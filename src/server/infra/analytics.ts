import "server-only";
import type { AnalyticsConfig } from "@/server/config";
import type { AnalyticsData, AnalyticsEvent } from "@/lib/analytics";

// Même destination que le script du navigateur (CSP : connect-src).
const ENDPOINT = "https://gateway.umami.is/api/send";
const TIMEOUT_MS = 2_000;
// Umami ignore sans erreur les User-Agent de robot (isbot) : « node », « Biirb/1.0 », « …Server… » le sont, celui-ci non.
const USER_AGENT = "Mozilla/5.0 (Linux x86_64) Biirb/1.0";

// Ni IP ni User-Agent du visiteur : les événements serveur sont comptés sans être rattachés à une personne.
export async function sendAnalyticsEvent(config: AnalyticsConfig, event: AnalyticsEvent, data?: AnalyticsData) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      type: "event",
      payload: { website: config.websiteId, hostname: config.domain ?? undefined, url: "/server", name: event, data },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Umami ${response.status}`);
}
