import "server-only";
import { getConfig } from "@/server/config";
import { clientIp, isRateLimited } from "@/server/rateLimit";
import { AuthError, login, logout, refreshSession, register, type AuthResult } from "@/server/services/auth.service";
import { PasswordResetError, requestPasswordReset, resetPassword } from "@/server/services/password-reset.service";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/schemas/auth.schema";
import { logError } from "@/server/logger";

const MAX_BODY_BYTES = 4 * 1024;
// Refresh token : cookie illisible par le JavaScript (une faille XSS ne vole plus la session), envoyé seulement aux routes d'auth.
const REFRESH_COOKIE = "brb_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

export async function loginController(request: Request) {
  const { max, windowMs } = getConfig().rateLimits.login;
  if (isRateLimited(`login:${clientIp(request)}`, max, windowMs)) {
    return errorResponse(429, "TOO_MANY_REQUESTS");
  }

  const sizeError = checkBodySize(request);
  if (sizeError) return sizeError;

  const body = loginSchema.safeParse(await readJson(request));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");

  // Même réponse que la limite par IP : ne révèle pas si le compte existe.
  const emailLimit = getConfig().rateLimits.loginEmail;
  if (isRateLimited(`login:email:${body.data.email}`, emailLimit.max, emailLimit.windowMs)) {
    return errorResponse(429, "TOO_MANY_REQUESTS");
  }

  try {
    return sessionResponse(await login(body.data.email, body.data.password, body.data.remember));
  } catch (error) {
    return handleError(error);
  }
}

export async function registerController(request: Request) {
  const { max, windowMs } = getConfig().rateLimits.register;
  if (isRateLimited(`register:${clientIp(request)}`, max, windowMs)) {
    return errorResponse(429, "TOO_MANY_REQUESTS");
  }

  const sizeError = checkBodySize(request);
  if (sizeError) return sizeError;

  const body = registerSchema.safeParse(await readJson(request));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");

  try {
    return sessionResponse(await register(body.data.name, body.data.email, body.data.password), 201);
  } catch (error) {
    return handleError(error);
  }
}

// Durée minimale de réponse : un compte existant (envoi du mail) ne répond pas plus lentement qu'un email inconnu.
const FORGOT_MIN_RESPONSE_MS = 2000;

