import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CreateTripLink } from "@/components/CreateTripLink";
import { FeedFilterLink } from "@/components/FeedFilterLink";
import { HomeArchetypeMore } from "@/components/HomeArchetypeMore";
import { buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { countryName, flagEmoji, placeHref } from "@/lib/country";
import type { Archetype, TrendingDestination } from "@/lib/posts";

// Lien d'une colonne latérale de l'accueil (types de récit, raccourcis).
export function sidebarLinkClassName(isActive = false) {
  return `flex items-center gap-2.5 rounded-lg px-3 py-2 font-display text-label-lg transition ${
    isActive ? "bg-ink text-surface" : "text-ink-soft hover:bg-surface-muted hover:text-ink"
  }`;
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4 shadow-xs">
      <h2 className="px-1 font-display text-label-lg text-ink">{title}</h2>
      {children}
    </Card>
  );
}

// Colonne de gauche (grand écran) : remplace les pastilles horizontales du feed.
// active : undefined = « Tendances » ; null = aucun (résultats de recherche).
// Types les plus utilisés affichés (liste déjà triée par le serveur), les autres repliés.
const VISIBLE_ARCHETYPES = 8;

export function HomeArchetypeNav({ archetypes, active }: { archetypes: Archetype[]; active: string | null | undefined }) {
  const t = useTranslations("Home");
  const links = [
    { key: "all", label: t("allArchetypes"), href: "/explore", isActive: active === undefined },
    ...archetypes.map(({ slug, label }) => ({ key: slug, label, href: `/explore?archetype=${slug}`, isActive: active === slug })),
  ];
  const visible = links.slice(0, VISIBLE_ARCHETYPES + 1);
  const more = links.slice(VISIBLE_ARCHETYPES + 1);

  const renderLinks = (list: typeof links) => (
    <ul className="flex flex-col gap-1">
      {list.map((link) => (
        <li key={link.key}>
          <FeedFilterLink href={link.href} aria-current={link.isActive ? "page" : undefined} className={sidebarLinkClassName(link.isActive)}>
            {link.label}
          </FeedFilterLink>
        </li>
      ))}
    </ul>
  );

  return (
    <nav aria-label={t("archetypesLabel")} className="flex flex-col gap-1">
      {renderLinks(visible)}
      {more.length > 0 && (
        // Ouvert d'office si le type affiché est dans la partie repliée.
        <HomeArchetypeMore
          moreLabel={t("moreArchetypes", { count: more.length })}
          fewerLabel={t("fewerArchetypes")}
          defaultOpen={more.some((link) => link.isActive)}
        >
          {renderLinks(more)}
        </HomeArchetypeMore>
      )}
    </nav>
  );
}

export function TrendingDestinations({ destinations }: { destinations: TrendingDestination[] }) {
  const t = useTranslations("HomeSidebar");
  const locale = useLocale();
  if (destinations.length === 0) return null;

  return (
    <SidebarSection title={t("trendingTitle")}>
      <ol className="flex flex-col">
        {destinations.map(({ countryCode, postCount }) => (
          <li key={countryCode}>
            <Link
              href={placeHref({ country: countryCode })}
              className="flex items-center gap-3 rounded-lg px-1 py-2 transition hover:bg-surface-muted"
            >
              <span aria-hidden="true" className="text-headline-sm">
                {flagEmoji(countryCode)}
              </span>
              <span className="min-w-0 flex-1 truncate font-display text-label-lg text-ink">{countryName(countryCode, locale)}</span>
              <span className="text-label-sm text-ink-soft">{t("postCount", { count: postCount })}</span>
            </Link>
          </li>
        ))}
      </ol>
    </SidebarSection>
  );
}

export function PlannerInvite() {
  const t = useTranslations("HomeSidebar");

  return (
    <Card className="flex flex-col gap-3 p-4 shadow-xs">
      <Icon name="sparkles" className="size-6 text-accent" />
      <h2 className="font-display text-headline-sm text-ink">{t("plannerTitle")}</h2>
      <p className="text-body-md text-ink-soft">{t("plannerText")}</p>
      <CreateTripLink placement="sidebar" className={buttonClassName("sm", "w-full")}>
        {t("plannerCta")}
      </CreateTripLink>
    </Card>
  );
}
