import "server-only";
import { connection } from "next/server";
import { getConfig } from "@/server/config";
import { getUserIdFromRequest } from "@/server/jwt";
import { clientIp, isRateLimited } from "@/server/rateLimit";
import {
  deleteMyAccount,
  getAccountDeletionPreview,
  getMyBadges,
  getMyProfile,
  getPublicProfile,
  ProfileError,
  setMyAvatar,
  setMyBadge,
  updateMyProfile,
} from "@/server/services/user.service";
import {
  deleteAccountSchema,
  displayedBadgeSchema,
  PROFILE_IMAGE_MAX_BYTES,
  profileImageSchema,
  updateProfileSchema,
  usernameParamSchema,
} from "@/schemas/user.schema";
import { logError } from "@/server/logger";

// GET /api/v1/users/me
export async function getMeController(request: Request) {
  // Jamais pré-calculé au build (cacheComponents).
  await connection();
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  try {
    return Response.json(await getMyProfile(userId));
  } catch (error) {
    return handleError(error);
  }
}

// GET /api/v1/users/me/badge : badges débloqués, badge affiché, progression.
export async function getMyBadgesController(request: Request) {
  await connection();
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");
  try {
    return Response.json(await getMyBadges(userId));
  } catch (error) {
    return handleError(error);
  }
}

// PUT /api/v1/users/me/badge { badge } : choisir le badge affiché (même limite que la modification du profil).
export async function setMyBadgeController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  const { max, windowMs } = getConfig().rateLimits.profileUpdate;
  if (isRateLimited(`users:update:${userId}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

  const body = displayedBadgeSchema.safeParse(await readJson(request));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");

  try {
    return Response.json(await setMyBadge(userId, body.data.badge));
  } catch (error) {
    return handleError(error);
  }
}

// GET /api/v1/users/{pseudo} : profil public (sans compte). Profil privé → identité seule.
export async function getPublicProfileController(request: Request, { params }: RouteContext<"/api/v1/users/[username]">) {
  // Jamais pré-calculé au build : les réglages de confidentialité peuvent changer à tout moment.
  await connection();
  const { max, windowMs } = getConfig().rateLimits.profileView;
  if (isRateLimited(`users:view:${clientIp(request)}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

  const username = usernameParamSchema.safeParse((await params).username);
  if (!username.success) return errorResponse(400, "INVALID_INPUT");

  try {
    return Response.json(await getPublicProfile(username.data));
  } catch (error) {
    // Pseudo inconnu ou compte banni : 404, sans distinguer les deux cas.
    if (error instanceof ProfileError && error.code === "NOT_FOUND") return errorResponse(404, "NOT_FOUND");
    return handleError(error);
  }
}

// PATCH /api/v1/users/me
export async function updateMeController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  const { max, windowMs } = getConfig().rateLimits.profileUpdate;
  if (isRateLimited(`users:update:${userId}`, max, windowMs)) {
    return errorResponse(429, "TOO_MANY_REQUESTS");
  }

  const body = updateProfileSchema.safeParse(await readJson(request));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");

  try {
    return Response.json({ user: await updateMyProfile(userId, body.data) });
  } catch (error) {
    return handleError(error);
  }
}

// GET /api/v1/users/me/deletion : ce que la suppression du compte ferait aux voyages (#112)
export async function accountDeletionPreviewController(request: Request) {
  await connection();
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");
  try {
    return Response.json(await getAccountDeletionPreview(userId));
  } catch (error) {
    return handleError(error);
  }
}

// DELETE /api/v1/users/me { password } (#112). Sessions supprimées avec le compte : le cookie de refresh ne sert plus.
export async function deleteMeController(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return errorResponse(401, "UNAUTHORIZED");

  // Comme le login : un mot de passe ne se teste pas en boucle.
  const { max, windowMs } = getConfig().rateLimits.login;
  if (isRateLimited(`users:delete:${userId}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

  const body = deleteAccountSchema.safeParse(await readJson(request));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");

  try {
    await deleteMyAccount(userId, body.data.password);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}

// Marge pour l'enveloppe multipart.
const MAX_IMAGE_BODY_BYTES = PROFILE_IMAGE_MAX_BYTES + 64 * 1024;

// PUT (multipart, champ « image ») / DELETE /api/v1/users/me/avatar
export function avatarController(upload: boolean) {
  return async (request: Request) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) return errorResponse(401, "UNAUTHORIZED");

    const { max, windowMs } = getConfig().rateLimits.profileUpdate;
    if (isRateLimited(`profile:image:${userId}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

    let image: File | null = null;
    if (upload) {
      const contentLength = Number(request.headers.get("content-length"));
      if (!contentLength) return errorResponse(411, "LENGTH_REQUIRED");
      if (contentLength > MAX_IMAGE_BODY_BYTES) return errorResponse(413, "PAYLOAD_TOO_LARGE");

      const form = await request.formData().catch(() => null);
      const body = profileImageSchema.safeParse(form ? Object.fromEntries(form) : null);
      if (!body.success) return errorResponse(400, "INVALID_INPUT");
      image = body.data.image;
    }

    try {
      return Response.json({ user: await setMyAvatar(userId, image) });
    } catch (error) {
      return handleError(error);
    }
  };
}

function readJson(request: Request) {
  return request.json().catch(() => null);
}

function errorResponse(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

function handleError(error: unknown) {
  if (error instanceof ProfileError) {
    if (error.code === "USERNAME_TAKEN") return errorResponse(409, "USERNAME_TAKEN");
    if (error.code === "INVALID_INPUT") return errorResponse(400, "INVALID_INPUT");
    if (error.code === "BADGE_LOCKED") return errorResponse(403, "BADGE_LOCKED");
    if (error.code === "INVALID_CREDENTIALS") return errorResponse(403, "INVALID_CREDENTIALS");
    if (error.code === "ADMIN_ACCOUNT") return errorResponse(403, "ADMIN_ACCOUNT");
    return errorResponse(401, "UNAUTHORIZED");
  }

  logError("users", error);
  return errorResponse(500, "INTERNAL_ERROR");
}
