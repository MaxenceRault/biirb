import "server-only";
import { City, Country, State } from "country-state-city";

// Serveur uniquement : la librairie pèse ~17 Mo.

export type Place = {
  key: string;
  label: string; // ex. « Kyoto, Kyōto, Japon »
  country: string; // code ISO du pays
  state?: string; // code de la région
  city?: string;
};

type IndexedPlace = Place & { search: string };

const MAX_RESULTS = 8;
const EXCLUDED_COUNTRIES = new Set(["IL"]);

let index: IndexedPlace[] | null = null;

export function searchPlaces(query: string): Place[] {
  const search = normalize(query);
  const matches = getIndex().filter((place) => place.search.startsWith(search));

  // Nom exact d'abord, puis les plus courts ; les pays avant les villes.
  return matches
    .sort(
      (a, b) =>
        Number(b.search === search) - Number(a.search === search) ||
        a.search.length - b.search.length ||
        Number(Boolean(a.city)) - Number(Boolean(b.city)) ||
        a.label.localeCompare(b.label, "fr"),
    )
    .slice(0, MAX_RESULTS)
    .map(({ key, label, country, state, city }) => ({ key, label, country, state, city }));
}

// Une ville doit être dans la région indiquée, elle-même dans le pays.
export function placeExists({ country, state, city }: { country: string; state?: string; city?: string }) {
  if (EXCLUDED_COUNTRIES.has(country)) return false;
  if (!Country.getCountryByCode(country)) return false;
  if (!state) return !city;
  if (!State.getStateByCodeAndCountry(state, country)) return false;
  return !city || City.getCitiesOfState(country, state).some(({ name }) => name === city);
}

function getIndex() {
  if (index) return index;

  // La librairie n'a les noms qu'en anglais.
  const displayNames = new Intl.DisplayNames(["fr"], { type: "region" });
  const countryNames = new Map(
    Country.getAllCountries()
      .filter(({ isoCode }) => !EXCLUDED_COUNTRIES.has(isoCode))
      .map(({ isoCode, name }) => [isoCode, displayNames.of(isoCode) ?? name]),
  );
  const stateNames = new Map(
    State.getAllStates().map(({ countryCode, isoCode, name }) => [`${countryCode}-${isoCode}`, name]),
  );

  const countries = [...countryNames].map(([code, name]) => ({
    key: code,
    label: name,
    country: code,
    search: normalize(name),
  }));

  // Une région peut contenir deux villes du même nom.
  const seen = new Set<string>();
  const cities = City.getAllCities().flatMap(({ name, countryCode, stateCode }) => {
    if (EXCLUDED_COUNTRIES.has(countryCode)) return [];
    const key = `${countryCode}-${stateCode}-${name}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const label = [name, stateNames.get(`${countryCode}-${stateCode}`), countryNames.get(countryCode)]
      .filter(Boolean)
      .join(", ");
    return [{ key, label, country: countryCode, state: stateCode || undefined, city: name, search: normalize(name) }];
  });

  index = [...countries, ...cities];
  return index;
}

// « kyoto » trouve « Kyōto ».
function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

// Coordonnées d'un lieu (ville, sinon centre de la région, sinon du pays) : null si la librairie n'en a pas.
export function placeCoordinates({ country, state, city }: { country: string; state?: string | null; city?: string | null }) {
  const place =
    (state && city ? City.getCitiesOfState(country, state).find((option) => option.name === city) : undefined) ??
    (state ? State.getStateByCodeAndCountry(state, country) : undefined) ??
    Country.getCountryByCode(country);
  const latitude = Number(place?.latitude);
  const longitude = Number(place?.longitude);
  return place?.latitude && place.longitude && Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

// Ville d'un pays retrouvée par son nom (nom écrit par l'IA : accents, casse, suffixes « -shi » ignorés), sinon une région.
// null : lieu inconnu de la librairie (rien n'est placé sur la carte).
export function findPlaceCoordinates(country: string, names: string[]) {
  if (!Country.getCountryByCode(country)) return null;
  const wanted = new Set(names.map(placeKey).filter(Boolean));
  const city = City.getCitiesOfCountry(country)?.find((option) => wanted.has(placeKey(option.name)));
  const place = city ?? State.getStatesOfCountry(country).find((option) => wanted.has(placeKey(option.name)));
  const latitude = Number(place?.latitude);
  const longitude = Number(place?.longitude);
  return place?.latitude && place.longitude && Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function placeKey(name: string) {
  return normalize(name)
    .replace(/[-\s](shi|city|prefecture|province|region)$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export type CityMatch = { name: string; country: string; latitude: number; longitude: number };

// Noms de villes qui sont aussi des mots courants dans un planning en français (faux positifs).
const CITY_DENYLIST = new Set(["date", "sens", "tours", "orange", "marche", "plage", "port", "centre", "ville", "nord", "sud", "ouest", "parc", "musee", "temple", "gare", "chateau", "pont", "lac", "mont"]);
// Noms les plus courts écartés (« Ami », « Ise »…) : trop de faux positifs.
const CITY_MIN_LENGTH = 4;
const CITY_MAX_WORDS = 4;
const cityIndexes = new Map<string, Map<string, CityMatch>>();

// Villes d'un pays par nom normalisé (calculé une fois par pays). Un nom porté par plusieurs villes : la première.
function cityIndex(country: string) {
  let index = cityIndexes.get(country);
  if (index) return index;
  index = new Map();
  for (const city of City.getCitiesOfCountry(country) ?? []) {
    const key = cityKey(city.name);
    const latitude = Number(city.latitude);
    const longitude = Number(city.longitude);
    if (key.length < CITY_MIN_LENGTH || CITY_DENYLIST.has(key) || index.has(key) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    index.set(key, { name: city.name.replace(/-shi$/, ""), country, latitude, longitude });
  }
  cityIndexes.set(country, index);
  return index;
}

function cityKey(name: string) {
  return normalize(name)
    .replace(/-shi$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Villes de ces pays citées dans un texte, dans l'ordre. Seulement un nom écrit avec une majuscule (nom propre).
export function findCitiesInText(text: string, countries: string[]): CityMatch[] {
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0]);
  const indexes = countries.map(cityIndex);
  const found: CityMatch[] = [];
  for (let start = 0; start < words.length; start++) {
    if (words[start][0] === words[start][0].toLowerCase()) continue;
    for (let count = Math.min(CITY_MAX_WORDS, words.length - start); count >= 1; count--) {
      const key = cityKey(words.slice(start, start + count).join(" "));
      const city = indexes.map((index) => index.get(key)).find(Boolean);
      if (city) {
        found.push(city);
        start += count - 1;
        break;
      }
    }
  }
  return found;
}

export type PlaceNames = { city: string | null; state: string | null; country: string };

export function describePlace({ country, state, city }: { country: string; state?: string | null; city?: string | null }): PlaceNames {
  const countryName = new Intl.DisplayNames(["fr"], { type: "region" }).of(country) ?? country;
  const stateName = state ? (State.getStateByCodeAndCountry(state, country)?.name ?? null) : null;
  return { city: city ?? null, state: stateName, country: countryName };
}
