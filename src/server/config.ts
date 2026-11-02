import "server-only";
import { z } from "zod";
import { logError } from "@/server/logger";

// Variables d'environnement validées au premier appel (lecture paresseuse : le build n'en a pas besoin).
// L'erreur nomme la variable, jamais sa valeur.

// Format de jose, ex. « 1h ».
const duration = z.string().regex(/^\d+[smhd]$/);
const count = z.coerce.number().int().positive();
const seconds = z.coerce.number().int().positive();

const envSchema = z.object({
  CLOUD_SQL_INSTANCE: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/),
  DB_USER: z.string().min(1),
  DB_NAME: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  // Distincte de JWT_SECRET : un access token ne peut pas servir de refresh token.
  JWT_REFRESH_SECRET: z.string().min(32),

  JWT_EXPIRES_IN: duration.default("1h"),
  REFRESH_TOKEN_REMEMBER_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  REFRESH_TOKEN_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  LOGIN_DEVICE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  // ≥ 10 (règle du projet) ; au-delà de 14, chaque connexion devient très lente.
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),

  // Proxys de confiance (Cloud Run : 1) : seules leurs entrées de X-Forwarded-For sont fiables.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),

  // Gemini sur Vertex AI (auth IAM, aucune clé). Optionnelles : sans elles, seules les fonctions IA échouent.
  GCP_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/).optional(),
  VERTEX_LOCATION: z.string().regex(/^[a-z0-9-]+$/).optional(),

  RATE_LIMIT_LOGIN_MAX: count.default(5),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: seconds.default(15 * 60),
  // Par email, quelle que soit l'IP : contre le bruteforce réparti.
  RATE_LIMIT_LOGIN_EMAIL_MAX: count.default(10),
  RATE_LIMIT_LOGIN_EMAIL_WINDOW_SECONDS: seconds.default(15 * 60),
  RATE_LIMIT_REFRESH_MAX: count.default(300),
  RATE_LIMIT_REFRESH_WINDOW_SECONDS: seconds.default(15 * 60),
  RATE_LIMIT_REGISTER_MAX: count.default(5),
  RATE_LIMIT_REGISTER_WINDOW_SECONDS: seconds.default(15 * 60),
  // Mot de passe oublié : par IP, et par email visé (une boîte mail ne peut pas être inondée de liens).
  RATE_LIMIT_FORGOT_PASSWORD_MAX: count.default(5),
  RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS: seconds.default(15 * 60),
  RATE_LIMIT_FORGOT_PASSWORD_EMAIL_MAX: count.default(3),
  RATE_LIMIT_FORGOT_PASSWORD_EMAIL_WINDOW_SECONDS: seconds.default(60 * 60),
  RATE_LIMIT_RESET_PASSWORD_MAX: count.default(10),
  RATE_LIMIT_RESET_PASSWORD_WINDOW_SECONDS: seconds.default(15 * 60),
  // Durée de validité du lien de réinitialisation.
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  RATE_LIMIT_LOCATIONS_MAX: count.default(60),
  RATE_LIMIT_LOCATIONS_WINDOW_SECONDS: seconds.default(60),
  RATE_LIMIT_POST_CREATE_MAX: count.default(10),
  RATE_LIMIT_POST_CREATE_WINDOW_SECONDS: seconds.default(60 * 60),
  RATE_LIMIT_FEED_MAX: count.default(120),
  RATE_LIMIT_FEED_WINDOW_SECONDS: seconds.default(60),
  RATE_LIMIT_POST_EDIT_MAX: count.default(30),
  RATE_LIMIT_POST_EDIT_WINDOW_SECONDS: seconds.default(15 * 60),
  RATE_LIMIT_POST_REACT_MAX: count.default(60),
  RATE_LIMIT_POST_REACT_WINDOW_SECONDS: seconds.default(60),
  RATE_LIMIT_PROFILE_VIEW_MAX: count.default(120),
  RATE_LIMIT_PROFILE_VIEW_WINDOW_SECONDS: seconds.default(60),
  RATE_LIMIT_PROFILE_UPDATE_MAX: count.default(10),
  RATE_LIMIT_PROFILE_UPDATE_WINDOW_SECONDS: seconds.default(15 * 60),
  RATE_LIMIT_REPORT_MAX: count.default(10),
  RATE_LIMIT_REPORT_WINDOW_SECONDS: seconds.default(60 * 60),
  RATE_LIMIT_TICKET_MAX: count.default(5),
  RATE_LIMIT_TICKET_WINDOW_SECONDS: seconds.default(60 * 60),
  RATE_LIMIT_COMMENT_MAX: count.default(20),
  RATE_LIMIT_COMMENT_WINDOW_SECONDS: seconds.default(15 * 60),
  RATE_LIMIT_ADMIN_MAX: count.default(120),
  RATE_LIMIT_ADMIN_WINDOW_SECONDS: seconds.default(60),
  // Quota IA par utilisateur et par jour (heure de Paris), admins exclus ; compteur en base (ai_usage).
  AI_DAILY_LIMIT_PER_USER: count.default(15),
  // Appels IA sur un voyage qui a le pass voyage (même compteur journalier, plafond plus haut).
  AI_DAILY_LIMIT_TRIP_PASS: count.default(100),
  // IA du planificateur, par utilisateur : génération d'un côté, discussion de l'autre.
  RATE_LIMIT_TRIP_AI_MAX: count.default(20),
  RATE_LIMIT_TRIP_AI_WINDOW_SECONDS: seconds.default(60 * 60),
  RATE_LIMIT_TRIP_CHAT_MAX: count.default(30),
  RATE_LIMIT_TRIP_CHAT_WINDOW_SECONDS: seconds.default(60 * 60),
  // Partage d'un voyage, par utilisateur : invitations (un pseudo inconnu est signalé : limite l'énumération) et liens rejoints.
  RATE_LIMIT_TRIP_SHARE_MAX: count.default(30),
  RATE_LIMIT_TRIP_SHARE_WINDOW_SECONDS: seconds.default(15 * 60),
  // Écritures sur les dépenses d'un voyage, par utilisateur (une devise étrangère appelle l'API de taux de change).
  RATE_LIMIT_TRIP_EXPENSE_MAX: count.default(120),
  RATE_LIMIT_TRIP_EXPENSE_WINDOW_SECONDS: seconds.default(15 * 60),
  // Exports PDF / .ics et commandes du pass voyage, par utilisateur : un PDF se calcule sur l'unique instance.
  RATE_LIMIT_TRIP_EXPORT_MAX: count.default(20),
  RATE_LIMIT_TRIP_EXPORT_WINDOW_SECONDS: seconds.default(15 * 60),
}).refine((env) => env.JWT_REFRESH_SECRET !== env.JWT_SECRET, {
  path: ["JWT_REFRESH_SECRET"],
  message: "doit être différente de JWT_SECRET",
});

