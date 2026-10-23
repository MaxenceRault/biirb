import type { TripDetail } from "@/components/TripPlanner";
import { exportFileName } from "@/lib/fileName";

type CsvLabels = { headers: string[]; category: (category: string) => string; dayLabel: (number: number) => string };

// Une ligne par activité. « ; » et BOM UTF-8 : ouverture directe dans Excel en français, accents compris.
export function buildTripCsv({ trip, items }: Pick<TripDetail, "trip" | "items">, days: string[], labels: CsvLabels) {
  // Injection CSV (OWASP) : une cellule commençant par = + - @, tabulation ou retour chariot serait évaluée comme formule par le tableur.
  const cell = (value: string) => `"${value.replace(/^[=+@\t\r-]/, "'$&").replaceAll('"', '""')}"`;
  const rows = items.map((item) =>
    [
      labels.dayLabel(days.indexOf(item.day) + 1),
      item.day,
      item.start_time,
      labels.category(item.category),
      item.title,
      item.description ?? "",
      item.source_post ? `${item.source_post.title} (/post/${item.source_post.slug})` : "",
    ]
      .map(cell)
      .join(";"),
  );
  return { name: `${exportFileName(trip.title)}.csv`, content: `﻿${[labels.headers.map(cell).join(";"), ...rows].join("\r\n")}` };
}

export function downloadFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
}
