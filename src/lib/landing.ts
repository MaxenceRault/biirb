// Angles des pages d'arrivée (publicités Instagram, Facebook, TikTok) : /?angle=<angle>.
// Un angle ne change que l'accroche du bandeau et la section mise en avant juste après : mêmes composants, aucun doublon.
// organized (« ton voyage est déjà organisé ? ») repose sur l'import d'un itinéraire, pas encore disponible :
// il n'est pas activé tant que l'import n'existe pas (l'adresse retombe sur l'accueil normal).
export const LANDING_ANGLES = ["change", "group"] as const;
export type LandingAngle = (typeof LANDING_ANGLES)[number];

export type LandingSection = "inspiration" | "planning" | "copilot" | "pass" | "final";

const DEFAULT_ORDER: LandingSection[] = ["inspiration", "planning", "copilot", "pass", "final"];

const FOCUS: Record<LandingAngle, LandingSection> = {
  change: "copilot",
  group: "pass",
};

// Section de l'angle remontée juste après le bandeau, le reste dans l'ordre habituel.
export function landingSections(angle: LandingAngle | null): LandingSection[] {
  if (!angle) return DEFAULT_ORDER;
  return [FOCUS[angle], ...DEFAULT_ORDER.filter((section) => section !== FOCUS[angle])];
}
