import "server-only";
import type { PoolClient } from "pg";
import { getDb } from "@/server/infra/db";
import { TRAVELERS_COUNT } from "@/server/repositories/trip-share.repository";
import { TRIP_MAX_TRAVELERS } from "@/schemas/trip-share.schema";
import type { SplitMode } from "@/schemas/trip-expense.schema";

export type ParticipantRow = {
  id: number;
  user_id: string | null;
  name: string;
  // Invité sans compte (renommable, supprimable s'il n'apparaît dans aucune dépense).
  is_guest: boolean;
  // Compte qui a encore accès au voyage (propriétaire ou membre).
  has_access: boolean;
};

export type ExpenseShareRow = { participant_id: number; weight: string; share_minor: string };

export type ExpenseRow = {
  id: number;
  title: string;
  amount_minor: string;
  currency: string;
  rate: string;
  base_amount_minor: string;
  paid_by: number;
  spent_on: string;
  category: string;
  split_mode: SplitMode;
  is_reimbursement: boolean;
  created_by: string | null;
  shares: ExpenseShareRow[];
};

export type PaymentTaskRow = {
  id: number;
  label: string;
  estimated_minor: string | null;
  assignee_id: number | null;
  expense_id: number | null;
  done: boolean;
};

export type NewExpense = {
  title: string;
  amount_minor: number;
  currency: string;
  rate: number;
  base_amount_minor: number;
  paid_by: number;
  spent_on: string;
  category: string;
  split_mode: SplitMode;
  is_reimbursement: boolean;
  created_by: string;
  shares: { participant_id: number; weight: number; share_minor: number }[];
};

// Propriétaire et membres ont toujours leur ligne de participant ; le nom est copié pour survivre à la suppression du compte.
export async function ensureAccountParticipants(tripId: number) {
  const db = await getDb();
  await db.query(
    `insert into trip_participant (trip_id, user_id, name)
     select $1, u.id, left(u.display_name, 60)
     from users u
     where u.id in (select user_id from trip where id = $1 union select user_id from trip_member where trip_id = $1)
     on conflict (trip_id, user_id) do nothing`,
    [tripId],
  );
}

export async function findParticipants(tripId: number): Promise<ParticipantRow[]> {
  const db = await getDb();
  const { rows } = await db.query<ParticipantRow>(
    `select p.id, p.user_id, coalesce(u.display_name, p.name, '?') as name, p.user_id is null as is_guest,
       (p.user_id is not null and (t.user_id = p.user_id or m.user_id is not null)) as has_access
     from trip_participant p
     join trip t on t.id = p.trip_id
     left join users u on u.id = p.user_id
     left join trip_member m on m.trip_id = p.trip_id and m.user_id = p.user_id
     where p.trip_id = $1
     order by (t.user_id = p.user_id) desc nulls last, p.id`,
    [tripId],
  );
  return rows;
}

// false : voyage complet. Verrou sur le voyage, comme à l'arrivée d'un membre (trip-share.repository).
export async function insertGuest(tripId: number, name: string): Promise<boolean> {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    await client.query("select 1 from trip where id = $1 for update", [tripId]);
    const { rowCount } = await client.query(
      `insert into trip_participant (trip_id, name) select $1, $2 where (${TRAVELERS_COUNT}) < $3`,
      [tripId, name, TRIP_MAX_TRAVELERS],
    );
    await client.query("commit");
    return rowCount === 1;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function updateGuestName(tripId: number, participantId: number, name: string): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query(
    "update trip_participant set name = $3 where id = $2 and trip_id = $1 and user_id is null",
    [tripId, participantId, name],
  );
  return rowCount === 1;
}

