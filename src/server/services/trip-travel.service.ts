import "server-only";
import { RoutingUnavailableError, searchPlaces, travelLegs, type GeoPoint } from "@/server/infra/openRouteService";
import { findTripById, findTripItems } from "@/server/repositories/trip.repository";
import {
  findDayItemPlaces,
  findTravelLegs,
  insertTravelLegs,
  saveItemPlace,
  type ItemPlaceRow,
  type LegKey,
  type LegRow,
} from "@/server/repositories/trip-travel.repository";
import { requireTripRole } from "@/server/services/trip-access.service";
import { requireTripPass } from "@/server/services/trip-pass.service";
import { TripError, tripDayAreas, type DayArea } from "@/server/services/trip.service";
import type { TravelProfile } from "@/schemas/trip.schema";

// À vol d'oiseau (la marche est plus longue, ≈ 2 km) : au-delà, le trajet en voiture (ou taxi) est donné aussi.
// Décidé sans attendre la marche : les deux calculs partent ensemble.
const DRIVE_FROM_METERS = 1_500;
// Recherches de lieux par requête : quota OpenRouteService (≈ 1 000 par jour, 100 par minute). Le reste au prochain affichage.
const MAX_SEARCHES = 8;
// Même limite que trip_item.place_query (db/migrations).
const PLACE_QUERY_MAX = 300;

export type TravelDuration = { minutes: number; meters: number };
export type TravelLeg = { fromItemId: number; toItemId: number; walk: TravelDuration | null; drive: TravelDuration | null };
// unlocated : lieu introuvable ; pending : pas encore cherché (limite de recherches atteinte, réessayé au prochain affichage).
export type DayTravel = { legs: TravelLeg[]; unlocated: number[]; pending: number[] };

// Temps de trajet entre les activités d'un jour (pass voyage) : chaque lieu est cherché une fois puis gardé en base,
// chaque tronçon calculé une fois puis partagé (travel_leg). Les transports coupent la journée : pas de trajet à travers.
export async function getDayTravel(userId: string, tripId: number, day: string): Promise<DayTravel> {
  // Vérifications et lectures en un seul aller-retour. Rien n'est renvoyé si une vérification échoue, et l'accès
  // passe avant le pass : un non-membre reçoit 404, jamais 402 (qui dirait que le voyage existe).
  const [access, pass, ...data] = await Promise.allSettled([
    requireTripRole(userId, tripId, "viewer"),
    requireTripPass(tripId),
    findTripById(tripId),
    findTripItems(tripId),
    findDayItemPlaces(tripId, day),
  ]);
  if (access.status === "rejected") throw access.reason;
  if (pass.status === "rejected") throw pass.reason;
  const [trip, items, places] = data.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }) as [Awaited<ReturnType<typeof findTripById>>, Awaited<ReturnType<typeof findTripItems>>, ItemPlaceRow[]];
  if (!trip) throw new TripError("NOT_FOUND");
  const area = tripDayAreas(trip, items)(day);
  if (!area) return { legs: [], unlocated: [], pending: [] };

  try {
    const { located, unlocated, pending } = await locateItems(tripId, places, area);
    const pairs = dayPairs(places).filter(([from, to]) => located.has(from.id) && located.has(to.id));
    const points = pairs.map(([from, to]): [GeoPoint, GeoPoint] => [located.get(from.id)!, located.get(to.id)!]);
    const farIndexes = points.flatMap(([from, to], index) => (straightMeters(from, to) > DRIVE_FROM_METERS ? [index] : []));
    const [walk, drive] = await Promise.all([
      legsFor(points, "foot-walking"),
      legsFor(farIndexes.map((index) => points[index]), "driving-car"),
    ]);

    return {
      legs: pairs.map(([from, to], index) => {
        const far = farIndexes.indexOf(index);
        return { fromItemId: from.id, toItemId: to.id, walk: duration(walk[index]), drive: far === -1 ? null : duration(drive[far]) };
      }),
      unlocated,
      pending,
    };
  } catch (error) {
    // Quota dépassé, panne ou clé absente : le voyage s'affiche sans trajets.
    if (error instanceof RoutingUnavailableError) throw new TripError("TRAVEL_UNAVAILABLE");
    throw error;
  }
}

