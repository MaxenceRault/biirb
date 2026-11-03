export type RoughPosition = { latitude: number; longitude: number };
export type GeolocationFailure = "unsupported" | "denied" | "unavailable";

// À appeler uniquement depuis un clic : le navigateur demande alors l'autorisation. Position arrondie (≈ 1 km) dès le
// navigateur, jamais gardée : renvoyée une fois à l'appelant, qui l'envoie avec sa question puis l'oublie.
export function getRoughPosition(): Promise<RoughPosition> {
  return new Promise((resolve, reject: (failure: GeolocationFailure) => void) => {
    if (!("geolocation" in navigator)) return reject("unsupported");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: round(coords.latitude), longitude: round(coords.longitude) }),
      (error) => reject(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      // Précision basse : plus rapide, moins de batterie, suffisant pour « près d'ici ».
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}

const round = (value: number) => Math.round(value * 100) / 100;
