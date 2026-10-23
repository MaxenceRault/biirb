import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getTranslations } from "next-intl/server";
import { getConfig, getMailConfig } from "@/server/config";
import { sendTextMail } from "@/server/infra/mailer";
import { logError, logInfo } from "@/server/logger";
import { consumeResetTokenAndSetPassword, replaceResetToken } from "@/server/repositories/password-reset.repository";
import { revokeUserRefreshTokens } from "@/server/repositories/refresh-token.repository";
import { findUserByEmail } from "@/server/repositories/user.repository";

export class PasswordResetError extends Error {
  constructor(public readonly code: "UNAVAILABLE" | "INVALID_RESET_TOKEN") {
    super(code);
  }
}

// devOrigin : origine de la requête, utilisée seulement hors production quand APP_URL est absente.
// Toujours le même résultat pour l'appelant : ne révèle jamais si un compte existe.
export async function requestPasswordReset(email: string, devOrigin: string | null) {
  const mail = getMailConfig();
  const baseUrl = mail?.appUrl ?? devOrigin;
  if (!mail || !baseUrl) throw new PasswordResetError("UNAVAILABLE");

  const user = await findUserByEmail(email);
  // Pas de mot de passe : compte de démonstration ; banni : il ne doit pas pouvoir revenir par ce biais.
  if (!user || !user.password_hash || user.banned_at) return logInfo("password-reset", { sent: false });

  const token = randomBytes(32).toString("base64url");
  await replaceResetToken(user.id, hashToken(token), new Date(Date.now() + getConfig().passwordResetTtlMs));

  // Code dans le fragment (#) : jamais envoyé au serveur, donc absent des logs d'accès.
  const link = `${baseUrl}/login?view=reset#token=${token}`;
  const t = await getTranslations({ locale: "fr", namespace: "PasswordResetEmail" });
  try {
    // Pas de nom affiché (texte libre, adresse non vérifiée à l'inscription) : un tiers y glisserait un faux lien.
    await sendTextMail(mail, {
      to: email,
      subject: t("subject"),
      text: t("body", { link, minutes: getConfig().passwordResetTtlMs / 60_000 }),
    });
    logInfo("password-reset", { sent: true });
  } catch (error) {
    // Échec d'envoi : signalé dans les logs, jamais au client (sinon il apprendrait que le compte existe).
    logError("password-reset", error);
  }
}

export async function resetPassword(token: string, password: string) {
  // Haché avant de vérifier le lien : même durée de réponse, lien valide ou non.
  const passwordHash = await bcrypt.hash(password, getConfig().bcryptSaltRounds);
  const userId = await consumeResetTokenAndSetPassword(hashToken(token), passwordHash);
  if (!userId) throw new PasswordResetError("INVALID_RESET_TOKEN");

  // Toutes les sessions ouvertes (peut-être par un intrus) sont coupées.
  await revokeUserRefreshTokens(userId);
  logInfo("password-reset", { reset: true });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
