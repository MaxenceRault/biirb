import "server-only";
import { trackServerEvent } from "@/server/services/analytics.service";
import { createHash, randomBytes } from "node:crypto";
import {
  answerUserInvitation,
  countTripTravelers,
  deleteMember,
  deleteTripInvitation,
  findActiveUserIdByUsername,
  findPendingInvitations,
  findTripInvitations,
  findTripMembers,
  insertLinkInvitation,
  joinWithLink,
  updateMemberRole,
  upsertUserInvitation,
} from "@/server/repositories/trip-share.repository";
import { requireTripRole } from "@/server/services/trip-access.service";
import { TRIP_MAX_TRAVELERS, type InviteMemberInput, type TripMemberRole } from "@/schemas/trip-share.schema";

export class TripShareError extends Error {
  constructor(public readonly code: "INVALID_INPUT" | "NOT_FOUND" | "USER_NOT_FOUND" | "ALREADY_MEMBER" | "INVITE_INVALID" | "TRIP_FULL") {
    super(code);
  }
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Membres visibles par tous ; invitations en cours seulement pour le propriétaire.
export async function getTripSharing(userId: string, tripId: number) {
  const role = await requireTripRole(userId, tripId, "viewer");
  const [members, invitations] = await Promise.all([
    findTripMembers(tripId),
    role === "owner" ? findTripInvitations(tripId) : Promise.resolve([]),
  ]);
  return { role, members, invitations };
}

export async function inviteByUsername(userId: string, tripId: number, input: InviteMemberInput) {
  await requireTripRole(userId, tripId, "owner");
  const inviteeId = await findActiveUserIdByUsername(input.username);
  if (!inviteeId) throw new TripShareError("USER_NOT_FOUND");
  if (inviteeId === userId) throw new TripShareError("INVALID_INPUT");
  // Places réservées par les invitations en attente ; la limite est revérifiée à l'acceptation.
  if ((await countTripTravelers(tripId, { pendingInvitations: true })) >= TRIP_MAX_TRAVELERS) throw new TripShareError("TRIP_FULL");
  if (!(await upsertUserInvitation(tripId, inviteeId, input.role, userId, expiry()))) throw new TripShareError("ALREADY_MEMBER");
  await trackServerEvent("companion_invited", { method: "username", role: input.role });
  return getTripSharing(userId, tripId);
}

// Le code n'est renvoyé qu'une fois : seule son empreinte est stockée.
export async function createInviteLink(userId: string, tripId: number, role: TripMemberRole) {
  await requireTripRole(userId, tripId, "owner");
  if ((await countTripTravelers(tripId)) >= TRIP_MAX_TRAVELERS) throw new TripShareError("TRIP_FULL");
  const code = randomBytes(32).toString("base64url");
  const expiresAt = expiry();
  const id = await insertLinkInvitation(tripId, hashCode(code), role, userId, expiresAt);
  await trackServerEvent("companion_invited", { method: "link", role });
  return { id, code, role, expiresAt: expiresAt.toISOString() };
}

export async function revokeInvitation(userId: string, tripId: number, invitationId: number) {
  await requireTripRole(userId, tripId, "owner");
  if (!(await deleteTripInvitation(tripId, invitationId))) throw new TripShareError("NOT_FOUND");
  return getTripSharing(userId, tripId);
}

export async function changeMemberRole(userId: string, tripId: number, memberId: string, role: TripMemberRole) {
  await requireTripRole(userId, tripId, "owner");
  if (!(await updateMemberRole(tripId, memberId, role))) throw new TripShareError("NOT_FOUND");
  return getTripSharing(userId, tripId);
}

// Le propriétaire retire un membre ; un membre peut se retirer lui-même (quitter le voyage).
export async function removeMember(userId: string, tripId: number, memberId: string) {
  const role = await requireTripRole(userId, tripId, "viewer");
  if (memberId !== userId && role !== "owner") throw new TripShareError("NOT_FOUND");
  if (!(await deleteMember(tripId, memberId))) throw new TripShareError("NOT_FOUND");
}

export function listMyInvitations(userId: string) {
  return findPendingInvitations(userId);
}

export async function answerInvitation(userId: string, invitationId: number, accepted: boolean) {
  const result = await answerUserInvitation(invitationId, userId, accepted);
  if (result === null) throw new TripShareError("NOT_FOUND");
  if (result.full) throw new TripShareError("TRIP_FULL");
  return { tripId: accepted ? result.tripId : null };
}

export async function joinTrip(userId: string, code: string) {
  const result = await joinWithLink(hashCode(code), userId);
  if (result === null) throw new TripShareError("INVITE_INVALID");
  if (result.full) throw new TripShareError("TRIP_FULL");
  return { tripId: result.tripId };
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function expiry() {
  return new Date(Date.now() + INVITATION_TTL_MS);
}
