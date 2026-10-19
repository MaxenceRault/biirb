"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

// Types de récit repliés de la colonne de l'accueil : la liste s'ouvre au-dessus du bouton, qui reste en dessous.
export function HomeArchetypeMore({
  children,
  moreLabel,
  fewerLabel,
  defaultOpen,
}: {
  children: ReactNode;
  moreLabel: string;
  fewerLabel: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();

  return (
    <>
      <div id={listId} hidden={!open}>
        {children}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={listId}
        className="flex items-center gap-1 rounded-lg px-3 py-2 text-left font-display text-label-md text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
      >
        <Icon name="chevronDown" className={`size-4 transition ${open ? "rotate-180" : ""}`} />
        {open ? fewerLabel : moreLabel}
      </button>
    </>
  );
}
