import "server-only";
import webpush from "web-push";
import type { PushConfig } from "@/server/config";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

// "gone" : abonnement expiré ou révoqué par le navigateur (404 / 410), à supprimer.
export async function sendWebPush(config: PushConfig, target: PushTarget, payload: object): Promise<"sent" | "gone"> {
  try {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      // Une notification de plus d'une heure n'a plus d'intérêt ; une requête ne reste pas bloquée sur le service.
      TTL: 3600,
      timeout: 10_000,
    });
    return "sent";
  } catch (error) {
    if (error instanceof webpush.WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "gone";
    throw error;
  }
}
