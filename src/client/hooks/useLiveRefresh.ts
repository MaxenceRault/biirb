import { useEffect, useEffectEvent } from "react";

const INTERVAL_MS = 30_000;

// Relit des données partagées toutes les 30 s, et dès que l'onglet redevient visible.
// Onglet caché ou hors ligne : aucune requête (pas de charge inutile sur l'unique instance Cloud Run).
export function useLiveRefresh(refresh: () => void, enabled = true) {
  const onRefresh = useEffectEvent(refresh);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === "visible" && navigator.onLine) onRefresh();
    };
    const timer = setInterval(tick, INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled]);
}
