// Installation de Biirb sur l'écran d'accueil (PWA, src/app/manifest.ts).
// Chrome, Edge, Android : le navigateur propose l'installation (beforeinstallprompt), rejouée au clic.
// Safari iOS n'a pas cette proposition : on explique le geste (Partager → « Sur l'écran d'accueil »).

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// prompt : installation possible en un clic ; ios : à faire à la main ; null : déjà installée ou navigateur non compatible.
export type InstallState = "prompt" | "ios" | null;

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Écouté dès le chargement du module (layout) : l'événement peut arriver avant l'affichage du bouton.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Pas de bandeau automatique du navigateur : l'installation est proposée par notre bouton.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    notify();
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// iPadOS se présente comme un Mac : on le reconnaît à son écran tactile.
function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallSnapshot(): InstallState {
  if (installed || isStandalone()) return null;
  if (deferred) return "prompt";
  return isIos() ? "ios" : null;
}

export function getInstallServerSnapshot(): InstallState {
  return null;
}

// Un événement ne sert qu'une fois : le navigateur en renverra un autre s'il propose de nouveau l'installation.
export async function promptInstall() {
  const event = deferred;
  if (!event) return;
  deferred = null;
  notify();
  await event.prompt();
  await event.userChoice.catch(() => null);
}
