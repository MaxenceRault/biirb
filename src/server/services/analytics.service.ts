import "server-only";
import { getAnalyticsConfig } from "@/server/config";
import { sendAnalyticsEvent } from "@/server/infra/analytics";
import { logInfo } from "@/server/logger";
import type { AnalyticsData, AnalyticsEvent } from "@/lib/analytics";

// Attendu (Cloud Run coupe le CPU après la réponse) mais jamais bloquant : une panne d'Umami n'annule aucune action.
// logInfo et non logError : une panne d'Umami ne doit pas déclencher l'alerte email de l'équipe.
export async function trackServerEvent(event: AnalyticsEvent, data?: AnalyticsData) {
  const config = getAnalyticsConfig();
  if (!config) return;
  try {
    await sendAnalyticsEvent(config, event, data);
  } catch (error) {
    logInfo("analytics", { event, failed: error instanceof Error ? error.message : "unknown" });
  }
}
