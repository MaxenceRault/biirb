import "server-only";
import {
  findAdminActions,
  findDashboardCounts,
  findRecentUsers,
  insertAdminAction,
  type AdminActionTarget,
} from "@/server/repositories/admin.repository";
import { countAiCallsPerDay, findAppSettings, updateAppSettings } from "@/server/repositories/ai-usage.repository";
import {
  ArchetypeTakenError,
  findAllArchetypesWithStats,
  insertArchetype,
  updateArchetype,
} from "@/server/repositories/archetype.repository";
import {
  deletePostById,
  deletePostPhoto,
  findPostsForAdmin,
  photoPathFromUrl,
  updatePostVisibilityById,
} from "@/server/repositories/post.repository";
import { revokeUserRefreshTokens } from "@/server/repositories/refresh-token.repository";
import { closeOpenReports, countOpenReports, findOpenReports } from "@/server/repositories/report.repository";
import {
  deleteUserById,
  findUserAccess,
  findUserMediaUrls,
  findUsersForAdmin,
  updateUserBanned,
  updateUserRole,
} from "@/server/repositories/user.repository";
import { aiDailyLimitPerUser } from "@/server/services/ai-quota.service";
import { normalizeText } from "@/server/moderationFilter";
import {
  BannedWordTakenError,
  deleteBannedWord,
  findBannedWords,
  insertBannedWord,
} from "@/server/repositories/banned-word.repository";
import { clearBannedTermsCache } from "@/server/services/banned-word.service";
import { findTicketsForAdmin, findTicketsForBoard, updateTicket as updateTicketRow } from "@/server/repositories/ticket.repository";
import type { TicketPriority, TicketStatus } from "@/schemas/ticket.schema";
import {
  deleteDevTicket,
  findDevTickets,
  insertDevTicket,
  updateDevTicket as updateDevTicketRow,
} from "@/server/repositories/dev-ticket.repository";
import type { CreateDevTicketInput, UpdateDevTicketInput } from "@/schemas/dev-ticket.schema";
import { getBuyMeACoffeeConfig } from "@/server/config";
import { findTripInternalId } from "@/server/repositories/trip.repository";
import {
  assignTripPass,
  findActiveTripPasses,
  findUnassignedTripPassEmailHash,
  findUnassignedTripPasses,
  hasActiveTripPass,
  insertGiftTripPass,
  revokeTripPass,
} from "@/server/repositories/trip-pass.repository";
import { payerEmailHash } from "@/server/services/trip-pass.service";
import type { CreateArchetypeInput, UpdateArchetypeInput } from "@/schemas/archetype.schema";
import { ARCHETYPE_SLUG_PATTERN } from "@/schemas/archetype.schema";
import type {
  AdminCreateBannedWordInput,
  AdminGrantTripPassInput,
  AdminUpdateSettingsInput,
  AdminUpdateUserInput,
} from "@/schemas/admin.schema";

export class AdminError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "CANNOT_TARGET_SELF"
      | "TARGET_IS_ADMIN"
      | "ARCHETYPE_TAKEN"
      | "BANNED_WORD_TAKEN"
      // Pass voyage.
      | "TRIP_NOT_FOUND"
      | "PASS_ALREADY_ACTIVE"
      | "EMAIL_MISMATCH",
  ) {
    super(code);
  }
}

const PAGE_SIZE = 50;
const REPORTS_LIMIT = 100;
const ACTIONS_LIMIT = 200;
const AI_HISTORY_DAYS = 7;
const RECENT_USERS = 5;

// Relus en base à chaque requête : un rôle retiré prend effet immédiatement.
export async function requireAdmin(userId: string) {
  const access = await findUserAccess(userId);
  if (!access || access.banned_at || access.role !== "admin") throw new AdminError("FORBIDDEN");
}

function log(adminId: string, action: string, targetType: AdminActionTarget, targetId: string | number | null, details?: Record<string, unknown>) {
  return insertAdminAction({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId === null ? null : String(targetId),
    details: details ?? null,
  });
}

