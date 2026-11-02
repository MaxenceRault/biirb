import "server-only";
import { connection } from "next/server";
import type { z } from "zod";
import { getConfig } from "@/server/config";
import { getUserIdFromRequest } from "@/server/jwt";
import { isRateLimited } from "@/server/rateLimit";
import {
  AdminError,
  addBannedWord,
  createArchetype,
  deletePost,
  deleteUser,
  dismissReports,
  editArchetype,
  getDashboard,
  getSettings,
  grantTripPass,
  listActions,
  listArchetypes,
  listBannedWords,
  listOpenReports,
  listPosts,
  listTripPasses,
  listUsers,
  removeBannedWord,
  removeTripPass,
  requireAdmin,
  listTickets,
  setPostHidden,
  updateTicket,
  updateSettings,
  updateUser,
  createDevTicket,
  getSupportBoard,
  listAssignees,
  listDevTickets,
  removeDevTicket,
  updateDevTicket,
} from "@/server/services/admin.service";
import {
  adminCloseReportsSchema,
  adminCreateBannedWordSchema,
  adminGrantTripPassSchema,
  adminPostsQuerySchema,
  adminUpdatePostSchema,
  adminUpdateSettingsSchema,
  adminUpdateUserSchema,
  adminUsersQuerySchema,
  userIdParamSchema,
} from "@/schemas/admin.schema";
import { createArchetypeSchema, updateArchetypeSchema } from "@/schemas/archetype.schema";
import { postIdSchema } from "@/schemas/post.schema";
import { adminTicketsQuerySchema, adminUpdateTicketSchema, ticketIdSchema } from "@/schemas/ticket.schema";
import { createDevTicketSchema, devTicketIdSchema, updateDevTicketSchema } from "@/schemas/dev-ticket.schema";
import { logError } from "@/server/logger";

type Params = Promise<Record<string, string | string[] | undefined>>;
type Context = { params: Params };

// GET /api/v1/admin/dashboard
export function dashboardController(request: Request) {
  return withAdmin(request, async () => json(await getDashboard()));
}

// GET /api/v1/admin/users?q=&page=
export function listUsersController(request: Request) {
  return withAdmin(request, async () => {
    const query = parseQuery(request, adminUsersQuerySchema);
    return query ? json(await listUsers(query)) : errorResponse(400, "INVALID_INPUT");
  });
}

// PATCH /api/v1/admin/users/[id] { role?, banned? }
export function updateUserController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const userId = userIdParamSchema.safeParse((await params).id);
    const body = await parseBody(request, adminUpdateUserSchema);
    if (!userId.success || !body) return errorResponse(400, "INVALID_INPUT");
    return json({ user: await updateUser(adminId, userId.data, body) });
  });
}

// DELETE /api/v1/admin/users/[id]
export function deleteUserController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const userId = userIdParamSchema.safeParse((await params).id);
    if (!userId.success) return errorResponse(400, "INVALID_INPUT");
    await deleteUser(adminId, userId.data);
    return new Response(null, { status: 204 });
  });
}

// GET /api/v1/admin/posts?q=&visibility=&page=
export function listPostsController(request: Request) {
  return withAdmin(request, async () => {
    const query = parseQuery(request, adminPostsQuerySchema);
    return query ? json(await listPosts(query)) : errorResponse(400, "INVALID_INPUT");
  });
}

// PATCH /api/v1/admin/posts/[id] { hidden }
export function updatePostController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const postId = postIdSchema.safeParse((await params).id);
    const body = await parseBody(request, adminUpdatePostSchema);
    if (!postId.success || !body) return errorResponse(400, "INVALID_INPUT");
    return json(await setPostHidden(adminId, postId.data, body.hidden));
  });
}

// DELETE /api/v1/admin/posts/[id]
export function deletePostController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const postId = postIdSchema.safeParse((await params).id);
    if (!postId.success) return errorResponse(400, "INVALID_INPUT");
    await deletePost(adminId, postId.data);
    return new Response(null, { status: 204 });
  });
}

