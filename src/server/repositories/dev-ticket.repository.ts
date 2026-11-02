import "server-only";
import { getDb } from "@/server/infra/db";
import type { AssigneeRow } from "@/server/repositories/user.repository";
import type { BoardColumn } from "@/schemas/dev-ticket.schema";
import type { TicketPriority } from "@/schemas/ticket.schema";

export type DevTicketRow = {
  id: number;
  title: string;
  description: string | null;
  status: BoardColumn;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
  // null : compte de l'auteur supprimé.
  author: { username: string; display_name: string } | null;
  assignees: AssigneeRow[];
};

export type DevTicketChanges = Partial<{ title: string; description: string | null; status: BoardColumn; priority: TicketPriority }>;

// Admins assignés : ceux qui ne le sont plus (rétrogradés, bannis) ne sont pas affichés.
const ASSIGNEES = `coalesce((
    select json_agg(json_build_object('id', au.id, 'username', au.username, 'display_name', au.display_name,
      'avatar_url', au.avatar_url, 'avatar_seed', au.avatar_seed, 'avatar_background_color', au.avatar_background_color) order by a.assigned_at)
    from dev_ticket_assignee a join users au on au.id = a.user_id
    where a.ticket_id = d.id and au.role = 'admin' and au.banned_at is null
  ), '[]'::json) as assignees`;

const COLUMNS = `d.id, d.title, d.description, d.status, d.priority, d.created_at, d.updated_at,
  case when u.id is null then null else json_build_object('username', u.username, 'display_name', u.display_name) end as author,
  ${ASSIGNEES}`;
// Noms de colonnes issus de cette liste, jamais de l'entrée utilisateur.
const EDITABLE_COLUMNS = ["title", "description", "status", "priority"] as const;

// Tous les tickets ouverts (priorité haute d'abord), et les derniers clôturés seulement.
export async function findDevTickets(closedLimit: number, openLimit: number): Promise<DevTicketRow[]> {
  const db = await getDb();
  const { rows } = await db.query<DevTicketRow>(
    `(select ${COLUMNS} from dev_ticket d left join users u on u.id = d.created_by
      where d.status <> 'closed'
      order by d.priority desc, d.updated_at desc
      limit $2)
     union all
     (select ${COLUMNS} from dev_ticket d left join users u on u.id = d.created_by
      where d.status = 'closed'
      order by d.updated_at desc
      limit $1)`,
    [closedLimit, openLimit],
  );
  return rows;
}

export async function insertDevTicket(
  authorId: string,
  ticket: { title: string; description: string | null; priority: TicketPriority },
): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: number }>(
    "insert into dev_ticket (title, description, priority, created_by) values ($1, $2, $3, $4) returning id",
    [ticket.title, ticket.description, ticket.priority, authorId],
  );
  return rows[0].id;
}

// null : ticket inconnu. previous : valeurs avant le changement (journal).
export async function updateDevTicket(id: number, changes: DevTicketChanges): Promise<{ previous: Pick<DevTicketRow, "status" | "title"> } | null> {
  const entries = EDITABLE_COLUMNS.filter((column) => changes[column] !== undefined).map((column) => [column, changes[column]] as const);
  const db = await getDb();
  const { rows } = await db.query<{ status: BoardColumn; title: string }>(
    `update dev_ticket d set ${entries.map(([column], index) => `${column} = $${index + 2}`).join(", ")}, updated_at = now()
     from (select status, title from dev_ticket where id = $1 for update) old
     where d.id = $1
     returning old.status, old.title`,
    [id, ...entries.map(([, value]) => value)],
  );
  return rows[0] ? { previous: rows[0] } : null;
}

// null : ticket inconnu.
export async function deleteDevTicket(id: number): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ title: string }>("delete from dev_ticket where id = $1 returning title", [id]);
  return rows[0]?.title ?? null;
}

// null : ticket inconnu. Remplace la liste entière ; ticket verrouillé : deux admins en même temps ne se mélangent pas.
// previous : ids avant le changement (journal), anciens admins compris : ils sont retirés s'ils ne sont plus dans la liste.
export async function replaceDevTicketAssignees(ticketId: number, userIds: string[]): Promise<{ previous: string[] } | null> {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    const ticket = await client.query("select id from dev_ticket where id = $1 for update", [ticketId]);
    if (ticket.rowCount === 0) {
      await client.query("rollback");
      return null;
    }
    const { rows } = await client.query<{ user_id: string }>("select user_id from dev_ticket_assignee where ticket_id = $1", [ticketId]);
    await client.query("delete from dev_ticket_assignee where ticket_id = $1 and user_id <> all($2::uuid[])", [ticketId, userIds]);
    await client.query(
      "insert into dev_ticket_assignee (ticket_id, user_id) select $1, unnest($2::uuid[]) on conflict do nothing",
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