export type RateLimit = { max: number; windowMs: number };

export type ServerConfig = {
  db: { instanceConnectionName: string; user: string; database: string };
  jwtSecret: string;
  jwtRefreshSecret: string;
  jwtExpiresIn: string;
  refreshTokenTtlMs: { remember: number; session: number };
  loginDeviceTtlSeconds: number;
  bcryptSaltRounds: number;
  passwordResetTtlMs: number;
  trustedProxyHops: number;
  // null : IA non configurée.
  vertex: { project: string; location: string } | null;
  aiDailyLimitPerUser: number;
  aiDailyLimitTripPass: number;
  rateLimits: Record<
    "login" | "loginEmail" | "refresh" | "register" | "forgotPassword" | "forgotPasswordEmail" | "resetPassword" | "locations" | "feed" | "postCreate" | "postEdit" | "postReact" | "profileView" | "profileUpdate" | "report" | "ticket" | "admin" | "comment" | "tripAi" | "tripChat" | "tripShare" | "tripExpense" | "tripExport",
    RateLimit
  >;
};

let config: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (config) return config;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    // Log ici : l'erreur peut être masquée plus haut (ex. simple 401).
    logError("config", `invalid env: ${names}`);
    throw new Error(`Configuration invalide ou manquante : ${names}`);
  }

  const env = parsed.data;
  const rateLimit = (max: number, windowSeconds: number) => ({ max, windowMs: windowSeconds * 1000 });

  config = {
    db: { instanceConnectionName: env.CLOUD_SQL_INSTANCE, user: env.DB_USER, database: env.DB_NAME },
    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    refreshTokenTtlMs: {
      remember: env.REFRESH_TOKEN_REMEMBER_DAYS * 24 * 60 * 60 * 1000,
      session: env.REFRESH_TOKEN_SESSION_HOURS * 60 * 60 * 1000,
    },
    loginDeviceTtlSeconds: env.LOGIN_DEVICE_DAYS * 24 * 60 * 60,
    bcryptSaltRounds: env.BCRYPT_SALT_ROUNDS,
    passwordResetTtlMs: env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    vertex:
      env.GCP_PROJECT_ID && env.VERTEX_LOCATION ? { project: env.GCP_PROJECT_ID, location: env.VERTEX_LOCATION } : null,
    aiDailyLimitPerUser: env.AI_DAILY_LIMIT_PER_USER,
    aiDailyLimitTripPass: env.AI_DAILY_LIMIT_TRIP_PASS,
    rateLimits: {
      login: rateLimit(env.RATE_LIMIT_LOGIN_MAX, env.RATE_LIMIT_LOGIN_WINDOW_SECONDS),
      loginEmail: rateLimit(env.RATE_LIMIT_LOGIN_EMAIL_MAX, env.RATE_LIMIT_LOGIN_EMAIL_WINDOW_SECONDS),
      refresh: rateLimit(env.RATE_LIMIT_REFRESH_MAX, env.RATE_LIMIT_REFRESH_WINDOW_SECONDS),
      register: rateLimit(env.RATE_LIMIT_REGISTER_MAX, env.RATE_LIMIT_REGISTER_WINDOW_SECONDS),
      forgotPassword: rateLimit(env.RATE_LIMIT_FORGOT_PASSWORD_MAX, env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS),
      forgotPasswordEmail: rateLimit(env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL_MAX, env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL_WINDOW_SECONDS),
      resetPassword: rateLimit(env.RATE_LIMIT_RESET_PASSWORD_MAX, env.RATE_LIMIT_RESET_PASSWORD_WINDOW_SECONDS),
      locations: rateLimit(env.RATE_LIMIT_LOCATIONS_MAX, env.RATE_LIMIT_LOCATIONS_WINDOW_SECONDS),
      feed: rateLimit(env.RATE_LIMIT_FEED_MAX, env.RATE_LIMIT_FEED_WINDOW_SECONDS),
      postCreate: rateLimit(env.RATE_LIMIT_POST_CREATE_MAX, env.RATE_LIMIT_POST_CREATE_WINDOW_SECONDS),
      postEdit: rateLimit(env.RATE_LIMIT_POST_EDIT_MAX, env.RATE_LIMIT_POST_EDIT_WINDOW_SECONDS),
      postReact: rateLimit(env.RATE_LIMIT_POST_REACT_MAX, env.RATE_LIMIT_POST_REACT_WINDOW_SECONDS),
      profileView: rateLimit(env.RATE_LIMIT_PROFILE_VIEW_MAX, env.RATE_LIMIT_PROFILE_VIEW_WINDOW_SECONDS),
      profileUpdate: rateLimit(env.RATE_LIMIT_PROFILE_UPDATE_MAX, env.RATE_LIMIT_PROFILE_UPDATE_WINDOW_SECONDS),
      report: rateLimit(env.RATE_LIMIT_REPORT_MAX, env.RATE_LIMIT_REPORT_WINDOW_SECONDS),
      ticket: rateLimit(env.RATE_LIMIT_TICKET_MAX, env.RATE_LIMIT_TICKET_WINDOW_SECONDS),
      comment: rateLimit(env.RATE_LIMIT_COMMENT_MAX, env.RATE_LIMIT_COMMENT_WINDOW_SECONDS),
      admin: rateLimit(env.RATE_LIMIT_ADMIN_MAX, env.RATE_LIMIT_ADMIN_WINDOW_SECONDS),
      tripAi: rateLimit(env.RATE_LIMIT_TRIP_AI_MAX, env.RATE_LIMIT_TRIP_AI_WINDOW_SECONDS),
      tripChat: rateLimit(env.RATE_LIMIT_TRIP_CHAT_MAX, env.RATE_LIMIT_TRIP_CHAT_WINDOW_SECONDS),
      tripShare: rateLimit(env.RATE_LIMIT_TRIP_SHARE_MAX, env.RATE_LIMIT_TRIP_SHARE_WINDOW_SECONDS),
      tripExpense: rateLimit(env.RATE_LIMIT_TRIP_EXPENSE_MAX, env.RATE_LIMIT_TRIP_EXPENSE_WINDOW_SECONDS),
      tripExport: rateLimit(env.RATE_LIMIT_TRIP_EXPORT_MAX, env.RATE_LIMIT_TRIP_EXPORT_WINDOW_SECONDS),
    },
  };
  return config;
}

