"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { countryName, flagEmoji } from "@/lib/country";
import { localDay, parseDay, tripMoment } from "@/lib/tripDates";
import { apiFetch, getSessionSnapshot, subscribeSession } from "@/client/session";

type CurrentTrip = {
  status: "during" | "upcoming";
  trip: {
    id: string;
    title: string;
    destination_country_code: string;
    destination_city: string | null;
    start_date: string;
    end_date: string;
  };
  items: { id: number; start_time: string; title: string }[];
};

// Activités du jour affichées sur l'accueil : le reste est dans le voyage.
const MAX_ITEMS = 4;

// En tête de l'accueil et de « Mes voyages » (connectés) : le voyage en cours avec son programme du jour et Biirbou,
// sinon le prochain voyage. Rien sans voyage en cours ni à venir.
export function CurrentTripCard({ className = "" }: { className?: string }) {
  const t = useTranslations("CurrentTrip");
  const format = useFormatter();
  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot, () => null);
  const [current, setCurrent] = useState<CurrentTrip | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // Jour de l'appareil : en voyage, le jour local du voyageur. Une erreur laisse simplement l'accueil sans la carte.
    apiFetch<{ current: CurrentTrip | null }>(`/api/v1/trips/current?${new URLSearchParams({ day: localDay(new Date()) })}`).then((result) => {
      if (!cancelled) setCurrent("data" in result ? result.data.current : null);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session || !current) return null;

  const { trip, items, status } = current;
  const moment = tripMoment(trip, localDay(new Date()));
  const href = `/planner/${trip.id}`;

  return (
    <Card className={`flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between ${className}`}>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="flex items-center gap-1.5 font-display text-label-md text-accent uppercase">
          <Icon name="sparkles" className="size-4" />
          {moment.kind === "during" ? t("during", { day: moment.day, total: moment.total }) : t("upcoming", { days: moment.kind === "before" ? moment.days : 0 })}
        </p>
        <h2 className="font-display text-headline-sm text-ink">
          <Link href={href} className="hover:text-accent">
            {flagEmoji(trip.destination_country_code)} {trip.title}
          </Link>
        </h2>
        <p className="text-body-sm text-ink-soft">
          {trip.destination_city ?? countryName(trip.destination_country_code, "fr")} ·{" "}
          {format.dateTimeRange(parseDay(trip.start_date), parseDay(trip.end_date), { day: "numeric", month: "short" })}
        </p>

        {status === "during" && (
          <div className="mt-1 flex flex-col gap-1.5">
            <p className="font-display text-label-lg text-ink">{t("today")}</p>
            {items.length === 0 ? (
              <p className="text-body-sm text-ink-soft">{t("empty")}</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {items.slice(0, MAX_ITEMS).map((item) => (
                  <li key={item.id} className="flex gap-3 text-body-sm text-ink">
                    <span className="w-11 shrink-0 font-display text-label-lg">{item.start_time}</span>
                    <span className="min-w-0">{item.title}</span>
                  </li>
                ))}
                {items.length > MAX_ITEMS && (
                  <li className="text-label-sm text-ink-soft">{t("more", { count: items.length - MAX_ITEMS })}</li>
                )}
              </ol>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 md:flex-col md:items-stretch">
        <Link href={`${href}?copilot=${status === "during" ? "adapt" : "open"}`} className={buttonClassName("md", "gap-2")}>
          <Icon name="sparkles" className="size-5" />
          {t(status === "during" ? "adapt" : "prepare")}
        </Link>
        <Link href={href} className={buttonClassName("md", "gap-2", "secondary")}>
          <Icon name="calendar" className="size-5" />
          {t("open")}
        </Link>
      </div>
    </Card>
  );
}
