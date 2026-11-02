// Jours d'un voyage (AAAA-MM-JJ) en heure locale de l'appareil : planning, copilote, accueil.

// Midi local : la date ne glisse pas selon le fuseau horaire.
export function parseDay(day: string) {
  return new Date(`${day}T12:00:00`);
}

// Jour de l'appareil (AAAA-MM-JJ) : en voyage, le jour local du voyageur.
export function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Où en est le voyageur par rapport à son voyage (dates AAAA-MM-JJ : l'ordre des chaînes est chronologique).
export function tripMoment(trip: { start_date: string; end_date: string }, today: string) {
  const days = tripDays(trip.start_date, trip.end_date);
  if (today < trip.start_date) {
    return { kind: "before" as const, days: Math.round((parseDay(trip.start_date).getTime() - parseDay(today).getTime()) / 86_400_000) };
  }
  if (today > trip.end_date) return { kind: "after" as const };
  return { kind: "during" as const, day: days.indexOf(today) + 1, total: days.length };
}

export function tripDays(start: string, end: string) {
  const days: string[] = [];
  for (let date = parseDay(start); date <= parseDay(end); date.setDate(date.getDate() + 1)) {
    days.push(localDay(date));
  }
  return days;
}