// Buy Me a Coffee (rôle mécène, pass voyage) : validé à part, une valeur invalide coupe seulement le paiement, jamais toute l'API.
const buyMeACoffeeSchema = z.object({
  BMC_WEBHOOK_SECRET: z.string().regex(/^\S{16,200}$/),
  BMC_PAGE_URL: z.url({ protocol: /^https$/, hostname: /^(www\.)?buymeacoffee\.com$/ }),
  // Don minimum (en euros) qui donne le rôle : le prix d'un café sur la page Buy Me a Coffee.
  BMC_PATRON_MIN_EUR: z.coerce.number().positive().max(1000).default(5),
});

// Pass voyage : article « Extra » de la boutique Buy Me a Coffee. Absent ou invalide : seul le pass est coupé.
const tripPassSchema = z.object({
  BMC_TRIP_PASS_URL: z.url({ protocol: /^https$/, hostname: /^(www\.)?buymeacoffee\.com$/ }),
  BMC_TRIP_PASS_EXTRA_ID: z.coerce.number().int().positive(),
  BMC_TRIP_PASS_PRICE_EUR: z.coerce.number().positive().max(1000).default(9.99),
});

export type TripPassConfig = { url: string; extraId: number; priceEur: number };

export type BuyMeACoffeeConfig = {
  webhookSecret: string;
  pageUrl: string;
  patronMinEur: number;
  // null : pass voyage non configuré.
  tripPass: TripPassConfig | null;
};

