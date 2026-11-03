// Événements de la mesure d'audience (Umami), émis par le navigateur ou par le serveur.
// Données : jamais d'email, de pseudo ni d'identifiant (récit, voyage, compte).
export type AnalyticsEvent =
  | "landing_viewed"
  | "create_trip_clicked"
  | "sign_up"
  | "story_viewed"
  | "story_created"
  | "trip_created"
  | "ai_generation_completed"
  | "companion_invited"
  | "trip_pass_viewed"
  | "trip_pass_checkout_started"
  | "trip_pass_purchased";

export type AnalyticsData = Record<string, string | number | boolean>;

// Clic mesuré par le script Umami lui-même (attributs data-umami-event) : aucun JavaScript de l'app, rien si le script est bloqué.
export function analyticsAttributes(event: AnalyticsEvent, data: Record<string, string> = {}) {
  return {
    "data-umami-event": event,
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [`data-umami-event-${key}`, value])),
  };
}
