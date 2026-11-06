import "server-only";
import type { z } from "zod";
import { getUserIdFromRequest } from "@/server/jwt";
import { getConfig } from "@/server/config";
import { isRateLimited } from "@/server/rateLimit";
import {
  addTripItem,
  addTripTask,
  answerTripSuggestion,
  createTrip,
  deleteTrip,
  deleteTripItem,
  deleteTripTask,
  exportTripCalendar,
  exportTripPdf,
  getCurrentTrip,
  getTrip,
  getTripMessages,
  listTrips,
  regenerateTrip,
  regenerateTripDay,
  undoPlanChange,
  sendTripMessage,
  acceptMessageSuggestions,
  TripError,
  updateTrip,
  updateTripItem,
  updateTripTask,
  getTripWeather,
} from "@/server/services/trip.service";
import { getDayTravel } from "@/server/services/trip-travel.service";
import { resolveTripId, TripAccessError } from "@/server/services/trip-access.service";
import { startTripPassCheckout, TripPassError } from "@/server/services/trip-pass.service";
import {
  answerTripSuggestionSchema,
  createTripItemSchema,
  createTripSchema,
  createTripTaskSchema,
  currentTripQuerySchema,
  dayParamSchema,
  idParamSchema,
  ifMatchSchema,
  tripIdParamSchema,
  sendTripMessageSchema,
  tripPassCheckoutSchema,
  tripPdfQuerySchema,
  updateTripItemSchema,
  updateTripSchema,
  updateTripTaskSchema,
} from "@/schemas/trip.schema";
import { logError } from "@/server/logger";

type Params = Promise<Record<string, string | string[] | undefined>>;

// GET /api/v1/trips
export function listTripsController(request: Request) {
  return withUser(request, async (userId) => Response.json(await listTrips(userId)));
}

// GET /api/v1/trips/current?day=AAAA-MM-JJ
export function getCurrentTripController(request: Request) {
  return withUser(request, async (userId) => {
    const query = currentTripQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return errorResponse(400, "INVALID_INPUT");
    return Response.json({ current: await getCurrentTrip(userId, query.data.day) });
  });
}

// POST /api/v1/trips
export function createTripController(request: Request) {
  return withUser(request, async (userId) => {
    const body = await parseBody(request, createTripSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    if (isAiRateLimited(userId)) return errorResponse(429, "TOO_MANY_REQUESTS");

    return Response.json(await createTrip(userId, body), { status: 201 });
  });
}

// GET /api/v1/trips/[id]
export function getTripController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, (userId, tripId) => getTrip(userId, tripId).then(json));
}

// PATCH /api/v1/trips/[id]
export function updateTripController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    const body = await parseBody(request, updateTripSchema);
    const version = parseIfMatch(request);
    if (!body || version === false) return errorResponse(400, "INVALID_INPUT");
    return json(await updateTrip(userId, tripId, body, version));
  });
}

// DELETE /api/v1/trips/[id]
export function deleteTripController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    await deleteTrip(userId, tripId);
    return new Response(null, { status: 204 });
  });
}

// POST /api/v1/trips/[id]/regenerate
export function regenerateTripController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    if (isAiRateLimited(userId)) return errorResponse(429, "TOO_MANY_REQUESTS");
    await regenerateTrip(userId, tripId);
    return json(await getTrip(userId, tripId));
  });
}

// POST /api/v1/trips/[id]/undo : annule le dernier changement de Biirbou.
export function undoTripPlanController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => json(await undoPlanChange(userId, tripId)));
}

// POST /api/v1/trips/[id]/days/[day]/regenerate (pass voyage)
export function regenerateTripDayController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const day = dayParamSchema.safeParse(routeParams.day);
    if (!day.success) return errorResponse(400, "INVALID_INPUT");
    if (isAiRateLimited(userId)) return errorResponse(429, "TOO_MANY_REQUESTS");
    return json(await regenerateTripDay(userId, tripId, day.data));
  });
}

// GET /api/v1/trips/[id]/days/[day]/travel (pass voyage)
export function getDayTravelController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const day = dayParamSchema.safeParse(routeParams.day);
    if (!day.success) return errorResponse(400, "INVALID_INPUT");
    const { max, windowMs } = getConfig().rateLimits.tripTravel;
    if (isRateLimited(`trips:travel:${userId}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");
    return json(await getDayTravel(userId, tripId, day.data));
  });
}

// GET /api/v1/trips/[id]/weather : prévisions des prochains jours du voyage (#26)
export function getTripWeatherController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    const { max, windowMs } = getConfig().rateLimits.tripWeather;
    if (isRateLimited(`trips:weather:${userId}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");
    return json(await getTripWeather(userId, tripId));
  });
}

