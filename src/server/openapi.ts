import "server-only";
import { z } from "zod";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "@/schemas/auth.schema";
import { createInviteLinkSchema, inviteMemberSchema, joinTripSchema, updateMemberSchema } from "@/schemas/trip-share.schema";
import {
  expenseSchema,
  participantSchema,
  paymentTaskSchema,
  settlementSchema,
  tripCurrencySchema,
  updatePaymentTaskSchema,
} from "@/schemas/trip-expense.schema";
import {
  answerTripSuggestionSchema,
  createTripItemSchema,
  createTripSchema,
  createTripTaskSchema,
  sendTripMessageSchema,
  TRIP_PDF_TEMPLATES,
  tripPassCheckoutSchema,
  updateTripItemSchema,
  updateTripSchema,
  updateTripTaskSchema,
} from "@/schemas/trip.schema";
import { createPostSchema, FEED_MAX_LIMIT, reportPostSchema, updatePostSchema } from "@/schemas/post.schema";
import {
  adminCloseReportsSchema,
  adminCreateBannedWordSchema,
  adminGrantTripPassSchema,
  adminUpdatePostSchema,
  adminUpdateSettingsSchema,
  adminUpdateUserSchema,
} from "@/schemas/admin.schema";
import { createArchetypeSchema, updateArchetypeSchema } from "@/schemas/archetype.schema";
import { createCommentSchema } from "@/schemas/comment.schema";
import { adminUpdateTicketSchema, createTicketSchema, TICKET_MAX_ASSIGNEES, TICKET_STATUSES } from "@/schemas/ticket.schema";
import { createDevTicketSchema, updateDevTicketSchema } from "@/schemas/dev-ticket.schema";
import { displayedBadgeSchema, profileImageSchema, updateProfileSchema } from "@/schemas/user.schema";
import { USER_ROLES } from "@/lib/roles";

// Générés depuis les schémas Zod des controllers : la doc suit la validation.
function requestBody(schema: z.ZodType) {
  // OpenAPI 3.0 : le moteur 3.1 de Swagger UI casse une fois compilé par Turbopack.
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(schema, { io: "input", target: "openapi-3.0" });
  delete jsonSchema.$schema;
  return { required: true, content: { "application/json": { schema: jsonSchema } } };
}

function multipartBody(schema: z.ZodType) {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(schema, { io: "input", target: "openapi-3.0" });
  delete jsonSchema.$schema;
  return { required: true, content: { "multipart/form-data": { schema: jsonSchema } } };
}

const publicUser = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    username: { type: "string" },
    display_name: { type: "string" },
    avatar_url: { type: "string", nullable: true },
    avatar_seed: { type: "string", nullable: true },
    avatar_background_color: { type: "string", nullable: true, description: "Couleur de fond du blobatar (#rrggbb, palette fixe)" },
  },
  required: ["id", "username", "display_name", "avatar_url", "avatar_seed"],
};

const profileUser = {
  ...publicUser,
  properties: {
    ...publicUser.properties,
    location: { type: "string", nullable: true },
    created_at: { type: "string", format: "date-time" },
    is_private: { type: "boolean", description: "Profil privé : les visiteurs ne voient que l'identité" },
    show_saved: { type: "boolean", description: "Onglet « Enregistrés » visible des visiteurs" },
  },
  required: [...publicUser.required, "location", "created_at", "is_private", "show_saved"],
};

const postSummary = {
  type: "object",
  properties: {
    id: { type: "integer" },
    slug: { type: "string", description: "URL du récit : /post/{slug}" },
    title: { type: "string" },
    photo_url: { type: "string" },
    photo_alt: { type: "string" },
    destination_country_code: { type: "string", example: "JP" },
    destination_state_code: { type: "string", nullable: true },
    destination_city: { type: "string", nullable: true },
    start_date: { type: "string", format: "date" },
    created_at: { type: "string", format: "date-time" },
    is_hidden: { type: "boolean", description: "Masqué par l'auteur : absent du feed public" },
  },
};

const feedPost = {
  type: "object",
  properties: {
    id: { type: "integer" },
    slug: { type: "string", example: "okinawa-et-ile-zamami", description: "URL du récit : /post/{slug}" },
    title: { type: "string" },
    shortDescription: { type: "string" },
    location: { type: "string", nullable: true, description: "Ville, sinon région ; null pour un pays entier" },
    countryCode: { type: "string", example: "JP" },
    archetype: {
      type: "object",
      description: "Type de récit (géré depuis l'admin)",
      properties: { slug: { type: "string", example: "culinary_heritage" }, label: { type: "string", example: "Patrimoine culinaire" } },
    },
    photoUrl: { type: "string" },
    photoAlt: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    likeCount: { type: "integer", minimum: 0, description: "Nombre de likes (visible par tous)" },
    author: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        username: { type: "string" },
        displayName: { type: "string" },
        avatarUrl: { type: "string", nullable: true },
        avatarSeed: { type: "string", nullable: true },
      },
    },
  },
};

const authResult = {
  type: "object",
  properties: {
    token: {
      type: "string",
      description: "JWT HS256, durée JWT_EXPIRES_IN (1 h par défaut). À envoyer dans « Authorization: Bearer <token> ».",
    },
    user: publicUser,
  },
};

const REFRESH_COOKIE_DOC =
  "Le refresh token n'est jamais dans le corps : il est posé dans le cookie `brb_refresh` (HttpOnly, SameSite=Strict, " +
  "Secure en production, Path=/api/v1/auth), illisible par le JavaScript. JWT signé avec JWT_REFRESH_SECRET, à usage unique " +
  "(REFRESH_TOKEN_REMEMBER_DAYS avec remember, 30 jours par défaut ; REFRESH_TOKEN_SESSION_HOURS sinon, 24 h par défaut). " +
  "Sans remember (et à l'inscription), cookie de session sans Max-Age, effacé à la fermeture du navigateur.";

function error(description: string, codes: string[]) {
  return {
    description,
    content: {
      "application/json": {
        schema: { type: "object", properties: { error: { type: "string", enum: codes } } },
      },
    },
  };
}

function json(description: string, schema: object) {
  return { description, content: { "application/json": { schema } } };
}

const invalidInput = error("Champ manquant, mal typé ou inconnu (Zod .strict())", ["INVALID_INPUT"]);
const unauthorized = error("Token absent, invalide, falsifié ou expiré", ["UNAUTHORIZED"]);
const tooManyRequests = error("Trop de requêtes : limite atteinte (réglable par variables RATE_LIMIT_*, voir .env.example)", [
  "TOO_MANY_REQUESTS",
]);
const notFound = error("Post introuvable ou appartenant à un autre utilisateur", ["NOT_FOUND"]);
const internalError = error("Erreur serveur (détail uniquement dans les logs serveur)", ["INTERNAL_ERROR"]);

const adminForbidden = error("Token valide mais pas administrateur (rôle relu en base à chaque requête), ou compte banni", ["FORBIDDEN"]);
const adminConflict = error("Action refusée : son propre compte, un autre admin (à rétrograder d'abord) ou nom déjà pris", [
  "CANNOT_TARGET_SELF",
  "TARGET_IS_ADMIN",
  "ARCHETYPE_TAKEN",
]);

