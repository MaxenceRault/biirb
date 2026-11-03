import type { UserRole } from "@/lib/roles";

export type SessionUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed?: string | null;
  avatar_background_color?: string | null;
  role?: UserRole;
};

// Aucun token dans le stockage du navigateur (lisible par un script injecté) : l'access token vit en mémoire,
// le refresh token dans un cookie httpOnly posé par l'API. Seul le profil affiché (non secret) est stocké.
const USER_KEY = "brb_user";
// Anciennes versions : tokens stockés en clair, effacés au chargement.
const LEGACY_KEYS = ["brb_token", "brb_refresh"];
// Émis à chaque connexion / déconnexion (ex. mise à jour de la Navbar).
const SESSION_EVENT = "brb:session";

let accessToken: string | null = null;

if (typeof window !== "undefined") {
  for (const storage of [localStorage, sessionStorage]) LEGACY_KEYS.forEach((key) => storage.removeItem(key));
}

// Profil en sessionStorage sans « Se souvenir de moi » : oublié à la fermeture de l'onglet.
export function saveSession(token: string, user: SessionUser, remember: boolean) {
  allowOfflineCache(remember);
  // Un refresh garde le cache hors ligne ; un autre compte, ou une session sans « Se souvenir de moi », part d'un cache vide.
  if (!remember || parseSessionUser(getStoredUser())?.id !== user.id) clearOfflineCache();
  for (const storage of [localStorage, sessionStorage]) storage.removeItem(USER_KEY);
  accessToken = token;
  (remember ? localStorage : sessionStorage).setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function getStoredUser() {
  return localStorage.getItem(USER_KEY) ?? sessionStorage.getItem(USER_KEY);
}

export function clearSession() {
  accessToken = null;
  for (const storage of [localStorage, sessionStorage]) storage.removeItem(USER_KEY);
  allowOfflineCache(false);
  clearOfflineCache();
  window.dispatchEvent(new Event(SESSION_EVENT));
}

// Voyages et dépenses gardés pour le hors ligne (public/sw.js) : rien ne doit rester pour le compte suivant.
function clearOfflineCache() {
  if (!("caches" in window)) return;
  void caches.delete("brb-data");
  void caches.delete("brb-pages");
}

// Repère lu par public/sw.js : sans lui, pages et données ne sont ni gardées ni servies hors ligne.
function allowOfflineCache(allowed: boolean) {
  if (!("caches" in window)) return;
  void (allowed ? caches.open("brb-remembered") : caches.delete("brb-remembered"));
}

// Session gardée (false) tant que le serveur n'a pas révoqué le refresh token : pas de fausse déconnexion hors ligne.
export async function logout(): Promise<boolean> {
  // Avant la révocation (le désabonnement a besoin du token) ; un échec n'empêche pas la déconnexion.
  await import("@/client/push").then((push) => push.unsubscribeThisDevice()).catch(() => undefined);
  // Même verrou que le refresh (si le navigateur le gère) : un refresh en cours ne peut pas finir après la déconnexion.
  return navigator.locks
    ? navigator.locks.request("brb-refresh", revokeSession)
    : revokeSession();
}

async function revokeSession() {
  const response = await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
  if (!response?.ok) return false;
  clearSession();
  return true;
}

let pendingRefresh: Promise<string | null> | null = null;

async function getFreshToken(): Promise<string | null> {
  if (accessToken && !isExpired(accessToken)) return accessToken;
  return refreshAccessToken();
}

// Un seul refresh à la fois, même entre onglets : un refresh token envoyé deux fois coupe la session (vol supposé).
// Le verrou fait attendre l'autre onglet, qui enverra ensuite le nouveau cookie.
function refreshAccessToken(): Promise<string | null> {
  if (pendingRefresh) return pendingRefresh;

  const run = navigator.locks
    ? // Le verrou est tenu jusqu'à la fin du refresh ; then() aplatit la promesse renvoyée.
      navigator.locks.request("brb-refresh", () => runRefresh()).then((token) => token)
    : runRefresh();
  const pending = run.finally(() => {
    pendingRefresh = null;
  });
  pendingRefresh = pending;
  return pending;
}

async function runRefresh(): Promise<string | null> {
  // Visiteur jamais connecté : inutile d'appeler l'API.
  if (!getStoredUser()) return null;

  const remember = localStorage.getItem(USER_KEY) !== null;
  const result = await postAuth("/api/v1/auth/refresh");
  if ("error" in result) {
    // Hors ligne ou limite atteinte : on garde la session pour réessayer.
    if (result.error !== "INTERNAL_ERROR" && result.error !== "TOO_MANY_REQUESTS") clearSession();
    return null;
  }

  saveSession(result.token, result.user, remember);
  return result.token;
}

// Au premier abonnement, récupère un access token (perdu à chaque chargement de page) via le cookie.
export function subscribeSession(onChange: () => void) {
  void getFreshToken();
  // Déconnexion dans un autre onglet : le token en mémoire de celui-ci est oublié aussi.
  const onStorage = () => {
    if (!getStoredUser()) accessToken = null;
    onChange();
  };
  window.addEventListener(SESSION_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

// Affichage seulement (connecté ou non) : la session est vérifiée par l'API au premier appel.
export function getSessionSnapshot() {
  return getStoredUser();
}

export function parseSessionUser(snapshot: string | null): SessionUser | null {
  if (!snapshot) return null;
  try {
    return JSON.parse(snapshot) as SessionUser;
  } catch {
    return null;
  }
}

function isExpired(token: string) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload)) as { exp?: number };
    return typeof exp !== "number" || exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

const AUTH_ERRORS = [
  "INVALID_CREDENTIALS",
  "ACCOUNT_BANNED",
  "EMAIL_TAKEN",
  "INVALID_INPUT",
  "TOO_MANY_REQUESTS",
  "INTERNAL_ERROR",
] as const;

export function authErrorCode(code: string | undefined): (typeof AUTH_ERRORS)[number] {
  return AUTH_ERRORS.find((known) => known === code) ?? "INTERNAL_ERROR";
}

// Le cookie du refresh token est posé, envoyé et effacé par le navigateur (même origine).
export async function postAuth(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }).catch(() => null);

  const data = await response?.json().catch(() => null);
  if (!response?.ok || !data?.token) return { error: String(data?.error ?? "INTERNAL_ERROR") };
  return { token: data.token as string, user: data.user as SessionUser };
}

