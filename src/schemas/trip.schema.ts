import { z } from "zod";
import { archetypeSlugSchema } from "@/schemas/archetype.schema";
import { TRIP_MAX_TRAVELERS } from "@/schemas/trip-share.schema";

// 3 mois maximum, début et fin inclus (même limite que la contrainte SQL trip_max_length_check).
export const TRIP_MAX_DAYS = 92;
export const TRIP_ITEM_CATEGORIES = ["transport", "lodging", "activity", "food"] as const;
// Couleur d'une case (vue Tableau, PDF) : mêmes clés que la contrainte SQL et les tokens --color-cell-* de globals.css.
export const TRIP_ITEM_COLORS = ["coral", "sky", "mint", "sun", "lavender", "sand", "rose", "slate"] as const;
export const TRIP_SUGGESTION_ACTIONS = ["add", "update", "delete"] as const;
export const TRIP_PDF_TEMPLATES = ["classic", "table", "booklet"] as const;
// Changements de Biirbou annulables (« Annuler », le plus récent d'abord), pendant TRIP_UNDO_HOURS.
export const TRIP_PLAN_CHANGE_KINDS = ["suggestion", "regenerate", "regenerate_day"] as const;
export type TripPlanChangeKind = (typeof TRIP_PLAN_CHANGE_KINDS)[number];
export const TRIP_UNDO_HOURS = 24;
// Court : limite le coût par message.
export const TRIP_MESSAGE_MAX = 500;
// Modes des temps de trajet (OpenRouteService, comme le type travel_profile) : pas de transports en commun.
export const TRAVEL_PROFILES = ["foot-walking", "driving-car"] as const;
export type TravelProfile = (typeof TRAVEL_PROFILES)[number];
// Énergie du voyageur (« Que faire maintenant ? ») : fatigué, motivé, envie de détente.
export const TRIP_ENERGY_LEVELS = ["tired", "motivated", "relaxed"] as const;
export type TripEnergyLevel = (typeof TRIP_ENERGY_LEVELS)[number];
// Motifs d'imprévus (« Adapter ma journée ») : valeurs connues, traduites par le serveur en libellés fixes pour Biirbou.
// La fatigue passe par l'énergie (TRIP_ENERGY_LEVELS).
export const TRIP_DISRUPTIONS = ["rain", "closed", "late", "cancelled", "budget", "wish"] as const;
export type TripDisruption = (typeof TRIP_DISRUPTIONS)[number];
// « Je suis à… » : un quartier ou un lieu.
export const TRIP_PLACE_MAX = 100;
// Mêmes limites que trip_destination et trip.instructions (db/migrations).
export const TRIP_MAX_DESTINATIONS = 8;
export const TRIP_INSTRUCTIONS_MAX = 1000;
// Mémoire du voyage retenue par Biirbou : même limite que trip.memory.
export const TRIP_MEMORY_MAX = 600;

const countryCode = z.string().regex(/^[A-Z]{2}$/);
const stateCode = z.string().regex(/^[A-Za-z0-9-]{1,10}$/);
const cityName = z.string().trim().min(1).max(100);
const isoDate = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const euros = z.number().int().min(0).max(1_000_000);

export const idParamSchema = z.coerce.number().int().positive().max(2_147_483_647);
// Voyage dans l'URL et l'API : son identifiant public (UUID), jamais la clé interne.
export const tripIdParamSchema = z.uuid();
// Jour d'un voyage dans l'URL (AAAA-MM-JJ).
export const dayParamSchema = isoDate;
// En-tête If-Match (verrouillage optimiste) : version de l'activité ou du voyage lue par le client, ex. "3".
export const ifMatchSchema = z
  .string()
  .regex(/^"[1-9][0-9]{0,8}"$/)
  .transform((value) => Number(value.slice(1, -1)));

// Étape du voyage : un lieu de country-state-city (ville → région obligatoire).
const tripDestinationSchema = z
  .strictObject({ country: countryCode, state: stateCode.optional(), city: cityName.optional() })
  .refine((place) => !place.city || place.state, { path: ["city"] });

