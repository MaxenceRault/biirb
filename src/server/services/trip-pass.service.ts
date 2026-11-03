import "server-only";
import { createHmac } from "node:crypto";
import { getBuyMeACoffeeConfig, type TripPassConfig } from "@/server/config";
import { logInfo } from "@/server/logger";
import { findActiveUserIdByEmail, findUserEmail } from "@/server/repositories/patron.repository";
import { hasActiveTripPass, recordTripPassPurchase, refundTripPass, saveTripPassOrder } from "@/server/repositories/trip-pass.repository";
import { aiDailyLimitPerUser, aiDailyLimitWithTripPass } from "@/server/services/ai-quota.service";
import { trackServerEvent } from "@/server/services/analytics.service";
import { requireTripRole } from "@/server/services/trip-access.service";
import { bmcExtraPurchaseSchema } from "@/schemas/patron.schema";
import { LEGAL_VERSIONS } from "@/lib/legal";

export class TripPassError extends Error {
  constructor(public readonly code: "PASS_REQUIRED" | "PASS_UNAVAILABLE" | "PASS_ALREADY_ACTIVE" | "INVALID_PAYLOAD") {
    super(code);
  }
}

export type TripPassStatus = {
  active: boolean;
  // false : pass pas en vente (Buy Me a Coffee non configuré).
  available: boolean;
  priceEur: number | null;
};

function tripPassConfig(): TripPassConfig | null {
  return getBuyMeACoffeeConfig()?.tripPass ?? null;
}

export async function getTripPassStatus(tripId: number): Promise<TripPassStatus> {
  const config = tripPassConfig();
  return { active: await hasActiveTripPass(tripId), available: config !== null, priceEur: config?.priceEur ?? null };
}

export type TripPassOffer = { available: boolean; priceEur: number | null; aiDailyLimit: number; aiDailyLimitPass: number };

// Accueil : prix et nombre d'aides de Biirbou par jour, lus dans la configuration (jamais écrits en dur dans la page).
export function getTripPassOffer(): TripPassOffer {
  const config = tripPassConfig();
  return {
    available: config !== null,
    priceEur: config?.priceEur ?? null,
    aiDailyLimit: aiDailyLimitPerUser(),
    aiDailyLimitPass: aiDailyLimitWithTripPass(),
  };
}

// Toujours relu en base : jamais déduit d'une donnée envoyée par le navigateur.
export async function requireTripPass(tripId: number) {
  if (!(await hasActiveTripPass(tripId))) throw new TripPassError("PASS_REQUIRED");
}

// Propriétaire uniquement, après les cases CGV et renonciation (validées par le schéma du controller).
// L'achat est rattaché au voyage par l'email du compte : affiché à son titulaire seulement.
export async function startTripPassCheckout(userId: string, tripId: number): Promise<{ url: string; email: string | null }> {
  await requireTripRole(userId, tripId, "owner");
  const config = tripPassConfig();
  if (!config) throw new TripPassError("PASS_UNAVAILABLE");
  if (await hasActiveTripPass(tripId)) throw new TripPassError("PASS_ALREADY_ACTIVE");

  await saveTripPassOrder(userId, tripId, LEGAL_VERSIONS.sales);
  return { url: config.url, email: await findUserEmail(userId) };
}

// Appelé par le webhook Buy Me a Coffee, une fois la signature vérifiée (patron.service).
export async function handleTripPassEvent(type: string, data: unknown) {
  const config = tripPassConfig();
  if (!config) return logInfo("trip-pass", { ignored: type, reason: "not_configured" });

  const purchase = bmcExtraPurchaseSchema.safeParse(data);
  if (!purchase.success) throw new TripPassError("INVALID_PAYLOAD");
  const { id, status, amount, currency, supporter_email: email, extras } = purchase.data;
  // Autre article de la boutique : pas un pass voyage.
  if (!extras.some((extra) => extra.id === config.extraId)) return logInfo("trip-pass", { ignored: type, paymentId: id, reason: "other_extra" });

  if (type === "extra_purchase.refunded") {
    return logInfo("trip-pass", { event: type, paymentId: id, applied: await refundTripPass(id) });
  }
  if (type !== "extra_purchase.created") return logInfo("trip-pass", { ignored: type });

  if (status !== "succeeded") return logInfo("trip-pass", { ignored: type, paymentId: id, reason: "not_succeeded" });
  if (currency !== "EUR" || amount < config.priceEur) {
    return logInfo("trip-pass", { ignored: type, paymentId: id, reason: "below_price_eur", amount, currency });
  }
  // Jamais l'email dans les logs ni en clair en base : empreinte + aperçu masqué.
  const userId = email ? await findActiveUserIdByEmail(email) : null;
  const webhookSecret = getBuyMeACoffeeConfig()?.webhookSecret ?? "";
  const recorded = await recordTripPassPurchase({
    bmcPaymentId: id,
    userId,
    amount,
    currency,
    payerEmailHash: email ? payerEmailHash(email, webhookSecret) : null,
    payerEmailHint: email ? maskEmail(email) : null,
  });
  if (!recorded) return logInfo("trip-pass", { ignored: type, paymentId: id, reason: "duplicate" });
  // Après le doublon : un webhook rejoué ne compte pas deux fois le revenu.
  await trackServerEvent("trip_pass_purchased", { revenue: amount, currency, assigned: recorded.tripId !== null });
  // Pas de compte ou pas de commande : l'achat attend qu'un admin le rattache (onglet Pass voyage).
  logInfo("trip-pass", {
    event: type,
    paymentId: id,
    assigned: recorded.tripId !== null,
    ...(recorded.tripId === null ? { reason: userId ? "no_pending_order" : "no_matching_account" } : {}),
  });
}

// HMAC (clé : secret du webhook) plutôt qu'un simple hash : une fuite de la base ne permet pas de retrouver les emails.
export function payerEmailHash(email: string, secret: string) {
  return createHmac("sha256", secret).update(email.trim().toLowerCase(), "utf8").digest("hex");
}

// « kilian@gmail.com » → « ki***@gmail.com » : assez pour reconnaître l'achat, pas pour lire l'adresse.
function maskEmail(email: string) {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`.slice(0, 80);
}
