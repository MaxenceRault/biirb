"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { transportLinks } from "@/lib/transport";
import { routeBacktracks } from "@/lib/tripChecks";
import { parseDay } from "@/lib/tripDates";
import type { TripMapData } from "@/components/TripMap";

// Sites officiels des transporteurs et pass des pays du voyage : liste fixe (lib/transport.ts), jamais écrite par l'IA.
export function TransportLinksCard({ countries }: { countries: string[] }) {
  const t = useTranslations("Planner.transport");
  const links = transportLinks(countries);
  if (links.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="font-display text-headline-sm text-ink">{t("title")}</h2>
      <p className="text-body-sm text-ink-soft">{t("intro")}</p>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.key}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-body-sm font-medium text-accent hover:underline"
            >
              <Icon name={link.kind === "bus" ? "car" : "train"} className="size-4 shrink-0 text-ink-soft" />
              {link.name}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-label-sm text-ink-soft">{t("verify")}</p>
    </Card>
  );
}

// Parcours qui revient dans une ville quittée depuis au moins deux jours (hors excursion et retour final en boucle).
export function RouteWarnings({ map, lastDay }: { map: TripMapData; lastDay: string }) {
  const t = useTranslations("Planner.transport");
  const format = useFormatter();
  const backtracks = routeBacktracks(map.pins, lastDay);
  if (backtracks.length === 0) return null;
  const date = (day: string) => format.dateTime(parseDay(day), { day: "numeric", month: "short" });

  return (
    <ul className="flex flex-col gap-1.5 rounded-lg bg-surface-muted p-4">
      {backtracks.map((backtrack) => (
        <li key={`${backtrack.name}-${backtrack.backOn}`} className="flex items-start gap-1.5 text-body-sm text-ink">
          <Icon name="warning" className="mt-0.5 size-4 shrink-0 text-accent" />
          {t("backtrack", { name: backtrack.name, left: date(backtrack.leftOn), back: date(backtrack.backOn) })}
        </li>
      ))}
    </ul>
  );
}
