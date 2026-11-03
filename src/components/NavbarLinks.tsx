"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/Icon";

const LINKS: { href: string; label: "explore" | "plan"; icon: IconName }[] = [
  { href: "/explore", label: "explore", icon: "explore" },
  { href: "/planner", label: "plan", icon: "calendar" },
];

// Liens principaux : en ligne dans la Navbar (desktop) ou en liste dans le menu mobile.
export function NavbarLinks({ variant }: { variant: "inline" | "stacked" }) {
  const t = useTranslations("Navbar");
  const pathname = usePathname();

  return LINKS.map(({ href, label, icon }) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={
          variant === "inline"
            ? // Page active : texte foncé + trait corail sous le lien.
              `relative font-display text-label-lg transition after:absolute after:inset-x-0 after:-bottom-1.5 after:h-0.5 after:rounded-full after:transition ${
                active ? "text-ink after:bg-accent" : "text-ink-soft after:bg-transparent hover:text-ink hover:after:bg-line"
              }`
            : `flex h-12 items-center gap-3 rounded-lg px-3 font-display text-label-lg transition ${
                active ? "bg-surface-muted text-ink" : "text-ink-soft hover:bg-surface-muted hover:text-ink"
              }`
        }
      >
        {variant === "stacked" && <Icon name={icon} className="size-5" />}
        {t(label)}
      </Link>
    );
  });
}