// GET /api/v1/trips/[id]/export/pdf (pass voyage)
export function exportTripPdfController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    if (isExportRateLimited(userId)) return errorResponse(429, "TOO_MANY_REQUESTS");
    const query = tripPdfQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return errorResponse(400, "INVALID_INPUT");
    const { fileName, bytes } = await exportTripPdf(userId, tripId, query.data.template);
    return fileResponse(new Uint8Array(bytes), "application/pdf", fileName);
  });
}

// GET /api/v1/trips/[id]/export/calendar (pass voyage)
export function exportTripCalendarController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    if (isExportRateLimited(userId)) return errorResponse(429, "TOO_MANY_REQUESTS");
    const { fileName, content } = await exportTripCalendar(userId, tripId);
    return fileResponse(content, "text/calendar; charset=utf-8", fileName);
  });
}

// POST /api/v1/trips/[id]/pass : commande du pass voyage (propriétaire), avant le paiement sur Buy Me a Coffee.
export function startTripPassCheckoutController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    // Sans les deux cases cochées : pas de lien de paiement.
    if (!(await parseBody(request, tripPassCheckoutSchema))) return errorResponse(400, "INVALID_INPUT");
    if (isExportRateLimited(userId)) return errorResponse(429, "TOO_MANY_REQUESTS");
    return json(await startTripPassCheckout(userId, tripId));
  });
}

// GET /api/v1/trips/[id]/messages
export function listTripMessagesController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => json({ messages: await getTripMessages(userId, tripId) }));
}

// POST /api/v1/trips/[id]/messages
export function sendTripMessageController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    const body = await parseBody(request, sendTripMessageSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    const { max, windowMs } = getConfig().rateLimits.tripChat;
    if (isRateLimited(`trips:chat:${userId}`, max, windowMs)) {
      return errorResponse(429, "TOO_MANY_REQUESTS");
    }

    const { content, ...context } = body;
    return json({ messages: await sendTripMessage(userId, tripId, content, context) }, 201);
  });
}

// PATCH /api/v1/trips/[id]/suggestions/[suggestionId]
export function answerTripSuggestionController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const suggestionId = idParamSchema.safeParse(routeParams.suggestionId);
    const body = await parseBody(request, answerTripSuggestionSchema);
    if (!suggestionId.success || !body) return errorResponse(400, "INVALID_INPUT");
    return json(await answerTripSuggestion(userId, tripId, suggestionId.data, body.accepted));
  });
}

// POST /api/v1/trips/[id]/messages/[messageId]/accept : « Tout accepter » (propositions en attente de cette réponse)
export function acceptMessageSuggestionsController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const messageId = idParamSchema.safeParse(routeParams.messageId);
    if (!messageId.success) return errorResponse(400, "INVALID_INPUT");
    return json(await acceptMessageSuggestions(userId, tripId, messageId.data));
  });
}

// POST /api/v1/trips/[id]/items
export function createTripItemController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    const body = await parseBody(request, createTripItemSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    return json(await addTripItem(userId, tripId, body), 201);
  });
}

// PATCH /api/v1/trips/[id]/items/[itemId]
export function updateTripItemController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const itemId = idParamSchema.safeParse(routeParams.itemId);
    const body = await parseBody(request, updateTripItemSchema);
    const version = parseIfMatch(request);
    if (!itemId.success || !body || version === false) return errorResponse(400, "INVALID_INPUT");
    return json(await updateTripItem(userId, tripId, itemId.data, body, version));
  });
}

// DELETE /api/v1/trips/[id]/items/[itemId]
export function deleteTripItemController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const itemId = idParamSchema.safeParse(routeParams.itemId);
    const version = parseIfMatch(request);
    if (!itemId.success || version === false) return errorResponse(400, "INVALID_INPUT");
    return json(await deleteTripItem(userId, tripId, itemId.data, version));
  });
}

// POST /api/v1/trips/[id]/tasks
export function createTripTaskController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    const body = await parseBody(request, createTripTaskSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    return json(await addTripTask(userId, tripId, body.label), 201);
  });
}

// PATCH /api/v1/trips/[id]/tasks/[taskId]
export function updateTripTaskController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const taskId = idParamSchema.safeParse(routeParams.taskId);
    const body = await parseBody(request, updateTripTaskSchema);
    if (!taskId.success || !body) return errorResponse(400, "INVALID_INPUT");
    return json(await updateTripTask(userId, tripId, taskId.data, body));
  });
}

