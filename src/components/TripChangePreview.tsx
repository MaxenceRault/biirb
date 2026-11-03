"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { CATEGORY_ICONS, type TripItem } from "@/components/TripPlanner";
import { parseDay } from "@/lib/tripDates";

// Proposition en attente, telle que la discussion la reçoit (target : activité visée, null pour un ajout).
export type PreviewSuggestion = Pick<TripItem, "day" | "start_time" | "title" | "category"> & {
  id: number;
  action: "add" | "update" | "delete";
  target: { id: number } | null;
};

type Change = "added" | "updated" | "moved" | "removed";
type Row = { key: string; start_time: string; title: string; category: TripItem["category"]; change: Change | null; pinned: boolean };
type PreviewDay = { day: string; before: Row[]; after: Row[] };

const byTime = (a: Row, b: Row) => a.start_time.localeCompare(b.start_time) || a.title.localeCompare(b.title);

// Planning des jours concernés, avant et après les propositions. Celles que le serveur refusera (activité disparue ou
// gardée depuis) ne changent rien ici non plus : comptées à part.
function previewDays(items: TripItem[], suggestions: PreviewSuggestion[]): { days: PreviewDay[]; skipped: number } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const changes = new Map<number, PreviewSuggestion>();
  const adds: PreviewSuggestion[] = [];
  let skipped = 0;
  for (const suggestion of suggestions) {
    if (suggestion.action === "add") {
      adds.push(suggestion);
      continue;
    }
    const item = suggestion.target && byId.get(suggestion.target.id);
    if (!item || item.pinned || changes.has(item.id)) skipped++;
    else changes.set(item.id, suggestion);
  }

  const moved = (item: TripItem, suggestion: PreviewSuggestion) =>
    suggestion.day !== item.day || suggestion.start_time !== item.start_time;
  const days = new Set(adds.map((suggestion) => suggestion.day));
  for (const [id, suggestion] of changes) {
    days.add(byId.get(id)!.day);
    if (suggestion.action === "update") days.add(suggestion.day);
  }

  const itemRow = (item: TripItem, change: Change | null): Row => ({ key: `i${item.id}`, ...item, change, pinned: item.pinned });
  const suggestionRow = (suggestion: PreviewSuggestion, change: Change): Row => ({ key: `s${suggestion.id}`, ...suggestion, change, pinned: false });

  return {
    skipped,
    days: [...days].sort().map((day) => {
      const dayItems = items.filter((item) => item.day === day);
      const before = dayItems.map((item) => {
        const suggestion = changes.get(item.id);
        if (!suggestion) return itemRow(item, null);
        return itemRow(item, suggestion.action === "delete" ? "removed" : moved(item, suggestion) ? "moved" : "updated");
      });
      const after = [
        ...dayItems.filter((item) => !changes.has(item.id)).map((item) => itemRow(item, null)),
        ...[...changes]
          .filter(([, suggestion]) => suggestion.action === "update" && suggestion.day === day)
          .map(([id, suggestion]) => suggestionRow(suggestion, moved(byId.get(id)!, suggestion) ? "moved" : "updated")),
        ...adds.filter((suggestion) => suggestion.day === day).map((suggestion) => suggestionRow(suggestion, "added")),
      ];
      return { day, before: before.sort(byTime), after: after.sort(byTime) };
    }),
  };
}

const CHANGE_TONES = { added: "accent", updated: "accent", moved: "neutral", removed: "danger" } as const;

// #12 : ce que deviendraient les journées si toutes les propositions en attente d'une réponse étaient acceptées.
export function TripChangePreview({
  open,
  onClose,
  items,
  days,
  suggestions,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  items: TripItem[];
  // Jours du voyage (numéro du jour).
  days: string[];
  suggestions: PreviewSuggestion[];
  // Absent : lecteur, aperçu seulement.
  onAccept?: () => void;
}) {
  const t = useTranslations("Planner.chat.preview");
  const format = useFormatter();
  const preview = previewDays(items, suggestions);

  const column = (label: string, rows: Row[]) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-label-sm font-semibold tracking-wide text-ink-soft uppercase">{label}</p>
      {rows.length === 0 ? (
        <p className="text-body-sm text-ink-soft italic">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.key}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-body-sm ${row.change ? "bg-surface-muted" : ""}`}
            >
              <span className="w-11 shrink-0 font-display text-label-md text-ink-soft tabular-nums">{row.start_time}</span>
              <Icon name={CATEGORY_ICONS[row.category]} className="size-4 shrink-0 text-ink-soft" />
              <span className={`min-w-0 flex-1 truncate ${row.change === "removed" ? "text-ink-soft line-through" : "text-ink"}`}>
                {row.title}
              </span>
              {row.pinned && (
                <span title={t("kept")} className="shrink-0 text-accent">
                  <Icon name="pushPin" className="size-4" />
                  <span className="sr-only">{t("kept")}</span>
                </span>
              )}
              {row.change && (
                <Badge tone={CHANGE_TONES[row.change]} className="shrink-0">
                  {t(`changes.${row.change}`)}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} title={t("title")} closeLabel={t("close")} size="lg" description={t("description")}>
      <div className="flex flex-col gap-5">
        {preview.days.map(({ day, before, after }) => (
          <section key={day} className="flex flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
            <h3 className="font-display text-label-lg text-ink">
              {t("day", { number: days.indexOf(day) + 1, date: format.dateTime(parseDay(day), { weekday: "long", day: "numeric", month: "long" }) })}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {column(t("before"), before)}
              {column(t("after"), after)}
            </div>
          </section>
        ))}
        {preview.skipped > 0 && (
          <p className="flex items-start gap-2 text-body-sm text-ink-soft">
            <Icon name="info" className="mt-0.5 size-4 shrink-0" />
            {t("skipped", { count: preview.skipped })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("back")}
        </Button>
        {onAccept && (
          <Button onClick={onAccept} className="gap-1.5">
            <Icon name="check" className="size-4" />
            {t("accept", { count: suggestions.length })}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
