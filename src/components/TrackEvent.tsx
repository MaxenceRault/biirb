"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/client/analytics";
import type { AnalyticsData, AnalyticsEvent } from "@/lib/analytics";

// Émet un événement d'audience une fois à l'affichage (le ref évite le double envoi du Strict Mode).
export function TrackEvent({ event, data }: { event: AnalyticsEvent; data?: AnalyticsData }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackEvent(event, data);
  }, [event, data]);
  return null;
}