let buyMeACoffee: BuyMeACoffeeConfig | null | undefined;

// null : paiement non configuré (variables absentes) ou invalide (signalé dans les logs).
export function getBuyMeACoffeeConfig(): BuyMeACoffeeConfig | null {
  if (buyMeACoffee !== undefined) return buyMeACoffee;

  const { BMC_WEBHOOK_SECRET, BMC_PAGE_URL, BMC_PATRON_MIN_EUR } = process.env;
  if (!BMC_WEBHOOK_SECRET && !BMC_PAGE_URL) return (buyMeACoffee = null);

  const parsed = buyMeACoffeeSchema.safeParse({ BMC_WEBHOOK_SECRET, BMC_PAGE_URL, BMC_PATRON_MIN_EUR });
  if (!parsed.success) {
    logInvalid("Buy Me a Coffee", parsed.error);
    return (buyMeACoffee = null);
  }
  return (buyMeACoffee = {
    webhookSecret: parsed.data.BMC_WEBHOOK_SECRET,
    pageUrl: parsed.data.BMC_PAGE_URL,
    patronMinEur: parsed.data.BMC_PATRON_MIN_EUR,
    tripPass: readTripPassConfig(),
  });
}

function readTripPassConfig(): TripPassConfig | null {
  const { BMC_TRIP_PASS_URL, BMC_TRIP_PASS_EXTRA_ID, BMC_TRIP_PASS_PRICE_EUR } = process.env;
  if (!BMC_TRIP_PASS_URL && !BMC_TRIP_PASS_EXTRA_ID) return null;

  const parsed = tripPassSchema.safeParse({ BMC_TRIP_PASS_URL, BMC_TRIP_PASS_EXTRA_ID, BMC_TRIP_PASS_PRICE_EUR });
  if (!parsed.success) {
    logInvalid("trip pass", parsed.error);
    return null;
  }
  return {
    url: parsed.data.BMC_TRIP_PASS_URL,
    extraId: parsed.data.BMC_TRIP_PASS_EXTRA_ID,
    priceEur: parsed.data.BMC_TRIP_PASS_PRICE_EUR,
  };
}

