"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/client/session";

export type TravelDuration = { minutes: number; meters: number };
export type TravelLeg = { fromItemId: number; toItemId: number; walk: TravelDuration | null; drive: TravelDuration | null };
export type DayTravel = { legs: TravelLeg[]; unlocated: number[]; pending: number[] };

// Recherches de lieux limitées par appel côté serveur : la suite est demandée aussitôt, quelques fois au plus.
const MAX_FOLLOW_UPS = 3;
const FOLLOW_UP_DELAY_MS = 1_000;

// Trajets d'une journée (pass voyage) : rechargés quand ses activités changent (itemsKey). unavailable : service
// indisponible (quota, panne) ; le planning s'affiche alors sans trajets.
export function useDayTravel(tripId: string, day: string, itemsKey: string, enabled: boolean) {
  const key = `${day}|${itemsKey}`;
  const [state, setState] = useState<{ key: string; travel: DayTravel | null; unavailable: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let followUps = 0;

    async function load() {
      const result = await apiFetch<DayTravel>(`/api/v1/trips/${tripId}/days/${day}/travel`);
      if (cancelled) return;
      if (!("data" in result)) return setState({ key, travel: null, unavailable: result.error === "TRAVEL_UNAVAILABLE" });
      setState({ key, travel: result.data, unavailable: false });
      if (result.data.pending.length > 0 && followUps++ < MAX_FOLLOW_UPS) timer = setTimeout(() => void load(), FOLLOW_UP_DELAY_MS);
    }

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tripId, day, key, enabled]);

  return enabled && state?.key === key ? state : null;
}
