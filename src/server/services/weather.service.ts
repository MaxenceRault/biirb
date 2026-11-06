import "server-only";
import { getForecast, WeatherUnavailableError, type ForecastStep } from "@/server/infra/weather";
import { logInfo } from "@/server/logger";
import { timeZoneAt } from "@/server/services/location.service";
import { TRIP_WEATHER_KINDS, type TripWeatherKind } from "@/schemas/trip.schema";

// Météo du jour (#26) à partir des prévisions : min / max, pluie cumulée et temps dominant en journée (8 h - 20 h locales).
export type DayWeather = { day: string; place: string | null; kind: TripWeatherKind; min: number; max: number; precipitationMm: number };
export type WeatherPoint = { name: string | null; latitude: number; longitude: number };
// unavailable : au moins un lieu sans prévision (panne, délai) ; les jours trouvés restent renvoyés.
export type ForecastResult = { days: DayWeather[]; unavailable: boolean };

const DAYTIME = { from: 8, to: 20 };

// Codes de MET Norway (« lightrainshowers_day », « partlycloudy_night »…) ramenés à quelques temps.
function weatherKind(symbol: string): TripWeatherKind {
  const base = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (base.includes("thunder")) return "storm";
  if (base.includes("snow") || base.includes("sleet")) return "snow";
  if (base.includes("rain")) return "rain";
  if (base === "fog") return "fog";
  if (base === "cloudy") return "cloudy";
  if (base === "partlycloudy" || base === "fair") return "partly";
  return "clear";
}

function localParts(time: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(time))
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function summarize(day: string, place: WeatherPoint, steps: ForecastStep[]): DayWeather | null {
  const timeZone = timeZoneAt(place) ?? "UTC";
  const ofDay = steps.map((step) => ({ step, ...localParts(step.time, timeZone) })).filter((entry) => entry.day === day);
  const temperatures = ofDay.flatMap(({ step }) => (step.temperature === null ? [] : [step.temperature]));
  if (temperatures.length === 0) return null;
  const daytime = ofDay.filter(({ hour }) => hour >= DAYTIME.from && hour < DAYTIME.to);
  const kinds = (daytime.length > 0 ? daytime : ofDay).flatMap(({ step }) => (step.symbol ? [weatherKind(step.symbol)] : []));
  return {
    day,
    place: place.name,
    kind: kinds.reduce<TripWeatherKind>((worst, kind) => (TRIP_WEATHER_KINDS.indexOf(kind) > TRIP_WEATHER_KINDS.indexOf(worst) ? kind : worst), "clear"),
    min: Math.round(Math.min(...temperatures)),
    max: Math.round(Math.max(...temperatures)),
    precipitationMm: Math.round(rainfall(ofDay.map(({ step }) => step)) * 10) / 10,
  };
}

// Pluie cumulée : une fenêtre de 6 h qui chevauche la précédente n'est pas recomptée.
function rainfall(steps: ForecastStep[]) {
  let coveredUntil = 0;
  let total = 0;
  for (const step of steps) {
    const start = Date.parse(step.time);
    if (step.hours === null || step.precipitationMm === null || start < coveredUntil) continue;
    total += step.precipitationMm;
    coveredUntil = start + step.hours * 60 * 60_000;
  }
  return total;
}

// Jours demandés au-delà des prévisions (environ 9 jours) : absents du résultat, jamais estimés.
export async function forecastDays(requests: { day: string; place: WeatherPoint }[]): Promise<ForecastResult> {
  const points = new Map<string, WeatherPoint>();
  for (const { place } of requests) points.set(`${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`, place);
  const forecasts = new Map<string, ForecastStep[]>();
  let unavailable = false;
  await Promise.all(
    [...points].map(async ([key, place]) => {
      try {
        forecasts.set(key, await getForecast(place));
      } catch (error) {
        unavailable = true;
        if (!(error instanceof WeatherUnavailableError)) throw error;
        // Panne d'un service externe : pas une erreur de Biirb (pas d'alerte email), le voyageur le voit à l'écran.
        logInfo("weather", { message: "MET Norway indisponible", reason: error.message });
      }
    }),
  );
  const days = requests.flatMap(({ day, place }) => {
    const steps = forecasts.get(`${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`);
    const weather = steps && summarize(day, place, steps);
    return weather ? [weather] : [];
  });
  return { days, unavailable };
}
