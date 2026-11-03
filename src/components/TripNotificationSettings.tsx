"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormError } from "@/components/ui/FormError";
import { Icon } from "@/components/ui/Icon";
import { useDismiss } from "@/client/hooks/useDismiss";
import { isPushSupported, subscribeThisDevice } from "@/client/push";
import { apiFetch } from "@/client/session";

type Settings = { push: boolean; email: boolean; pushPublicKey: string | null; emailAvailable: boolean };
type Problem = "denied" | "unavailable" | "error";

// Notifications de ce voyage hors de l'app (navigateur, email) : choix du membre, décochées par défaut.
export function TripNotificationSettings({ tripId }: { tripId: string }) {
  const t = useTranslations("Planner.notify");
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  useDismiss(root, open, () => setOpen(false));
  const path = `/api/v1/trips/${tripId}/notification-settings`;

  async function toggle() {
    setOpen(!open);
    if (open || settings) return;
    const result = await apiFetch<Settings>(path);
    if ("data" in result) setSettings(result.data);
    else setProblem("error");
  }

  async function save(next: { push: boolean; email: boolean }) {
    if (!settings) return;
    setPending(true);
    setProblem(null);
    // Autorisation du navigateur demandée seulement quand le membre coche la case.
    if (next.push && !settings.push && settings.pushPublicKey) {
      const subscribed = await subscribeThisDevice(settings.pushPublicKey);
      if (subscribed !== "ok") {
        setProblem(subscribed);
        setPending(false);
        return;
      }
    }
    const result = await apiFetch<Settings>(path, { method: "PUT", body: next });
    if ("data" in result) setSettings(result.data);
    else setProblem("error");
    setPending(false);
  }

  const active = settings !== null && (settings.push || settings.email);
  const pushReady = settings?.pushPublicKey && isPushSupported();

  return (
    <div ref={root} className="relative">
      <Button variant="secondary" size="sm" onClick={() => void toggle()} aria-expanded={open} className="gap-1.5">
        <Icon name="notifications" className={`size-4 ${active ? "text-accent" : ""}`} />
        {t("open")}
      </Button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
          <div className="flex flex-col gap-0.5">
            <p className="font-display text-label-lg text-ink">{t("title")}</p>
            <p className="text-body-sm text-ink-soft">{t("intro")}</p>
          </div>

          {settings === null ? (
            !problem && <div className="h-16 animate-pulse rounded-lg bg-surface-muted" aria-hidden="true" />
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Checkbox
                  checked={settings.push}
                  disabled={pending || !pushReady}
                  onChange={(event) => void save({ push: event.currentTarget.checked, email: settings.email })}
                >
                  {t("push")}
                </Checkbox>
                <p className="pl-6.5 text-label-sm text-ink-soft">
                  {!settings.pushPublicKey ? t("pushOff") : !isPushSupported() ? t("pushUnsupported") : t("pushHint")}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Checkbox
                  checked={settings.email}
                  disabled={pending || !settings.emailAvailable}
                  onChange={(event) => void save({ push: settings.push, email: event.currentTarget.checked })}
                >
                  {t("email")}
                </Checkbox>
                <p className="pl-6.5 text-label-sm text-ink-soft">{settings.emailAvailable ? t("emailHint") : t("emailOff")}</p>
              </div>
            </>
          )}

          {problem && (
            <div role="alert">
              <FormError>{t(`problems.${problem}`)}</FormError>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