// GET /api/v1/admin/reports
export function listReportsController(request: Request) {
  return withAdmin(request, async () => json({ reports: await listOpenReports() }));
}

// PATCH /api/v1/admin/reports/[postId] { status: "dismissed" }
export function closeReportsController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const postId = postIdSchema.safeParse((await params).postId);
    const body = await parseBody(request, adminCloseReportsSchema);
    if (!postId.success || !body) return errorResponse(400, "INVALID_INPUT");
    await dismissReports(adminId, postId.data);
    return new Response(null, { status: 204 });
  });
}

// GET /api/v1/admin/tickets?status=&page=
export function listTicketsController(request: Request) {
  return withAdmin(request, async () => {
    const query = parseQuery(request, adminTicketsQuerySchema);
    return query ? json(await listTickets(query)) : errorResponse(400, "INVALID_INPUT");
  });
}

// PATCH /api/v1/admin/tickets/[id] { status?, priority?, assigneeIds? }
export function updateTicketController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const id = ticketIdSchema.safeParse((await params).id);
    const body = await parseBody(request, adminUpdateTicketSchema);
    if (!id.success || !body) return errorResponse(400, "INVALID_INPUT");
    await updateTicket(adminId, id.data, body);
    return new Response(null, { status: 204 });
  });
}

// GET /api/v1/admin/tickets/board : Kanban du support.
export function supportBoardController(request: Request) {
  return withAdmin(request, async () => json(await getSupportBoard()));
}

// GET /api/v1/admin/assignees : admins assignables à un ticket (Kanban).
export function listAssigneesController(request: Request) {
  return withAdmin(request, async () => json(await listAssignees()));
}

// GET /api/v1/admin/dev-tickets : Kanban du développement.
export function listDevTicketsController(request: Request) {
  return withAdmin(request, async () => json(await listDevTickets()));
}

// POST /api/v1/admin/dev-tickets { title, description?, priority? }
export function createDevTicketController(request: Request) {
  return withAdmin(request, async (adminId) => {
    const body = await parseBody(request, createDevTicketSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    return json(await createDevTicket(adminId, body), 201);
  });
}

// PATCH /api/v1/admin/dev-tickets/[id] { title?, description?, status?, priority?, assigneeIds? }
export function updateDevTicketController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const id = devTicketIdSchema.safeParse((await params).id);
    const body = await parseBody(request, updateDevTicketSchema);
    if (!id.success || !body) return errorResponse(400, "INVALID_INPUT");
    await updateDevTicket(adminId, id.data, body);
    return new Response(null, { status: 204 });
  });
}

// DELETE /api/v1/admin/dev-tickets/[id]
export function deleteDevTicketController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const id = devTicketIdSchema.safeParse((await params).id);
    if (!id.success) return errorResponse(400, "INVALID_INPUT");
    await removeDevTicket(adminId, id.data);
    return new Response(null, { status: 204 });
  });
}

// GET /api/v1/admin/trip-passes
export function listTripPassesController(request: Request) {
  return withAdmin(request, async () => json(await listTripPasses()));
}

// POST /api/v1/admin/trip-passes { tripId, passId?, payerEmail? }
export function grantTripPassController(request: Request) {
  return withAdmin(request, async (adminId) => {
    const body = await parseBody(request, adminGrantTripPassSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    await grantTripPass(adminId, body);
    return new Response(null, { status: 204 });
  });
}

// DELETE /api/v1/admin/trip-passes/[id]
export function revokeTripPassController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const id = postIdSchema.safeParse((await params).id);
    if (!id.success) return errorResponse(400, "INVALID_INPUT");
    await removeTripPass(adminId, id.data);
    return new Response(null, { status: 204 });
  });
}

