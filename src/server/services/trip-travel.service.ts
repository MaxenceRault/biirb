import "server-only";
import { getRoutingConfig, type RoutingBudget } from "@/server/config";
import { logInfo } from "@/server/logger";
import { RoutingUnavailableError, searchPlaces, travelLegs, type GeoPoint, type TravelLegResult } from "@/server/infra/openRouteService";
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
import { TripError, liveTripDay, tripDayAreas, type DayArea } from "@/server/services/trip.service";
import type { TravelProfile } from "@/schemas/trip.schema";

// À vol d'oiseau (la marche est plus longue, ≈ 2 km) : au-delà, le trajet en voiture (ou taxi) est donné aussi.
// Décidé sans attendre la marche : les deux calculs partent ensemble.
const DRIVE_FROM_METERS = 1_500;
// Recherches de lieux par requête (plan gratuit : 3 000 par jour, 100 par minute) : le reste au prochain affichage.
const MAX_SEARCHES = 8;
// Au-delà de cette part du plafond du jour, seul le jour en cours d'un voyage en cours lance de nouveaux calculs.
const RESERVED_FROM = 0.8;
// Même limite que trip_item.place_query (db/migrations).
const PLACE_QUERY_MAX = 300;

export type TravelDuration = { minutes: number; meters: number };
export type TravelLeg = { fromItemId: number; toItemId: number; walk: TravelDuration | null; drive: TravelDuration | null };
// unlocated : lieu introuvable ; pending : pas encore cherché (réessayé au prochain affichage) ; deferred : plafond du
// site atteint ou OpenRouteService indisponible, une partie des trajets attend (jamais une erreur pour le voyageur).
export type DayTravel = { legs: TravelLeg[]; unlocated: number[]; pending: number[]; deferred: boolean };

type RoutingCall = "geocode" | "matrix";

// Compteurs de tout le site, en mémoire comme les rate limits (une seule instance Cloud Run).
const usage: Record<RoutingCall, { day: Window; minute: Window }> = {
  geocode: { day: { count: 0, resetAt: 0 }, minute: { count: 0, resetAt: 0 } },
  matrix: { day: { count: 0, resetAt: 0 }, minute: { count: 0, resetAt: 0 } },
};
type Window = { count: number; resetAt: number; logged?: boolean };

// Un appel à OpenRouteService est-il permis ? Compté s'il l'est. priority : jour en cours d'un voyage en cours.
function takeRoutingCall(call: RoutingCall, budget: RoutingBudget, priority: boolean) {
  const now = Date.now();
  const { day, minute } = usage[call];
  if (day.resetAt <= now) Object.assign(day, { count: 0, resetAt: now + 24 * 60 * 60 * 1000, logged: false });
  if (minute.resetAt <= now) Object.assign(minute, { count: 0, resetAt: now + 60 * 1000 });

  const dayLimit = priority ? budget.daily : Math.floor(budget.daily * RESERVED_FROM);
  if (day.count >= dayLimit || minute.count >= budget.perMinute) {
    // Une fois par jour et par type d'appel : de quoi voir s'il faut un plus gros quota, sans donnée personnelle.
    if (day.count >= dayLimit && !day.logged) {
      day.logged = true;
      logInfo("routing", { message: "plafond OpenRouteService atteint", call, used: day.count, limit: dayLimit, priority });
    }
    return false;
  }
  day.count += 1;
  minute.count += 1;
  return true;
}

// Plafond atteint ou panne pendant cette requête : ce qui est en cache est quand même renvoyé.
type Budget = { take: (call: RoutingCall) => boolean; deferred: boolean };

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
  // Clé absente : la fonction est coupée (seul cas d'erreur).
  const config = getRoutingConfig();
  if (!config) throw new TripError("TRAVEL_UNAVAILABLE");
  const area = tripDayAreas(trip, items)(day);
  if (!area) return { legs: [], unlocated: [], pending: [], deferred: false };

  const priority = liveTripDay(trip, items) === day;
  const budget: Budget = { take: (call) => takeRoutingCall(call, config.budget[call], priority), deferred: false };
  const { located, unlocated, pending } = await locateItems(tripId, places, area, budget);
    const pairs = dayPairs(places).filter(([from, to]) => located.has(from.id) && located.has(to.id));
    const points = pairs.map(([from, to]): [GeoPoint, GeoPoint] => [located.get(from.id)!, located.get(to.id)!]);
    const farIndexes = points.flatMap(([from, to], index) => (straightMeters(from, to) > DRIVE_FROM_METERS ? [index] : []));
  const [walkCache, driveCache] = await Promise.all([
    cachedLegs(points, "foot-walking"),
    cachedLegs(farIndexes.map((index) => points[index]), "driving-car"),
  ]);
  // À pied d'abord : c'est le trajet affiché par défaut ; la voiture prend ce qui reste du budget.
  const [walk, drive] = await Promise.all([completeLegs(walkCache, budget), completeLegs(driveCache, budget)]);

  return {
    legs: pairs.map(([from, to], index) => {
      const far = farIndexes.indexOf(index);
      return { fromItemId: from.id, toItemId: to.id, walk: duration(walk[index]), drive: far === -1 ? null : duration(drive[far]) };
    }),
    unlocated,
    pending,
    deferred: budget.deferred,
  };
}

