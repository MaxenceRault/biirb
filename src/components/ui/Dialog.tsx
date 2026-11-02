"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";

const WIDTHS = { md: "w-[min(32rem,calc(100%-2rem))]", sm: "w-[min(26rem,calc(100%-2rem))]" } as const;

// Fenêtre modale : <dialog> natif (focus piégé, Échap, fond inerte). Fermée aussi par un clic sur le fond.
// Apparition en fondu (@starting-style) ; navigateur sans support ou mouvement réduit : affichée directement.
export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  size = "md",
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  // sm : fenêtre courte (confirmation).
  size?: keyof typeof WIDTHS;
  // Texte sous le titre, lu avec lui par les lecteurs d'écran (aria-describedby).
  description?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] ${WIDTHS[size]} overflow-y-auto rounded-lg bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/40 open:translate-y-0 open:opacity-100 starting:open:translate-y-2 starting:open:opacity-0 starting:open:backdrop:bg-ink/0 motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:backdrop:transition-[background-color] motion-safe:backdrop:duration-200`}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-headline-sm text-ink">
            {title}
          </h2>
          <IconButton icon="close" label={closeLabel} onClick={onClose} />
        </div>
        {description && (
          <p id={descriptionId} className="text-body-md whitespace-pre-line text-ink-soft">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
