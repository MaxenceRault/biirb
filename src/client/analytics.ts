import type { AnalyticsData, AnalyticsEvent } from "@/lib/analytics";

declare global {
  interface Window {
    umami?: { track: (event: string, data?: AnalyticsData) => void };
  }
}

// Le script Umami se charge après l'hydratation : un événement émis avant attend quelques secondes.
// Script absent (non configuré, bloqué par l'utilisateur) : l'événement est abandonné sans erreur.
const RETRY_MS = 250;
const MAX_TRIES = 40;

export function trackEvent(event: AnalyticsEvent, data?: AnalyticsData) {
  let tries = 0;
  const send = () => {
    if (window.umami) return window.umami.track(event, data);
    if (++tries < MAX_TRIES) setTimeout(send, RETRY_MS);
  };
  send();
}
