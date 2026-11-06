"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch, clearSession } from "@/client/session";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { Icon } from "@/components/ui/Icon";
import { PasswordInput } from "@/components/ui/PasswordInput";

type Preview = { ownedShared: number; ownedAlone: number; memberOf: number };
const KNOWN_ERRORS = ["INVALID_CREDENTIALS", "ADMIN_ACCOUNT", "TOO_MANY_REQUESTS"];

// Suppression du compte par son titulaire (#112) : conséquences sur ses voyages d'abord, puis mot de passe.
export function DeleteAccountSection() {
  const t = useTranslations("Profile.deleteAccount");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function openDialog() {
    setError(null);
    setOpen(true);
    const result = await apiFetch<Preview>("/api/v1/users/me/deletion");
    if ("data" in result) setPreview(result.data);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await apiFetch("/api/v1/users/me", { method: "DELETE", body: { password } });
    setPending(false);
    if ("error" in result) return setError(KNOWN_ERRORS.includes(result.error) ? result.error : "generic");
    // Sessions supprimées avec le compte : le navigateur oublie le profil et les voyages gardés hors ligne.
    clearSession();
    router.replace("/");
  }

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="font-display text-headline-sm text-ink">{t("title")}</h2>
      <p className="text-body-sm text-ink-soft">{t("intro")}</p>
      <Button variant="secondary" size="sm" onClick={() => void openDialog()} className="gap-1.5 self-start text-error">
        <Icon name="delete" className="size-4" />
        {t("open")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("dialogTitle")} closeLabel={t("close")} description={t("dialogText")}>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2 text-body-sm text-ink">
            {preview ? (
              <>
                <li>{t("ownedShared", { count: preview.ownedShared })}</li>
                <li>{t("ownedAlone", { count: preview.ownedAlone })}</li>
                <li>{t("memberOf", { count: preview.memberOf })}</li>
              </>
            ) : null}
            <li>{t("stories")}</li>
            <li>{t("kept")}</li>
          </ul>
          <Field id="delete-password" label={t("password")}>
            <PasswordInput id="delete-password" name="password" autoComplete="current-password" maxLength={200} required />
          </Field>
          {error && <FormError>{t(`errors.${error}`)}</FormError>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={pending} autoFocus>
              {t("back")}
            </Button>
            <Button type="submit" size="sm" variant="danger" disabled={pending} className="gap-1.5">
              <Icon name="delete" className="size-4" />
              {pending ? t("deleting") : t("confirm")}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