// Panne, délai, quota (429) ou réponse hors format : null, et la requête est marquée « en attente ».
async function orWait<T>(budget: Budget, request: () => Promise<T>): Promise<T | null> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof RoutingUnavailableError)) throw error;
    logInfo("routing", { message: "OpenRouteService indisponible", reason: error.message });
    budget.deferred = true;
    return null;
  }
}

// Coordonnées des activités du jour : lues en base si la recherche n'a pas changé, sinon cherchées (MAX_SEARCHES au plus).
async function locateItems(tripId: number, places: ItemPlaceRow[], area: DayArea, budget: Budget) {
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

  // Plafond atteint : le reste attend, sans être marqué introuvable (cherché au prochain affichage).
  const allowed: ItemPlaceRow[] = [];
  for (const place of searchable.slice(0, MAX_SEARCHES)) {
    if (!budget.take("geocode")) {
      budget.deferred = true;
      break;
    }
    allowed.push(place);
  }
  const pending = searchable.filter((place) => !allowed.includes(place)).map((place) => place.id);
  await Promise.all(
    allowed.map(async (place) => {
      const text = searchText(place);
      const candidates = await orWait(budget, () => searchPlaces(text, { near: area, country: area.country }));
      // Panne : rien n'est enregistré, nouvel essai au prochain affichage.
      if (!candidates) return pending.push(place.id);
      const found = candidates
        // Une ville, une région ou un pays n'est pas le lieu d'une activité : son centre donnerait un trajet faux.
        .filter((candidate) => !COARSE_LAYERS.has(candidate.layer))
        .sort((a, b) => layerRank(a.layer) - layerRank(b.layer))
        .find((candidate) => placeNameMatches(text, candidate.name, area.name));
      await saveItemPlace(tripId, place.id, searchKey(place, area), found ? { latitude: found.latitude, longitude: found.longitude } : null);
      if (found) located.set(place.id, roundPoint(found));
      else unlocated.push(place.id);
    }),
  );
  return { located, unlocated, pending };
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
const COARSE_LAYERS = new Set(["locality", "localadmin", "county", "macrocounty", "region", "macroregion", "country", "dependency", "empire", "continent", "ocean", "marinearea"]);

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
  // « v2 » : lieux cherchés avant le refus des villes et régions entières, cherchés de nouveau une fois.
  return `v2 ${text} @${area.country}:${area.latitude.toFixed(2)},${area.longitude.toFixed(2)}`.slice(0, PLACE_QUERY_MAX);
}

// Tronçons déjà en cache, et ceux qui manquent.
async function cachedLegs(pairs: [GeoPoint, GeoPoint][], profile: TravelProfile) {
  const keys: LegKey[] = pairs.map(([from, to]) => ({
    fromLatitude: from.latitude,
    fromLongitude: from.longitude,
    toLatitude: to.latitude,
    toLongitude: to.longitude,
  }));
  const known = new Map((await findTravelLegs(keys, profile)).map((leg) => [legId(leg), leg]));
  // Même point (deux activités au même endroit) : pas d'appel.
  const missing = keys.filter((key) => !known.has(legId(key)) && !samePoint(key));
  return { profile, keys, known, missing };
}

// Tronçons manquants calculés en un appel puis gardés ; plafond atteint ou panne : seuls ceux du cache s'affichent.
// Le budget est pris avant toute attente : l'ordre des appels décide qui passe en premier.
async function completeLegs({ profile, keys, known, missing }: Awaited<ReturnType<typeof cachedLegs>>, budget: Budget) {
  const allowed = missing.length > 0 && budget.take("matrix");
  if (missing.length > 0 && !allowed) budget.deferred = true;

  let computed: TravelLegResult[] = [];
  if (allowed) {
    const pairsToCompute = missing.map((key): [GeoPoint, GeoPoint] => [
      { latitude: key.fromLatitude, longitude: key.fromLongitude },
      { latitude: key.toLatitude, longitude: key.toLongitude },
    ]);
    computed = (await orWait(budget, () => travelLegs(pairsToCompute, profile))) ?? [];
  }
  const fresh = missing.flatMap((key, index) => (computed[index] ? [{ ...key, ...computed[index] }] : []));
  await insertTravelLegs(fresh, profile);
  for (const leg of fresh) known.set(legId(leg), leg);

  return keys.map((key): LegRow | null => (samePoint(key) ? { ...key, durationSeconds: 0, distanceMeters: 0 } : (known.get(legId(key)) ?? null)));
}

function legId(key: LegKey) {
  return `${key.fromLatitude},${key.fromLongitude},${key.toLatitude},${key.toLongitude}`;
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