function logInvalid(label: string, error: z.ZodError) {
  const names = error.issues.map((issue) => issue.path.join(".")).join(", ");
  logError("config", `invalid ${label} env (payment disabled): ${names}`);
}

// Envoi d'emails (Gmail en SMTP) : validé à part, une valeur invalide coupe seulement les emails, jamais toute l'API.
const mailSchema = z.object({
  SMTP_USER: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  // Mot de passe d'application Google : 16 lettres (affichées par groupes de 4, espaces retirés).
  SMTP_PASSWORD: z
    .string()
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(z.string().regex(/^[a-z]{16}$/i)),
  // URL publique du site : seule base des liens envoyés (jamais l'en-tête Host de la requête).
  APP_URL: z.url({ protocol: /^https?$/ }).optional(),
});

export type MailConfig = { user: string; password: string; appUrl: string | null };

let mail: MailConfig | null | undefined;

// null : emails non configurés (variables absentes) ou invalides (signalé dans les logs).
export function getMailConfig(): MailConfig | null {
  if (mail !== undefined) return mail;

  const { SMTP_USER, SMTP_PASSWORD, APP_URL } = process.env;
  if (!SMTP_USER && !SMTP_PASSWORD) return (mail = null);

  const parsed = mailSchema.safeParse({ SMTP_USER, SMTP_PASSWORD, APP_URL });
  // En production, un lien ne se construit jamais depuis la requête : APP_URL obligatoire.
  const missingAppUrl = parsed.success && !parsed.data.APP_URL && process.env.NODE_ENV === "production";
  if (!parsed.success || missingAppUrl) {
    const names = parsed.success ? "APP_URL" : parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    logError("config", `invalid mail env (emails disabled): ${names}`);
    return (mail = null);
  }
  return (mail = {
    user: parsed.data.SMTP_USER,
    password: parsed.data.SMTP_PASSWORD,
    appUrl: parsed.data.APP_URL?.replace(/\/+$/, "") ?? null,
  });
}

// Mesure d'audience (Umami Cloud, sans cookie) : absente ou invalide, seule la mesure est coupée.
// Lue aussi au build : la balise est figée dans la page statique (build Docker ET variable Cloud Run).
const analyticsSchema = z.object({
  UMAMI_WEBSITE_ID: z.uuid(),
  APP_URL: z.url({ protocol: /^https?$/ }).optional(),
});

// domain : seul domaine compté (APP_URL), pour ignorer un build lancé en local.
export type AnalyticsConfig = { websiteId: string; domain: string | null };

let analytics: AnalyticsConfig | null | undefined;

export function getAnalyticsConfig(): AnalyticsConfig | null {
  if (analytics !== undefined) return analytics;

  const { UMAMI_WEBSITE_ID, APP_URL } = process.env;
  if (!UMAMI_WEBSITE_ID) return (analytics = null);

  const parsed = analyticsSchema.safeParse({ UMAMI_WEBSITE_ID, APP_URL });
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    logError("config", `invalid analytics env (analytics disabled): ${names}`);
    return (analytics = null);
  }
  return (analytics = {
    websiteId: parsed.data.UMAMI_WEBSITE_ID,
    domain: parsed.data.APP_URL ? new URL(parsed.data.APP_URL).hostname : null,
  });
}

// Base des liens absolus des métadonnées (og:url) : sans APP_URL, Next se rabat sur localhost.
const siteUrlSchema = z.url({ protocol: /^https?$/ });

let siteUrl: URL | null | undefined;

export function getSiteUrl(): URL | null {
  if (siteUrl !== undefined) return siteUrl;

  const { APP_URL } = process.env;
  if (!APP_URL) return (siteUrl = null);

  const parsed = siteUrlSchema.safeParse(APP_URL);
  if (!parsed.success) {
    logError("config", "invalid env (site url disabled): APP_URL");
    return (siteUrl = null);
  }
  return (siteUrl = new URL(parsed.data));
}