function adminRoute(
  summary: string,
  options: { body?: z.ZodType; ok?: object; params?: { name: string; schema: object }[]; query?: object[]; description?: string; conflict?: boolean },
) {
  return {
    tags: ["Administration"],
    summary,
    ...(options.description ? { description: options.description } : {}),
    security: [{ bearerAuth: [] }],
    parameters: [
      ...(options.params ?? []).map(({ name, schema }) => ({ name, in: "path", required: true, schema })),
      ...(options.query ?? []),
    ],
    ...(options.body ? { requestBody: requestBody(options.body) } : {}),
    responses: {
      ...(options.ok ?? { 200: json("OK", { type: "object" }) }),
      400: invalidInput,
      401: unauthorized,
      403: adminForbidden,
      404: error("Élément introuvable", ["NOT_FOUND"]),
      ...(options.conflict ? { 409: adminConflict } : {}),
      429: tooManyRequests,
      500: internalError,
    },
  };
}
const userIdParam = { name: "id", schema: { type: "string", format: "uuid" } };
const numericIdParam = (name: string) => ({ name, schema: { type: "integer", minimum: 1 } });
const searchQuery = [
  { name: "q", in: "query", schema: { type: "string", minLength: 1, maxLength: 60 } },
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 }, description: "50 lignes par page" },
];
const noContent = { 204: { description: "Fait" } };

const tripDetail = {
  type: "object",
  properties: {
    trip: { type: "object", description: "Voyage (destination, dates, archetype, budget, source_post_count, generated_at)" },
    items: { type: "array", items: { type: "object" }, description: "Activités, triées par jour et heure" },
    tasks: { type: "array", items: { type: "object" }, description: "Checklist de préparation" },
    role: { type: "string", enum: ["owner", "editor", "viewer"] },
    pass: {
      type: "object",
      description: "Pass voyage : actif, en vente, prix",
      properties: { active: { type: "boolean" }, available: { type: "boolean" }, priceEur: { type: "number", nullable: true } },
    },
    chatLimit: { type: "integer", description: "Messages possibles dans la discussion IA (50, 200 avec le pass)" },
    undo: {
      type: "object",
      nullable: true,
      description: "Dernier changement de Biirbou annulable (POST /trips/{id}/undo) ; null : rien, délai de 24 h passé, planning modifié depuis, ou lecteur",
      properties: { kind: { type: "string", enum: ["suggestion", "regenerate", "regenerate_day"] }, created_at: { type: "string", format: "date-time" } },
    },
    live: {
      type: "object",
      nullable: true,
      description: "Voyage en cours (bouton « Que faire maintenant ? ») : jour local à la destination ; null avant, après, ou lecteur",
      properties: { day: { type: "string", format: "date" }, dayNumber: { type: "integer" } },
    },
    aiQuota: {
      type: "object",
      description: "Requêtes IA du jour de l'utilisateur sur ce voyage (limit null : illimité, admin ; plafond plus haut avec le pass)",
      properties: { used: { type: "integer" }, limit: { type: "integer", nullable: true } },
    },
    mapsUrls: { type: "object", nullable: true, description: "Pass voyage : lien Google Maps de l'itinéraire de chaque jour (clé AAAA-MM-JJ)" },
  },
};
const tripFull = error("Voyage complet : 10 voyageurs maximum (propriétaire, membres, participants sans compte)", ["TRIP_FULL"]);
const exportRateLimited = error("Trop d'exports ou de commandes (RATE_LIMIT_TRIP_EXPORT_*, par utilisateur)", ["TOO_MANY_REQUESTS"]);
const passRequired = error("Fonction du pass voyage : le voyage n'a pas de pass actif", ["PASS_REQUIRED"]);
const tripNotFound = error("Voyage (ou élément) introuvable, ou appartenant à un autre utilisateur", ["NOT_FOUND"]);
const tripMessages = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          role: { type: "string", enum: ["user", "assistant"] },
          content: { type: "string" },
          off_topic: { type: "boolean" },
          created_at: { type: "string", format: "date-time" },
          suggestions: {
            type: "array",
            items: { type: "object", properties: { status: { type: "string", enum: ["pending", "accepted", "rejected"] } } },
          },
        },
      },
    },
  },
};
const aiUnavailable = error("L'IA n'a pas répondu ou a renvoyé un format invalide", ["AI_UNAVAILABLE"]);
const aiRateLimited = error("Trop d'appels à l'IA : 20 maximum par utilisateur et par heure", ["TOO_MANY_REQUESTS"]);
const idParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "integer", minimum: 1 } });
const tripIdParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Identifiant public du voyage" };
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const tripSharing = json("Membres et invitations", { type: "object", properties: { role: { type: "string", enum: ["owner", "editor", "viewer"] }, members: { type: "array", items: { type: "object" } }, invitations: { type: "array", items: { type: "object" } } } });
const tripLedger = json("Registre des dépenses à jour", {
  type: "object",
  description:
    "role, currency, me, participants, expenses (montant d'origine, taux figé, montant converti, parts), total, " +
    "spentByCategory, budget, balances, settlements, paymentTasks",
});

// Ajoute des paramètres de requête (?…) à une route déjà décrite.
function withQuery<T extends { parameters: object[] }>(route: T, query: object[]): T {
  return { ...route, parameters: [...route.parameters, ...query] };
}

function tripRoute(summary: string, options: { params?: string[]; body?: z.ZodType; ok?: object; ai?: boolean; description?: string }) {
  return {
    tags: ["Voyages"],
    summary,
    ...(options.description ? { description: options.description } : {}),
    security: [{ bearerAuth: [] }],
    // {id} d'un voyage : son identifiant public (UUID) ; les autres ids (activité, invitation…) sont des entiers.
    parameters: (options.params ?? ["id"]).map((name) => (name === "id" ? tripIdParam : idParam(name))),
    ...(options.body ? { requestBody: requestBody(options.body) } : {}),
    responses: {
      400: invalidInput,
      401: unauthorized,
      404: tripNotFound,
      ...(options.ai ? { 429: aiRateLimited, 503: aiUnavailable } : {}),
      500: internalError,
      // En dernier : peut remplacer une réponse par défaut.
      ...(options.ok ?? { 200: json("Voyage à jour", tripDetail) }),
    },
  };
}

function profileImagePaths(label: string, description: string) {
  const responses = {
    200: json("Profil à jour", { type: "object", properties: { user: profileUser } }),
    401: unauthorized,
    429: tooManyRequests,
    500: internalError,
  };
  return {
    put: {
      tags: ["Utilisateurs"],
      summary: `${label} : envoyer une image`,
      description: `${description} Type réel vérifié (JPEG, PNG, WebP), 3 Mo maximum. L'ancienne image est supprimée.`,
      security: [{ bearerAuth: [] }],
      requestBody: multipartBody(profileImageSchema),
      responses: {
        ...responses,
        400: invalidInput,
        411: error("En-tête Content-Length absent", ["LENGTH_REQUIRED"]),
        413: error("Image trop lourde", ["PAYLOAD_TOO_LARGE"]),
      },
    },
    delete: {
      tags: ["Utilisateurs"],
      summary: `${label} : retirer l'image`,
      security: [{ bearerAuth: [] }],
      responses,
    },
  };
}

const reactions = {
  type: "object",
  properties: {
    likeCount: { type: "integer", minimum: 0 },
    liked: { type: "boolean", description: "Le post est aimé par l'utilisateur connecté" },
    saved: { type: "boolean", description: "Le post est dans ses voyages enregistrés" },
  },
};
const postIdParameter = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } };
const reactionNotFound = error("Post introuvable ou masqué", ["NOT_FOUND"]);

