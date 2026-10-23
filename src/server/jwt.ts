import "server-only";
import { randomUUID } from "node:crypto";
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

export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const [scheme, token] = request.headers.get("authorization")?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) return null;

  try {
    return await verifyToken(token);
  } catch {
    return null;
  }
}
