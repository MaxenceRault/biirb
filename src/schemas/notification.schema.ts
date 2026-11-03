import { z } from "zod";

// Identiques au type notification_kind (db/migrations) : changement d'un membre signalé aux autres membres du voyage.
export const NOTIFICATION_KINDS = [
  "plan_regenerated",
  "day_regenerated",
  "plan_undone",
  "suggestion_accepted",
  "item_added",
  "item_updated",
  "item_deleted",
  "trip_updated",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// Identique à la contrainte SQL de notification.detail.
export const NOTIFICATION_DETAIL_MAX = 120;
// Dernières notifications renvoyées (centre de notifications).
export const NOTIFICATION_LIST_LIMIT = 30;

// Notifications hors de l'app, choisies par chaque membre pour chaque voyage (décochées par défaut).
export const tripNotificationSettingsSchema = z.strictObject({
  push: z.boolean(),
  email: z.boolean(),
});
export type TripNotificationSettingsInput = z.infer<typeof tripNotificationSettingsSchema>;

// Services de push des navigateurs (Chrome / Edge / Firefox / Safari / Windows) : le serveur envoie une requête à cette
// adresse, jamais à une adresse quelconque (sinon un compte ferait appeler un service interne : SSRF).
const PUSH_SERVICE_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/];

const pushEndpointSchema = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .refine((value) => PUSH_SERVICE_HOSTS.some((host) => host.test(new URL(value).hostname)));

const base64Url = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+=*$/);

export const pushSubscriptionSchema = z.strictObject({
  endpoint: pushEndpointSchema,
  keys: z.strictObject({ p256dh: base64Url(80, 120), auth: base64Url(16, 40) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.strictObject({ endpoint: pushEndpointSchema });
