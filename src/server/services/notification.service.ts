import "server-only";
import { getTranslations } from "next-intl/server";
import { getMailConfig, getPushConfig } from "@/server/config";
import { sendTextMail } from "@/server/infra/mailer";
import { sendWebPush } from "@/server/infra/webPush";
import { logError } from "@/server/logger";
import {
  countUnreadNotifications,
  deleteGonePushSubscription,
  deleteNotifications,
  deleteOldNotifications,
  deletePushSubscription,
  findNotificationChannels,
  findNotificationContext,
  findNotifications,
  findTripNotificationSetting,
  insertTripNotifications,
  markNotificationsRead,
  upsertPushSubscription,
  upsertTripNotificationSetting,
} from "@/server/repositories/notification.repository";
import { requireTripRole } from "@/server/services/trip-access.service";
import {
  NOTIFICATION_DETAIL_MAX,
  NOTIFICATION_LIST_LIMIT,
  type NotificationKind,
  type PushSubscriptionInput,
  type TripNotificationSettingsInput,
} from "@/schemas/notification.schema";

// Au-delà, plus utile : supprimées à la lecture du centre de notifications.
const RETENTION_DAYS = 30;

export async function listNotifications(userId: string) {
  await deleteOldNotifications(userId, RETENTION_DAYS);
  const [notifications, unread] = await Promise.all([
    findNotifications(userId, NOTIFICATION_LIST_LIMIT),
    countUnreadNotifications(userId),
  ]);
  return { notifications, unread };
}

export async function readAllNotifications(userId: string) {
  await markNotificationsRead(userId);
}

export async function clearNotifications(userId: string) {
  await deleteNotifications(userId);
}

// Réglages d'un membre pour un voyage, et ce que le serveur sait envoyer (push / email configurés).
export async function getTripNotificationSettings(userId: string, tripId: number) {
  await requireTripRole(userId, tripId, "viewer");
  return {
    ...(await findTripNotificationSetting(tripId, userId)),
    // Clé publique VAPID (pas un secret) : le navigateur en a besoin pour s'abonner. null : push non configuré.
    pushPublicKey: getPushConfig()?.publicKey ?? null,
    emailAvailable: getMailConfig() !== null,
  };
}

export async function updateTripNotificationSettings(userId: string, tripId: number, input: TripNotificationSettingsInput) {
  await requireTripRole(userId, tripId, "viewer");
  await upsertTripNotificationSetting(tripId, userId, input);
  return getTripNotificationSettings(userId, tripId);
}

export async function subscribePush(userId: string, input: PushSubscriptionInput) {
  await upsertPushSubscription(userId, { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth });
}

export async function unsubscribePush(userId: string, endpoint: string) {
  await deletePushSubscription(userId, endpoint);
}

// Jamais bloquant : le changement est déjà enregistré, une notification manquée ne doit pas le faire échouer.
export async function notifyTripMembers(tripId: number, actorId: string, kind: NotificationKind, detail: string | null = null) {
  try {
    const recipients = await insertTripNotifications(tripId, actorId, kind, detail?.slice(0, NOTIFICATION_DETAIL_MAX) ?? null);
    if (recipients.length > 0) await sendOutsideApp(tripId, actorId, kind, detail, recipients);
  } catch (error) {
    logError("notifications", error);
  }
}

// Push et email pour les membres qui les ont choisis sur ce voyage. Attendus (Cloud Run coupe le CPU après la réponse),
// mais chaque envoi échoue seul : jamais d'erreur renvoyée au membre qui a fait le changement.
async function sendOutsideApp(tripId: number, actorId: string, kind: NotificationKind, detail: string | null, recipients: string[]) {
  const pushConfig = getPushConfig();
  const mailConfig = getMailConfig();
  if (!pushConfig && !mailConfig) return;

  const channels = await findNotificationChannels(tripId, recipients);
  if (channels.length === 0) return;
  const context = await findNotificationContext(tripId, actorId);
  if (!context) return;

  const sends: Promise<unknown>[] = [];

  if (pushConfig) {
    const t = await getTranslations({ locale: "fr", namespace: "Notifications" });
    const payload = {
      title: context.trip_title,
      body: t(`kinds.${kind}`, {
        actor: context.actor_name ?? t("someone"),
        detail: kind === "day_regenerated" && detail ? formatDay(detail) : (detail ?? ""),
        trip: context.trip_title,
      }),
      // Chemin seulement : le service worker n'ouvre que des pages du planificateur.
      url: `/planner/${context.trip_public_id}`,
    };
    for (const target of channels.flatMap((channel) => channel.subscriptions)) {
      sends.push(
        sendWebPush(pushConfig, target, payload).then((result) => (result === "gone" ? deleteGonePushSubscription(target.endpoint) : undefined)),
      );
    }
  }

  if (mailConfig) {
    // Aucun texte saisi par un membre (titre, nom, activité) : un tiers y glisserait un faux lien (comme pour le mot de passe oublié).
    const t = await getTranslations({ locale: "fr", namespace: "NotificationEmail" });
    const change = t(`kinds.${kind}`);
    const text = mailConfig.appUrl
      ? t("body", { change, link: `${mailConfig.appUrl}/planner/${context.trip_public_id}` })
      : t("bodyNoLink", { change });
    for (const channel of channels) {
      if (channel.email) sends.push(sendTextMail(mailConfig, { to: channel.email, subject: t("subject"), text }));
    }
  }

  for (const result of await Promise.allSettled(sends)) {
    if (result.status === "rejected") logError("notifications", result.reason);
  }
}

// Jour AAAA-MM-JJ → « jeudi 5 novembre » (midi UTC : la date ne glisse pas selon le fuseau).
function formatDay(day: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
