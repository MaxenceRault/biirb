import { createDevTicketController, listDevTicketsController } from "@/server/controllers/admin.controller";

export const GET = listDevTicketsController;
export const POST = createDevTicketController;
