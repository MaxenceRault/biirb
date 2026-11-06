"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { getInstallServerSnapshot, getInstallSnapshot, promptInstall, subscribeInstall } from "@/client/install";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

// « Installer l'app » (accueil) : rien d'affiché si elle est déjà installée ou si le navigateur ne sait pas l'installer.
export function InstallAppButton() {
  const t = useTranslations("Landing.install");
  const state = useSyncExternalStore(subscribeInstall, getInstallSnapshot, getInstallServerSnapshot);
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (!state) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        size="sm"
        variant="inverse"
        aria-expanded={state === "ios" ? showIosHelp : undefined}
        aria-controls={state === "ios" ? "install-ios-help" : undefined}
        onClick={() => (state === "prompt" ? void promptInstall() : setShowIosHelp((open) => !open))}
        className="gap-2"
      >
        <Icon name="download" className="size-4" />
        {t("button")}
      </Button>
      {state === "ios" && showIosHelp ? (
        <p id="install-ios-help" className="flex max-w-sm items-center gap-1.5 text-body-sm text-surface/85">
          <Icon name="share" className="size-4 shrink-0" />
          {t("ios")}
        </p>
      ) : (
        <p className="text-label-sm text-surface/70">{t("hint")}</p>
      )}
    </div>
  );
}
