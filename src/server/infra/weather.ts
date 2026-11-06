import "server-only";
import { z } from "zod";
import { getSiteUrl } from "@/server/config";

// Prévisions de MET Norway (api.met.no, institut météorologique norvégien) : gratuites y compris en usage commercial,
// sans clé, licence CC BY 4.0 (source affichée à l'écran). Appelé côté serveur uniquement ; réponses revalidées.
// Conditions d'utilisation : User-Agent identifiant l'app, coordonnées à 4 décimales au plus, cache jusqu'à Expires.
const API = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const TIMEOUT_MS = 5_000;
const DEFAULT_TTL_MS = 60 * 60_000;
// Une ville suffit pour la météo du jour : 2 décimales (≈ 1 km) partagent le cache entre voyages proches.
const DECIMALS = 2;
const MAX_CACHED_POINTS = 500;

const summary = z.object({ summary: z.object({ symbol_code: z.string().max(60) }) });
const precipitation = z.object({ details: z.object({ precipitation_amount: z.number().min(0).max(1000).optional() }).optional() });
const forecastSchema = z.object({
  properties: z.object({
    timeseries: z
      .array(
        z.object({
          time: z.iso.datetime(),
          data: z.object({
            instant: z.object({ details: z.object({ air_temperature: z.number().min(-100).max(70).optional() }) }),
            next_1_hours: summary.and(precipitation).optional(),
            next_6_hours: summary.and(precipitation).optional(),
          }),
        }),
      )
      .max(200),
  }),
});

export type ForecastStep = { time: string; temperature: number | null; symbol: string | null; precipitationMm: number | null; hours: 1 | 6 | null };

export class WeatherUnavailableError extends Error {}

const cache = new Map<string, { expires: number; steps: ForecastStep[] }>();

function userAgent() {
  // Contact demandé par MET Norway : l'adresse du site (jamais un email personnel).
  return `Biirb/1.0 (${getSiteUrl()?.origin ?? "https://github.com/MaxenceRault/biirb"})`;
}

// Prévisions heure par heure (puis par 6 h) des 9 prochains jours environ autour d'un point.
export async function getForecast({ latitude, longitude }: { latitude: number; longitude: number }): Promise<ForecastStep[]> {
  const lat = latitude.toFixed(DECIMALS);
  const lon = longitude.toFixed(DECIMALS);
  const key = `${lat},${lon}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.steps;

  // Délai dépassé, réseau, quota (429), panne ou réponse illisible : indisponible, jamais une erreur 500.
  const response = await fetch(`${API}?lat=${lat}&lon=${lon}`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new WeatherUnavailableError(`MET Norway injoignable : ${error instanceof Error ? error.name : "inconnu"}`);
  });
  if (!response.ok) throw new WeatherUnavailableError(`MET Norway ${response.status}`);
  const parsed = forecastSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new WeatherUnavailableError("MET Norway : réponse hors format");

  const steps = parsed.data.properties.timeseries.map(({ time, data }): ForecastStep => {
    const next = data.next_1_hours ?? data.next_6_hours;
    return {
      time,
      temperature: data.instant.details.air_temperature ?? null,
      symbol: next?.summary.symbol_code ?? null,
      precipitationMm: next?.details?.precipitation_amount ?? null,
      hours: data.next_1_hours ? 1 : data.next_6_hours ? 6 : null,
    };
  });
  const expires = Date.parse(response.headers.get("expires") ?? "");
  if (cache.size >= MAX_CACHED_POINTS) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Number.isFinite(expires) && expires > Date.now() ? expires : Date.now() + DEFAULT_TTL_MS, steps });
  return steps;
}
