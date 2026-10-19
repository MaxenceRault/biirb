import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { countryName, flagEmoji } from "@/lib/country";
import type { Archetype } from "@/lib/posts";

export type TripSummary = {
  // Identifiant public (UUID).
  id: string;
  title: string;
  destination_country_code: string;
  destination_city: string | null;
  start_date: string;
  end_date: string;
  archetype: Archetype;
  item_count: number;
  // Étapes de l'itinéraire (1 : destination seule).
  destination_count: number;
  // Voyage partagé avec l'utilisateur : son rôle et le propriétaire (absents hors du planificateur).
  role?: "owner" | "editor" | "viewer";
  owner_name?: string;
};

export function TripCard({ trip }: { trip: TripSummary }) {
  const t = useTranslations("Planner");
  const format = useFormatter();

  return (
    <Link
      href={`/planner/${trip.id}`}
      className="block h-full rounded-lg focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
    >
      <Card className="flex h-full flex-col gap-2 p-5 transition hover:border-ink-soft/30">
        <span className="flex items-center justify-between gap-2">
          <span className="font-display text-label-sm text-ink-soft uppercase">
            {flagEmoji(trip.destination_country_code)}{" "}
            {trip.destination_city ?? countryName(trip.destination_country_code, "fr")}
            {trip.destination_count > 1 && ` ${t("trip.moreStops", { count: trip.destination_count - 1 })}`}
          </span>
          {trip.role && trip.role !== "owner" && (
            <Badge tone="accent">
              <Icon name="share" className="size-3.5" />
              {t("share.sharedBy", { name: trip.owner_name ?? "" })}
            </Badge>
          )}
        </span>
        <span className="font-display text-headline-sm text-ink">{trip.title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <Icon name="calendar" className="size-4" />
            {format.dateTimeRange(new Date(trip.start_date), new Date(trip.end_date), {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon name="category" className="size-4" />
            {trip.archetype.label}
          </span>
          <span>{t("list.activities", { count: trip.item_count })}</span>
        </span>
      </Card>
    </Link>
  );
}
