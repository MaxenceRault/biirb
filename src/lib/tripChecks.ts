// Contrôles du planning calculés sans IA, dans le navigateur (hors ligne compris) : doublons de lieux (#104) et
// activités à la même heure (#25). Ce ne sont que des alertes : rien n'est jamais supprimé ni déplacé automatiquement.

type PlannedItem = { id: number; day: string; start_time: string; title: string; category: string; place_name: string | null };
export type ItemCandidate = Omit<PlannedItem, "id">;

// exact : même lieu (nom identique une fois normalisé) ; sinon lieu très proche, doublon seulement possible.
export type ItemWarning = { kind: "duplicate"; other: PlannedItem; exact: boolean } | { kind: "sameTime"; other: PlannedItem };

// Mots qui ne désignent pas un lieu : « Visite du Louvre » et « Le Louvre » sont le même endroit.
const STOP_WORDS = new Set(
  "a au aux avec chez d de des du en et l la le les un une sur pour par vers the of at visite visiter decouverte decouvrir balade promenade tour arret pause matinee apres midi soir soiree".split(
    " ",
  ),
);

function placeTokens(item: Pick<PlannedItem, "title" | "place_name">) {
  return (item.place_name ?? item.title)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

// Repas et nuits se répètent normalement (« Dîner », « Hôtel ») : un restaurant compte seulement s'il est nommé.
function comparable(item: ItemCandidate) {
  return item.category === "activity" || (item.category === "food" && item.place_name !== null);
}

function similarity(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return { exact: false, close: false };
  const shared = [...left].filter((word) => right.has(word)).length;
  const exact = shared === left.size && shared === right.size;
  // Deux mots communs au moins : « Musée » seul ne fait pas un doublon.
  const close = shared >= 2 && shared / new Set([...left, ...right]).size >= 0.6;
  return { exact, close };
}

// Alertes d'une activité (existante ou proposée par Biirbou) face au reste du planning ; ignoreId : l'activité elle-même.
export function itemWarnings(candidate: ItemCandidate, items: PlannedItem[], ignoreId?: number): ItemWarning[] {
  const warnings: ItemWarning[] = [];
  const tokens = comparable(candidate) ? placeTokens(candidate) : [];
  for (const other of items) {
    if (other.id === ignoreId) continue;
    if (other.day === candidate.day && other.start_time === candidate.start_time && other.category !== "lodging" && candidate.category !== "lodging") {
      warnings.push({ kind: "sameTime", other });
    }
    if (tokens.length === 0 || !comparable(other)) continue;
    const { exact, close } = similarity(tokens, placeTokens(other));
    if (exact || close) warnings.push({ kind: "duplicate", other, exact });
  }
  return warnings;
}

// Retour dans une ville déjà quittée après au moins deux jours ailleurs. Une excursion à la journée (un seul
// jour ailleurs) n'en est pas un, ni le retour final à la ville d'arrivée pour repartir (tour en boucle).
export type RouteBacktrack = { name: string; leftOn: string; backOn: string };

type MapPin = { name: string; stays: { start: string; end: string }[] };

const DAY = 24 * 60 * 60 * 1000;

export function routeBacktracks(pins: MapPin[], lastDay: string): RouteBacktrack[] {
  const start = (pin: MapPin) => pin.stays.reduce((min, stay) => (stay.start < min ? stay.start : min), pin.stays[0]?.start ?? "");
  const firstPin = pins.reduce<MapPin | null>((first, pin) => (!first || start(pin) < start(first) ? pin : first), null);
  return pins.flatMap((pin) => {
    const stays = [...pin.stays].sort((a, b) => a.start.localeCompare(b.start));
    return stays.slice(1).flatMap((stay, index) => {
      const previous = stays[index];
      const daysAway = Math.round((Date.parse(stay.start) - Date.parse(previous.end)) / DAY) - 1;
      const finalLoop = pin === firstPin && index === stays.length - 2 && stay.end === lastDay;
      return daysAway >= 2 && !finalLoop ? [{ name: pin.name, leftOn: previous.end, backOn: stay.start }] : [];
    });
  });
}
