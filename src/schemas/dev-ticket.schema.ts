import { z } from "zod";

// Identiques aux contraintes SQL de dev_ticket.
export const DEV_TICKET_TITLE_MIN = 3;
export const DEV_TICKET_TITLE_MAX = 120;
export const DEV_TICKET_DESCRIPTION_MAX = 2000;

// Colonnes du Kanban de l'administration (les tickets de support s'y rangent aussi : open → todo, resolved → done).
export const BOARD_COLUMNS = ["todo", "in_progress", "done", "closed"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const DEV_TICKET_PRIORITIES = ["low", "medium", "high"] as const;
export type DevTicketPriority = (typeof DEV_TICKET_PRIORITIES)[number];

const title = z.string().trim().min(DEV_TICKET_TITLE_MIN).max(DEV_TICKET_TITLE_MAX);
// Vide → null (pas de description).
const description = z
  .string()
  .trim()
  .max(DEV_TICKET_DESCRIPTION_MAX)
  .transform((value) => value || null);

export const createDevTicketSchema = z.strictObject({
  title,
  description: description.optional(),
  priority: z.enum(DEV_TICKET_PRIORITIES).default("medium"),
});

export const updateDevTicketSchema = z
  .strictObject({ title, description, status: z.enum(BOARD_COLUMNS), priority: z.enum(DEV_TICKET_PRIORITIES) })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0);

export const devTicketIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

export type CreateDevTicketInput = z.infer<typeof createDevTicketSchema>;
export type UpdateDevTicketInput = z.infer<typeof updateDevTicketSchema>;