// Coordonnées des activités du jour : lues en base si la recherche n'a pas changé, sinon cherchées (MAX_SEARCHES au plus).
async function locateItems(tripId: number, places: ItemPlaceRow[], area: DayArea) {
  const located = new Map<number, GeoPoint>();
  const unlocated: number[] = [];
  const toSearch: ItemPlaceRow[] = [];
  for (const place of places.filter(isSearchable)) {
    if (place.place_query !== searchKey(place, area)) toSearch.push(place);
    else if (place.latitude !== null && place.longitude !== null) located.set(place.id, roundPoint({ latitude: place.latitude, longitude: place.longitude }));
    else unlocated.push(place.id);
  }

  // Rien de distinctif à chercher (« Check-in à l'hôtel ») : introuvable, sans appel.
  const searchable = toSearch.filter((place) => searchText(place));
  for (const place of toSearch.filter((option) => !searchText(option))) {
    await saveItemPlace(tripId, place.id, searchKey(place, area), null);
    unlocated.push(place.id);
  }

  await Promise.all(
    searchable.slice(0, MAX_SEARCHES).map(async (place) => {
      const text = searchText(place);
      const candidates = (await searchPlaces(text, { near: area, country: area.country })).sort(
        (a, b) => layerRank(a.layer) - layerRank(b.layer),
      );
      const found = candidates.find((candidate) => placeNameMatches(text, candidate.name, area.name));
      await saveItemPlace(tripId, place.id, searchKey(place, area), found ? { latitude: found.latitude, longitude: found.longitude } : null);
      if (found) located.set(place.id, roundPoint(found));
      else unlocated.push(place.id);
    }),
  );
  return { located, unlocated, pending: searchable.slice(MAX_SEARCHES).map((place) => place.id) };
}

// Nom donné par Biirbou tel quel ; sinon les seuls mots distinctifs du titre (« Déjeuner chez Ichiran Shibuya » →
// « Ichiran Shibuya ») : OpenRouteService ne trouve rien avec les verbes et les articles. Vide : rien à chercher.
function searchText(place: ItemPlaceRow) {
  if (place.place_name) return place.place_name;
  return place.title
    .split(/\s+/)
    .filter((word) => distinctiveWords(word, new Set()).size > 0)
    .join(" ");
}

// Un lieu précis avant un quartier : « Ichiran Shibuya » est le restaurant, pas le quartier Shibuya.
const PRECISE_LAYERS = ["venue", "address", "street"];

function layerRank(layer: string) {
  const index = PRECISE_LAYERS.indexOf(layer);
  return index === -1 ? PRECISE_LAYERS.length : index;
}

// Transport (vol, train vers la ville suivante) : pas un lieu de la journée, et pas de trajet à pied à travers.
function isSearchable(place: ItemPlaceRow) {
  return place.category !== "transport";
}

function dayPairs(places: ItemPlaceRow[]) {
  const pairs: [ItemPlaceRow, ItemPlaceRow][] = [];
  for (let index = 1; index < places.length; index++) {
    const [from, to] = [places[index - 1], places[index]];
    if (isSearchable(from) && isSearchable(to)) pairs.push([from, to]);
  }
  return pairs;
}

// Ce qui a été cherché, et autour de quelle ville : un titre, un lieu ou une ville du jour qui change = nouvelle recherche.
function searchKey(place: ItemPlaceRow, area: DayArea) {
  const text = searchText(place) || place.title;
  return `${text} @${area.country}:${area.latitude.toFixed(2)},${area.longitude.toFixed(2)}`.slice(0, PLACE_QUERY_MAX);
}

