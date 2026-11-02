import "server-only";
import { z } from "zod";
import { getRoutingConfig } from "@/server/config";

// OpenRouteService (données OpenStreetMap, © openrouteservice.org by HeiGIT) : recherche de lieux et trajets.
// Appelé côté serveur uniquement : la clé ne quitte jamais le serveur. Réponses revalidées (service externe).
const API = "https://api.openrouteservice.org";
const TIMEOUT_MS = 5_000;
// Recherche autour de la ville du jour : au-delà, ce n'est plus le lieu de l'activité.
const SEARCH_RADIUS_KM = 30;
const SEARCH_RESULTS = 5;

export type GeoPoint = { latitude: number; longitude: number };
export type PlaceCandidate = GeoPoint & { name: string; layer: string };
export type TravelProfile = "foot-walking" | "driving-car";
export type TravelLegResult = { durationSeconds: number; distanceMeters: number } | null;

const coordinates = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const searchSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates }),
      properties: z.object({ name: z.string().max(300), layer: z.string().max(40) }),
    }),
  ),
});
const matrixSchema = z.object({
  durations: z.array(z.array(z.number().nonnegative().nullable())),
  distances: z.array(z.array(z.number().nonnegative().nullable())),
});

export class RoutingUnavailableError extends Error {}

async function call(path: string, init: RequestInit) {
  const config = getRoutingConfig();
  if (!config) throw new RoutingUnavailableError("ORS_API_KEY absente");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: config.apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Quota dépassé (429) ou panne : le voyage s'affiche sans trajets.
  if (!response.ok) throw new RoutingUnavailableError(`OpenRouteService ${response.status}`);
  return response.json();
}

// Lieux d'un nom, autour d'un point et dans un pays (ISO 3166-1 alpha-2). Le choix du bon résultat revient au service.
export async function searchPlaces(text: string, { near, country }: { near: GeoPoint; country: string }): Promise<PlaceCandidate[]> {
  const params = new URLSearchParams({
    text,
    size: String(SEARCH_RESULTS),
    "focus.point.lat": String(near.latitude),
    "focus.point.lon": String(near.longitude),
    "boundary.circle.lat": String(near.latitude),
    "boundary.circle.lon": String(near.longitude),
    "boundary.circle.radius": String(SEARCH_RADIUS_KM),
    "boundary.country": country,
  });
  const { features } = searchSchema.parse(await call(`/geocode/search?${params}`, { method: "GET" }));
  return features.map(({ geometry, properties }) => ({
    name: properties.name,
    layer: properties.layer,
    longitude: geometry.coordinates[0],
    latitude: geometry.coordinates[1],
  }));
}

// Trajets entre points consécutifs (A→B, B→C…) en un seul appel : null si aucun itinéraire (île, point isolé).
export async function consecutiveLegs(points: GeoPoint[], profile: TravelProfile): Promise<TravelLegResult[]> {
  if (points.length < 2) return [];
  const body = {
    locations: points.map(({ latitude, longitude }) => [longitude, latitude]),
    sources: points.slice(0, -1).map((_, index) => index),
    destinations: points.slice(1).map((_, index) => index + 1),
    metrics: ["duration", "distance"],
  };
  const { durations, distances } = matrixSchema.parse(
    await call(`/v2/matrix/${profile}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  );
  // Ligne i = départ i, colonne i = arrivée i + 1 : le tronçon i est sur la diagonale.
  return points.slice(1).map((_, index) => {
    const duration = durations[index]?.[index];
    const distance = distances[index]?.[index];
    return duration == null || distance == null ? null : { durationSeconds: Math.round(duration), distanceMeters: Math.round(distance) };
  });
}
