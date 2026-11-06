import { z } from "zod";
import { BANNED_KINDS, BANNED_REASONS } from "@/server/moderationFilter";
import { USER_ROLES } from "@/lib/roles";

// 50 lignes par page.
const search = z.string().trim().min(1).max(60).optional();
const page = z.coerce.number().int().min(1).max(10_000).default(1);

export const adminUsersQuerySchema = z.strictObject({ q: search, page });

export const adminPostsQuerySchema = z.strictObject({ q: search, page, visibility: z.enum(["all", "visible", "hidden"]).default("all") });

export const userIdParamSchema = z.uuid();

// Ventes (#108) : période [from, to] en jours de Paris ; sans dates, les 30 derniers jours. Un an au plus.
export const adminSalesQuerySchema = z
  .strictObject({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine(({ from, to }) => !from || !to || (from <= to && Date.parse(to) - Date.parse(from) <= 366 * 24 * 60 * 60 * 1000));
export type AdminSalesQuery = z.infer<typeof adminSalesQuerySchema>;

export const adminUpdateUserSchema = z
  .strictObject({
    role: z.enum(USER_ROLES),
    banned: z.boolean(),
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0);

export const adminUpdatePostSchema = z.strictObject({ hidden: z.boolean() });

export const adminCloseReportsSchema = z.strictObject({ status: z.literal("dismissed") });

export const adminUpdateSettingsSchema = z
  .strictObject({
    aiEnabled: z.boolean(),
    aiDailyCap: z.number().int().min(0).max(100_000),
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0);

// POST /api/v1/admin/banned-words : terme normalisé côté serveur (minuscules, sans accents).
export const adminCreateBannedWordSchema = z.strictObject({
  term: z.string().trim().min(2).max(60),
  reason: z.enum(BANNED_REASONS),
  kind: z.enum(BANNED_KINDS),
});

// POST /api/v1/admin/trip-passes : passId (achat à rattacher) exige l'email de paiement déclaré par l'acheteur.
export const adminGrantTripPassSchema = z
  .strictObject({
    // Identifiant public (UUID) affiché sur la page du voyage.
    tripId: z.uuid(),
    passId: z.number().int().positive().max(2_147_483_647).optional(),
    payerEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
  })
  .refine((input) => input.passId === undefined || input.payerEmail !== undefined, { path: ["payerEmail"] });

export type AdminGrantTripPassInput = z.infer<typeof adminGrantTripPassSchema>;
export type AdminCreateBannedWordInput = z.infer<typeof adminCreateBannedWordSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type AdminUpdateSettingsInput = z.infer<typeof adminUpdateSettingsSchema>;
