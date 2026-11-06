"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/client/session";
import type { TripWeatherKind } from "@/schemas/trip.schema";

export type DayWeather = { day: string; place: string | null; kind: TripWeatherKind; min: number; max: number; precipitationMm: number };
export type TripWeather = { days: DayWeather[]; unavailable: boolean };

// Prévisions du voyage (#26), lues une fois à l'ouverture (le serveur les garde en cache) et à la reconnexion.
// Échec de l'appel : unavailable, pour le dire à l'écran plutôt que de ne rien afficher (#68).
export function useTripWeather(tripId: string, enabled: boolean) {
  const [weather, setWeather] = useState<TripWeather | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void apiFetch<TripWeather>(`/api/v1/trips/${tripId}/weather`).then((result) => {
      if (!cancelled) setWeather("data" in result ? result.data : { days: [], unavailable: true });
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);

  return enabled ? weather : null;
}
