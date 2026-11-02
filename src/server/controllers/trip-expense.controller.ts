import "server-only";
import type { z } from "zod";
import { getUserIdFromRequest } from "@/server/jwt";
import { getConfig } from "@/server/config";
import { isRateLimited } from "@/server/rateLimit";
import { resolveTripId, TripAccessError } from "@/server/services/trip-access.service";
import {
  addExpense,
  addGuest,
  addPaymentTask,
  deleteExpense,
  deletePaymentTask,
  getLedger,
  removeGuest,
  renameGuest,
  setTripCurrency,
  settle,
  TripExpenseError,
  updateExpense,
  updatePaymentTask,
} from "@/server/services/trip-expense.service";
import { idParamSchema, tripIdParamSchema } from "@/schemas/trip.schema";
import {
  expenseSchema,
  participantSchema,
  paymentTaskSchema,
  ledgerQuerySchema,
  settlementSchema,
  tripCurrencySchema,
  updatePaymentTaskSchema,
} from "@/schemas/trip-expense.schema";
import { logError } from "@/server/logger";

type Params = Promise<Record<string, string | string[] | undefined>>;
type RouteParams = Record<string, string | string[] | undefined>;

// GET /api/v1/trips/[id]/expenses[?display=JPY] : participants, dépenses, soldes, équilibrage, checklist « à payer »
export const getLedgerController = route(
  (userId, tripId, _params, query) => getLedger(userId, tripId, (query as z.infer<typeof ledgerQuerySchema>).display),
  { query: ledgerQuerySchema, write: false },
);

// POST /api/v1/trips/[id]/expenses
export const createExpenseController = route(
  async (userId, tripId, _params, body) => addExpense(userId, tripId, body as z.infer<typeof expenseSchema>),
  { schema: expenseSchema, status: 201 },
);

// PUT /api/v1/trips/[id]/expenses/[expenseId]
export const updateExpenseController = route(
  async (userId, tripId, params, body) => updateExpense(userId, tripId, id(params.expenseId), body as z.infer<typeof expenseSchema>),
  { schema: expenseSchema },
);

// DELETE /api/v1/trips/[id]/expenses/[expenseId]
export const deleteExpenseController = route((userId, tripId, params) => deleteExpense(userId, tripId, id(params.expenseId)));

// POST /api/v1/trips/[id]/participants { name } : invité sans compte
export const createParticipantController = route(
  async (userId, tripId, _params, body) => addGuest(userId, tripId, (body as z.infer<typeof participantSchema>).name),
  { schema: participantSchema, status: 201 },
);

// PATCH /api/v1/trips/[id]/participants/[participantId] { name }
export const updateParticipantController = route(
  async (userId, tripId, params, body) =>
    renameGuest(userId, tripId, id(params.participantId), (body as z.infer<typeof participantSchema>).name),
  { schema: participantSchema },
);

// DELETE /api/v1/trips/[id]/participants/[participantId]
export const deleteParticipantController = route((userId, tripId, params) => removeGuest(userId, tripId, id(params.participantId)));

// POST /api/v1/trips/[id]/settlements { from, to, amount } : « marquer comme remboursé »
export const createSettlementController = route(
  async (userId, tripId, _params, body) => settle(userId, tripId, body as z.infer<typeof settlementSchema>),
  { schema: settlementSchema, status: 201 },
);

// PUT /api/v1/trips/[id]/currency { currency } : tant qu'aucune dépense n'est saisie
export const updateCurrencyController = route(
  async (userId, tripId, _params, body) => setTripCurrency(userId, tripId, (body as z.infer<typeof tripCurrencySchema>).currency),
  { schema: tripCurrencySchema },
);

// POST /api/v1/trips/[id]/payment-tasks
export const createPaymentTaskController = route(
  async (userId, tripId, _params, body) => addPaymentTask(userId, tripId, body as z.infer<typeof paymentTaskSchema>),
  { schema: paymentTaskSchema, status: 201 },
);

// PATCH /api/v1/trips/[id]/payment-tasks/[taskId]
export const updatePaymentTaskController = route(
  async (userId, tripId, params, body) =>
    updatePaymentTask(userId, tripId, id(params.taskId), body as z.infer<typeof updatePaymentTaskSchema>),
  { schema: updatePaymentTaskSchema },
);

// DELETE /api/v1/trips/[id]/payment-tasks/[taskId]
export const deletePaymentTaskController = route((userId, tripId, params) => deletePaymentTask(userId, tripId, id(params.taskId)));

class InvalidParamError extends Error {}

function id(value: RouteParams[string]) {
  const parsed = idParamSchema.safeParse(value);
  if (!parsed.success) throw new InvalidParamError();
  return parsed.data;
}

// JWT revérifié (en plus de proxy.ts), id du voyage et corps validés, réponse = registre des dépenses à jour.
function route(
  handler: (userId: string, tripId: number, routeParams: RouteParams, body: unknown) => Promise<unknown>,
  // query : paramètres d'URL validés, passés au handler à la place du corps (GET).
  options: { schema?: z.ZodType; query?: z.ZodType; status?: number; write?: boolean } = {},
) {
  return async (request: Request, { params }: { params: Params }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) return errorResponse(401, "UNAUTHORIZED");

    const { max, windowMs } = getConfig().rateLimits.tripExpense;
    if (options.write !== false && isRateLimited(`trips:expense:${userId}`, max, windowMs)) {
      return errorResponse(429, "TOO_MANY_REQUESTS");
    }

    const routeParams = await params;
    const tripId = tripIdParamSchema.safeParse(routeParams.id);
    if (!tripId.success) return errorResponse(400, "INVALID_INPUT");

    let body: unknown;
    if (options.query) {
      const parsed = options.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return errorResponse(400, "INVALID_INPUT");
      body = parsed.data;
    }
    if (options.schema) {
      const parsed = options.schema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return errorResponse(400, "INVALID_INPUT");
      body = parsed.data;
    }

    try {
      // UUID de l'URL → clé interne (404 si inconnu).
      return Response.json(await handler(userId, await resolveTripId(tripId.data), routeParams, body), { status: options.status ?? 200 });
    } catch (error) {
      return handleError(error);
    }
  };
}

function errorResponse(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

function handleError(error: unknown) {
  if (error instanceof InvalidParamError) return errorResponse(400, "INVALID_INPUT");
  if (error instanceof TripAccessError) return errorResponse(error.code === "FORBIDDEN" ? 403 : 404, error.code);
  if (error instanceof TripExpenseError) {
    const status = { INVALID_INPUT: 400, NOT_FOUND: 404, FORBIDDEN: 403, PARTICIPANT_IN_USE: 409, CURRENCY_LOCKED: 409, RATE_UNAVAILABLE: 503, TRIP_FULL: 409 }[
      error.code
    ];
    return errorResponse(status, error.code);
  }
  logError("trips.expenses", error);
  return errorResponse(500, "INTERNAL_ERROR");
}