function reactionPaths(kind: "like" | "save", label: string) {
  const responses = {
    200: json("État des réactions après l'opération", reactions),
    400: invalidInput,
    401: unauthorized,
    404: reactionNotFound,
    429: tooManyRequests,
    500: internalError,
  };
  return {
    parameters: [postIdParameter],
    put: {
      tags: ["Réactions"],
      summary: `${label} un post`,
      description: "Idempotent : sans effet si c'est déjà fait.",
      security: [{ bearerAuth: [] }],
      responses,
    },
    delete: {
      tags: ["Réactions"],
      summary: `Retirer le ${kind === "like" ? "like" : "enregistrement"} d'un post`,
      description: "Idempotent : sans effet s'il n'y en avait pas.",
      security: [{ bearerAuth: [] }],
      responses,
    },
  };
}

export function buildOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Biirb API",
      version: "1.0.0",
      description:
        "API de Biirb. Pour les routes protégées : se connecter via /auth/login, " +
        "copier le token, puis cliquer sur « Authorize ».",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    tags: [
      { name: "Auth", description: "Inscription et connexion" },
      { name: "Utilisateurs", description: "Profil de l'utilisateur connecté" },
      { name: "Voyages", description: "Planificateur : voyages générés par l'IA (Gemini) à partir des posts, puis modifiables" },
      { name: "Posts", description: "Feed public, création, masquage et suppression de récits" },
      { name: "Lieux", description: "Recherche de villes et pays (country-state-city)" },
      { name: "Réactions", description: "Likes et voyages enregistrés" },
      { name: "Mécène", description: "Rôle mécène obtenu par un don sur Buy Me a Coffee" },
      { name: "Support", description: "Tickets de support : création et suivi par l'utilisateur" },
      { name: "Administration", description: "Réservé au rôle admin : modération, rôles, types de récit, réglages de l'IA, journal" },
    ],
    paths: {
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Créer un compte",
          requestBody: requestBody(registerSchema),
          responses: {
            201: json("Compte créé, utilisateur connecté (refresh token dans le cookie brb_refresh)", authResult),
            400: invalidInput,
            409: error("Email déjà utilisé", ["EMAIL_TAKEN"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Se connecter",
          description:
            "`remember` fixe la durée du refresh token (30 jours, sinon 24 h) et le stockage côté navigateur. " +
            "L'access token dure toujours 1 h. Connexion réussie : cookie `brb_device` (HttpOnly, SameSite=Strict, " +
            "Path=/api/v1/auth/login, LOGIN_DEVICE_DAYS) ; avec lui, cet appareil a son propre compteur au lieu de la limite par email. " +
            "En-tête Origin obligatoire et identique au site (CSRF).",
          requestBody: requestBody(loginSchema),
          responses: {
            200: json("Connecté (refresh token dans le cookie brb_refresh)", authResult),
            400: invalidInput,
            401: error("Email ou mot de passe incorrect (message volontairement identique)", ["INVALID_CREDENTIALS"]),
            403: error("Compte banni (après un mot de passe correct), ou origine absente ou différente du site", ["ACCOUNT_BANNED", "FORBIDDEN"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/auth/refresh": {
        post: {
          tags: ["Auth"],
          summary: "Renouveler l'access token",
          description:
            "Sans corps : le refresh token est lu dans le cookie `brb_refresh`. Rotation : nouvel access token dans la réponse, " +
            "nouveau refresh token dans le cookie, l'ancien devient invalide (le réutiliser révoque toute la session). " +
            "En-tête Origin obligatoire et identique au site (CSRF). " + REFRESH_COOKIE_DOC,
          responses: {
            200: json("Nouvel access token (refresh token renouvelé dans le cookie)", authResult),
            401: error("Cookie absent, refresh token inconnu, expiré, révoqué ou déjà utilisé (cookie effacé)", ["INVALID_REFRESH_TOKEN"]),
            403: error("Origine absente ou différente du site", ["FORBIDDEN"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Se déconnecter",
          description:
            "Sans corps : révoque toute la session liée au cookie `brb_refresh` et efface le cookie. " +
            "Répond 204 même sans cookie ou si le token est inconnu. En-tête Origin obligatoire et identique au site (CSRF).",
          responses: {
            204: { description: "Session révoquée, cookie effacé" },
            403: error("Origine absente ou différente du site", ["FORBIDDEN"]),
            500: internalError,
          },
        },
      },
      "/auth/forgot-password": {
        post: {
          tags: ["Auth"],
          summary: "Mot de passe oublié : envoyer un lien par email",
          description:
            "Répond 202 que le compte existe ou non, en au moins 2 s (ne révèle pas les comptes). Lien à usage unique, " +
            "valable PASSWORD_RESET_TTL_MINUTES, construit avec APP_URL (jamais l'en-tête Host) : /login?view=reset#token=…",
          requestBody: requestBody(forgotPasswordSchema),
          responses: {
            202: { description: "Demande prise en compte" },
            400: invalidInput,
            429: tooManyRequests,
            503: error("Envoi d'emails non configuré", ["MAIL_UNAVAILABLE"]),
            500: internalError,
          },
        },
      },
      "/auth/reset-password": {
        post: {
          tags: ["Auth"],
          summary: "Choisir un nouveau mot de passe avec le code du lien",
          description: "Code à usage unique (43 caractères base64url). Succès : mot de passe changé (bcrypt), toutes les sessions révoquées.",
          requestBody: requestBody(resetPasswordSchema),
          responses: {
            204: { description: "Mot de passe changé" },
            400: error("Champ invalide, ou lien expiré / déjà utilisé / inconnu", ["INVALID_INPUT", "INVALID_RESET_TOKEN"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/trips": {
        get: {
          tags: ["Voyages"],
          summary: "Mes voyages",
          security: [{ bearerAuth: [] }],
          responses: {
            200: json("Liste et quota IA du jour", {
              type: "object",
              properties: {
                trips: { type: "array", items: { type: "object" } },
                aiQuota: {
                  type: "object",
                  description: "Appels IA (génération, re-génération, discussion) du jour ; limit null = illimité (admin)",
                  properties: { used: { type: "integer" }, limit: { type: "integer", nullable: true } },
                },
              },
            }),
            401: unauthorized,
            500: internalError,
          },
        },
        post: {
          tags: ["Voyages"],
          summary: "Générer un voyage avec l'IA",
          description:
            "1 à 8 étapes (Biirbou en fait le parcours le plus logique), et envies facultatives du voyageur (1000 caractères, filtrées contre l'injection de prompt). " +
            "Posts filtrés par étape (destination ou tags) et par archetype, puis envoyés à Gemini (15 max). " +
            "Réponse de l'IA revalidée côté serveur. Rien n'est enregistré si l'IA échoue.",
          security: [{ bearerAuth: [] }],
          requestBody: requestBody(createTripSchema),
          responses: {
            201: json("Voyage créé (identifiant public)", { type: "object", properties: { id: { type: "string", format: "uuid" } } }),
            400: error("Champ invalide, voyage de plus de 3 mois (92 jours), ou envies refusées (injection)", [
              "INVALID_INPUT",
              "TRIP_TOO_LONG",
              "INSTRUCTIONS_REJECTED",
            ]),
            401: unauthorized,
            429: aiRateLimited,
            503: aiUnavailable,
            500: internalError,
          },
        },
      },
      "/posts": {
        get: {
          tags: ["Posts"],
          summary: "Feed : posts du plus récent au plus ancien (public)",
          description:
            "Pagination par curseur (chargement infini) : renvoyer `nextCursor` dans `cursor` pour la page suivante. " +
            "`nextCursor` vaut null quand il n'y a plus rien à charger.",
          parameters: [
            { name: "archetype", in: "query", schema: { type: "string", pattern: "^[a-z][a-z_]{0,39}$" }, description: "Slug d'un type de récit actif" },
            { name: "cursor", in: "query", schema: { type: "integer", minimum: 1 }, description: "Id du dernier post déjà affiché" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: FEED_MAX_LIMIT, default: 10 } },
          ],
          responses: {
            200: json("Une page du feed", {
              type: "object",
              properties: {
                posts: { type: "array", items: feedPost },
                nextCursor: { type: "integer", nullable: true },
              },
            }),
            400: invalidInput,
            429: tooManyRequests,
            500: internalError,
          },
        },
        post: {
          tags: ["Posts"],
          summary: "Publier un récit",
          description:
            "L'auteur est toujours celui du token. Destination et tags vérifiés dans country-state-city, " +
            "type réel de la photo vérifié (JPEG, PNG, WebP, 5 Mo max). Chaque tag est un JSON : " +
            '`{"country":"JP","state":"26","city":"Kyoto"}`. `body` : récit mis en page, document JSON de l\'éditeur ' +
            "(paragraph, bulletList, image ; marques bold, italic, underline, textStyle.fontSize 14px / 20px / 24px), " +
            "tout autre nœud ou attribut est refusé. Une image a pour src `upload:N` : N-ième fichier `bodyPhotos` " +
            "(5 max, 1 Mo chacun), chacun placé une seule fois. Texte vérifié par la liste de mots bannis, photos par l'IA.",
          security: [{ bearerAuth: [] }],
          requestBody: multipartBody(createPostSchema),
          responses: {
            201: json("Récit publié", {
              type: "object",
              properties: {
                id: { type: "integer" },
                slug: { type: "string", example: "okinawa-et-ile-zamami", description: "URL du récit : /post/{slug}" },
              },
            }),
            400: invalidInput,
            401: unauthorized,
            411: error("En-tête Content-Length absent", ["LENGTH_REQUIRED"]),
            413: error("Corps de requête trop lourd", ["PAYLOAD_TOO_LARGE"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/trips/{id}": {
        get: tripRoute("Détail d'un voyage", {}),
        patch: tripRoute("Modifier le titre, le budget ou la mémoire de Biirbou", {
          body: updateTripSchema,
          description: "memory : ce que Biirbou a retenu de la discussion, corrigé ou effacé (chaîne vide) ; filtrée contre l'injection (400 INSTRUCTIONS_REJECTED).",
        }),
        delete: tripRoute("Supprimer un voyage", { ok: { 204: { description: "Supprimé" } } }),
      },
      "/trips/{id}/regenerate": {
        post: tripRoute("Re-générer avec l'IA", {
          ai: true,
          description: "Remplace toutes les activités, la checklist et le budget.",
        }),
      },
      "/trips/{id}/undo": {
        post: tripRoute("Annuler le dernier changement de Biirbou", {
          ok: {
            200: json("Voyage à jour", tripDetail),
            404: error("Rien à annuler (aucun changement de Biirbou depuis 24 h)", ["NOTHING_TO_UNDO"]),
            409: error("Planning modifié à la main depuis ce changement : rien n'est restauré", ["PLAN_CHANGED"]),
          },
          description:
            "Proposition acceptée, re-génération complète ou d'un jour : restaure le planning d'avant, le plus récent d'abord, " +
            "pendant 24 h (TRIP_UNDO_HOURS). Une proposition annulée redevient en attente. Éditeur ou propriétaire. " +
            "GET /trips/{id} renvoie undo : { kind, created_at } si une annulation est possible.",
        }),
      },
      "/trips/{id}/pass": {
        post: tripRoute("Commander le pass voyage (propriétaire)", {
          body: tripPassCheckoutSchema,
          description:
            "acceptSales et waiveWithdrawal doivent valoir true (CGV acceptées, renonciation au droit de rétractation), enregistrés avec la commande. " +
            "Enregistre le voyage choisi (24 h) puis renvoie le lien de l'article Buy Me a Coffee. Le pass est activé par le webhook " +
            "extra_purchase.created payé avec l'email du compte (renvoyé ici à son titulaire), d'au moins BMC_TRIP_PASS_PRICE_EUR en euros.",
          ok: {
            200: json("Lien de paiement", {
              type: "object",
              properties: { url: { type: "string", format: "uri" }, email: { type: "string", nullable: true } },
            }),
            403: error("Réservé au propriétaire du voyage", ["FORBIDDEN"]),
            429: exportRateLimited,
            409: error("Le voyage a déjà le pass", ["PASS_ALREADY_ACTIVE"]),
            503: error("Pass voyage pas en vente (non configuré)", ["PASS_UNAVAILABLE"]),
          },
        }),
      },
      "/trips/{id}/days/{day}/regenerate": {
        post: {
          ...tripRoute("Re-générer un seul jour avec l'IA (pass voyage)", {
            ai: true,
            description: "Remplace les activités de ce jour seulement, sans doublon avec les autres jours. Éditeur ou propriétaire.",
            ok: { 200: json("Voyage à jour", tripDetail), 402: passRequired, 403: error("Lecteur : action interdite", ["FORBIDDEN"]) },
          }),
          parameters: [tripIdParam, { name: "day", in: "path", required: true, schema: { type: "string", format: "date" } }],
        },
      },
      "/trips/{id}/days/{day}/travel": {
        get: {
          ...tripRoute("Temps de trajet entre les activités d'un jour (pass voyage)", {
            description:
              "OpenRouteService (OpenStreetMap) : à pied, et en voiture au-delà de 2 km ; pas de transports en commun. Chaque lieu est " +
              "cherché une fois (nom donné par Biirbou, sinon titre) puis gardé ; un transport coupe la journée. Lecteur compris. " +
              "unlocated : lieu introuvable ; pending : pas encore cherché (8 recherches par appel, la suite au prochain). " +
              "deferred : plafond du site atteint (ORS_*_MAX, réserve pour le jour en cours d'un voyage en cours) ou " +
              "OpenRouteService indisponible : les trajets en cache sont renvoyés, les autres attendent le prochain affichage.",
            ok: {
              200: json("Trajets du jour", {
                type: "object",
                properties: {
                  legs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        fromItemId: { type: "integer" },
                        toItemId: { type: "integer" },
                        walk: { type: "object", nullable: true, properties: { minutes: { type: "integer" }, meters: { type: "integer" } } },
                        drive: { type: "object", nullable: true, properties: { minutes: { type: "integer" }, meters: { type: "integer" } } },
                      },
                    },
                  },
                  unlocated: { type: "array", items: { type: "integer" } },
                  pending: { type: "array", items: { type: "integer" } },
                  deferred: { type: "boolean" },
                },
              }),
              402: passRequired,
              429: tooManyRequests,
              503: error("Temps de trajet coupés (clé OpenRouteService absente)", ["TRAVEL_UNAVAILABLE"]),
            },
          }),
          parameters: [tripIdParam, { name: "day", in: "path", required: true, schema: { type: "string", format: "date" } }],
        },
      },
      "/trips/current": {
        get: {
          tags: ["Voyages"],
          summary: "Voyage en cours (accueil)",
          description:
            "Le voyage dont les dates englobent day (jour de l'appareil), avec ses activités de ce jour ; sinon le prochain voyage (sans activités). " +
            "current null : aucun voyage en cours ni à venir.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "day", in: "query", required: true, schema: { type: "string", format: "date" } }],
          responses: {
            200: json("Voyage en cours ou à venir", {
              type: "object",
              properties: {
                current: {
                  type: "object",
                  nullable: true,
                  properties: {
                    status: { type: "string", enum: ["during", "upcoming"] },
                    trip: { type: "object" },
                    items: { type: "array", items: { type: "object" } },
                  },
                },
              },
            }),
            400: error("day absent ou invalide", ["INVALID_INPUT"]),
            401: unauthorized,
            500: internalError,
          },
        },
      },
      "/trips/{id}/export/pdf": {
        get: withQuery(tripRoute("Télécharger le planning en PDF (pass voyage)", {
          description: "template : classic (planning à la suite), table (A4 paysage, jours en colonnes, cases colorées) ou booklet (A5, une page par jour).",
          ok: {
            200: { description: "Fichier PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } },
            402: passRequired,
            429: exportRateLimited,
          },
        }), [{ name: "template", in: "query", schema: { type: "string", enum: [...TRIP_PDF_TEMPLATES], default: "classic" } }]),
      },
      "/trips/{id}/export/calendar": {
        get: tripRoute("Télécharger le calendrier .ics (pass voyage)", {
          ok: {
            200: { description: "Calendrier iCalendar", content: { "text/calendar": { schema: { type: "string" } } } },
            402: passRequired,
            429: exportRateLimited,
          },
        }),
      },
      "/trips/{id}/messages": {
        get: tripRoute("Discussion avec l'IA", { ok: { 200: json("Messages et propositions", tripMessages) } }),
        post: tripRoute("Envoyer un message à l'IA", {
          body: sendTripMessageSchema,
          ai: true,
          ok: {
            201: json("Discussion à jour", tripMessages),
            429: error("30 messages maximum par utilisateur et par heure, 50 par voyage (200 avec le pass voyage)", ["TOO_MANY_REQUESTS", "CHAT_LIMIT_REACHED"]),
          },
          description:
            "Limitée au voyage et à sa destination (hors sujet : off_topic, aucune proposition). Message traité comme " +
            "une donnée non fiable. Les activités proposées restent en attente jusqu'à la réponse de l'utilisateur. " +
            "clientTime (heure de l'appareil avec décalage, ignorée si elle s'écarte de plus de 15 min de l'heure du serveur) : " +
            "Biirbou sait quel jour du voyage on est ; pendant le voyage, l'heure de la destination (fuseau de l'étape du jour) prime. " +
            "position (arrondie à 2 décimales par le serveur) ou place (« Je suis à… », l'un ou l'autre) : utilisés " +
            "seulement pendant le voyage, jamais enregistrés. energy (tired, motivated, relaxed) : adapte les propositions, " +
            "jamais enregistrée. disruption (reason : rain, closed, late, cancelled, budget, wish ; day : jour du voyage, sinon 400) : " +
            "imprévu choisi dans « Adapter ma journée », traduit par le serveur en libellé fixe, jamais enregistré. Le prompt contient aussi le budget, les dépenses et la mémoire du voyage, mise à jour après l'échange.",
        }),
      },
      "/trips/{id}/suggestions/{suggestionId}": {
        patch: tripRoute("Accepter ou refuser une proposition de l'IA", {
          params: ["id", "suggestionId"],
          body: answerTripSuggestionSchema,
          description: "Acceptée : l'activité est ajoutée au planning. 404 si la proposition a déjà reçu une réponse.",
        }),
      },
      "/trips/{id}/items": {
        post: tripRoute("Ajouter une activité", { body: createTripItemSchema, ok: { 201: json("Voyage à jour", tripDetail) } }),
      },
      "/trips/{id}/items/{itemId}": {
        patch: tripRoute("Modifier une activité", { params: ["id", "itemId"], body: updateTripItemSchema }),
        delete: tripRoute("Supprimer une activité", { params: ["id", "itemId"] }),
      },
      "/trips/{id}/tasks": {
        post: tripRoute("Ajouter une tâche", { body: createTripTaskSchema, ok: { 201: json("Voyage à jour", tripDetail) } }),
      },
      "/trips/{id}/tasks/{taskId}": {
        patch: tripRoute("Modifier / cocher une tâche", { params: ["id", "taskId"], body: updateTripTaskSchema }),
        delete: tripRoute("Supprimer une tâche", { params: ["id", "taskId"] }),
      },
      "/trips/{id}/members": {
        get: tripRoute("Membres du voyage (et invitations en cours pour le propriétaire)", { ok: { 200: tripSharing } }),
        post: tripRoute("Inviter par pseudo (propriétaire)", {
          body: inviteMemberSchema,
          description: "L'invitation attend l'acceptation de l'invité (7 jours). 404 USER_NOT_FOUND, 409 ALREADY_MEMBER, 409 TRIP_FULL (invitations en attente comprises), 403 si pas propriétaire.",
          ok: { 201: tripSharing },
        }),
      },
      "/trips/{id}/members/{userId}": {
        patch: { ...tripRoute("Changer le rôle d'un membre (propriétaire)", { body: updateMemberSchema, ok: { 200: tripSharing } }), parameters: [tripIdParam, uuidParam("userId")] },
        delete: {
          ...tripRoute("Retirer un membre (propriétaire) ou quitter le voyage (son propre id)", { ok: { 204: { description: "Retiré" } } }),
          parameters: [tripIdParam, uuidParam("userId")],
        },
      },
      "/trips/{id}/invitations": {
        post: tripRoute("Créer un lien d'invitation (propriétaire)", {
          body: createInviteLinkSchema,
          description: "Code renvoyé une seule fois (seule son empreinte SHA-256 est stockée). Lien : /planner/join#<code>, réutilisable 7 jours.",
          ok: {
            201: json("Lien créé", { type: "object", properties: { id: { type: "integer" }, code: { type: "string" }, role: { type: "string" }, expiresAt: { type: "string" } } }),
            409: tripFull,
          },
        }),
      },
      "/trips/{id}/invitations/{invitationId}": {
        delete: tripRoute("Annuler une invitation (propriétaire)", { params: ["id", "invitationId"], ok: { 200: tripSharing } }),
      },
      "/trips/invitations": {
        get: tripRoute("Invitations reçues par pseudo", { params: [], ok: { 200: json("Invitations en attente", { type: "object" }) } }),
      },
      "/trips/invitations/{invitationId}": {
        patch: tripRoute("Accepter ou refuser une invitation reçue", {
          params: ["invitationId"],
          body: answerTripSuggestionSchema,
          ok: { 200: json("tripId du voyage rejoint (null si refusée)", { type: "object" }), 409: tripFull },
        }),
      },
      "/trips/join": {
        post: tripRoute("Rejoindre un voyage avec un lien d'invitation", {
          params: [],
          body: joinTripSchema,
          description: "404 INVITE_INVALID : lien expiré, annulé ou inventé. Limité par utilisateur (RATE_LIMIT_TRIP_SHARE_*).",
          ok: { 200: json("Voyage rejoint", { type: "object", properties: { tripId: { type: "integer" } } }), 409: tripFull },
        }),
      },
      "/trips/{id}/expenses": {
        get: withQuery(
          tripRoute("Dépenses partagées (registre complet)", {
            ok: { 200: tripLedger, 503: error("Taux de change indisponible", ["RATE_UNAVAILABLE"]) },
            description:
              "display : devise d'affichage, parmi displayCurrencies (celle du voyage et celles des dépenses). Chaque dépense est " +
              "convertie au taux BCE du jour où elle a été payée (montant exact si elle a été payée dans cette devise) ; totaux, " +
              "soldes, équilibrage et budget sont alors dans cette devise. Budget prévu (en euros) : dernier taux.",
          }),
          [{ name: "display", in: "query", schema: { type: "string", example: "JPY" } }],
        ),
        post: tripRoute("Ajouter une dépense", {
          body: expenseSchema,
          description:
            "Montants en unités mineures de leur devise (centimes ; 0 décimale pour JPY, KRW, ISK). Taux BCE du jour de la dépense, " +
            "figé. Lecteur : seulement une dépense qu'il a payée. paymentTaskId : coche la ligne « à payer » correspondante. " +
            "503 RATE_UNAVAILABLE si le taux de change est indisponible.",
          ok: { 201: tripLedger },
        }),
      },
      "/trips/{id}/expenses/{expenseId}": {
        put: tripRoute("Modifier une dépense", { params: ["id", "expenseId"], body: expenseSchema, ok: { 200: tripLedger } }),
        delete: tripRoute("Supprimer une dépense", { params: ["id", "expenseId"], ok: { 200: tripLedger } }),
      },
      "/trips/{id}/participants": {
        post: tripRoute("Ajouter un participant sans compte (éditeur)", { body: participantSchema, ok: { 201: tripLedger, 409: tripFull } }),
      },
      "/trips/{id}/participants/{participantId}": {
        patch: tripRoute("Renommer un participant sans compte", { params: ["id", "participantId"], body: participantSchema, ok: { 200: tripLedger } }),
        delete: tripRoute("Retirer un participant sans compte (409 s'il apparaît dans une dépense)", { params: ["id", "participantId"], ok: { 200: tripLedger } }),
      },
      "/trips/{id}/settlements": {
        post: tripRoute("Marquer un remboursement entre participants", { body: settlementSchema, ok: { 201: tripLedger } }),
      },
      "/trips/{id}/currency": {
        put: tripRoute("Changer la devise du voyage (409 CURRENCY_LOCKED dès qu'une dépense existe)", { body: tripCurrencySchema, ok: { 200: tripLedger } }),
      },
      "/trips/{id}/payment-tasks": {
        post: tripRoute("Ajouter une chose à payer (éditeur)", { body: paymentTaskSchema, ok: { 201: tripLedger } }),
      },
      "/trips/{id}/payment-tasks/{taskId}": {
        patch: tripRoute("Modifier une chose à payer", { params: ["id", "taskId"], body: updatePaymentTaskSchema, ok: { 200: tripLedger } }),
        delete: tripRoute("Retirer une chose à payer", { params: ["id", "taskId"], ok: { 200: tripLedger } }),
      },
      "/posts/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        patch: {
          tags: ["Posts"],
          summary: "Masquer ou réafficher mon post",
          description: "Un post masqué disparaît du feed public mais reste visible par son auteur dans son profil.",
          security: [{ bearerAuth: [] }],
          requestBody: requestBody(updatePostSchema),
          responses: {
            200: json("Visibilité mise à jour", {
              type: "object",
              properties: { id: { type: "integer" }, hidden: { type: "boolean" } },
            }),
            400: invalidInput,
            401: unauthorized,
            404: notFound,
            429: tooManyRequests,
            500: internalError,
          },
        },
        delete: {
          tags: ["Posts"],
          summary: "Supprimer définitivement mon post",
          description: "Supprime le post, ses liens vers les tags et sa photo du bucket.",
          security: [{ bearerAuth: [] }],
          responses: {
            204: { description: "Post supprimé (pas de contenu)" },
            400: invalidInput,
            401: unauthorized,
            404: notFound,
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/locations": {
        get: {
          tags: ["Lieux"],
          summary: "Rechercher une ville ou un pays (8 suggestions max)",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2, maxLength: 60 } },
          ],
          responses: {
            200: json("Suggestions", {
              type: "object",
              properties: {
                places: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      label: { type: "string", example: "Kyoto, Kyōto Prefecture, Japon" },
                      country: { type: "string" },
                      state: { type: "string" },
                      city: { type: "string" },
                    },
                  },
                },
              },
            }),
            400: invalidInput,
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/posts/{id}/like": reactionPaths("like", "Aimer"),
      "/posts/{id}/save": reactionPaths("save", "Enregistrer"),
      "/posts/{id}/reactions": {
        parameters: [postIdParameter],
        get: {
          tags: ["Réactions"],
          summary: "Mes réactions sur un post (et son nombre de likes)",
          security: [{ bearerAuth: [] }],
          responses: {
            200: json("État des réactions", reactions),
            400: invalidInput,
            401: unauthorized,
            404: reactionNotFound,
            500: internalError,
          },
        },
      },
      "/users/me/patron": {
        get: {
          tags: ["Mécène"],
          summary: "État du rôle mécène",
          description:
            "`enabled` : paiement configuré. `pageUrl` : page Buy Me a Coffee. `email` : adresse du compte, à utiliser " +
            "sur Buy Me a Coffee (elle relie le don au compte).",
          security: [{ bearerAuth: [] }],
          responses: {
            200: json("État", {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                minEur: { type: "number", nullable: true, description: "Don minimum (EUR) qui donne le rôle" },
                isPatron: { type: "boolean" },
                email: { type: "string", nullable: true },
                pageUrl: { type: "string", nullable: true },
              },
            }),
            401: unauthorized,
            500: internalError,
          },
        },
      },
      "/payments/buymeacoffee": {
        post: {
          tags: ["Mécène"],
          summary: "Webhook Buy Me a Coffee (appelé par Buy Me a Coffee uniquement)",
          description:
            "Signature HMAC-SHA256 du corps brut vérifiée (en-tête x-signature-sha256, BMC_WEBHOOK_SECRET). " +
            "donation.created d'au moins BMC_PATRON_MIN_EUR en euros : rôle mécène au compte non banni de même email. donation.refunded : rôle précédent rendu. " +
            "extra_purchase.created de l'article BMC_TRIP_PASS_EXTRA_ID : pass voyage du dernier voyage commandé (24 h) par ce compte ; extra_purchase.refunded : pass retiré. " +
            "Idempotent ; événements de test ignorés en production.",
          responses: {
            200: json("Événement reçu", { type: "object", properties: { received: { type: "boolean" } } }),
            400: invalidInput,
            401: error("Signature absente ou invalide", ["INVALID_SIGNATURE"]),
            413: error("Corps trop volumineux", ["PAYLOAD_TOO_LARGE"]),
            503: error("Paiement non configuré", ["PAYMENT_UNAVAILABLE"]),
            500: internalError,
          },
        },
      },
      "/users/me/badge": {
        get: {
          tags: ["Utilisateurs"],
          summary: "Mes badges : débloqués, affiché, progression",
          description: "Voyageur toujours ; globe-trotteur dès BADGE_THRESHOLDS.globetrotter récits publiés, rêveur dès BADGE_THRESHOLDS.dreamer récits aimés (ou attribués par un admin) ; mécène et admin selon le rôle.",
          security: [{ bearerAuth: [] }],
          responses: { 200: json("Badges", {
            type: "object",
            properties: {
              badges: { type: "array", items: { type: "object", properties: { badge: { type: "string", enum: [...USER_ROLES] }, unlocked: { type: "boolean" } } } },
              displayed: { type: "string", enum: [...USER_ROLES] },
              progress: { type: "object", properties: { posts: { type: "integer" }, likes: { type: "integer" } } },
              thresholds: { type: "object", properties: { globetrotter: { type: "integer" }, dreamer: { type: "integer" } } },
            },
          }), 401: unauthorized, 500: internalError },
        },
        put: {
          tags: ["Utilisateurs"],
          summary: "Choisir le badge affiché",
          description: "badge null : badge du rôle. Affiché sur le profil, les récits et les commentaires ; le rôle (droits) ne change pas.",
          security: [{ bearerAuth: [] }],
          requestBody: requestBody(displayedBadgeSchema),
          responses: {
            200: json("Badges à jour", {
            type: "object",
            properties: {
              badges: { type: "array", items: { type: "object", properties: { badge: { type: "string", enum: [...USER_ROLES] }, unlocked: { type: "boolean" } } } },
              displayed: { type: "string", enum: [...USER_ROLES] },
              progress: { type: "object", properties: { posts: { type: "integer" }, likes: { type: "integer" } } },
              thresholds: { type: "object", properties: { globetrotter: { type: "integer" }, dreamer: { type: "integer" } } },
            },
          }),
            400: invalidInput,
            401: unauthorized,
            403: error("Badge pas encore débloqué", ["BADGE_LOCKED"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/users/me/avatar": profileImagePaths("Photo de profil", "Remplace le blobatar partout (navbar, cartes, récits)."),
      "/users/me/reactions": {
        get: {
          tags: ["Réactions"],
          summary: "Mes réactions sur plusieurs posts (une page du feed)",
          description: "Un seul appel pour toute une page du feed, au lieu d'un appel par post.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "postIds",
              in: "query",
              required: true,
              description: "Ids séparés par des virgules (1 à 50), ex. 12,11,10",
              schema: { type: "string", pattern: "^[1-9][0-9]{0,9}(,[1-9][0-9]{0,9})*$" },
            },
          ],
          responses: {
            200: json("Réactions de l'utilisateur", {
              type: "object",
              properties: {
                reactions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      postId: { type: "integer" },
                      likeCount: { type: "integer", minimum: 0 },
                      liked: { type: "boolean" },
                      saved: { type: "boolean" },
                    },
                  },
                },
              },
            }),
            400: invalidInput,
            401: unauthorized,
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/users/{username}": {
        get: {
          tags: ["Utilisateurs"],
          summary: "Profil public d'un utilisateur (sans compte)",
          description:
            "Profil privé : `isPrivate: true` et l'identité seule (nom, pseudo, avatar). Sinon : récits visibles " +
            "(jamais masqués ni en attente de modération), et enregistrés uniquement si l'utilisateur les montre " +
            "(`saved: null` sinon). Jamais les itinéraires IA, l'email ni les réglages.",
          parameters: [
            { name: "username", in: "path", required: true, schema: { type: "string", pattern: "^[a-z0-9_]{3,30}$" } },
          ],
          responses: {
            200: json("Profil public", {
              type: "object",
              properties: {
                isPrivate: { type: "boolean" },
                user: publicUser,
                stories: { type: "array", items: postSummary, description: "Absent si profil privé" },
                storyCount: { type: "integer", description: "Absent si profil privé" },
                saved: { type: "array", nullable: true, items: postSummary, description: "null si non partagés" },
              },
            }),
            400: invalidInput,
            404: error("Pseudo inconnu ou compte banni (réponse identique)", ["NOT_FOUND"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/users/me": {
        get: {
          tags: ["Utilisateurs"],
          summary: "Mon profil et mes récits publiés",
          security: [{ bearerAuth: [] }],
          responses: {
            200: json("Profil", {
              type: "object",
              properties: {
                user: profileUser,
                stories: { type: "array", items: postSummary, description: "12 plus récents" },
                storyCount: { type: "integer" },
                saved: { type: "array", items: postSummary, description: "Voyages enregistrés (48 plus récents), avec leur auteur" },
              },
            }),
            401: unauthorized,
            500: internalError,
          },
        },
        patch: {
          tags: ["Utilisateurs"],
          summary: "Modifier mon profil",
          description: "L'utilisateur modifié est toujours celui du token : impossible de modifier un autre compte.",
          security: [{ bearerAuth: [] }],
          requestBody: requestBody(updateProfileSchema),
          responses: {
            200: json("Profil mis à jour", { type: "object", properties: { user: profileUser } }),
            400: invalidInput,
            401: unauthorized,
            409: error("Pseudo déjà pris", ["USERNAME_TAKEN"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/posts/{id}/report": {
        post: {
          tags: ["Posts"],
          summary: "Signaler un récit à la modération",
          description: "Motif facultatif (500 caractères). Signaler deux fois le même récit n'a pas d'effet de plus.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          requestBody: requestBody(reportPostSchema),
          responses: {
            204: { description: "Signalement enregistré" },
            400: error("Champ invalide, ou signalement de son propre récit", ["INVALID_INPUT", "OWN_POST"]),
            401: unauthorized,
            403: error("Compte banni", ["FORBIDDEN"]),
            404: error("Récit introuvable", ["NOT_FOUND"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/tickets": {
        get: {
          tags: ["Support"],
          summary: "Mes tickets (50 plus récents)",
          security: [{ bearerAuth: [] }],
          responses: {
            200: json("Tickets", { type: "object", properties: { tickets: { type: "array", items: { type: "object" } } } }),
            401: unauthorized,
            500: internalError,
          },
        },
        post: {
          tags: ["Support"],
          summary: "Ouvrir un ticket",
          description:
            "État initial « open ». L'avancement (open → in_progress → resolved) est changé par un admin. category : trip_pass, bug, report, " +
            "account ou other ; trip_pass prévient tous les admins par email (texte fixe : numéro du ticket et pseudo, jamais le message).",
          security: [{ bearerAuth: [] }],
          requestBody: requestBody(createTicketSchema),
          responses: {
            201: json("Ticket créé", { type: "object" }),
            400: invalidInput,
            401: unauthorized,
            403: error("Compte banni", ["FORBIDDEN"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/posts/{id}/comments": {
        get: {
          tags: ["Posts"],
          summary: "Commentaires d'un récit (public)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          responses: {
            200: json("Du plus ancien au plus récent (200 max)", { type: "object", properties: { comments: { type: "array", items: { type: "object" } } } }),
            400: invalidInput,
            404: error("Récit introuvable ou masqué", ["NOT_FOUND"]),
            500: internalError,
          },
        },
        post: {
          tags: ["Posts"],
          summary: "Commenter un récit",
          description: "Connecté et non banni. Texte vérifié par la modération IA (refus → 422 avec les motifs).",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          requestBody: requestBody(createCommentSchema),
          responses: {
            201: json("Commentaire créé", { type: "object", properties: { comment: { type: "object" } } }),
            400: invalidInput,
            401: unauthorized,
            403: error("Compte banni", ["FORBIDDEN"]),
            404: error("Récit introuvable ou masqué", ["NOT_FOUND"]),
            422: error("Refusé par la modération (motif non communiqué)", ["CONTENT_REJECTED"]),
            429: tooManyRequests,
            500: internalError,
          },
        },
      },
      "/posts/{id}/comments/{commentId}": {
        delete: {
          tags: ["Posts"],
          summary: "Supprimer un commentaire",
          description: "Par son auteur, ou par un admin (action inscrite au journal).",
          security: [{ bearerAuth: [] }],
          parameters: ["id", "commentId"].map((name) => ({ name, in: "path", required: true, schema: { type: "integer", minimum: 1 } })),
          responses: { 204: { description: "Supprimé" }, 400: invalidInput, 401: unauthorized, 404: error("Introuvable ou pas à vous", ["NOT_FOUND"]), 500: internalError },
        },
      },
      "/admin/dashboard": {
        get: adminRoute("Tableau de bord", { description: "Compteurs, signalements en attente, requêtes IA des 7 derniers jours, dernières inscriptions." }),
      },
      "/admin/users": {
        get: adminRoute("Utilisateurs", { query: searchQuery, description: "Recherche par pseudo ou nom. Jamais d'email ni de hash." }),
      },
      "/admin/users/{id}": {
        patch: adminRoute("Changer le rôle / bannir", {
          params: [userIdParam],
          body: adminUpdateUserSchema,
          conflict: true,
          description: "Bannir coupe toutes les sessions (refresh tokens révoqués, connexion refusée).",
        }),
        delete: adminRoute("Supprimer un compte", { params: [userIdParam], ok: noContent, conflict: true, description: "Récits, voyages et photos supprimés avec lui." }),
      },
      "/admin/posts": {
        get: adminRoute("Récits (masqués compris)", {
          query: [...searchQuery, { name: "visibility", in: "query", schema: { type: "string", enum: ["all", "visible", "hidden"], default: "all" } }],
        }),
      },
      "/admin/posts/{id}": {
        patch: adminRoute("Masquer / réafficher un récit", { params: [numericIdParam("id")], body: adminUpdatePostSchema, description: "Masquer règle aussi ses signalements ouverts." }),
        delete: adminRoute("Supprimer un récit", { params: [numericIdParam("id")], ok: noContent }),
      },
      "/admin/reports": {
        get: adminRoute("Signalements en attente", { description: "Regroupés par récit, du plus signalé au moins signalé." }),
      },
      "/admin/reports/{postId}": {
        patch: adminRoute("Classer sans suite", { params: [numericIdParam("postId")], body: adminCloseReportsSchema, ok: noContent }),
      },
      "/admin/tickets": {
        get: adminRoute("Tickets de support", {
          description: "Ouverts d'abord, les plus anciens en premier. 50 par page. Jamais l'email de l'auteur.",
          query: [
            { name: "status", in: "query", schema: { type: "string", enum: ["all", ...TICKET_STATUSES], default: "all" } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          ],
        }),
      },
      "/admin/tickets/{id}": {
        patch: adminRoute("Changer l'état, la priorité ou les assignés d'un ticket", {
          params: [numericIdParam("id")],
          body: adminUpdateTicketSchema,
          ok: noContent,
          description:
            "L'état est vu par l'auteur du ticket, la priorité et les assignés restent internes à l'administration. " +
            `assigneeIds : liste complète (remplace la précédente, ${TICKET_MAX_ASSIGNEES} au plus), admins actifs uniquement (GET /admin/assignees), sinon 400. ` +
            "Inscrit au journal (avant / après ; ajoutés / retirés).",
        }),
      },
      "/admin/tickets/board": {
        get: adminRoute("Kanban du support", {
          description:
            "Tous les tickets non clôturés (300 au plus, plus anciens d'abord) et les 30 derniers clôturés. Colonnes : open → À faire, " +
            "in_progress → En cours, resolved → Fait, closed → Clôturé ; déplacer un ticket = PATCH /admin/tickets/{id} (état vu par l'utilisateur).",
        }),
      },
      "/admin/assignees": {
        get: adminRoute("Admins assignables à un ticket", {
          description: "Admins actifs (non bannis) : id, pseudo, nom affiché, avatar. Jamais d'email.",
        }),
      },
      "/admin/dev-tickets": {
        get: adminRoute("Kanban du développement", {
          description: "Tickets internes de l'équipe : tous les non clôturés (priorité haute d'abord) et les 30 derniers clôturés. Visibles des admins seulement.",
        }),
        post: adminRoute("Créer un ticket de développement", {
          body: createDevTicketSchema,
          ok: { 201: json("Créé", { type: "object", properties: { id: { type: "integer" } } }) },
          description: "Créé dans la colonne « À faire ». Inscrit au journal.",
        }),
      },
      "/admin/dev-tickets/{id}": {
        patch: adminRoute("Modifier ou déplacer un ticket de développement", {
          params: [numericIdParam("id")],
          body: updateDevTicketSchema,
          ok: noContent,
          description:
            "status : todo, in_progress, done ou closed. " +
            `assigneeIds : liste complète (remplace la précédente, ${TICKET_MAX_ASSIGNEES} au plus), admins actifs uniquement. Inscrit au journal.`,
        }),
        delete: adminRoute("Supprimer un ticket de développement", { params: [numericIdParam("id")], ok: noContent, description: "Inscrit au journal." }),
      },
      "/admin/trip-passes": {
        get: adminRoute("Pass voyage : achats à rattacher et pass actifs", {
          description: "Achat à rattacher : payé avec un email sans compte ou sans commande en cours. Email jamais renvoyé, seulement un aperçu masqué.",
        }),
        post: adminRoute("Rattacher un achat à un voyage, ou offrir un pass", {
          body: adminGrantTripPassSchema,
          ok: noContent,
          description:
            "passId : rattache l'achat si payerEmail (déclaré par l'acheteur) correspond à l'empreinte de l'email du paiement, sinon 409 EMAIL_MISMATCH. " +
            "Sans passId : pass offert. 404 TRIP_NOT_FOUND, 409 PASS_ALREADY_ACTIVE. Inscrit au journal.",
          conflict: true,
        }),
      },
      "/admin/trip-passes/{id}": {
        delete: adminRoute("Retirer un pass voyage", { params: [numericIdParam("id")], ok: noContent, description: "Inscrit au journal." }),
      },
      "/admin/archetypes": {
        get: adminRoute("Types de récit (actifs ou non)", {}),
        post: adminRoute("Créer un type de récit", { body: createArchetypeSchema, ok: { 201: json("Créé", { type: "object" }) }, conflict: true }),
      },
      "/admin/archetypes/{id}": {
        patch: adminRoute("Modifier / (dés)activer un type de récit", { params: [numericIdParam("id")], body: updateArchetypeSchema, conflict: true }),
      },
      "/admin/settings": {
        get: adminRoute("Réglages de l'IA", {}),
        patch: adminRoute("Couper l'IA / changer le plafond global", { body: adminUpdateSettingsSchema }),
      },
      "/admin/banned-words": {
        get: adminRoute("Mots bannis (modération du texte)", {}),
        post: adminRoute("Bannir un terme", { body: adminCreateBannedWordSchema, ok: { 201: json("Ajouté", { type: "object" }) }, conflict: true }),
      },
      "/admin/banned-words/{id}": {
        delete: adminRoute("Retirer un terme", { params: [numericIdParam("id")], ok: noContent }),
      },
      "/admin/actions": {
        get: adminRoute("Journal des actions admin", { description: "200 dernières actions." }),
      },
    },
  };
}
