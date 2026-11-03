"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import { useDismiss } from "@/client/hooks/useDismiss";
import type { TravelDuration, TravelLeg } from "@/client/hooks/useDayTravel";

// Ligne entre deux activités du planning : à pied, et en voiture au-delà de 2 km (calculé par le serveur).
export function TravelLegRow({ leg, from, to }: { leg: TravelLeg; from: string; to: string }) {
  const t = useTranslations("Planner.travel");
  const duration = (value: TravelDuration) =>
    value.minutes < 60 ? t("minutes", { minutes: value.minutes }) : t("hours", { hours: Math.floor(value.minutes / 60), minutes: String(value.minutes % 60).padStart(2, "0") });
  if (!leg.walk && !leg.drive) return null;

  return (
    <li aria-label={t("label", { from, to })} className="flex items-center gap-3 pl-14 text-label-sm text-ink-soft sm:pl-16">
      <span aria-hidden="true" className="h-4 border-l border-dashed border-line" />
      {leg.walk && (
        <span className="flex items-center gap-1">
          <Icon name="walk" className="size-4" />
          <span className="sr-only">{t("walk")}</span>
          {duration(leg.walk)}
        </span>
      )}
      {leg.drive && (
        <span className="flex items-center gap-1">
          <Icon name="car" className="size-4" />
          <span className="sr-only">{t("drive")}</span>
          {duration(leg.drive)}
        </span>
      )}
    </li>
  );
}

// Limites de l'estimation, et sources exigées par les licences d'OpenRouteService et d'OpenStreetMap derrière ⓘ.
export function TravelCredit() {
  const t = useTranslations("Planner.travel");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sourcesId = useId();
  useDismiss(root, open, () => setOpen(false));
  const link = (href: string) =>
    function Link(chunks: ReactNode) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          {chunks}
        </a>
      );
    };

  return (
    <div ref={root} className="relative flex items-center gap-1 text-label-sm text-ink-soft">
      <span>{t("estimate")}</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={sourcesId}
        aria-label={t("sources")}
        title={t("sources")}
        onClick={() => setOpen((current) => !current)}
        className="rounded-full p-0.5 transition hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
      >
        <Icon name="info" className="size-4" />
      </button>
      {open && (
        <p id={sourcesId} className="absolute top-full left-0 z-10 mt-1 max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-ink shadow-lg">
          {t.rich("credit", {
            ors: link("https://openrouteservice.org/"),
            osm: link("https://www.openstreetmap.org/copyright"),
          })}
        </p>
      )}
    </div>
  );
}
