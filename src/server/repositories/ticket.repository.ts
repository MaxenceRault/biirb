import "server-only";
import { getDb } from "@/server/infra/db";
import type { TicketCategory, TicketStatus } from "@/schemas/ticket.schema";

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
export async function findTicketsForBoard(closedLimit: number, openLimit: number): Promise<AdminTicketRow[]> {
  const db = await getDb();
  const { rows } = await db.query<AdminTicketRow>(
    `(select ${COLUMNS},
        json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name) as author
      from support_ticket t join users u on u.id = t.user_id
      where t.status <> 'closed'
      -- Les plus anciens d'abord : à traiter en premier.
      order by t.created_at
      limit $2)
     union all
     (select ${COLUMNS},
        json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name) as author
      from support_ticket t join users u on u.id = t.user_id
      where t.status = 'closed'
      order by t.updated_at desc
      limit $1)`,
    [closedLimit, openLimit],
  );
  return rows;
}

// null : ticket inconnu. previous : état avant le changement (journal).
export async function updateTicketStatus(
  id: number,
  status: TicketStatus,
): Promise<{ previous: TicketStatus } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ previous: TicketStatus }>(
    `update support_ticket t set status = $2, updated_at = now()
     from (select status as previous from support_ticket where id = $1 for update) old
     where t.id = $1
     returning old.previous`,
    [id, status],
  );
  return rows[0] ?? null;
}
