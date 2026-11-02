"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
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

// Mention exigée par OpenRouteService et OpenStreetMap, et limites de l'estimation.
export function TravelCredit() {
  const t = useTranslations("Planner.travel");
  const link = (href: string) =>
    function Link(chunks: ReactNode) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
          {chunks}
        </a>
      );
    };
  return (
    <p className="text-label-sm text-ink-soft">
      {t.rich("credit", {
        ors: link("https://openrouteservice.org/"),
        osm: link("https://www.openstreetmap.org/copyright"),
      })}
    </p>
  );
}
