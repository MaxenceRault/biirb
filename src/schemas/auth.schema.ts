import { z } from "zod";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

// bcrypt ignore tout au-delà de 72 octets : limite en octets (accents et emojis en comptent plusieurs).
const BCRYPT_MAX_BYTES = 72;
const fitsBcrypt = (password: string) => new TextEncoder().encode(password).length <= BCRYPT_MAX_BYTES;

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1).refine(fitsBcrypt),
  remember: z.boolean(),
});

// Nouveau mot de passe : inscription et réinitialisation.
const newPassword = z.string().min(8).refine(fitsBcrypt);

export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  email,
  password: newPassword,
  // Case des CGU cochée : sans elle, pas de compte.
  acceptTerms: z.literal(true),
});

export const forgotPasswordSchema = z.strictObject({ email });

// Code du lien : 32 octets aléatoires en base64url.
export const resetPasswordSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: newPassword,
});

// Valeur d'un cookie httpOnly d'authentification (JWT) : brb_refresh, brb_device.
export const authCookieSchema = z
  .string()
  .max(1000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