// in_use : invité présent dans une dépense (payeur ou part), à garder pour l'historique.
export async function deleteGuest(tripId: number, participantId: number): Promise<"deleted" | "missing" | "in_use"> {
  const db = await getDb();
  const { rows } = await db.query<{ status: "deleted" | "in_use" }>(
    `with target as (
       select id from trip_participant where id = $2 and trip_id = $1 and user_id is null
     ), used as (
       select 1 from trip_expense where paid_by in (select id from target)
       union all select 1 from trip_expense_share where participant_id in (select id from target)
     ), removed as (
       delete from trip_participant where id in (select id from target) and not exists (select 1 from used) returning id
     )
     select case when exists (select 1 from removed) then 'deleted' else 'in_use' end as status
     where exists (select 1 from target)`,
    [tripId, participantId],
  );
  return rows[0]?.status ?? "missing";
}

const EXPENSE_COLUMNS = `e.id, e.title, e.amount_minor, e.currency, e.rate, e.base_amount_minor, e.paid_by,
  to_char(e.spent_on, 'YYYY-MM-DD') as spent_on, e.category, e.split_mode, e.is_reimbursement, e.created_by,
  coalesce((select json_agg(json_build_object('participant_id', s.participant_id, 'weight', s.weight, 'share_minor', s.share_minor)
    order by s.participant_id) from trip_expense_share s where s.expense_id = e.id), '[]') as shares`;

export async function findExpenses(tripId: number): Promise<ExpenseRow[]> {
  const db = await getDb();
  const { rows } = await db.query<ExpenseRow>(
    `select ${EXPENSE_COLUMNS} from trip_expense e where e.trip_id = $1 order by e.spent_on desc, e.id desc`,
    [tripId],
  );
  return rows;
}

export async function findExpense(tripId: number, expenseId: number): Promise<ExpenseRow | null> {
  const db = await getDb();
  const { rows } = await db.query<ExpenseRow>(`select ${EXPENSE_COLUMNS} from trip_expense e where e.id = $2 and e.trip_id = $1`, [
    tripId,
    expenseId,
  ]);
  return rows[0] ?? null;
}

