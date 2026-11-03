import "server-only";
import { getUserIdFromRequest } from "@/server/jwt";
import { logError } from "@/server/logger";
import { getConfig } from "@/server/config";
import { isRateLimited } from "@/server/rateLimit";
import {
  clearNotifications,
  getTripNotificationSettings,
  listNotifications,
  readAllNotifications,
  subscribePush,
  unsubscribePush,
  updateTripNotificationSettings,
} from "@/server/services/notification.service";
import { resolveTripId, TripAccessError } from "@/server/services/trip-access.service";
import { pushSubscriptionSchema, pushUnsubscribeSchema, tripNotificationSettingsSchema } from "@/schemas/notification.schema";
import { tripIdParamSchema } from "@/schemas/trip.schema";

type Params = Promise<Record<string, string | string[] | undefined>>;

// GET /api/v1/users/me/notifications (Bearer) → { notifications, unread }
export async function listNotificationsController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  try {
    return Response.json(await listNotifications(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return internalError(error);
  }
}

// POST /api/v1/users/me/notifications/read (Bearer) → 204 : toutes marquées comme lues.
export async function readNotificationsController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  try {
    await readAllNotifications(userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return internalError(error);
  }
}

// DELETE /api/v1/users/me/notifications (Bearer) → 204 : toutes effacées.
export async function clearNotificationsController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  try {
    await clearNotifications(userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return internalError(error);
  }
}

// GET /api/v1/trips/[id]/notification-settings (Bearer) → { push, email, pushPublicKey, emailAvailable }
export async function getTripNotificationSettingsController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => Response.json(await getTripNotificationSettings(userId, tripId)));
}

// PUT /api/v1/trips/[id]/notification-settings (Bearer) { push, email } → réglages à jour
export async function updateTripNotificationSettingsController(request: Request, { params }: { params: Params }) {
  return withTrip(request, params, async (userId, tripId) => {
    const body = tripNotificationSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return errorResponse(400, "INVALID_INPUT");
    return Response.json(await updateTripNotificationSettings(userId, tripId, body.data));
  });
}

// POST /api/v1/users/me/push-subscriptions (Bearer) { endpoint, keys } → 204 : cet appareil reçoit les notifications du navigateur.
export async function subscribePushController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");
  // Même fenêtre que les exports : un compte ne remplit pas la table d'abonnements.
  const { max, windowMs } = getConfig().rateLimits.tripExport;
  if (isRateLimited(`push:subscribe:${userId}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

  const body = pushSubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");
  try {
    await subscribePush(userId, body.data);
    return new Response(null, { status: 204 });
  } catch (error) {
    return internalError(error);
  }
}

// DELETE /api/v1/users/me/push-subscriptions (Bearer) { endpoint } → 204 (déconnexion de cet appareil).
export async function unsubscribePushController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  const body = pushUnsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");
  try {
    await unsubscribePush(userId, body.data.endpoint);
    return new Response(null, { status: 204 });
  } catch (error) {
    return internalError(error);
  }
}

// JWT revérifié (en plus de proxy.ts) ; UUID du voyage → clé interne (404 si inconnu ou pas membre).
async function withTrip(request: Request, params: Params, handler: (userId: string, tripId: number) => Promise<Response>) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");
  const tripId = tripIdParamSchema.safeParse((await params).id);
  if (!tripId.success) return errorResponse(400, "INVALID_INPUT");

  try {
    return await handler(userId, await resolveTripId(tripId.data));
  } catch (error) {
    if (error instanceof TripAccessError) return errorResponse(error.code === "FORBIDDEN" ? 403 : 404, error.code);
    return internalError(error);
  }
}

function errorResponse(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

function internalError(error: unknown) {
  logError("notifications", error);
  return errorResponse(500, "INTERNAL_ERROR");
}
