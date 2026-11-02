// Événements de la mesure d'audience (Umami), émis par le navigateur ou par le serveur.
// Données : jamais d'email, de pseudo ni d'identifiant (récit, voyage, compte).
export type AnalyticsEvent =
  | "sign_up"
  | "story_viewed"
  | "story_created"
  | "trip_created"
  | "ai_generation_completed"
  | "companion_invited"
  | "trip_pass_checkout_started"
  | "trip_pass_purchased";

export type AnalyticsData = Record<string, string | number | boolean>;
