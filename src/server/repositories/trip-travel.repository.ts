import "server-only";
import { getDb } from "@/server/infra/db";
import type { TravelProfile, TripItemCategory } from "@/schemas/trip.schema";

// place_query : dernière recherche faite pour cette activité (null : jamais cherchée) ; coordonnées null : introuvable.
export type ItemPlaceRow = {
  id: number;
  start_time: string;
  title: string;
  category: TripItemCategory;
  place_name: string | null;
  place_query: string | null;
  latitude: number | null;
  longitude: number | null;
};

// Points arrondis à 4 décimales (≈ 10 m), comme les clés de travel_leg.
export type LegKey = { fromLatitude: number; fromLongitude: number; toLatitude: number; toLongitude: number };
export type LegRow = LegKey & { durationSeconds: number; distanceMeters: number };

export async function findDayItemPlaces(tripId: number, day: string): Promise<ItemPlaceRow[]> {
  const db = await getDb();
  const { rows } = await db.query<ItemPlaceRow>(
    `select id, to_char(start_time, 'HH24:MI') as start_time, title, category, place_name, place_query, latitude, longitude
     from trip_item where trip_id = $1 and day = $2
     order by start_time, id`,
    [tripId, day],
  );
  return rows;
}

// point null : lieu introuvable pour cette recherche (pas de nouvel essai tant qu'elle ne change pas).
export async function saveItemPlace(tripId: number, itemId: number, query: string, point: { latitude: number; longitude: number } | null) {
  const db = await getDb();
  await db.query("update trip_item set place_query = $3, latitude = $4, longitude = $5 where id = $1 and trip_id = $2", [
    itemId,
    tripId,
    query,
    point?.latitude ?? null,
    point?.longitude ?? null,
  ]);
}

export async function findTravelLegs(keys: LegKey[], profile: TravelProfile): Promise<LegRow[]> {
  if (keys.length === 0) return [];
  const db = await getDb();
  const { rows } = await db.query<{ a: string; b: string; c: string; d: string; duration_seconds: number; distance_meters: number }>(
    `select l.from_latitude as a, l.from_longitude as b, l.to_latitude as c, l.to_longitude as d, l.duration_seconds, l.distance_meters
     from travel_leg l
     join unnest($1::numeric[], $2::numeric[], $3::numeric[], $4::numeric[]) as k (a, b, c, d)
       on l.from_latitude = k.a and l.from_longitude = k.b and l.to_latitude = k.c and l.to_longitude = k.d
     where l.profile = $5`,
    [...legColumns(keys), profile],
  );
  // numeric arrive en texte : reconverti pour comparer aux clés.
  return rows.map((row) => ({
    fromLatitude: Number(row.a),
    fromLongitude: Number(row.b),
    toLatitude: Number(row.c),
    toLongitude: Number(row.d),
    durationSeconds: row.duration_seconds,
    distanceMeters: row.distance_meters,
  }));
}

// Trajet déjà calculé entre deux activités du voyage (lecture seule, jamais d'appel externe) : null si l'une n'a pas de
// lieu connu. Même arrondi que les clés de travel_leg ; même point : 0 minute.
export async function findCachedTravelBetween(
  tripId: number,
  fromItemId: number,
  toItemId: number,
): Promise<{ walkSeconds: number | null; driveSeconds: number | null } | null> {
  const db = await getDb();
  const point = (alias: string, prefix: string) =>
    `l.${prefix}_latitude = round(${alias}.latitude::numeric, 4) and l.${prefix}_longitude = round(${alias}.longitude::numeric, 4)`;
  const leg = (profileParam: string) =>
    `(select l.duration_seconds from travel_leg l where ${point("a", "from")} and ${point("b", "to")} and l.profile = ${profileParam}::travel_profile)`;
  const { rows } = await db.query<{ same: boolean; walk: number | null; drive: number | null }>(
    `select round(a.latitude::numeric, 4) = round(b.latitude::numeric, 4) and round(a.longitude::numeric, 4) = round(b.longitude::numeric, 4) as same,
       ${leg("$4")} as walk, ${leg("$5")} as drive
     from trip_item a join trip_item b on b.trip_id = a.trip_id
     where a.trip_id = $1 and a.id = $2 and b.id = $3 and a.latitude is not null and b.latitude is not null`,
    [tripId, fromItemId, toItemId, "foot-walking", "driving-car"],
  );
  const row = rows[0];
  if (!row) return null;
  return row.same ? { walkSeconds: 0, driveSeconds: null } : { walkSeconds: row.walk, driveSeconds: row.drive };
}

// Déjà présent (calculé entre-temps par une autre requête) : ignoré.
export async function insertTravelLegs(legs: LegRow[], profile: TravelProfile) {
  if (legs.length === 0) return;
  const db = await getDb();
  await db.query(
    `insert into travel_leg (from_latitude, from_longitude, to_latitude, to_longitude, profile, duration_seconds, distance_meters)
     select a, b, c, d, $5, e, f from unnest($1::numeric[], $2::numeric[], $3::numeric[], $4::numeric[], $6::int[], $7::int[]) as k (a, b, c, d, e, f)
     on conflict do nothing`,
    [...legColumns(legs), profile, legs.map((leg) => leg.durationSeconds), legs.map((leg) => leg.distanceMeters)],
  );
}

function legColumns(keys: LegKey[]) {
  return [keys.map((key) => key.fromLatitude), keys.map((key) => key.fromLongitude), keys.map((key) => key.toLatitude), keys.map((key) => key.toLongitude)];
}