export async function getDashboard() {
  const [counts, openReports, aiPerDay, settings, recentUsers] = await Promise.all([
    findDashboardCounts(),
    countOpenReports(),
    countAiCallsPerDay(AI_HISTORY_DAYS),
    findAppSettings(),
    findRecentUsers(RECENT_USERS),
  ]);
  return {
    counts: { ...counts, open_reports: openReports },
    ai: {
      today: aiPerDay.at(-1)?.total ?? 0,
      perDay: aiPerDay,
      enabled: settings.ai_enabled,
      dailyCap: settings.ai_daily_cap,
      perUserLimit: aiDailyLimitPerUser(),
    },
    recentUsers,
  };
}

export async function listUsers({ q, page }: { q?: string; page: number }) {
  const { users, total } = await findUsersForAdmin({ search: q, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  return { users, total, page, pageSize: PAGE_SIZE };
}

export async function updateUser(adminId: string, userId: string, input: AdminUpdateUserInput) {
  if (userId === adminId) throw new AdminError("CANNOT_TARGET_SELF");
  const target = await findUserAccess(userId);
  if (!target) throw new AdminError("NOT_FOUND");

  if (input.banned !== undefined) {
    // Rétrograder puis bannir dans la même requête est permis.
    if (input.banned && (input.role ?? target.role) === "admin") throw new AdminError("TARGET_IS_ADMIN");
  }

  if (input.role !== undefined && input.role !== target.role) {
    await updateUserRole(userId, input.role);
    await log(adminId, "user.role", "user", userId, { from: target.role, to: input.role });
  }

  if (input.banned !== undefined && input.banned !== Boolean(target.banned_at)) {
    await updateUserBanned(userId, input.banned);
    // L'access token en cours expire dans l'heure.
    if (input.banned) await revokeUserRefreshTokens(userId);
    await log(adminId, input.banned ? "user.ban" : "user.unban", "user", userId);
  }

  return findUserAccess(userId);
}

export async function deleteUser(adminId: string, userId: string) {
  if (userId === adminId) throw new AdminError("CANNOT_TARGET_SELF");
  const target = await findUserAccess(userId);
  if (!target) throw new AdminError("NOT_FOUND");
  if (target.role === "admin") throw new AdminError("TARGET_IS_ADMIN");

  const mediaUrls = await findUserMediaUrls(userId);
  if (!(await deleteUserById(userId))) throw new AdminError("NOT_FOUND");
  await log(adminId, "user.delete", "user", userId);

  // Le compte est supprimé : une photo qui résiste ne fait pas échouer la requête.
  await Promise.all(
    mediaUrls.map((url) => {
      const path = photoPathFromUrl(url);
      return path ? deletePostPhoto(path).catch(() => {}) : null;
    }),
  );
}

export async function listPosts({ q, page, visibility }: { q?: string; page: number; visibility: "all" | "visible" | "hidden" }) {
  const { posts, total } = await findPostsForAdmin({ search: q, visibility, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  return { posts, total, page, pageSize: PAGE_SIZE };
}

export async function setPostHidden(adminId: string, postId: number, hidden: boolean) {
  if (!(await updatePostVisibilityById(postId, hidden))) throw new AdminError("NOT_FOUND");
  // Masqué : signalements traités ; réaffiché (ex. post en attente de modération) : validé.
  await closeOpenReports(postId, hidden ? "resolved" : "dismissed");
  await log(adminId, hidden ? "post.hide" : "post.show", "post", postId);
  return { id: postId, hidden };
}

export async function deletePost(adminId: string, postId: number) {
  const photoUrls = await deletePostById(postId);
  if (photoUrls === null) throw new AdminError("NOT_FOUND");
  await log(adminId, "post.delete", "post", postId);

  await Promise.all(
    photoUrls.map((url) => {
      const path = photoPathFromUrl(url);
      return path ? deletePostPhoto(path).catch(() => {}) : null;
    }),
  );
}

export function listOpenReports() {
  return findOpenReports(REPORTS_LIMIT);
}

export async function dismissReports(adminId: string, postId: number) {
  const closed = await closeOpenReports(postId, "dismissed");
  if (closed === 0) throw new AdminError("NOT_FOUND");
  await log(adminId, "reports.dismiss", "post", postId, { count: closed });
}

export function listArchetypes() {
  return findAllArchetypesWithStats();
}

export async function createArchetype(adminId: string, input: CreateArchetypeInput) {
  const slug = input.slug ?? slugify(input.label);
  if (!ARCHETYPE_SLUG_PATTERN.test(slug)) throw new AdminError("INVALID_INPUT");

  try {
    const archetype = await insertArchetype({ slug, label: input.label, description: input.description ?? null });
    await log(adminId, "archetype.create", "archetype", archetype.id, { slug, label: input.label });
    return archetype;
  } catch (error) {
    if (error instanceof ArchetypeTakenError) throw new AdminError("ARCHETYPE_TAKEN");
    throw error;
  }
}

export async function editArchetype(adminId: string, id: number, input: UpdateArchetypeInput) {
  try {
    const archetype = await updateArchetype(id, {
      label: input.label,
      description: input.description,
      is_active: input.isActive,
    });
    if (!archetype) throw new AdminError("NOT_FOUND");
    await log(adminId, "archetype.update", "archetype", id, { ...input });
    return archetype;
  } catch (error) {
    if (error instanceof ArchetypeTakenError) throw new AdminError("ARCHETYPE_TAKEN");
    throw error;
  }
}

// « Road trip & van » → « road_trip_van ».
function slugify(label: string) {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
}

export function getSettings() {
  return findAppSettings();
}

export async function updateSettings(adminId: string, input: AdminUpdateSettingsInput) {
  const settings = await updateAppSettings({ ai_enabled: input.aiEnabled, ai_daily_cap: input.aiDailyCap });
  await log(adminId, "settings.update", "settings", null, { ...input });
  return settings;
}

export function listActions() {
  return findAdminActions(ACTIONS_LIMIT);
}

export function listBannedWords() {
  return findBannedWords();
}

// Terme normalisé comme le texte vérifié (« Connard » → « connard ») : sinon il ne serait jamais trouvé.
export async function addBannedWord(adminId: string, input: AdminCreateBannedWordInput) {
  const term = normalizeText(input.term);
  if (!/^[a-z]+( [a-z]+)*$/.test(term) || (input.kind !== "phrase" && term.includes(" "))) throw new AdminError("INVALID_INPUT");

  try {
    const word = await insertBannedWord({ term, reason: input.reason, kind: input.kind });
    clearBannedTermsCache();
    await log(adminId, "banned_word.create", "settings", word.id, { term, reason: input.reason, kind: input.kind });
    return word;
  } catch (error) {
    if (error instanceof BannedWordTakenError) throw new AdminError("BANNED_WORD_TAKEN");
    throw error;
  }
}

export async function removeBannedWord(adminId: string, id: number) {
  const term = await deleteBannedWord(id);
  if (term === null) throw new AdminError("NOT_FOUND");
  clearBannedTermsCache();
  await log(adminId, "banned_word.delete", "settings", id, { term });
}

export async function listTickets({ status, page }: { status: TicketStatus | "all"; page: number }) {
  const { tickets, total } = await findTicketsForAdmin(status === "all" ? null : status, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return { tickets, total, page, pageSize: PAGE_SIZE };
}

// L'état est vu par l'auteur du ticket ; la priorité reste interne à l'administration.
export async function updateTicket(adminId: string, ticketId: number, changes: { status?: TicketStatus; priority?: TicketPriority }) {
  const updated = await updateTicketRow(ticketId, changes);
  if (!updated) throw new AdminError("NOT_FOUND");
  const { previous } = updated;
  if (changes.status && changes.status !== previous.status) {
    await log(adminId, "ticket.status", "ticket", ticketId, { from: previous.status, to: changes.status });
  }
  if (changes.priority && changes.priority !== previous.priority) {
    await log(adminId, "ticket.priority", "ticket", ticketId, { from: previous.priority, to: changes.priority });
  }
}

// Kanban : colonne « clôturé » limitée aux plus récents ; plafond des tickets à traiter (taille de la réponse).
const BOARD_CLOSED_LIMIT = 30;
const BOARD_OPEN_LIMIT = 300;

export async function getSupportBoard() {
  return { tickets: await findTicketsForBoard(BOARD_CLOSED_LIMIT, BOARD_OPEN_LIMIT) };
}

// Tickets de développement : écrits par les admins, visibles d'eux seuls.
export async function listDevTickets() {
  return { tickets: await findDevTickets(BOARD_CLOSED_LIMIT, BOARD_OPEN_LIMIT) };
}

export async function createDevTicket(adminId: string, input: CreateDevTicketInput) {
  const id = await insertDevTicket(adminId, { title: input.title, description: input.description ?? null, priority: input.priority });
  await log(adminId, "dev_ticket.create", "dev_ticket", id, { title: input.title });
  return { id };
}

export async function updateDevTicket(adminId: string, id: number, input: UpdateDevTicketInput) {
  const updated = await updateDevTicketRow(id, input);
  if (!updated) throw new AdminError("NOT_FOUND");
  const moved = input.status !== undefined && input.status !== updated.previous.status;
  await log(adminId, "dev_ticket.update", "dev_ticket", id, {
    title: input.title ?? updated.previous.title,
    fields: Object.keys(input),
    ...(moved ? { from: updated.previous.status, to: input.status } : {}),
  });
}

export async function removeDevTicket(adminId: string, id: number) {
  const title = await deleteDevTicket(id);
  if (title === null) throw new AdminError("NOT_FOUND");
  await log(adminId, "dev_ticket.delete", "dev_ticket", id, { title });
}

const TRIP_PASSES_LIMIT = 100;

// Achats à rattacher (autre email, commande expirée) et pass actifs.
export async function listTripPasses() {
  const [unassigned, active] = await Promise.all([findUnassignedTripPasses(), findActiveTripPasses(TRIP_PASSES_LIMIT)]);
  return { unassigned, active };
}

// passId : rattache un achat payé, seulement si l'email déclaré par l'acheteur est bien celui du paiement
// (personne ne peut se faire attribuer le paiement d'un autre). Sans passId : pass offert.
export async function grantTripPass(adminId: string, { tripId: publicId, passId, payerEmail }: AdminGrantTripPassInput) {
  const tripId = await findTripInternalId(publicId);
  if (tripId === null) throw new AdminError("TRIP_NOT_FOUND");
  if (await hasActiveTripPass(tripId)) throw new AdminError("PASS_ALREADY_ACTIVE");

  if (passId === undefined) {
    const id = await insertGiftTripPass(tripId, adminId);
    await log(adminId, "trip_pass.gift", "trip", publicId, { passId: id });
    return;
  }

  const purchase = await findUnassignedTripPassEmailHash(passId);
  if (!purchase) throw new AdminError("NOT_FOUND");
  const secret = getBuyMeACoffeeConfig()?.webhookSecret;
  if (!secret || !payerEmail || purchase.payer_email_hash !== payerEmailHash(payerEmail, secret)) {
    throw new AdminError("EMAIL_MISMATCH");
  }
  if (!(await assignTripPass(passId, tripId, adminId))) throw new AdminError("NOT_FOUND");
  await log(adminId, "trip_pass.assign", "trip", publicId, { passId });
}

export async function removeTripPass(adminId: string, passId: number) {
  const revoked = await revokeTripPass(passId);
  if (!revoked) throw new AdminError("NOT_FOUND");
  await log(adminId, "trip_pass.revoke", "trip", revoked.trip_public_id, { passId });
}