// POST /api/v1/auth/forgot-password { email } → 202, que le compte existe ou non.
export async function forgotPasswordController(request: Request) {
  const { max, windowMs } = getConfig().rateLimits.forgotPassword;
  if (isRateLimited(`forgot:${clientIp(request)}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

  const sizeError = checkBodySize(request);
  if (sizeError) return sizeError;

  const body = forgotPasswordSchema.safeParse(await readJson(request));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");

  // Même réponse que la limite par IP : ne révèle pas si le compte existe.
  const emailLimit = getConfig().rateLimits.forgotPasswordEmail;
  if (isRateLimited(`forgot:email:${body.data.email}`, emailLimit.max, emailLimit.windowMs)) {
    return errorResponse(429, "TOO_MANY_REQUESTS");
  }

  const startedAt = Date.now();
  // Hors production seulement : en ligne, le lien est toujours construit avec APP_URL (jamais l'en-tête Host).
  const devOrigin = process.env.NODE_ENV === "production" ? null : devRequestOrigin(request);
  try {
    await requestPasswordReset(body.data.email, devOrigin);
  } catch (error) {
    if (error instanceof PasswordResetError) return errorResponse(503, "MAIL_UNAVAILABLE");
    return handleError(error);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, FORGOT_MIN_RESPONSE_MS - (Date.now() - startedAt))));
  return new Response(null, { status: 202 });
}

// Dev : adresse et port d'écoute du serveur (request.url), jamais l'en-tête Host que tout client du réseau choisit.
// 0.0.0.0 / [::] (Docker) ne s'ouvrent pas dans un navigateur : remplacés par localhost.
function devRequestOrigin(request: Request) {
  const url = new URL(request.url);
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "localhost";
  return url.origin;
}

// POST /api/v1/auth/reset-password { token, password } → 204 ; toutes les sessions du compte sont révoquées.
export async function resetPasswordController(request: Request) {
  const { max, windowMs } = getConfig().rateLimits.resetPassword;
  if (isRateLimited(`reset:${clientIp(request)}`, max, windowMs)) return errorResponse(429, "TOO_MANY_REQUESTS");

  const sizeError = checkBodySize(request);
  if (sizeError) return sizeError;

  const body = resetPasswordSchema.safeParse(await readJson(request));
  if (!body.success) return errorResponse(400, "INVALID_INPUT");

  try {
    await resetPassword(body.data.token, body.data.password);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof PasswordResetError) return errorResponse(400, "INVALID_RESET_TOKEN");
    return handleError(error);
  }
}

// POST /api/v1/auth/refresh : refresh token lu dans le cookie, aucun corps.
export async function refreshController(request: Request) {
  const { max, windowMs } = getConfig().rateLimits.refresh;
  if (isRateLimited(`refresh:${clientIp(request)}`, max, windowMs)) {
    return errorResponse(429, "TOO_MANY_REQUESTS");
  }
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN");

  const refreshToken = readRefreshCookie(request);
  if (!refreshToken) return withClearedCookie(errorResponse(401, "INVALID_REFRESH_TOKEN"));

  try {
    return sessionResponse(await refreshSession(refreshToken));
  } catch (error) {
    const response = handleError(error);
    return response.status === 401 ? withClearedCookie(response) : response;
  }
}

// POST /api/v1/auth/logout : révoque la session du cookie et l'efface.
export async function logoutController(request: Request) {
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN");

  const refreshToken = readRefreshCookie(request);
  try {
    if (refreshToken) await logout(refreshToken);
    return withClearedCookie(new Response(null, { status: 204 }));
  } catch (error) {
    return handleError(error);
  }
}

// Le cookie part même pour une requête venue d'ailleurs si SameSite était contourné : on exige notre propre origine (CSRF).
function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  try {
    return origin !== null && new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function readRefreshCookie(request: Request): string | null {
  const cookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE}=`));
  const value = refreshTokenSchema.safeParse(cookie?.slice(REFRESH_COOKIE.length + 1));
  return value.success ? value.data : null;
}

// maxAgeSeconds null : cookie de session, oublié à la fermeture du navigateur (l'expiration en base reste la borne).
function refreshCookie(value: string, maxAgeSeconds: number | null) {
  return [
    `${REFRESH_COOKIE}=${value}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    ...(maxAgeSeconds === null ? [] : [`Max-Age=${maxAgeSeconds}`]),
    "HttpOnly",
    "SameSite=Strict",
    // http://localhost en dev : Secure empêcherait certains navigateurs d'enregistrer le cookie.
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

function withClearedCookie(response: Response) {
  response.headers.append("Set-Cookie", refreshCookie("", 0));
  return response;
}

// Refusé avant lecture (il serait chargé entièrement en mémoire).
function checkBodySize(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (!length) return errorResponse(411, "LENGTH_REQUIRED");
  if (length > MAX_BODY_BYTES) return errorResponse(413, "PAYLOAD_TOO_LARGE");
  return null;
}

function readJson(request: Request) {
  return request.json().catch(() => null);
}

// Access token dans le corps (gardé en mémoire par le navigateur), refresh token en cookie. Jamais mis en cache.
function sessionResponse({ token, refreshToken, refreshExpiresAt, remember, user }: AuthResult, status = 200) {
  const maxAge = remember ? Math.max(0, Math.floor((refreshExpiresAt.getTime() - Date.now()) / 1000)) : null;
  return Response.json(
    { token, user },
    { status, headers: { "Cache-Control": "no-store", "Set-Cookie": refreshCookie(refreshToken, maxAge) } },
  );
}

function errorResponse(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    const status = error.code === "EMAIL_TAKEN" ? 409 : error.code === "ACCOUNT_BANNED" ? 403 : 401;
    return errorResponse(status, error.code);
  }

  logError("auth", error);
  return errorResponse(500, "INTERNAL_ERROR");
}
