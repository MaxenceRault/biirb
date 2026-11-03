"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import { useDismiss } from "@/client/hooks/useDismiss";
import { useLiveRefresh } from "@/client/hooks/useLiveRefresh";
import { apiFetch } from "@/client/session";
import { parseDay } from "@/lib/tripDates";
import type { NotificationKind } from "@/schemas/notification.schema";

type Notification = {
  id: number;
  kind: NotificationKind;
  detail: string | null;
  created_at: string;
  read: boolean;
  trip: { id: string; title: string };
  actor_name: string | null;
};

type NotificationList = { notifications: Notification[]; unread: number };

// Centre de notifications (Navbar, connecté) : changements faits par les autres membres de mes voyages.
export function NotificationBell() {
  const t = useTranslations("Notifications");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<NotificationList | null>(null);
  // Ouvert au clic ; un changement de page le ferme (comme le menu du compte).
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const close = useCallback(() => setOpenedOn(null), []);
  useDismiss(root, open, close);

  // Échec (hors ligne, serveur indisponible) : on garde la dernière liste, sans message.
  const load = useCallback(
    () =>
      apiFetch<NotificationList>("/api/v1/users/me/notifications").then((result) => {
        if ("data" in result) setList(result.data);
      }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  async function toggle() {
    if (open) return close();
    setOpenedOn(pathname);
    if (!list || list.unread === 0) return;
    // Vues = lues : la pastille disparaît, les nouvelles restent marquées dans la liste jusqu'au prochain chargement.
    setList({ ...list, unread: 0 });
    await apiFetch("/api/v1/users/me/notifications/read", { method: "POST" });
  }

  // Effacées tout de suite à l'écran ; en cas d'échec, la prochaine relecture les fait revenir.
  async function clear() {
    setList({ notifications: [], unread: 0 });
    await apiFetch("/api/v1/users/me/notifications", { method: "DELETE" });
  }

  function message(notification: Notification) {
    const detail =
      notification.kind === "day_regenerated" && notification.detail
        ? format.dateTime(parseDay(notification.detail), { weekday: "long", day: "numeric", month: "long" })
        : (notification.detail ?? "");
    return t(`kinds.${notification.kind}`, { actor: notification.actor_name ?? t("someone"), detail, trip: notification.trip.title });
  }

  const unread = list?.unread ?? 0;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={t("open", { count: unread })}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex size-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
      >
        <Icon name="notifications" className="size-5" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-label-sm leading-4.5 text-on-accent"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 w-80 max-w-[calc(100vw-2rem)] pt-1.5">
          <div className="rounded-lg border border-line bg-surface py-1.5 shadow-lg">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 pt-1 pb-2">
              <p className="font-display text-label-lg text-ink">{t("title")}</p>
              {list && list.notifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => void clear()}
                  className="rounded-lg px-1.5 py-0.5 text-label-md text-accent transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
                >
                  {t("clear")}
                </button>
              )}
            </div>
            {!list || list.notifications.length === 0 ? (
              <p className="px-3 py-4 text-body-sm text-ink-soft">{t("empty")}</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {list.notifications.map((notification) => (
                  <li key={notification.id}>
                    <Link
                      href={`/planner/${notification.trip.id}`}
                      onClick={close}
                      className="flex gap-2.5 px-3 py-2.5 transition hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.read ? "bg-transparent" : "bg-accent"}`}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        {!notification.read && <span className="sr-only">{t("unread")}</span>}
                        <span className="text-body-sm text-ink">{message(notification)}</span>
                        <span className="text-label-sm text-ink-soft">{format.relativeTime(new Date(notification.created_at), now)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
