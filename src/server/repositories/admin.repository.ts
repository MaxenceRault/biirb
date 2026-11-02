import "server-only";
import { getDb } from "@/server/infra/db";

export type DashboardCounts = {
  users: number;
  banned_users: number;
  new_users_7d: number;
  posts: number;
  hidden_posts: number;
  new_posts_7d: number;
  trips: number;
};

export async function findDashboardCounts(): Promise<DashboardCounts> {
  const db = await getDb();
  const { rows } = await db.query<DashboardCounts>(
    `select
       (select count(*)::int from users) as users,
       (select count(*)::int from users where banned_at is not null) as banned_users,
       (select count(*)::int from users where created_at > now() - interval '7 days') as new_users_7d,
       (select count(*)::int from post) as posts,
       (select count(*)::int from post where is_hidden) as hidden_posts,
       (select count(*)::int from post where created_at > now() - interval '7 days') as new_posts_7d,
       (select count(*)::int from trip) as trips`,
  );
  return rows[0];
}

export type RecentUserRow = { id: string; username: string; display_name: string; created_at: string };

export async function findRecentUsers(limit: number): Promise<RecentUserRow[]> {
  const db = await getDb();
  const { rows } = await db.query<RecentUserRow>(
    "select id, username, display_name, created_at from users order by created_at desc limit $1",
    [limit],
  );
  return rows;
}

export type AdminActionTarget = "user" | "post" | "archetype" | "settings" | "ticket" | "trip" | "dev_ticket";

export type NewAdminAction = {
  admin_id: string;
  action: string;
  target_type: AdminActionTarget;
  target_id: string | null;
  details: Record<string, unknown> | null;
};

export async function insertAdminAction(action: NewAdminAction) {
  const db = await getDb();
  await db.query(
    "insert into admin_action (admin_id, action, target_type, target_id, details) values ($1, $2, $3, $4, $5)",
    [action.admin_id, action.action, action.target_type, action.target_id, action.details],
  );
}

export type AdminActionRow = {
  id: number;
  action: string;
  target_type: AdminActionTarget;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  // null : administrateur supprimé depuis.
  admin: { id: string; username: string } | null;
};

export async function findAdminActions(limit: number): Promise<AdminActionRow[]> {
  const db = await getDb();
  const { rows } = await db.query<AdminActionRow>(
    `select a.id::int as id, a.action, a.target_type, a.target_id, a.details, a.created_at,
       case when u.id is null then null else json_build_object('id', u.id, 'username', u.username) end as admin
     from admin_action a left join users u on u.id = a.admin_id
     order by a.id desc
     limit $1`,
    [limit],
  );
  return rows;
}
