"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/client/session";

export type TravelDuration = { minutes: number; meters: number };
export type TravelLeg = { fromItemId: number; toItemId: number; walk: TravelDuration | null; drive: TravelDuration | null };
// deferred : plafond du site atteint ou service indisponible, une partie des trajets viendra plus tard.
export type DayTravel = { legs: TravelLeg[]; unlocated: number[]; pending: number[]; deferred: boolean };

// Recherches de lieux limitées par appel côté serveur : la suite est demandée aussitôt, quelques fois au plus.
const MAX_FOLLOW_UPS = 3;

// Dernier résultat de chaque journée (onglet en cours) : revenir sur un jour est immédiat, et après une modification
// les trajets connus restent affichés le temps du recalcul. Durées et ids seulement, rien de personnel.
const lastByDay = new Map<string, { itemsKey: string; travel: DayTravel }>();

// Trajets d'une journée (pass voyage), recalculés quand ses activités changent (itemsKey). unavailable : fonction
// coupée (clé absente) ; le planning s'affiche alors sans trajets.
export function useDayTravel(tripId: string, day: string, itemsKey: string, enabled: boolean) {
  const dayKey = `${tripId}|${day}`;
  const [state, setState] = useState<{ dayKey: string; itemsKey: string; travel: DayTravel | null; unavailable: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let followUps = 0;

    async function load() {
      const result = await apiFetch<DayTravel>(`/api/v1/trips/${tripId}/days/${day}/travel`);
      if (cancelled) return;
      if (!("data" in result)) return setState({ dayKey, itemsKey, travel: null, unavailable: result.error === "TRAVEL_UNAVAILABLE" });
      lastByDay.set(dayKey, { itemsKey, travel: result.data });
      setState({ dayKey, itemsKey, travel: result.data, unavailable: false });
      // En attente à cause du plafond : redemander tout de suite heurterait la même limite.
      if (!result.data.deferred && result.data.pending.length > 0 && followUps++ < MAX_FOLLOW_UPS) await load();
    }

    // Déjà complet pour ces activités : pas d'appel. Une journée en attente est redemandée en y revenant.
    const last = lastByDay.get(dayKey);
    if (last?.itemsKey !== itemsKey || last.travel.deferred || last.travel.pending.length > 0) void load();
    return () => {
      cancelled = true;
    };
  }, [tripId, day, dayKey, itemsKey, enabled]);

  if (!enabled) return null;
  if (state?.dayKey === dayKey && state.itemsKey === itemsKey) return state;
  // En attendant la réponse : le dernier résultat de ce jour (les tronçons disparus ne s'affichent plus, ids différents).
  const last = lastByDay.get(dayKey);
  return last ? { dayKey, itemsKey: last.itemsKey, travel: last.travel, unavailable: false } : null;
}
