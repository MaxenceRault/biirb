import "server-only";
import { getDb } from "@/server/infra/db";
import type { AssigneeRow } from "@/server/repositories/user.repository";
import type { TicketCategory, TicketPriority, TicketStatus } from "@/schemas/ticket.schema";

export type TicketRow = {
  id: number;
  subject: string;
  message: string;
  status: TicketStatus;
  category: TicketCategory;
  created_at: string;
  updated_at: string;
};

// Jamais d'email : le pseudo suffit à retrouver le compte depuis l'admin.
export type AdminTicketRow = TicketRow & { author: { id: string; username: string; display_name: string } };

const COLUMNS = "t.id, t.subject, t.message, t.status, t.category, t.created_at, t.updated_at";
// Admins assignés (Kanban) : ceux qui ne le sont plus (rétrogradés, bannis) ne sont pas affichés.
const ASSIGNEES = `coalesce((
    select json_agg(json_build_object('id', au.id, 'username', au.username, 'display_name', au.display_name,
      'avatar_url', au.avatar_url, 'avatar_seed', au.avatar_seed, 'avatar_background_color', au.avatar_background_color) order by a.assigned_at)
    from support_ticket_assignee a join users au on au.id = a.user_id
    where a.ticket_id = t.id and au.role = 'admin' and au.banned_at is null
  ), '[]'::json) as assignees`;

export type BoardTicketRow = AdminTicketRow & { priority: TicketPriority; assignees: AssigneeRow[] };

export async function insertTicket(userId: string, subject: string, message: string, category: TicketCategory): Promise<TicketRow> {
  const db = await getDb();
  const { rows } = await db.query<TicketRow>(
    `insert into support_ticket as t (user_id, subject, message, category) values ($1, $2, $3, $4) returning ${COLUMNS}`,
    [userId, subject, message, category],
  );
  return rows[0];
}

export async function findTicketsByUser(userId: string, limit: number): Promise<TicketRow[]> {
  const db = await getDb();
  const { rows } = await db.query<TicketRow>(
    `select ${COLUMNS} from support_ticket t where t.user_id = $1 order by t.created_at desc limit $2`,
    [userId, limit],
  );
  return rows;
}

export async function findTicketsForAdmin(
  status: TicketStatus | null,
  limit: number,
  offset: number,
): Promise<{ tickets: AdminTicketRow[]; total: number }> {
  const db = await getDb();
  const [list, count] = await Promise.all([
    db.query<AdminTicketRow>(
      `select ${COLUMNS},
         json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name) as author
       from support_ticket t
       join users u on u.id = t.user_id
       where $1::support_ticket_status is null or t.status = $1
       -- Ouverts d'abord, puis en cours, puis résolus ; les plus anciens en premier (à traiter).
       order by t.status, t.created_at
       limit $2 offset $3`,
      [status, limit, offset],
    ),
    db.query<{ total: number }>(
      "select count(*)::int as total from support_ticket where $1::support_ticket_status is null or status = $1",
      [status],
    ),
  ]);
  return { tickets: list.rows, total: count.rows[0].total };
}

// Kanban : tous les tickets à traiter, et les derniers clôturés seulement (la colonne ne grossit pas sans fin).
// priority et assignees : réservés à l'admin (jamais dans les requêtes de l'auteur).
export async function findTicketsForBoard(closedLimit: number, openLimit: number): Promise<BoardTicketRow[]> {
  const db = await getDb();
  const { rows } = await db.query<BoardTicketRow>(
    `(select ${COLUMNS}, t.priority, ${ASSIGNEES},
        json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name) as author
      from support_ticket t join users u on u.id = t.user_id
      where t.status <> 'closed'
      -- Priorité haute d'abord, puis les plus anciens (à traiter en premier).
      order by t.priority desc, t.created_at
      limit $2)
     union all
     (select ${COLUMNS}, t.priority, ${ASSIGNEES},
        json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name) as author
      from support_ticket t join users u on u.id = t.user_id
      where t.status = 'closed'
      order by t.updated_at desc
      limit $1)`,
    [closedLimit, openLimit],
  );
  return rows;
}

// null : ticket inconnu. previous : état et priorité avant le changement (journal).
export async function updateTicket(
  id: number,
  changes: { status?: TicketStatus; priority?: TicketPriority },
): Promise<{ previous: { status: TicketStatus; priority: TicketPriority } } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ status: TicketStatus; priority: TicketPriority }>(
    `update support_ticket t set status = coalesce($2, t.status), priority = coalesce($3, t.priority), updated_at = now()
     from (select status, priority from support_ticket where id = $1 for update) old
     where t.id = $1
     returning old.status, old.priority`,
    [id, changes.status ?? null, changes.priority ?? null],
  );
  return rows[0] ? { previous: rows[0] } : null;
}

// null : ticket inconnu. Remplace la liste entière ; ticket verrouillé : deux admins en même temps ne se mélangent pas.
// previous : ids avant le changement (journal), anciens admins compris : ils sont retirés s'ils ne sont plus dans la liste.
export async function replaceTicketAssignees(ticketId: number, userIds: string[]): Promise<{ previous: string[] } | null> {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    const ticket = await client.query("select id from support_ticket where id = $1 for update", [ticketId]);
    if (ticket.rowCount === 0) {
      await client.query("rollback");
      return null;
    }
    const { rows } = await client.query<{ user_id: string }>("select user_id from support_ticket_assignee where ticket_id = $1", [ticketId]);
    await client.query("delete from support_ticket_assignee where ticket_id = $1 and user_id <> all($2::uuid[])", [ticketId, userIds]);
    await client.query(
      "insert into support_ticket_assignee (ticket_id, user_id) select $1, unnest($2::uuid[]) on conflict do nothing",
      [ticketId, userIds],
    );
    await client.query("commit");
    return { previous: rows.map((row) => row.user_id) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
