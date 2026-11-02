"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FilterBar, FilterChip } from "@/components/ui/FilterChip";
import { FormError } from "@/components/ui/FormError";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { getRoughPosition, type GeolocationFailure, type RoughPosition } from "@/client/geolocation";
import { TRIP_ENERGY_LEVELS, TRIP_PLACE_MAX, type TripEnergyLevel, type TripMessageContext } from "@/schemas/trip.schema";

const ENERGY_ICONS: Record<TripEnergyLevel, IconName> = { tired: "bedtime", motivated: "bolt", relaxed: "spa" };

// « Que faire maintenant ? » : énergie, puis position GPS ou lieu écrit (l'un ou l'autre, tout est facultatif).
// Rien n'est gardé après l'envoi : la position ne sert qu'à cette question.
export function WhatNowDialog({
  open,
  dayNumber,
  onClose,
  onAsk,
}: {
  open: boolean;
  dayNumber: number;
  onClose: () => void;
  onAsk: (context: TripMessageContext) => void;
}) {
  const t = useTranslations("Planner.whatNow");
  const [energy, setEnergy] = useState<TripEnergyLevel | null>(null);
  const [position, setPosition] = useState<RoughPosition | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<GeolocationFailure | null>(null);
  const [place, setPlace] = useState("");

  function reset() {
    setEnergy(null);
    setPosition(null);
    setLocating(false);
    setGeoError(null);
    setPlace("");
  }

  function close() {
    reset();
    onClose();
  }

  // Demandée seulement ici, au clic : c'est ce clic qui déclenche l'autorisation du navigateur.
  async function locate() {
    setLocating(true);
    setGeoError(null);
    try {
      setPosition(await getRoughPosition());
      setPlace("");
    } catch (failure) {
      setGeoError(failure as GeolocationFailure);
    }
    setLocating(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = place.trim();
    onAsk({
      ...(energy && { energy }),
      ...(position ? { position } : typed.length >= 2 ? { place: typed } : {}),
    });
    reset();
  }

  return (
    <Dialog open={open} onClose={close} title={t("title")} closeLabel={t("cancel")} description={t("description", { number: dayNumber })}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="font-display text-label-md text-ink">{t("energy.label")}</p>
          <FilterBar label={t("energy.label")}>
            {TRIP_ENERGY_LEVELS.map((level) => (
              <FilterChip key={level} active={energy === level} onClick={() => setEnergy((current) => (current === level ? null : level))}>
                <Icon name={ENERGY_ICONS[level]} className="size-4" />
                {t(`energy.${level}`)}
              </FilterChip>
            ))}
          </FilterBar>
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-display text-label-md text-ink">{t("where.label")}</p>
          {position ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-accent/10 px-3 py-2 text-body-sm text-ink">
              <span className="flex items-center gap-2">
                <Icon name="myLocation" className="size-4.5 text-accent" />
                {t("where.located")}
              </span>
              <button type="button" onClick={() => setPosition(null)} className="text-label-md text-accent hover:underline">
                {t("where.forget")}
              </button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => void locate()} disabled={locating} className="gap-2 self-start">
              <Icon name="myLocation" className="size-4.5" />
              {t(locating ? "where.locating" : "where.locate")}
            </Button>
          )}
          {geoError && <FormError>{t(`where.errors.${geoError}`)}</FormError>}

          <Field id="what-now-place" label={t("where.placeLabel")}>
            <Input
              id="what-now-place"
              value={place}
              onChange={(event) => {
                setPlace(event.currentTarget.value);
                // L'un ou l'autre : écrire un lieu remplace la position.
                if (event.currentTarget.value) setPosition(null);
              }}
              minLength={2}
              maxLength={TRIP_PLACE_MAX}
              placeholder={t("where.placeholder")}
              autoComplete="off"
            />
          </Field>
          <p className="text-label-sm text-ink-soft">{t("where.privacy")}</p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={close}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={locating} className="gap-2">
            <Icon name="sparkles" className="size-4.5" />
            {t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
