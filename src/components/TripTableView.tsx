"use client";

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useDismiss } from "@/client/hooks/useDismiss";
import { CATEGORY_ICONS, parseDay, tripDays, type ItemCategory, type Trip, type TripItem } from "@/components/TripPlanner";
import { TRIP_ITEM_COLORS, type TripItemColor } from "@/schemas/trip.schema";

// Classes écrites en entier : Tailwind ne génère que les classes présentes telles quelles dans le code.
export const CELL_COLORS: Record<TripItemColor, { fill: string; strong: string; swatch: string }> = {
  coral: { fill: "bg-cell-coral", strong: "border-cell-coral-strong", swatch: "bg-cell-coral-strong" },
  sky: { fill: "bg-cell-sky", strong: "border-cell-sky-strong", swatch: "bg-cell-sky-strong" },
  mint: { fill: "bg-cell-mint", strong: "border-cell-mint-strong", swatch: "bg-cell-mint-strong" },
  sun: { fill: "bg-cell-sun", strong: "border-cell-sun-strong", swatch: "bg-cell-sun-strong" },
  lavender: { fill: "bg-cell-lavender", strong: "border-cell-lavender-strong", swatch: "bg-cell-lavender-strong" },
  sand: { fill: "bg-cell-sand", strong: "border-cell-sand-strong", swatch: "bg-cell-sand-strong" },
  rose: { fill: "bg-cell-rose", strong: "border-cell-rose-strong", swatch: "bg-cell-rose-strong" },
  slate: { fill: "bg-cell-slate", strong: "border-cell-slate-strong", swatch: "bg-cell-slate-strong" },
};

// Couleur d'une case sans choix explicite : celle de sa catégorie (même règle dans src/server/tripPdf.ts).
export const CATEGORY_COLORS: Record<ItemCategory, TripItemColor> = {
  transport: "sky",
  lodging: "lavender",
  activity: "mint",
  food: "sun",
};

const FIRST_HOUR = 7;
const LAST_HOUR = 21;

// Grille jours × heures, en lecture seule : seule la couleur des cases se change (éditeurs).
export function TripTableView({
  trip,
  items,
  canEdit,
  onColor,
}: {
  trip: Trip;
  items: TripItem[];
  canEdit: boolean;
  onColor: (item: TripItem, color: TripItemColor | null) => Promise<boolean>;
}) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const days = tripDays(trip.start_date, trip.end_date);
  const hourOf = (item: TripItem) => Number(item.start_time.slice(0, 2));
  // Plage élargie si une activité commence plus tôt ou plus tard.
  const first = Math.min(FIRST_HOUR, ...items.map(hourOf));
  const last = Math.max(LAST_HOUR, ...items.map(hourOf));
  const hours = Array.from({ length: last - first + 1 }, (_, index) => first + index);

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-headline-sm text-ink">{t("table.title")}</h2>
        <p className="text-body-sm text-ink-soft">{canEdit ? t("table.hintEditor") : t("table.hint")}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{t("table.caption", { title: trip.title })}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-14 border-b border-line bg-surface-muted px-2 py-2">
                <span className="sr-only">{t("table.hour")}</span>
              </th>
              {days.map((day, index) => (
                <th key={day} scope="col" className="min-w-40 border-b border-l border-line bg-surface-muted px-3 py-2 align-bottom">
                  <span className="block font-display text-label-lg text-ink">{t("days.label", { number: index + 1 })}</span>
                  <span className="block text-label-sm font-normal text-ink-soft">
                    {format.dateTime(parseDay(day), { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-t border-line bg-surface px-2 py-2 align-top font-display text-label-sm font-normal text-ink-soft"
                >
                  {`${String(hour).padStart(2, "0")}:00`}
                </th>
                {days.map((day) => {
                  const cellItems = items.filter((item) => item.day === day && hourOf(item) === hour);
                  return (
                    <td key={day} className="h-12 border-t border-l border-line p-1 align-top">
                      <ul className="flex flex-col gap-1">
                        {cellItems.map((item) => (
                          <TableCell key={item.id} item={item} canEdit={canEdit} onColor={onColor} />
                        ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TableCell({
  item,
  canEdit,
  onColor,
}: {
  item: TripItem;
  canEdit: boolean;
  onColor: (item: TripItem, color: TripItemColor | null) => Promise<boolean>;
}) {
  const t = useTranslations("Planner");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const color = CELL_COLORS[item.color ?? CATEGORY_COLORS[item.category]];

  const content = (
    <>
      <span className="flex items-center gap-1 text-label-sm text-ink-soft">
        <Icon name={CATEGORY_ICONS[item.category]} className="size-3.5" />
        {item.start_time}
        {item.pinned && (
          <span title={t("item.pinnedHint")} className="ml-auto text-accent">
            <Icon name="lock" className="size-3.5" />
            <span className="sr-only">{t("item.pinned")}</span>
          </span>
        )}
      </span>
      <span className="block text-body-sm font-medium text-ink">{item.title}</span>
    </>
  );

  async function choose(value: TripItemColor | null) {
    if (await onColor(item, value)) setOpen(false);
  }

  return (
    <li ref={ref}>
      {/* Verrouillée : couleur figée aussi (le serveur la refuse, ITEM_LOCKED). */}
      {canEdit && !item.pinned ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={t("table.changeColor", { title: item.title })}
          className={`block w-full rounded-md border-l-4 px-2 py-1.5 text-left transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${color.fill} ${color.strong}`}
        >
          {content}
        </button>
      ) : (
        <div className={`rounded-md border-l-4 px-2 py-1.5 ${color.fill} ${color.strong}`}>{content}</div>
      )}

      {open && (
        <div
          role="group"
          aria-label={t("table.palette")}
          className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface p-2"
        >
          {TRIP_ITEM_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => void choose(value)}
              aria-label={t(`table.colors.${value}`)}
              aria-pressed={item.color === value}
              className={`size-6 rounded-full ring-offset-2 transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none aria-pressed:ring-2 aria-pressed:ring-ink ${CELL_COLORS[value].swatch}`}
            />
          ))}
          <button
            type="button"
            onClick={() => void choose(null)}
            className="rounded-lg px-2 py-1 text-label-sm text-ink-soft hover:bg-surface-muted hover:text-ink"
          >
            {t("table.reset")}
          </button>
        </div>
      )}
    </li>
  );
}
