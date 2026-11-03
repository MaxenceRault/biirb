import "server-only";
import { getDb } from "@/server/infra/db";
import type { NotificationKind } from "@/schemas/notification.schema";

export type NotificationRow = {
  id: number;
  kind: NotificationKind;
  detail: string | null;
  created_at: string;
  read: boolean;
  // Identifiant public (UUID) du voyage : la clé interne ne sort jamais du serveur.
  trip: { id: string; title: string };
  actor_name: string | null;
};

// Membres du voyage (propriétaire + membres) sauf l'auteur du changement. Même changement répété dans les 10 minutes
// (même membre, même activité) et pas encore lu : une seule notification, pour ne pas inonder le centre.
// Renvoie les destinataires réellement notifiés (doublons exclus) : seuls eux reçoivent aussi le push et l'email.
export async function insertTripNotifications(tripId: number, actorId: string, kind: NotificationKind, detail: string | null): Promise<string[]> {
  const db = await getDb();
  const { rows } = await db.query<{ user_id: string }>(
    // Types explicites : chaque paramètre sert deux fois, Postgres ne doit pas en déduire deux types différents.
    `insert into notification (user_id, trip_id, actor_id, kind, detail)
     select r.user_id, $1::int, $2::uuid, $3::notification_kind, $4::varchar
     from (select user_id from trip where id = $1::int union select user_id from trip_member where trip_id = $1::int) r
     where r.user_id <> $2::uuid
       and not exists (
         select 1 from notification n
         where n.user_id = r.user_id and n.trip_id = $1::int and n.actor_id = $2::uuid and n.kind = $3::notification_kind
           and n.detail is not distinct from $4::varchar and n.read_at is null and n.created_at > now() - interval '10 minutes'
       )
     returning user_id`,
    [tripId, actorId, kind, detail],
  );
  return rows.map((row) => row.user_id);
}

// Seulement les voyages dont l'utilisateur est encore membre : un membre retiré ne voit plus leur titre.
const VISIBLE = `n.user_id = $1 and (t.user_id = $1 or exists (select 1 from trip_member m where m.trip_id = t.id and m.user_id = $1))`;

export async function findNotifications(userId: string, limit: number): Promise<NotificationRow[]> {
  const db = await getDb();
  const { rows } = await db.query<NotificationRow>(
    `select n.id, n.kind, n.detail, n.created_at, n.read_at is not null as read,
       json_build_object('id', t.public_id, 'title', t.title) as trip, actor.display_name as actor_name
     from notification n
     join trip t on t.id = n.trip_id
     left join users actor on actor.id = n.actor_id
     where ${VISIBLE}
     order by n.id desc
     limit $2`,
    [userId, limit],
  );
  return rows;
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from notification n join trip t on t.id = n.trip_id where ${VISIBLE} and n.read_at is null`,
    [userId],
  );
  return rows[0].count;
}

export async function markNotificationsRead(userId: string) {
  const db = await getDb();
  await db.query("update notification set read_at = now() where user_id = $1 and read_at is null", [userId]);
}

export async function deleteNotifications(userId: string) {
  const db = await getDb();
  await db.query("delete from notification where user_id = $1", [userId]);
}

export async function deleteOldNotifications(userId: string, days: number) {
  const db = await getDb();
  await db.query("delete from notification where user_id = $1 and created_at < now() - make_interval(days => $2)", [userId, days]);
}

export type TripNotificationSetting = { push: boolean; email: boolean };

export async function findTripNotificationSetting(tripId: number, userId: string): Promise<TripNotificationSetting> {
  const db = await getDb();
  const { rows } = await db.query<TripNotificationSetting>(
    "select push, email from trip_notification_setting where trip_id = $1 and user_id = $2",
    [tripId, userId],
  );
  return rows[0] ?? { push: false, email: false };
}

export async function upsertTripNotificationSetting(tripId: number, userId: string, setting: TripNotificationSetting) {
  const db = await getDb();
  await db.query(
    `insert into trip_notification_setting (trip_id, user_id, push, email) values ($1, $2, $3, $4)
     on conflict (trip_id, user_id) do update set push = excluded.push, email = excluded.email, updated_at = now()`,
    [tripId, userId, setting.push, setting.email],
  );
}

export type NotificationChannels = {
  user_id: string;
  // null : email non choisi pour ce voyage, ou compte banni.
  email: string | null;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
};

// Destinataires qui ont choisi le push ou l'email pour ce voyage (emails et abonnements : jamais renvoyés au client).
export async function findNotificationChannels(tripId: number, userIds: string[]): Promise<NotificationChannels[]> {
  const db = await getDb();
  const { rows } = await db.query<NotificationChannels>(
    `select u.id as user_id,
       case when s.email and u.banned_at is null then u.email end as email,
       case when s.push and u.banned_at is null then coalesce(
         (select json_agg(json_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
            from push_subscription p where p.user_id = u.id),
         '[]') else '[]' end as subscriptions
     from trip_notification_setting s
     join users u on u.id = s.user_id
     where s.trip_id = $1 and s.user_id = any($2::uuid[]) and (s.push or s.email)`,
    [tripId, userIds],
  );
  return rows;
}

// Texte d'une notification envoyée hors de l'app : voyage (identifiant public) et nom du membre à l'origine.
export async function findNotificationContext(tripId: number, actorId: string) {
  const db = await getDb();
  const { rows } = await db.query<{ trip_public_id: string; trip_title: string; actor_name: string | null }>(
    `select t.public_id as trip_public_id, t.title as trip_title, (select display_name from users where id = $2) as actor_name
     from trip t where t.id = $1`,
    [tripId, actorId],
  );
  return rows[0] ?? null;
}

// Même navigateur, autre compte : l'abonnement passe au compte connecté.
export async function upsertPushSubscription(userId: string, subscription: { endpoint: string; p256dh: string; auth: string }) {
  const db = await getDb();
  await db.query(
    `insert into push_subscription (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [userId, subscription.endpoint, subscription.p256dh, subscription.auth],
  );
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  const db = await getDb();
  await db.query("delete from push_subscription where user_id = $1 and endpoint = $2", [userId, endpoint]);
}

// Abonnement refusé par le service de push (expiré, révoqué) : supprimé quel que soit son compte.
export async function deleteGonePushSubscription(endpoint: string) {
  const db = await getDb();
  await db.query("delete from push_subscription where endpoint = $1", [endpoint]);
}
