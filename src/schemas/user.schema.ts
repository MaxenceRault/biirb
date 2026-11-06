import { z } from "zod";
import { USER_ROLES } from "@/lib/roles";

// Mêmes règles que la table users.
export const USERNAME_PATTERN = "^[a-z0-9_]{3,30}$";
const AVATAR_SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Allowlist : aucune autre valeur CSS acceptée.
export const AVATAR_BACKGROUND_COLORS = [
  "#ffdad8",
  "#ffe8c2",
  "#fff3b0",
  "#d9f2d0",
  "#cfeee8",
  "#d4e5ef",
  "#dde2f3",
  "#ead8f5",
  "#e1e3e4",
  "#1a202c",
] as const;

// Le formulaire envoie toujours tous les champs.
export const updateProfileSchema = z.strictObject({
  display_name: z.string().trim().min(1).max(60),
  username: z.string().trim().toLowerCase().regex(new RegExp(USERNAME_PATTERN)),
  location: z
    .string()
    .trim()
    .max(80)
    .transform((value) => value || null),
  avatar_seed: z.string().regex(AVATAR_SEED_PATTERN).nullable(),
  avatar_background_color: z.enum(AVATAR_BACKGROUND_COLORS).nullable(),
  // Facultatifs : absents = inchangés (le formulaire du profil ne les envoie pas encore tous).
  is_private: z.boolean().optional(),
  show_saved: z.boolean().optional(),
});

// PUT /api/v1/users/me/badge : null rend le badge du rôle. Débloqué ou non : vérifié par le service.
export const displayedBadgeSchema = z.strictObject({ badge: z.enum(USER_ROLES).nullable() });

// Pseudo dans l'URL (/api/v1/users/{pseudo}, /profile/{pseudo}) : mêmes règles que la table users.
export const usernameParamSchema = z.string().regex(new RegExp(USERNAME_PATTERN));

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const PROFILE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const profileImageSchema = z.strictObject({
  image: z.file().min(1).max(PROFILE_IMAGE_MAX_BYTES).mime([...PROFILE_IMAGE_TYPES]),
});

// DELETE /api/v1/users/me (#112) : mot de passe actuel, comme à la connexion.
export const deleteAccountSchema = z.strictObject({ password: z.string().min(1).max(200) });
