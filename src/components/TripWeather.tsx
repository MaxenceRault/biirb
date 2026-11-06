"use client";

import { useTranslations } from "next-intl";
import type { DayWeather, TripWeather } from "@/client/hooks/useTripWeather";
import type { TripWeatherKind } from "@/schemas/trip.schema";

const WEATHER_EMOJIS: Record<TripWeatherKind, string> = {
  clear: "☀️",
  partly: "⛅",
  cloudy: "☁️",
  fog: "🌫️",
  rain: "🌧️",
  snow: "🌨️",
  storm: "⛈️",
};

// Météo d'une journée du planning (#26). horizon : jour couvert par les prévisions ; au-delà, rien n'est affiché
// (ni estimé). Source citée, exigée par la licence CC BY 4.0 de MET Norway.
export function DayWeatherLine({ weather, day, horizon }: { weather: TripWeather | null; day: string; horizon: boolean }) {
  const t = useTranslations("Planner.weather");
  if (!weather || !horizon) return null;
  const forecast: DayWeather | undefined = weather.days.find((entry) => entry.day === day);

  if (!forecast) {
    return weather.unavailable ? <p className="text-label-sm text-ink-soft">{t("unavailable")}</p> : null;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-ink">
      <span aria-hidden="true">{WEATHER_EMOJIS[forecast.kind]}</span>
      <span>
        {t(forecast.place ? "summaryAt" : "summary", {
          kind: t(`kinds.${forecast.kind}`),
          place: forecast.place ?? "",
          min: forecast.min,
          max: forecast.max,
          rain: forecast.precipitationMm,
        })}
      </span>
      <a href="https://www.met.no/en" target="_blank" rel="noopener noreferrer" className="text-label-sm text-ink-soft hover:underline">
        {t("source")}
      </a>
    </p>
  );
}