export function updateSessionUser(user: SessionUser) {
  const storage = localStorage.getItem(USER_KEY) ? localStorage : sessionStorage;
  storage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

// ?next= après connexion ou inscription : chemin interne uniquement (jamais « //autre-site.com »).
// Caractères de contrôle refusés : le parseur d'URL retire tabulations et retours à la ligne (« /\t/site.com » → « //site.com »).
export function nextPathAfterLogin(fallback = "/") {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !/^\/(?![/\\])/.test(next) || /\p{Cc}/u.test(next)) return fallback;
  return new URL(next, window.location.origin).origin === window.location.origin ? next : fallback;
}

export type ApiResult<T> = { data: T } | { error: string };

// Access token refusé (401) : renouvelé une fois, puis l'appel est rejoué.
// ifMatch : version lue de la ressource (verrouillage optimiste) ; le serveur répond 412 CONFLICT si elle est périmée.
type ApiInit = { method?: string; body?: unknown; ifMatch?: number };

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  const token = await getFreshToken();
  // Refresh impossible (hors ligne, serveur injoignable) : lecture sans token. Le serveur la refuse (401) ;
  // sans réseau, le service worker répond avec la dernière version en cache.
  if (!token && (init.method ?? "GET") === "GET" && getStoredUser()) {
    const cached = await readResponse<T>(await fetch(path).catch(() => null));
    if ("data" in cached) return cached;
  }
  if (!token) return { error: "UNAUTHORIZED" };

  let response = await sendWithToken(path, init, token);
  if (response?.status === 401) {
    const renewed = await refreshAccessToken();
    if (!renewed) return { error: "UNAUTHORIZED" };
    response = await sendWithToken(path, init, renewed);
    if (response?.status === 401) clearSession();
  }

  return readResponse<T>(response);
}

// Fichier généré par l'API (PDF, calendrier) : même authentification qu'apiFetch, corps lu en binaire.
export async function apiDownload(path: string): Promise<{ data: Blob } | { error: string }> {
  const token = await getFreshToken();
  if (!token) return { error: "UNAUTHORIZED" };

  let response = await sendWithToken(path, {}, token);
  if (response?.status === 401) {
    const renewed = await refreshAccessToken();
    if (!renewed) return { error: "UNAUTHORIZED" };
    response = await sendWithToken(path, {}, renewed);
    if (response?.status === 401) clearSession();
  }
  if (!response?.ok) {
    const data = await response?.json().catch(() => null);
    return { error: String(data?.error ?? "INTERNAL_ERROR") };
  }
  return { data: await response.blob() };
}

async function readResponse<T>(response: Response | null): Promise<ApiResult<T>> {
  const data = await response?.json().catch(() => null);
  if (!response?.ok) return { error: String(data?.error ?? "INTERNAL_ERROR") };
  return { data: data as T };
}

function sendWithToken(path: string, init: ApiInit, token: string) {
  const isMultipart = init.body instanceof FormData;
  return fetch(path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      // Multipart : le navigateur ajoute le Content-Type avec la frontière.
      ...(init.body === undefined || isMultipart ? {} : { "Content-Type": "application/json" }),
      ...(init.ifMatch === undefined ? {} : { "If-Match": `"${init.ifMatch}"` }),
    },
    body: init.body === undefined ? undefined : isMultipart ? (init.body as FormData) : JSON.stringify(init.body),
  }).catch(() => null);
}
