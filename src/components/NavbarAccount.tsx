"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/Avatar";
import { buttonClassName } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Icon } from "@/components/ui/Icon";
import { NotificationBell } from "@/components/NotificationBell";
import { useDismiss } from "@/client/hooks/useDismiss";
import {
  getSessionSnapshot,
  logout,
  parseSessionUser,
  subscribeSession,
  type SessionUser,
} from "@/client/session";

// Session dans le navigateur : inconnue côté serveur → emplacement réservé.
export function NavbarAccount() {
  const t = useTranslations("Navbar");
  const snapshot = useSyncExternalStore(subscribeSession, getSessionSnapshot, () => undefined);

  if (snapshot === undefined) {
    return <span aria-hidden="true" className="block h-9 w-28" />;
  }

  const user = parseSessionUser(snapshot);
  if (!user) {
    return (
      <Link href="/login" className={buttonClassName("sm")}>
        {t("login")}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <NotificationBell />
      <AccountMenu user={user} />
    </div>
  );
}

function AccountMenu({ user }: { user: SessionUser }) {
  const t = useTranslations("Navbar");
  const router = useRouter();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  // Ouvert au clic (indispensable au tactile) ; un changement de page le ferme.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const close = useCallback(() => setOpenedOn(null), []);
  const [logoutFailed, setLogoutFailed] = useState(false);
  useDismiss(root, open, close);

  async function handleLogout() {
    setLogoutFailed(false);
    if (!(await logout())) {
      setLogoutFailed(true);
      return;
    }
    close();
    router.push("/");
  }

  return (
    <div ref={root} className="group relative">
      <button
        type="button"
        onClick={() => setOpenedOn(open ? null : pathname)}
        aria-label={t("accountMenu")}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
      >
        <Avatar src={user.avatar_url} name={user.avatar_seed ?? user.id}
          backgroundColor={user.avatar_background_color} alt="" size={28} />
        <Icon name="chevronDown" className="size-4 text-ink-soft" />
      </button>

      {/* Survol en plus du clic, sur les écrans qui le permettent. */}
      <div
        className={`absolute top-full right-0 z-50 w-48 pt-1.5 ${open ? "block" : "hidden"} md:group-focus-within:block md:group-hover:block`}
      >
        <div className="rounded-lg border border-line bg-surface py-1.5 shadow-lg">
          <div className="mb-1 border-b border-line px-3 py-1.5">
            <p className="font-display text-label-lg text-ink">{user.display_name}</p>
            <p className="text-body-sm text-ink-soft/70">@{user.username}</p>
          </div>
          <Link href="/profile" className="flex items-center gap-2 px-3 py-2 text-body-md text-ink-soft transition hover:bg-canvas hover:text-ink">
            <Icon name="settings" className="size-4" />
            {t("settings")}
          </Link>
          <Link href="/support" className="flex items-center gap-2 px-3 py-2 text-body-md text-ink-soft transition hover:bg-canvas hover:text-ink">
            <Icon name="help" className="size-4" />
            {t("support")}
          </Link>
          {/* Affichage seulement : l'API vérifie le rôle en base. */}
          {user.role === "admin" && (
            <Link href="/admin" className="flex items-center gap-2 px-3 py-2 text-body-md text-ink-soft transition hover:bg-canvas hover:text-ink">
              <Icon name="shield" className="size-4" />
              {t("admin")}
            </Link>
          )}
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-md text-ink-soft transition hover:bg-canvas hover:text-ink"
            >
              <Icon name="logout" className="size-4" />
              {t("logout")}
            </button>
            {logoutFailed && (
              <div className="px-3 py-1.5">
                <FormError>{t("logoutFailed")}</FormError>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
