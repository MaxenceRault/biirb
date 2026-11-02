"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { FormError } from "@/components/ui/FormError";
import { Icon } from "@/components/ui/Icon";
import { trackEvent } from "@/client/analytics";
import { apiFetch } from "@/client/session";
import type { TripRole } from "@/components/TripSharePanel";

export type TripPass = { active: boolean; available: boolean; priceEur: number | null };

const BENEFITS = ["ai", "day", "exports"] as const;

// Pourquoi la fenêtre s'ouvre : une fonction du pass touchée, une limite atteinte, ou « info » (carte de la colonne).
export type TripPassFeature = "info" | "pdf" | "calendar" | "day" | "maps" | "ai" | "chat";

type OfferProps = { tripId: string; pass: TripPass; role: TripRole; onRefresh: () => Promise<boolean> };

function usePrice(pass: TripPass) {
  const format = useFormatter();
  return pass.priceEur === null ? null : format.number(pass.priceEur, { style: "currency", currency: "EUR" });
}

// Carte courte de la colonne de droite (voyage sans pass) : le détail et l'achat sont dans la fenêtre.
export function TripPassCard({ pass, onOpen }: { pass: TripPass; onOpen: () => void }) {
  const t = useTranslations("Planner");
  const price = usePrice(pass);
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
        <Icon name="sparkles" className="size-5 text-accent" />
        {t("pass.title")}
      </h2>
      <p className="text-body-sm text-ink-soft">{t("pass.teaser")}</p>
      <Button onClick={onOpen} className="gap-1.5">
        {price && pass.available ? t("pass.discoverPrice", { price }) : t("pass.discover")}
      </Button>
    </Card>
  );
}

// Fenêtre du pass : avantages, prix, puis achat sur Buy Me a Coffee.
export function TripPassDialog({ feature, onClose, ...props }: OfferProps & { feature: TripPassFeature | null; onClose: () => void }) {
  const t = useTranslations("Planner");

  // Pass activé après le paiement : la fenêtre se ferme.
  async function refreshAndClose() {
    const active = await props.onRefresh();
    if (active) onClose();
    return active;
  }

  return (
    <Dialog
      open={feature !== null}
      onClose={onClose}
      closeLabel={t("passDialog.close")}
      title={
        <span className="flex items-center gap-2">
          <Icon name="sparkles" className="size-5 text-accent" />
          {t("pass.title")}
        </span>
      }
    >
      {feature && feature !== "info" && (
        <p className="rounded-lg bg-surface-muted p-3 text-body-sm text-ink">{t(`passDialog.reasons.${feature}`)}</p>
      )}
      <p className="text-body-sm text-ink-soft">{t("pass.hint")}</p>
      {/* key : repart d'un formulaire vierge à chaque ouverture. */}
      {feature && <TripPassOffer key={feature} {...props} feature={feature} onRefresh={refreshAndClose} />}
    </Dialog>
  );
}

// Avantages + achat. Le pass est activé par le webhook Buy Me a Coffee, jamais par le navigateur.
function TripPassOffer({ tripId, pass, role, feature, onRefresh }: OfferProps & { feature: TripPassFeature }) {
  const t = useTranslations("Planner");
  const price = usePrice(pass);
  const [checkout, setCheckout] = useState<{ url: string; email: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [notYet, setNotYet] = useState(false);
  // CGV et renonciation au droit de rétractation : non pré-cochées, revérifiées par l'API.
  const [acceptSales, setAcceptSales] = useState(false);
  const [waiveWithdrawal, setWaiveWithdrawal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Onglet ouvert pendant le clic (sinon bloqué comme pop-up), puis dirigé vers Buy Me a Coffee une fois la commande enregistrée.
  async function pay() {
    setPending(true);
    setError(null);
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const result = await apiFetch<{ url: string; email: string | null }>(`/api/v1/trips/${tripId}/pass`, {
      method: "POST",
      body: { acceptSales, waiveWithdrawal },
    });
    setPending(false);
    if ("data" in result) {
      setCheckout(result.data);
      if (tab) tab.location.href = result.data.url;
      // source : ce qui a ouvert l'offre (fonction verrouillée, limite atteinte ou carte « info »).
      trackEvent("trip_pass_checkout_started", { source: feature });
      return;
    }
    tab?.close();
    setError(["PASS_ALREADY_ACTIVE", "PASS_UNAVAILABLE", "FORBIDDEN", "TOO_MANY_REQUESTS"].includes(result.error) ? result.error : "INTERNAL_ERROR");
  }

  async function refresh() {
    setPending(true);
    setNotYet(!(await onRefresh()));
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {BENEFITS.map((benefit) => (
          <li key={benefit} className="flex gap-2 text-body-sm text-ink">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-accent" />
            {t(`pass.benefits.${benefit}`)}
          </li>
        ))}
      </ul>

      {!pass.available || price === null ? (
        <div className="flex flex-col gap-2">
          <Button disabled>{t("pass.soon")}</Button>
          <p className="text-body-sm text-ink-soft">{t("pass.unavailable")}</p>
        </div>
      ) : role !== "owner" ? (
        <p className="text-body-sm text-ink-soft">{t("pass.ownerOnly")}</p>
      ) : checkout ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-lg bg-surface-muted p-3 text-body-sm text-ink">
            {checkout.email ? t("pass.paying", { email: checkout.email }) : t("pass.payingUnknown")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void refresh()} disabled={pending} className="gap-1.5">
              <Icon name="refresh" className="size-4" />
              {t("pass.refresh")}
            </Button>
            <a href={checkout.url} target="_blank" rel="noopener noreferrer" className={buttonClassName("md", "", "secondary")}>
              {t("pass.reopenPayment")}
            </a>
          </div>
          {notYet && <p className="text-body-sm text-ink-soft">{t("pass.notYet")}</p>}
          <p className="text-label-sm text-ink-soft">
            {t("pass.otherEmail", { id: tripId })}{" "}
            <Link href={`/support?${new URLSearchParams({ topic: "trip_pass", trip: tripId })}`} className="font-medium text-accent hover:underline">
              {t("pass.support")}
            </Link>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-ink">{t("pass.emailNotice")}</p>
          <Checkbox checked={acceptSales} onChange={(event) => setAcceptSales(event.currentTarget.checked)} className="items-start">
            {t.rich("pass.acceptSales", {
              sales: (chunks) => (
                <Link href="/legal/sales" target="_blank" className="font-medium text-accent hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </Checkbox>
          <Checkbox checked={waiveWithdrawal} onChange={(event) => setWaiveWithdrawal(event.currentTarget.checked)} className="items-start">
            {t("pass.waiveWithdrawal")}
          </Checkbox>
          <Button onClick={() => void pay()} disabled={pending || !acceptSales || !waiveWithdrawal} className="gap-1.5">
            {pending ? t("pass.opening") : t("pass.pay", { price })}
          </Button>
        </div>
      )}

      {error && <FormError>{t(`errors.${error as "INTERNAL_ERROR"}`)}</FormError>}
    </div>
  );
}
