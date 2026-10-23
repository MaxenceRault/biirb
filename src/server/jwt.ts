import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "@/server/config";

// Deux clés distinctes : un access token ne peut pas servir de refresh token.
function getSecret() {
  return new TextEncoder().encode(getConfig().jwtSecret);
}

function getRefreshSecret() {
  return new TextEncoder().encode(getConfig().jwtRefreshSecret);
}

export function signToken(userId: string, expiresIn = getConfig().jwtExpiresIn) {
  return new SignJWT()
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
  return payload.sub ?? null;
}

// Aussi enregistré en base (empreinte) pour être révocable : voir auth.service.
// remember signé dans le token : la rotation garde le même type de cookie (persistant ou de session).
export function signRefreshToken(userId: string, expiresAt: Date, remember: boolean) {
  return new SignJWT({ token_use: "refresh", remember })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getRefreshSecret());
}

export async function verifyRefreshToken(token: string): Promise<{ userId: string; remember: boolean } | null> {
  try {
    const { payload } = await jwtVerify(token, getRefreshSecret(), { algorithms: ["HS256"] });
    if (payload.token_use !== "refresh" || !payload.sub) return null;
    // Token émis avant ce champ : cookie persistant comme avant, borné par son expiration en base.
    return { userId: payload.sub, remember: payload.remember !== false };
  } catch {
    return null;
  }
}

// Appareil où ce compte s'est déjà connecté : lié à l'email (empreinte, pas l'adresse en clair dans le cookie).
export function signDeviceToken(email: string, ttlSeconds: number) {
  return new SignJWT({ token_use: "device", email_hash: hashEmail(email) })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getRefreshSecret());
}

// Identifiant du cookie s'il a été émis pour cet email, sinon null.
export async function verifyDeviceToken(token: string, email: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getRefreshSecret(), { algorithms: ["HS256"] });
    return payload.token_use === "device" && payload.email_hash === hashEmail(email) ? (payload.jti ?? null) : null;
  } catch {
    return null;
  }
}

function hashEmail(email: string) {
  return createHash("sha256").update(email).digest("base64url");
}

export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const [scheme, token] = request.headers.get("authorization")?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) return null;

  try {
    return await verifyToken(token);
  } catch {
    return null;
  }
}