// Tronçons lus dans le cache, les autres calculés en un appel puis gardés.
async function legsFor(pairs: [GeoPoint, GeoPoint][], profile: TravelProfile): Promise<(LegRow | null)[]> {
  const keys: LegKey[] = pairs.map(([from, to]) => ({
    fromLatitude: from.latitude,
    fromLongitude: from.longitude,
    toLatitude: to.latitude,
    toLongitude: to.longitude,
  }));
  const id = (key: LegKey) => `${key.fromLatitude},${key.fromLongitude},${key.toLatitude},${key.toLongitude}`;
  const known = new Map((await findTravelLegs(keys, profile)).map((leg) => [id(leg), leg]));

  // Même point (deux activités au même endroit) : pas d'appel.
  const missing = keys.filter((key) => !known.has(id(key)) && !samePoint(key));
  const computed = await travelLegs(
    missing.map((key) => [
      { latitude: key.fromLatitude, longitude: key.fromLongitude },
      { latitude: key.toLatitude, longitude: key.toLongitude },
    ]),
    profile,
  );
  const fresh = missing.flatMap((key, index) => (computed[index] ? [{ ...key, ...computed[index] }] : []));
  await insertTravelLegs(fresh, profile);
  for (const leg of fresh) known.set(id(leg), leg);

  return keys.map((key) => (samePoint(key) ? { ...key, durationSeconds: 0, distanceMeters: 0 } : (known.get(id(key)) ?? null)));
}

// Distance à vol d'oiseau (haversine).
function straightMeters(a: GeoPoint, b: GeoPoint) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function samePoint(key: LegKey) {
  return key.fromLatitude === key.toLatitude && key.fromLongitude === key.toLongitude;
}

// 4 décimales (≈ 10 m) : clé du cache partagé.
function roundPoint({ latitude, longitude }: GeoPoint): GeoPoint {
  return { latitude: Math.round(latitude * 10_000) / 10_000, longitude: Math.round(longitude * 10_000) / 10_000 };
}

function duration(leg: LegRow | null): TravelDuration | null {
  return leg && { minutes: Math.max(1, Math.round(leg.durationSeconds / 60)), meters: leg.distanceMeters };
}

// Mots trop courants pour identifier un lieu (« CHECK & CHECK » n'est pas « Check-in à l'hôtel »).
const GENERIC_WORDS = new Set(
  (
    "musee museum museo temple sanctuaire shrine jinja restaurant resto hotel hostel auberge ryokan visite visit dejeuner " +
    "diner lunch dinner breakfast balade promenade walk check parc park jardin garden gare station market marche quartier " +
    "district tour tower place square street rue avenue cafe bar art arts ramen sushi izakaya bistro brasserie pub " +
    "pizzeria trattoria boulangerie bakery plage beach retour depart arrivee installation nuit soiree matin " +
    "apres midi temps libre repos the les des une aux sur dans pour " +
    "avec and of at in to du la le et au en vers chez centre center city ville grand grande petit old new"
  ).split(" "),
);

function distinctiveWords(text: string, ignored: Set<string>) {
  const words = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word) && !ignored.has(word));
  return new Set(words);
}

// Le nom trouvé doit vraiment être celui cherché : au moins la moitié de ses mots distinctifs dans la recherche
// (« Meiji 100% Chocolate Cafe » n'est pas « Meiji Jingu »). Le nom de la ville du jour ne compte pas.
export function placeNameMatches(query: string, candidate: string, cityName: string | null) {
  const ignored = cityName ? distinctiveWords(cityName, new Set()) : new Set<string>();
  const wanted = [...distinctiveWords(query, ignored)];
  const found = [...distinctiveWords(candidate, ignored)];
  if (found.length === 0 || wanted.length === 0) return false;
  const close = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  const matching = found.filter((word) => wanted.some((other) => close(word, other))).length;
  return matching >= 1 && matching * 2 >= found.length;
}
