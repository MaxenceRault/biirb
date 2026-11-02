import "server-only";
import { z } from "zod";

// Taux de référence de la BCE via Frankfurter : gratuit, sans clé. Appelé côté serveur uniquement.
const API = "https://api.frankfurter.dev/v1";
const TIMEOUT_MS = 5_000;
const CACHE_MS = 12 * 60 * 60 * 1000;

const responseSchema = z.object({ rates: z.record(z.string(), z.number().positive()) });
const cache = new Map<string, { rate: number; expiresAt: number }>();

// Unités de `to` pour 1 unité de `from`, au jour donné (dernier jour ouvré publié ; date future : dernier taux).
export async function getExchangeRate(from: string, to: string, date: string): Promise<number> {
  if (from === to) return 1;
  const today = new Date().toISOString().slice(0, 10);
  const day = date > today ? "latest" : date;
  const key = `${day}:${from}:${to}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rate;

  const response = await fetch(`${API}/${day}?from=${from}&to=${to}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Frankfurter ${response.status}`);
  const rate = responseSchema.parse(await response.json()).rates[to];
  if (!rate) throw new Error("Taux absent de la réponse");

  cache.set(key, { rate, expiresAt: Date.now() + CACHE_MS });
  return rate;
}

// Un jour passé ne change plus : gardé jusqu'au redémarrage (une table par jour de dépense, quelques Ko).
const euroTables = new Map<string, { rates: Record<string, number>; expiresAt: number }>();

// Table du jour donné en base euro : unités de chaque devise pour 1 €, toutes devises de la BCE en un seul appel.
// Une conversion A → B ce jour-là vaut table[B] / table[A], sans enregistrer de taux par dépense.
export async function getEuroRates(date: string): Promise<Record<string, number>> {
  const today = new Date().toISOString().slice(0, 10);
  const day = date >= today ? "latest" : date;
  const cached = euroTables.get(day);
  if (cached && cached.expiresAt > Date.now()) return cached.rates;

  const response = await fetch(`${API}/${day}?from=EUR`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Frankfurter ${response.status}`);
  const rates = { ...responseSchema.parse(await response.json()).rates, EUR: 1 };

  euroTables.set(day, { rates, expiresAt: day === "latest" ? Date.now() + CACHE_MS : Number.POSITIVE_INFINITY });
  return rates;
}
