"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import type { ItemWarning } from "@/lib/tripChecks";

// Alertes d'une activité du planning ou d'une proposition de Biirbou (doublon de lieu #104, même heure #25).
export function ItemWarnings({ warnings, days }: { warnings: ItemWarning[]; days: string[] }) {
  const t = useTranslations("Planner.checks");
  if (warnings.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {warnings.map((warning) => (
        <li key={`${warning.kind}-${warning.other.id}`} className="flex items-start gap-1.5 text-body-sm text-ink">
          <Icon name="warning" className="mt-0.5 size-4 shrink-0 text-accent" />
          {warning.kind === "sameTime"
            ? t("sameTime", { title: warning.other.title })
            : t(warning.exact ? "duplicate" : "maybeDuplicate", {
                title: warning.other.title,
                number: days.indexOf(warning.other.day) + 1,
                time: warning.other.start_time,
              })}
        </li>
      ))}
    </ul>
  );
}
