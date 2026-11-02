import type { ComponentProps, ReactNode } from "react";

// Puce de filtre (types de récit de l'accueil, Kanban de l'admin) : active = fond ink, comme un onglet choisi.
// Exportée pour styler un <Link> (filtre par URL) comme une puce.
export function filterChipClassName(active: boolean, className = "") {
  return `inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 font-display text-label-md whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
    active ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink-soft hover:border-ink-soft/25 hover:text-ink"
  } ${className}`;
}

// Filtre dans la page (sans changer l'URL) : bouton à bascule.
export function FilterChip({ active, className = "", ...props }: ComponentProps<"button"> & { active: boolean }) {
  return <button type="button" aria-pressed={active} className={filterChipClassName(active, className)} {...props} />;
}

// Rangée de puces : défile horizontalement sur petit écran au lieu de passer à la ligne.
export function FilterBar({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`flex items-center gap-2 overflow-x-auto pb-1 ${className}`}>
      {children}
    </div>
  );
}
