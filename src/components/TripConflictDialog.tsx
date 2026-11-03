"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { Trip, TripItem } from "@/components/TripPlanner";
import { parseDay } from "@/lib/tripDates";

// Modification refusée (412) : version enregistrée par un autre membre (relue) et modification de l'utilisateur.
export type TripConflict =
  | { kind: "item"; theirs: TripItem; mine: Record<string, unknown> }
  | { kind: "delete"; theirs: TripItem }
  | { kind: "trip"; theirs: Trip; mine: Record<string, unknown> };

// Champs du corps de PATCH /trips/{id} → colonne du voyage et libellé.
const TRIP_FIELDS = [
  { body: "title", column: "title", label: "trip.titleLabel" },
  { body: "budgetLodging", column: "budget_lodging", label: "budget.lodging" },
  { body: "budgetTransit", column: "budget_transit", label: "budget.transit" },
  { body: "budgetDining", column: "budget_dining", label: "budget.dining" },
  { body: "budgetActivities", column: "budget_activities", label: "budget.activities" },
  { body: "budgetTarget", column: "budget_target", label: "budget.target" },
] as const;

// Fermer sans choisir (Échap, fond, croix) garde la version enregistrée : rien n'est écrasé par erreur.
export function TripConflictDialog({
  conflict,
  days,
  onAnswer,
}: {
  conflict: TripConflict | null;
  days: string[];
  onAnswer: (keepMine: boolean) => void;
}) {
  const t = useTranslations("Planner");

  return (
    <Dialog
      open={conflict !== null}
      onClose={() => onAnswer(false)}
      closeLabel={t("conflict.keepTheirs")}
      title={t("conflict.title")}
      description={conflict && t(`conflict.description.${conflict.kind}`)}
    >
      {conflict && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Side label={t("conflict.theirs")}>
              {conflict.kind === "trip" ? (
                <TripFields trip={conflict.theirs} mine={conflict.mine} side="theirs" />
              ) : (
                <ItemSummary item={conflict.theirs} days={days} showColor={conflict.kind === "item" && "color" in conflict.mine} />
              )}
            </Side>
            <Side label={t("conflict.mine")} highlighted>
              {conflict.kind === "trip" ? (
                <TripFields trip={conflict.theirs} mine={conflict.mine} side="mine" />
              ) : conflict.kind === "delete" ? (
                <p className="text-body-sm text-error">{t("conflict.deleteMine")}</p>
              ) : (
                <ItemSummary item={mergeItem(conflict.theirs, conflict.mine)} days={days} showColor={"color" in conflict.mine} />
              )}
            </Side>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onAnswer(false)}>
              {t("conflict.keepTheirs")}
            </Button>
            <Button variant={conflict.kind === "delete" ? "danger" : "primary"} onClick={() => onAnswer(true)}>
              {t(conflict.kind === "delete" ? "conflict.deleteAnyway" : "conflict.keepMine")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Side({ label, highlighted = false, children }: { label: string; highlighted?: boolean; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-2 rounded-lg border p-3 ${highlighted ? "border-accent/40 bg-accent/5" : "border-line bg-surface-muted"}`}>
      <h3 className="font-display text-label-md text-ink-soft uppercase">{label}</h3>
      {children}
    </section>
  );
}

function ItemSummary({ item, days, showColor }: { item: TripItem; days: string[]; showColor: boolean }) {
  const t = useTranslations("Planner");
  const format = useFormatter();

  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-sm text-ink-soft">
        {t("days.dayTab", {
          number: days.indexOf(item.day) + 1,
          date: format.dateTime(parseDay(item.day), { day: "numeric", month: "short" }),
        })}{" "}
        · {item.start_time} · {t(`categories.${item.category}`)}
      </span>
      <span className="font-display text-label-lg text-ink">{item.title}</span>
      {item.description && <p className="text-body-sm text-ink-soft">{item.description}</p>}
      {showColor && (
        <span className="text-label-sm text-ink-soft">
          {t("conflict.color", { color: item.color ? t(`table.colors.${item.color}`) : t("table.reset") })}
        </span>
      )}
    </div>
  );
}

// Seuls les champs modifiés de part ou d'autre (tous si aucun ne diffère).
function TripFields({ trip, mine, side }: { trip: Trip; mine: Record<string, unknown>; side: "theirs" | "mine" }) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const sent = TRIP_FIELDS.filter((field) => field.body in mine);
  const differing = sent.filter((field) => mine[field.body] !== trip[field.column]);
  const value = (field: (typeof TRIP_FIELDS)[number]) => {
    const raw = side === "mine" ? mine[field.body] : trip[field.column];
    if (typeof raw === "number") return format.number(raw, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
    return typeof raw === "string" ? raw : "—";
  };

  return (
    <dl className="flex flex-col gap-1.5">
      {(differing.length > 0 ? differing : sent).map((field) => (
        <div key={field.body} className="flex flex-col">
          <dt className="text-label-sm text-ink-soft">{t(field.label)}</dt>
          <dd className="font-display text-label-lg text-ink">{value(field)}</dd>
        </div>
      ))}
    </dl>
  );
}

function mergeItem(item: TripItem, mine: Record<string, unknown>): TripItem {
  const text = (key: string) => (typeof mine[key] === "string" ? (mine[key] as string) : undefined);
  return {
    ...item,
    day: text("day") ?? item.day,
    start_time: text("startTime") ?? item.start_time,
    title: text("title") ?? item.title,
    description: "description" in mine ? text("description") || null : item.description,
    category: (text("category") as TripItem["category"] | undefined) ?? item.category,
    color: "color" in mine ? (mine.color as TripItem["color"]) : item.color,
  };
}
