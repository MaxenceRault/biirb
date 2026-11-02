"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon, type IconName } from "@/components/ui/Icon";

export type ConfirmOptions = {
  // Question courte (« Supprimer cette dépense ? »), puis ce qui va se passer.
  title: string;
  message?: string;
  // Verbe de l'action (« Supprimer », « Réimaginer ») : jamais un simple « OK ».
  confirmLabel: string;
  icon?: IconName;
  // Action destructive (suppression, retrait, bannissement) : rouge, et « Retour » a le focus.
  danger?: boolean;
};
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

// Mêmes teintes que Badge (accent / danger).
const TONES = { default: "bg-accent/10 text-accent", danger: "bg-error/10 text-error" } as const;

// Remplace window.confirm sur tout le site : une seule fenêtre (Dialog), ouverte par useConfirm() depuis n'importe quel composant client.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("ConfirmDialog");
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Confirm>((options) => {
    // Une demande encore ouverte est refusée : jamais deux actions confirmées par un seul clic.
    resolver.current?.(false);
    setRequest(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // Après showModal (effet du Dialog, enfant : exécuté avant) : action destructive → « Retour », sinon l'action.
  useEffect(() => {
    if (request) (request.danger ? cancelButton : confirmButton).current?.focus();
  }, [request]);

  // Échap, clic sur le fond, croix ou « Retour » : refusée.
  function answer(confirmed: boolean) {
    resolver.current?.(confirmed);
    resolver.current = null;
    setRequest(null);
  }

  const tone = request?.danger ? TONES.danger : TONES.default;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => answer(false)}
        closeLabel={t("cancel")}
        size="sm"
        title={
          <span className="flex items-center gap-3">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tone}`}>
              <Icon name={request?.icon ?? (request?.danger ? "delete" : "help")} className="size-5" />
            </span>
            {request?.title}
          </span>
        }
        description={request?.message}
      >
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelButton} variant="secondary" onClick={() => answer(false)}>
            {t("cancel")}
          </Button>
          <Button ref={confirmButton} variant={request?.danger ? "danger" : "primary"} onClick={() => answer(true)}>
            {request?.confirmLabel}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

// Promesse : true si l'utilisateur confirme. Dans un composant client sous ConfirmProvider (layout global).
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm : ConfirmProvider manquant");
  return confirm;
}