// GET /api/v1/admin/archetypes
export function listArchetypesController(request: Request) {
  return withAdmin(request, async () => json({ archetypes: await listArchetypes() }));
}

// POST /api/v1/admin/archetypes { label, description?, slug? }
export function createArchetypeController(request: Request) {
  return withAdmin(request, async (adminId) => {
    const body = await parseBody(request, createArchetypeSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    return json({ archetype: await createArchetype(adminId, body) }, 201);
  });
}

// PATCH /api/v1/admin/archetypes/[id] { label?, description?, isActive? }
export function updateArchetypeController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const id = postIdSchema.safeParse((await params).id);
    const body = await parseBody(request, updateArchetypeSchema);
    if (!id.success || !body) return errorResponse(400, "INVALID_INPUT");
    return json({ archetype: await editArchetype(adminId, id.data, body) });
  });
}

// GET /api/v1/admin/settings
export function getSettingsController(request: Request) {
  return withAdmin(request, async () => json({ settings: await getSettings() }));
}

// PATCH /api/v1/admin/settings { aiEnabled?, aiDailyCap? }
export function updateSettingsController(request: Request) {
  return withAdmin(request, async (adminId) => {
    const body = await parseBody(request, adminUpdateSettingsSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    return json({ settings: await updateSettings(adminId, body) });
  });
}

// GET /api/v1/admin/banned-words
export function listBannedWordsController(request: Request) {
  return withAdmin(request, async () => json({ words: await listBannedWords() }));
}

// POST /api/v1/admin/banned-words { term, reason, kind }
export function createBannedWordController(request: Request) {
  return withAdmin(request, async (adminId) => {
    const body = await parseBody(request, adminCreateBannedWordSchema);
    if (!body) return errorResponse(400, "INVALID_INPUT");
    return json({ word: await addBannedWord(adminId, body) }, 201);
  });
}

// DELETE /api/v1/admin/banned-words/[id]
export function deleteBannedWordController(request: Request, { params }: Context) {
  return withAdmin(request, async (adminId) => {
    const id = postIdSchema.safeParse((await params).id);
    if (!id.success) return errorResponse(400, "INVALID_INPUT");
    await removeBannedWord(adminId, id.data);
    return new Response(null, { status: 204 });
  });
}

// GET /api/v1/admin/actions
export function listActionsController(request: Request) {
  return withAdmin(request, async () => json({ actions: await listActions() }));
}

// Token, rate limit, puis rôle admin relu en base. Non-admin : 403 générique.
async function withAdmin(request: Request, handler: (adminId: string) => Promise<Response>) {
  // Jamais pré-calculé au build (cacheComponents).
  await connection();
  const adminId = await getUserIdFromRequest(request);
  if (!adminId) return errorResponse(401, "UNAUTHORIZED");

  const { max, windowMs } = getConfig().rateLimits.admin;
  if (isRateLimited(`admin:${adminId}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

  try {
    await requireAdmin(adminId);
    return await handler(adminId);
  } catch (error) {
    return handleError(error);
  }
}

function parseQuery<T extends z.ZodType>(request: Request, schema: T): z.infer<T> | null {
  const query = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  return query.success ? query.data : null;
}

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | null> {
  const body = schema.safeParse(await request.json().catch(() => null));
  return body.success ? body.data : null;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

const ADMIN_ERROR_STATUS: Record<AdminError["code"], number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  CANNOT_TARGET_SELF: 409,
  TARGET_IS_ADMIN: 409,
  ARCHETYPE_TAKEN: 409,
  BANNED_WORD_TAKEN: 409,
  TRIP_NOT_FOUND: 404,
  PASS_ALREADY_ACTIVE: 409,
  EMAIL_MISMATCH: 409,
};

function handleError(error: unknown) {
  if (error instanceof AdminError) return errorResponse(ADMIN_ERROR_STATUS[error.code], error.code);

  logError("admin", error);
  return errorResponse(500, "INTERNAL_ERROR");
}