// Une transaction : jamais de dépense sans ses parts. paymentTaskId : la ligne « à payer » est cochée et liée.
export async function insertExpense(tripId: number, expense: NewExpense, paymentTaskId?: number): Promise<boolean> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `insert into trip_expense (trip_id, title, amount_minor, currency, rate, base_amount_minor, paid_by, spent_on, category,
         split_mode, is_reimbursement, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [
        tripId,
        expense.title,
        expense.amount_minor,
        expense.currency,
        expense.rate,
        expense.base_amount_minor,
        expense.paid_by,
        expense.spent_on,
        expense.category,
        expense.split_mode,
        expense.is_reimbursement,
        expense.created_by,
      ],
    );
    await insertShares(client, rows[0].id, expense.shares);
    if (paymentTaskId !== undefined) {
      const { rowCount } = await client.query(
        "update trip_payment_task set done = true, expense_id = $3 where id = $2 and trip_id = $1 and not done",
        [tripId, paymentTaskId, rows[0].id],
      );
      if (rowCount !== 1) return false;
    }
    return true;
  });
}

export async function replaceExpense(tripId: number, expenseId: number, expense: NewExpense): Promise<boolean> {
  return transaction(async (client) => {
    const { rowCount } = await client.query(
      `update trip_expense set title = $3, amount_minor = $4, currency = $5, rate = $6, base_amount_minor = $7, paid_by = $8,
         spent_on = $9, category = $10, split_mode = $11
       where id = $2 and trip_id = $1`,
      [
        tripId,
        expenseId,
        expense.title,
        expense.amount_minor,
        expense.currency,
        expense.rate,
        expense.base_amount_minor,
        expense.paid_by,
        expense.spent_on,
        expense.category,
        expense.split_mode,
      ],
    );
    if (rowCount !== 1) return false;
    await client.query("delete from trip_expense_share where expense_id = $1", [expenseId]);
    await insertShares(client, expenseId, expense.shares);
    return true;
  });
}

export async function deleteExpense(tripId: number, expenseId: number): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query("delete from trip_expense where id = $2 and trip_id = $1", [tripId, expenseId]);
  return rowCount === 1;
}

// La devise ne change que tant qu'aucune dépense n'est enregistrée (les soldes y sont calculés).
export async function updateTripCurrency(tripId: number, currency: string): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query(
    "update trip set currency = $2 where id = $1 and not exists (select 1 from trip_expense where trip_id = $1)",
    [tripId, currency],
  );
  return rowCount === 1;
}

// Copilote : dépensé par catégorie dans la devise du voyage (unités mineures), remboursements exclus.
export async function findSpendingByCategory(tripId: number): Promise<{ currency: string; byCategory: Record<string, number> } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ currency: string; by_category: Record<string, string> }>(
    `select t.currency,
       coalesce((select json_object_agg(x.category, x.total)
                   from (select e.category, sum(e.base_amount_minor) as total from trip_expense e
                          where e.trip_id = t.id and not e.is_reimbursement group by e.category) x), '{}') as by_category
     from trip t where t.id = $1`,
    [tripId],
  );
  if (!rows[0]) return null;
  return {
    currency: rows[0].currency,
    byCategory: Object.fromEntries(Object.entries(rows[0].by_category).map(([category, total]) => [category, Number(total)])),
  };
}

export async function findTripCurrency(tripId: number): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ currency: string }>("select currency from trip where id = $1", [tripId]);
  return rows[0]?.currency ?? null;
}

export async function findPaymentTasks(tripId: number): Promise<PaymentTaskRow[]> {
  const db = await getDb();
  const { rows } = await db.query<PaymentTaskRow>(
    "select id, label, estimated_minor, assignee_id, expense_id, done from trip_payment_task where trip_id = $1 order by done, id",
    [tripId],
  );
  return rows;
}

export async function findPaymentTask(tripId: number, taskId: number): Promise<PaymentTaskRow | null> {
  const db = await getDb();
  const { rows } = await db.query<PaymentTaskRow>(
    "select id, label, estimated_minor, assignee_id, expense_id, done from trip_payment_task where id = $2 and trip_id = $1",
    [tripId, taskId],
  );
  return rows[0] ?? null;
}

export async function insertPaymentTask(tripId: number, task: { label: string; estimated_minor: number | null; assignee_id: number | null }) {
  const db = await getDb();
  await db.query("insert into trip_payment_task (trip_id, label, estimated_minor, assignee_id) values ($1, $2, $3, $4)", [
    tripId,
    task.label,
    task.estimated_minor,
    task.assignee_id,
  ]);
}

// Noms de colonnes issus de cette liste, jamais de l'entrée utilisateur.
const TASK_COLUMNS = ["label", "estimated_minor", "assignee_id", "done"] as const;
export type PaymentTaskChanges = Partial<{ label: string; estimated_minor: number | null; assignee_id: number | null; done: boolean }>;

export async function updatePaymentTask(tripId: number, taskId: number, changes: PaymentTaskChanges): Promise<boolean> {
  const entries = TASK_COLUMNS.filter((column) => changes[column] !== undefined).map((column) => [column, changes[column]] as const);
  if (entries.length === 0) return true;
  const db = await getDb();
  const { rowCount } = await db.query(
    `update trip_payment_task set ${entries.map(([column], index) => `${column} = $${index + 3}`).join(", ")}
     where id = $2 and trip_id = $1`,
    [tripId, taskId, ...entries.map(([, value]) => value)],
  );
  return rowCount === 1;
}

export async function deletePaymentTask(tripId: number, taskId: number): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query("delete from trip_payment_task where id = $2 and trip_id = $1", [tripId, taskId]);
  return rowCount === 1;
}

async function insertShares(client: PoolClient, expenseId: number, shares: NewExpense["shares"]) {
  await client.query(
    `insert into trip_expense_share (expense_id, participant_id, weight, share_minor)
     select $1, * from unnest($2::int[], $3::numeric[], $4::bigint[])`,
    [expenseId, shares.map((share) => share.participant_id), shares.map((share) => share.weight), shares.map((share) => share.share_minor)],
  );
}

async function transaction<T>(work: (client: PoolClient) => Promise<T | false>): Promise<T | false> {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query(result === false ? "rollback" : "commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
