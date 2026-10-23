"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Autocomplete, type Suggestion } from "@/components/ui/Autocomplete";
import { Card } from "@/components/ui/Card";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FormError } from "@/components/ui/FormError";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { Archetype } from "@/lib/posts";
import { usePlaceSearch, type Place } from "@/client/hooks/usePlaceSearch";

type TripContextBarProps = {
  idPrefix: string;
  archetypes: readonly Archetype[];
  maxDays?: number;
  disablePast?: boolean;
  // Planificateur : plusieurs étapes (champs cachés « destination », JSON).
  maxDestinations?: number;
  // Planificateur : nombre de voyageurs (champ « travelers »).
  maxTravelers?: number;
};

const CONTEXT_INPUT_CLASS_NAME =
  "w-full min-w-0 bg-transparent text-body-md font-medium text-ink placeholder:text-ink-soft/50 focus:outline-none";

// Partagée par l'éditeur de récit et le planificateur ; les champs partent avec le formulaire parent.
export function TripContextBar({ idPrefix, archetypes, maxDays, disablePast, maxDestinations, maxTravelers }: TripContextBarProps) {
  const t = useTranslations("TripContextBar");

  return (
    <Card className={`grid grid-cols-1 gap-2 p-2 ${maxTravelers ? "md:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)]" : "md:grid-cols-3"}`}>
      <ContextField icon="pin" label={t(maxDestinations ? "destinations" : "destination")} htmlFor={`${idPrefix}-destination`}>
        {maxDestinations ? (
          <DestinationsField id={`${idPrefix}-destination`} max={maxDestinations} />
        ) : (
          <DestinationField id={`${idPrefix}-destination`} />
        )}
      </ContextField>

      <ContextField icon="calendar" label={t("timeline")} htmlFor={`${idPrefix}-dates`}>
        <DateRangePicker
          id={`${idPrefix}-dates`}
          startName="startDate"
          endName="endDate"
          maxDays={maxDays}
          disablePast={disablePast}
        />
      </ContextField>

      <ContextField icon="category" label={t("archetype")} htmlFor={`${idPrefix}-archetype`}>
        <select
          id={`${idPrefix}-archetype`}
          name="archetype"
          defaultValue=""
          required
          className={`cursor-pointer ${CONTEXT_INPUT_CLASS_NAME}`}
        >
          <option value="" disabled>
            {t("archetypePlaceholder")}
          </option>
          {archetypes.map(({ slug, label }) => (
            <option key={slug} value={slug}>
              {label}
            </option>
          ))}
        </select>
      </ContextField>

      {maxTravelers && (
        <ContextField icon="group" label={t("travelers")} htmlFor={`${idPrefix}-travelers`}>
          <select id={`${idPrefix}-travelers`} name="travelers" defaultValue="1" required className={`cursor-pointer ${CONTEXT_INPUT_CLASS_NAME}`}>
            {Array.from({ length: maxTravelers }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {t("travelersCount", { count })}
              </option>
            ))}
          </select>
        </ContextField>
      )}
    </Card>
  );
}

// Seul un lieu choisi dans la liste est accepté (champs cachés pays / région / ville).
function DestinationField({ id }: { id: string }) {
  const t = useTranslations("TripContextBar");
  const input = useRef<HTMLInputElement>(null);
  const { query, places, error, changeQuery, reset } = usePlaceSearch();
  const [selected, setSelected] = useState<Place | null>(null);

  useEffect(() => {
    input.current?.setCustomValidity(query && !selected ? t("destinationPick") : "");
  }, [query, selected, t]);

  function handleSelect({ key }: Suggestion) {
    const place = places.find((option) => option.key === key);
    if (!place) return;
    setSelected(place);
    reset(place.label);
  }

  return (
    <>
      <Autocomplete
        ref={input}
        id={id}
        value={query}
        onValueChange={(value) => {
          changeQuery(value);
          setSelected(null);
        }}
        suggestions={places.map(({ key, label }) => ({ key, label }))}
        onSelect={handleSelect}
        placeholder={t("destinationPlaceholder")}
        required
        className={`truncate ${CONTEXT_INPUT_CLASS_NAME}`}
      />
      {selected && (
        <>
          <input type="hidden" name="destinationCountry" value={selected.country} />
          {selected.state && <input type="hidden" name="destinationState" value={selected.state} />}
          {selected.city && <input type="hidden" name="destinationCity" value={selected.city} />}
        </>
      )}
      {error && <FormError>{t("placesError")}</FormError>}
    </>
  );
}

// Étapes choisies une à une dans la liste (Biirbou en fait le parcours le plus logique) ; requis tant qu'aucune n'est choisie.
function DestinationsField({ id, max }: { id: string; max: number }) {
  const t = useTranslations("TripContextBar");
  const input = useRef<HTMLInputElement>(null);
  const { query, places, error, changeQuery, reset } = usePlaceSearch();
  const [selected, setSelected] = useState<Place[]>([]);
  const full = selected.length >= max;

  useEffect(() => {
    input.current?.setCustomValidity(query ? t("destinationPick") : "");
  }, [query, t]);

  function handleSelect({ key }: Suggestion) {
    const place = places.find((option) => option.key === key);
    if (!place) return;
    setSelected((current) => (current.some((option) => option.key === place.key) ? current : [...current, place].slice(0, max)));
    reset("");
  }

  return (
    <>
      {selected.length > 0 && (
        <ul aria-label={t("destinations")} className="flex flex-wrap items-center gap-1 py-1">
          {selected.map((place) => (
            <li key={place.key} className="flex items-center gap-1">
              <span className="flex items-center gap-1 rounded-full bg-surface py-0.5 pr-1 pl-2.5 text-label-md text-ink">
                {place.city ?? place.label}
                <button
                  type="button"
                  onClick={() => setSelected((current) => current.filter((option) => option.key !== place.key))}
                  aria-label={t("destinationRemove", { place: place.label })}
                  className="rounded-full p-0.5 text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              </span>
              <input
                type="hidden"
                name="destination"
                value={JSON.stringify({ country: place.country, state: place.state, city: place.city })}
              />
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <Autocomplete
          ref={input}
          id={id}
          value={query}
          onValueChange={changeQuery}
          suggestions={places.filter((place) => !selected.some((option) => option.key === place.key)).map(({ key, label }) => ({ key, label }))}
          onSelect={handleSelect}
          placeholder={t(selected.length > 0 ? "destinationAddPlaceholder" : "destinationPlaceholder")}
          required={selected.length === 0}
          className={`truncate ${CONTEXT_INPUT_CLASS_NAME}`}
        />
      )}
      {full && <span className="text-label-sm text-ink-soft">{t("destinationsFull", { max })}</span>}
      {error && <FormError>{t("placesError")}</FormError>}
    </>
  );
}

function ContextField({
  icon,
  label,
  htmlFor,
  children,
}: {
  icon: IconName;
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 transition focus-within:ring-2 focus-within:ring-accent/25">
      <Icon name={icon} className="size-5 text-ink-soft" />
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor={htmlFor} className="font-display text-label-sm text-ink-soft uppercase">
          {label}
        </label>
        {children}
      </div>
    </div>
  );
}