// DELETE /api/v1/trips/[id]/tasks/[taskId]
export function deleteTripTaskController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId, routeParams) => {
    const taskId = idParamSchema.safeParse(routeParams.taskId);
    if (!taskId.success) return errorResponse(400, "INVALID_INPUT");
    return json(await deleteTripTask(userId, tripId, taskId.data));
  });
}

// JWT revérifié (en plus de proxy.ts) ; erreurs traduites en réponses génériques.
async function withUser(request: Request, handler: (userId: string) => Promise<Response>) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  try {
    return await handler(userId);
  } catch (error) {
    return handleError(error);
  }
}

async function withTrip(
  request: Request,
  params: Params,
  handler: (userId: string, tripId: number, routeParams: Record<string, string | string[] | undefined>) => Promise<Response>,
) {
  return withUser(request, async (userId) => {
    const routeParams = await params;
    const tripId = tripIdParamSchema.safeParse(routeParams.id);
    if (!tripId.success) return errorResponse(400, "INVALID_INPUT");
    // UUID de l'URL → clé interne (404 si inconnu), utilisée ensuite par les services.
    return handler(userId, await resolveTripId(tripId.data), routeParams);
  });
}

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | null> {
  const body = schema.safeParse(await request.json().catch(() => null));
  return body.success ? body.data : null;
}

// Version attendue (verrouillage optimiste) ; undefined : en-tête absent, dernière écriture gagnante ; false : en-tête invalide.
function parseIfMatch(request: Request): number | undefined | false {
  const header = request.headers.get("if-match");
  if (header === null) return undefined;
  const version = ifMatchSchema.safeParse(header);
  return version.success ? version.data : false;
}

// Exports et commandes du pass : une même fenêtre par utilisateur (RATE_LIMIT_TRIP_EXPORT_*).
function isExportRateLimited(userId: string) {
  const { max, windowMs } = getConfig().rateLimits.tripExport;
  return isRateLimited(`trips:export:${userId}`, max, windowMs);
}

function isAiRateLimited(userId: string) {
  const { max, windowMs } = getConfig().rateLimits.tripAi;
  return isRateLimited(`trips:ai:${userId}`, max, windowMs);
}

// Nom de fichier ASCII (exportFileName) : sûr dans l'en-tête.
function fileResponse(body: BodyInit, type: string, fileName: string) {
  return new Response(body, {
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store" },
  });
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function errorResponse(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

function handleError(error: unknown) {
  if (error instanceof TripAccessError) return errorResponse(error.code === "FORBIDDEN" ? 403 : 404, error.code);
  if (error instanceof TripPassError) {
    if (error.code === "PASS_REQUIRED") return errorResponse(402, "PASS_REQUIRED");
    if (error.code === "PASS_ALREADY_ACTIVE") return errorResponse(409, "PASS_ALREADY_ACTIVE");
    if (error.code === "PASS_UNAVAILABLE") return errorResponse(503, "PASS_UNAVAILABLE");
  }
  if (error instanceof TripError) {
    if (error.code === "NOT_FOUND") return errorResponse(404, "NOT_FOUND");
    if (error.code === "AI_UNAVAILABLE") return errorResponse(503, "AI_UNAVAILABLE");
    if (error.code === "TRAVEL_UNAVAILABLE") return errorResponse(503, "TRAVEL_UNAVAILABLE");
    if (error.code === "CHAT_LIMIT_REACHED") return errorResponse(429, "CHAT_LIMIT_REACHED");
    if (error.code === "SUGGESTION_OUTDATED") return errorResponse(409, "SUGGESTION_OUTDATED");
    if (error.code === "NOTHING_TO_UNDO") return errorResponse(404, "NOTHING_TO_UNDO");
    if (error.code === "PLAN_CHANGED") return errorResponse(409, "PLAN_CHANGED");
    if (error.code === "CONFLICT") return errorResponse(412, "CONFLICT");
    if (error.code === "ITEM_LOCKED") return errorResponse(409, "ITEM_LOCKED");
    if (error.code === "DAILY_LIMIT_REACHED") return errorResponse(429, "DAILY_LIMIT_REACHED");
    if (error.code === "AI_DISABLED") return errorResponse(503, "AI_DISABLED");
    if (error.code === "FORBIDDEN") return errorResponse(403, "FORBIDDEN");
    return errorResponse(400, error.code);
  }

  logError("trips", error);
  return errorResponse(500, "INTERNAL_ERROR");
}
