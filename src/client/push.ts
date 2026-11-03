import { apiFetch } from "@/client/session";

// "unavailable" : navigateur sans push, ou service worker absent (il n'est enregistré qu'en production).
export type PushResult = "ok" | "denied" | "unavailable" | "error";

export function isPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Demande l'autorisation (au clic seulement, jamais au chargement), abonne cet appareil et l'enregistre côté serveur.
export async function subscribeThisDevice(publicKey: string): Promise<PushResult> {
  if (!isPushSupported()) return "unavailable";
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return "unavailable";
  if ((await Notification.requestPermission()) !== "granted") return "denied";

  try {
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
    const { keys } = subscription.toJSON();
    if (!keys?.p256dh || !keys.auth) return "error";
    // Seuls les champs attendus (le schéma du serveur refuse tout champ inconnu, comme expirationTime).
    const result = await apiFetch("/api/v1/users/me/push-subscriptions", {
      method: "POST",
      body: { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    });
    return "data" in result ? "ok" : "error";
  } catch {
    return "error";
  }
}

// Déconnexion : cet appareil ne reçoit plus rien pour ce compte (le compte suivant devra s'abonner à son tour).
export async function unsubscribeThisDevice() {
  if (!isPushSupported()) return;
  const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!subscription) return;
  await apiFetch("/api/v1/users/me/push-subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe().catch(() => false);
}

function base64UrlToBytes(value: string) {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
