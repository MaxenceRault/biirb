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

// Ventes d'une période [from, to[ (#108), par devise : pass voyage achetés (offerts à part) et dons mécène.
// Les remboursements sont comptés à part, jamais retirés du brut. Lecture seule.
export type SalesRow = {
  kind: "trip_pass" | "donation";
  currency: string;
  count: number;
  gross: string;
  refunded_count: number;
  refunded_amount: string;
};

export type SalesCounts = { gifts: number; unassigned: number; open_orders: number; trips_created: number; trips_with_pass: number };

export async function findSales(from: string, to: string): Promise<{ rows: SalesRow[]; counts: SalesCounts }> {
  const db = await getDb();
  const [sales, counts] = await Promise.all([
    db.query<SalesRow>(
      `select 'trip_pass' as kind, currency, count(*)::int as count, sum(amount)::text as gross,
              count(refunded_at)::int as refunded_count, coalesce(sum(amount) filter (where refunded_at is not null), 0)::text as refunded_amount
         from trip_pass
        where bmc_payment_id is not null and created_at >= $1 and created_at < $2
        group by currency
       union all
       select 'donation', currency, count(*)::int, sum(amount)::text,
              count(refunded_at)::int, coalesce(sum(amount) filter (where refunded_at is not null), 0)::text
         from patron_donation
        where created_at >= $1 and created_at < $2
        group by currency
       order by kind, currency`,
      [from, to],
    ),
    db.query<SalesCounts>(
      `select
         (select count(*)::int from trip_pass where bmc_payment_id is null and created_at >= $1 and created_at < $2) as gifts,
         (select count(*)::int from trip_pass where trip_id is null and refunded_at is null and revoked_at is null) as unassigned,
         (select count(*)::int from trip_pass_order where created_at > now() - interval '24 hours') as open_orders,
         (select count(*)::int from trip where created_at >= $1 and created_at < $2) as trips_created,
         (select count(distinct t.id)::int from trip t join trip_pass p on p.trip_id = t.id
           where t.created_at >= $1 and t.created_at < $2 and p.bmc_payment_id is not null) as trips_with_pass`,
      [from, to],
    ),
  ]);
  return { rows: sales.rows, counts: counts.rows[0] };
}

// Transactions d'un compte (#109) : pass achetés ou offerts et dons. Ni email ni donnée bancaire (il n'y en a pas en base).
export type UserTransactionRow = {
  kind: "trip_pass" | "donation";
  id: number;
  bmc_payment_id: string | null;
  amount: string | null;
  currency: string | null;
  status: "active" | "unassigned" | "refunded" | "revoked" | "gift";
  trip_public_id: string | null;
  trip_title: string | null;
  created_at: string;
};

export async function findUserTransactions(userId: string): Promise<UserTransactionRow[]> {
  const db = await getDb();
  const { rows } = await db.query<UserTransactionRow>(
    `select 'trip_pass' as kind, p.id, p.bmc_payment_id::text, p.amount::text, p.currency,
            case when p.refunded_at is not null then 'refunded'
                 when p.revoked_at is not null then 'revoked'
                 when p.trip_id is null then 'unassigned'
                 when p.bmc_payment_id is null then 'gift'
                 else 'active' end as status,
            t.public_id as trip_public_id, t.title as trip_title, p.created_at
       from trip_pass p left join trip t on t.id = p.trip_id
      where p.user_id = $1
     union all
     select 'donation', d.id, d.bmc_payment_id::text, d.amount::text, d.currency,
            case when d.refunded_at is not null then 'refunded' else 'active' end,
            null, null, d.created_at
       from patron_donation d
      where d.user_id = $1
     order by created_at desc
     limit 100`,
    [userId],
  );
  return rows;
}
