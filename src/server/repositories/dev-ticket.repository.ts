import "server-only";
import { getDb } from "@/server/infra/db";
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
};

export type DevTicketChanges = Partial<{ title: string; description: string | null; status: BoardColumn; priority: TicketPriority }>;

const COLUMNS = `d.id, d.title, d.description, d.status, d.priority, d.created_at, d.updated_at,
  case when u.id is null then null else json_build_object('username', u.username, 'display_name', u.display_name) end as author`;
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