export const createTripSchema = z
  .strictObject({
    // La première est la destination principale (cartes) ; Biirbou construit le parcours le plus logique.
    destinations: z.array(tripDestinationSchema).min(1).max(TRIP_MAX_DESTINATIONS),
    startDate: isoDate,
    endDate: isoDate,
    archetype: archetypeSlugSchema,
    // Pour le budget, l'hébergement et le rythme proposés par l'IA (même limite que le partage du voyage).
    travelers: z.number().int().min(1).max(TRIP_MAX_TRAVELERS),
    // Envies du voyageur pour Biirbou : donnée non fiable (filtrée et cadrée dans trip.service).
    instructions: z
      .string()
      .trim()
      .max(TRIP_INSTRUCTIONS_MAX)
      .transform((value) => value || undefined)
      .optional(),
  })
  // Dates AAAA-MM-JJ : l'ordre des chaînes est chronologique.
  .refine((trip) => trip.endDate >= trip.startDate, { path: ["endDate"] });

export const updateTripSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(100),
    // Mémoire de Biirbou corrigée par le voyageur ; vide : effacée.
    memory: z
      .string()
      .trim()
      .max(TRIP_MEMORY_MAX)
      .transform((value) => value || null)
      .nullable(),
    budgetTarget: euros.nullable(),
    budgetLodging: euros,
    budgetTransit: euros,
    budgetDining: euros,
    budgetActivities: euros,
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0);

// POST /api/v1/trips/[id]/pass : CGV acceptées et renonciation expresse au droit de rétractation (contenu numérique
// fourni dès le paiement), cases cochées par l'acheteur.
export const tripPassCheckoutSchema = z.strictObject({
  acceptSales: z.literal(true),
  waiveWithdrawal: z.literal(true),
});

// Arrondi à 2 décimales (≈ 1 km) : jamais la position exacte, même si le navigateur l'envoie.
const coordinate = (limit: number) =>
  z
    .number()
    .min(-limit)
    .max(limit)
    .transform((value) => Math.round(value * 100) / 100);

// Contexte du moment, envoyé avec la question puis oublié (jamais enregistré) : heure de l'appareil ; pour « Que faire
// maintenant ? », position GPS arrondie ou lieu écrit à la main (l'un ou l'autre) et énergie ; pour « Adapter ma
// journée », motif de l'imprévu et jour concerné.
export const sendTripMessageSchema = z
  .strictObject({
    content: z.string().trim().min(2).max(TRIP_MESSAGE_MAX),
    // Heure de l'appareil avec son décalage (ex. 2026-11-02T14:05:00+09:00) : en voyage, l'heure locale du voyageur.
    clientTime: z.iso.datetime({ offset: true }).optional(),
    position: z.strictObject({ latitude: coordinate(90), longitude: coordinate(180) }).optional(),
    place: z.string().trim().min(2).max(TRIP_PLACE_MAX).optional(),
    energy: z.enum(TRIP_ENERGY_LEVELS).optional(),
    disruption: z.strictObject({ reason: z.enum(TRIP_DISRUPTIONS), day: isoDate }).optional(),
  })
  .refine((body) => !(body.position && body.place));
export type TripMessageContext = Omit<z.infer<typeof sendTripMessageSchema>, "content">;

export const answerTripSuggestionSchema = z.strictObject({
  accepted: z.boolean(),
});

const tripItemFields = {
  day: isoDate,
  startTime: time,
  title: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || null),
  category: z.enum(TRIP_ITEM_CATEGORIES),
};

export const createTripItemSchema = z.strictObject(tripItemFields);

// color : null rend la couleur de la catégorie.
export const updateTripItemSchema = z
  .strictObject({ ...tripItemFields, color: z.enum(TRIP_ITEM_COLORS).nullable() })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0);

// GET /api/v1/trips/current?day= : jour de l'appareil (en voyage, le jour local du voyageur).
export const currentTripQuerySchema = z.strictObject({ day: isoDate });

// GET /api/v1/trips/[id]/export/pdf?template=
export const tripPdfQuerySchema = z.strictObject({ template: z.enum(TRIP_PDF_TEMPLATES).default("classic") });

export const createTripTaskSchema = z.strictObject({
  label: z.string().trim().min(1).max(120),
});

export const updateTripTaskSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(120),
    done: z.boolean(),
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0);

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type TripDestinationInput = z.infer<typeof tripDestinationSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type CreateTripItemInput = z.infer<typeof createTripItemSchema>;
export type UpdateTripItemInput = z.infer<typeof updateTripItemSchema>;
export type UpdateTripTaskInput = z.infer<typeof updateTripTaskSchema>;
export type TripItemCategory = (typeof TRIP_ITEM_CATEGORIES)[number];
export type TripItemColor = (typeof TRIP_ITEM_COLORS)[number];
export type TripSuggestionAction = (typeof TRIP_SUGGESTION_ACTIONS)[number];
export type TripPdfTemplate = (typeof TRIP_PDF_TEMPLATES)[number];
