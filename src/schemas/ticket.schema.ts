import { z } from "zod";

// Identiques aux contraintes SQL de support_ticket.
export const TICKET_SUBJECT_MIN = 3;
export const TICKET_SUBJECT_MAX = 120;
export const TICKET_MESSAGE_MIN = 10;
export const TICKET_MESSAGE_MAX = 2000;

// closed : clôturé par un admin (Kanban), plus rien à faire.
export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// trip_pass : paiement ou activation du pass voyage, les admins sont prévenus par email.
export const TICKET_CATEGORIES = ["trip_pass", "bug", "report", "account", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const createTicketSchema = z.strictObject({
  subject: z.string().trim().min(TICKET_SUBJECT_MIN).max(TICKET_SUBJECT_MAX),
  message: z.string().trim().min(TICKET_MESSAGE_MIN).max(TICKET_MESSAGE_MAX),
  category: z.enum(TICKET_CATEGORIES),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const ticketIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

export const adminTicketsQuerySchema = z.strictObject({
  status: z.enum(["all", ...TICKET_STATUSES]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const adminUpdateTicketSchema = z.strictObject({ status: z.enum(TICKET_STATUSES) });
