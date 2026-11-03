import Link from "next/link";
import type { ReactNode } from "react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { CreateTripLink } from "@/components/CreateTripLink";
import { HomeHero } from "@/components/HomeHero";
import { SectionDots } from "@/components/SectionDots";
import { StoryCarousel, type CarouselStory } from "@/components/StoryCarousel";
import { TrackEvent } from "@/components/TrackEvent";
import { Biirbou } from "@/components/ui/Biirbou";
import { buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { filterChipClassName } from "@/components/ui/FilterChip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { countryName, flagEmoji, placeHref } from "@/lib/country";
import { landingSections, type LandingAngle, type LandingSection } from "@/lib/landing";
import type { Archetype, TrendingDestination } from "@/lib/posts";
import { TRIP_MAX_DAYS, TRIP_MAX_DESTINATIONS } from "@/schemas/trip.schema";
import { TRIP_MAX_TRAVELERS } from "@/schemas/trip-share.schema";

// Offre du pass lue dans la configuration par la page (trip-pass.service) : jamais de prix écrit en dur.
export type LandingOffer = { available: boolean; priceEur: number | null; aiDailyLimit: number; aiDailyLimitPass: number };

// Ancres des blocs (points de navigation à droite).
const HERO_ID = "landing-hero";
const sectionId = (section: LandingSection) => `landing-section-${section}`;

// Tous les récits, filtres et recherche : page Explorer.
const EXPLORE_HREF = "/explore";
// Types les plus utilisés (liste déjà triée par le serveur) ; tous les autres sont sur la page Explorer.
const LANDING_ARCHETYPES = 10;

export async function LandingHero({ angle, photos }: { angle: LandingAngle | null; photos: { slug: string; photo_url: string }[] }) {
  const t = await getTranslations("Landing");
  const copy = angle ? `angles.${angle}` : "hero";

  return (
    <HomeHero id={HERO_ID} photos={photos} label={t("hero.label")}>
      <TrackEvent event="landing_viewed" data={{ angle: angle ?? "default" }} />
      <div className="flex max-w-5xl flex-col items-center gap-4 text-center text-surface">
        <p className="flex items-center gap-1.5 font-display text-label-lg text-surface/90">
          <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
          {t("hero.eyebrow")}
        </p>
        <h1 className="font-display text-display-lg-mobile text-balance md:text-display-lg">{t(`${copy}.title`)}</h1>
        <p className="max-w-2xl text-body-lg text-balance text-surface/90">{t(`${copy}.subtitle`)}</p>

        <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <CreateTripLink placement="hero" className={buttonClassName("md", "w-full gap-2 sm:w-auto")}>
            <Icon name="sparkles" className="size-4.5" />
            {t("cta.create")}
          </CreateTripLink>
          <Link href={EXPLORE_HREF} className={buttonClassName("md", "w-full gap-2 sm:w-auto", "inverse")}>
            <Icon name="book" className="size-4.5" />
            {t("cta.explore")}
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <p className="text-label-md text-surface/80">{t("hero.free")}</p>
          {/* L'import n'existe pas encore : annoncé, jamais cliquable. */}
          <p className="flex items-center gap-1.5 rounded-full border border-surface/25 bg-ink/30 px-3 py-1 text-label-sm text-surface/85 backdrop-blur-sm">
            <Icon name="clock" className="size-3.5 shrink-0" />
            {t("hero.importSoon")}
          </p>
        </div>
      </div>
    </HomeHero>
  );
}

// Sections de présentation, dans l'ordre de l'angle. Le flux complet des récits est sur la page Explorer.
export async function LandingSections({
  angle,
  destinations,
  archetypes,
  stories,
  offer,
}: {
  angle: LandingAngle | null;
  destinations: TrendingDestination[];
  archetypes: Archetype[];
  stories: CarouselStory[];
  offer: LandingOffer;
}) {
  const t = await getTranslations("Landing.dots");
  const order = landingSections(angle);
  const sections: Record<LandingSection, ReactNode> = {
    inspiration: <Inspiration destinations={destinations} archetypes={archetypes} stories={stories} />,
    planning: <Planning />,
    copilot: <Copilot />,
    pass: <PassOffer offer={offer} />,
    final: <FinalCall />,
  };

  return (
    <div className="mx-auto flex max-w-300 flex-col gap-16 px-4 md:gap-20 md:px-6">
      {order.map((section) => (
        // scroll-mt : sous la barre de navigation fixe quand un point de navigation y mène.
        <div key={section} id={sectionId(section)} className="scroll-mt-24">
          {sections[section]}
        </div>
      ))}
      <SectionDots
        label={t("label")}
        sections={[
          { id: HERO_ID, label: t("hero") },
          ...order.map((section) => ({ id: sectionId(section), label: t(section) })),
        ]}
      />
    </div>
  );
}

function SectionHeader({ id, eyebrow, title, text }: { id: string; eyebrow?: ReactNode; title: string; text?: string }) {
  return (
    <header className="mb-6 flex max-w-2xl flex-col gap-2 md:mb-8">
      {eyebrow && <p className="flex items-center gap-1.5 font-display text-label-lg text-accent">{eyebrow}</p>}
      <h2 id={id} className="font-display text-headline-xl-mobile text-balance text-ink md:text-headline-xl">
        {title}
      </h2>
      {text && <p className="text-body-lg text-ink-soft">{text}</p>}
    </header>
  );
}

function FeatureCard({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <Card className="flex flex-col gap-3 p-6 shadow-xs">
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon name={icon} className="size-5" />
      </span>
      <h3 className="font-display text-headline-sm text-ink">{title}</h3>
      <p className="text-body-md text-ink-soft">{text}</p>
    </Card>
  );
}

// Chips sur une ligne qui défile sur mobile (hauteur minimale), en plusieurs lignes sur grand écran.
const CHIP_ROW = "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden";

async function Inspiration({
  destinations,
  archetypes,
  stories,
}: {
  destinations: TrendingDestination[];
  archetypes: Archetype[];
  stories: CarouselStory[];
}) {
  const t = await getTranslations("Landing.inspiration");
  const locale = await getLocale();
  const hidden = archetypes.length - LANDING_ARCHETYPES;

  return (
    <section aria-labelledby="landing-inspiration">
      <SectionHeader id="landing-inspiration" eyebrow={t("eyebrow")} title={t("title")} text={t("text")} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-10">
        <div className="flex min-w-0 flex-col gap-6">
          {archetypes.length > 0 && (
            <nav aria-labelledby="landing-archetypes" className="flex flex-col gap-3">
              <h3 id="landing-archetypes" className="font-display text-label-lg text-ink">
                {t("archetypes")}
              </h3>
              <ul className={CHIP_ROW}>
                {archetypes.slice(0, LANDING_ARCHETYPES).map(({ slug, label }) => (
                  <li key={slug} className="shrink-0">
                    <Link href={`${EXPLORE_HREF}?archetype=${slug}`} className={filterChipClassName(false)}>
                      {label}
                    </Link>
                  </li>
                ))}
                {hidden > 0 && (
                  <li className="shrink-0">
                    <Link href={EXPLORE_HREF} className={filterChipClassName(false, "text-ink")}>
                      {t("allArchetypes", { count: hidden })}
                      <Icon name="arrowBack" className="size-3.5 rotate-180" />
                    </Link>
                  </li>
                )}
              </ul>
            </nav>
          )}

          {destinations.length > 0 && (
            <nav aria-labelledby="landing-destinations" className="flex flex-col gap-3">
              <h3 id="landing-destinations" className="font-display text-label-lg text-ink">
                {t("destinations")}
              </h3>
              <ul className={CHIP_ROW}>
                {destinations.map(({ countryCode, postCount }) => (
                  <li key={countryCode} className="shrink-0">
                    <Link href={placeHref({ country: countryCode })} className={filterChipClassName(false)}>
                      <span aria-hidden="true">{flagEmoji(countryCode)}</span>
                      {countryName(countryCode, locale)}
                      <span className="text-ink-soft/70">{t("postCount", { count: postCount })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {/* Grand écran : sous les filtres ; mobile : sous le carrousel. */}
          <div className="hidden lg:block">
            <Link href={EXPLORE_HREF} className={buttonClassName("md", "gap-2", "secondary")}>
              {t("explore")}
              <Icon name="arrowBack" className="size-4.5 rotate-180" />
            </Link>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="font-display text-label-lg text-ink">{t("recent")}</h3>
          <StoryCarousel stories={stories} />
          <div className="lg:hidden">
            <Link href={EXPLORE_HREF} className={buttonClassName("md", "w-full gap-2 sm:w-auto", "secondary")}>
              {t("explore")}
              <Icon name="arrowBack" className="size-4.5 rotate-180" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const PLANNING_STEPS = [
  { key: "where", icon: "calendar" },
  { key: "compose", icon: "sparkles" },
  { key: "adjust", icon: "edit" },
] as const satisfies readonly { key: string; icon: IconName }[];

async function Planning() {
  const t = await getTranslations("Landing.planning");
  const values = { destinations: TRIP_MAX_DESTINATIONS, months: Math.floor(TRIP_MAX_DAYS / 30), travelers: TRIP_MAX_TRAVELERS };

  return (
    <section aria-labelledby="landing-planning">
      <SectionHeader
        id="landing-planning"
        eyebrow={
          <>
            <Icon name="check" className="size-4" />
            {t("eyebrow")}
          </>
        }
        title={t("title")}
        text={t("text")}
      />
      <ol className="mb-8 grid gap-4 md:grid-cols-3">
        {PLANNING_STEPS.map(({ key, icon }, position) => (
          <li key={key} className="relative">
            <span aria-hidden="true" className="absolute top-5 right-6 font-display text-headline-xl text-line">
              {position + 1}
            </span>
            <FeatureCard icon={icon} title={t(`steps.${key}.title`)} text={t(`steps.${key}.text`, values)} />
          </li>
        ))}
      </ol>
      <CreateTripLink placement="planning" className={buttonClassName("md", "gap-2")}>
        <Icon name="sparkles" className="size-4.5" />
        {t("cta")}
      </CreateTripLink>
    </section>
  );
}

const COPILOT_FEATURES = [
  { key: "adapt", icon: "refresh" },
  { key: "now", icon: "myLocation" },
  { key: "edit", icon: "edit" },
  { key: "memory", icon: "bookmark" },
  { key: "group", icon: "group" },
  { key: "budget", icon: "category" },
] as const satisfies readonly { key: string; icon: IconName }[];

async function Copilot() {
  const t = await getTranslations("Landing.copilot");

  return (
    <section aria-labelledby="landing-copilot">
      <SectionHeader id="landing-copilot" eyebrow={t("eyebrow")} title={t("title")} text={t("text")} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <CopilotDemo />
        <ul className="grid gap-4 sm:grid-cols-2">
          {COPILOT_FEATURES.map(({ key, icon }) => (
            <li key={key} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Icon name={icon} className="size-4.5" />
              </span>
              <div className="flex flex-col gap-0.5">
                <h3 className="font-display text-label-lg text-ink">{t(`features.${key}.title`)}</h3>
                <p className="text-body-sm text-ink-soft">{t(`features.${key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {/* Honnêteté : aucune donnée en temps réel (météo, trafic, horaires) n'est lue par Biirbou. */}
      <p className="mt-6 flex items-start gap-2 text-body-sm text-ink-soft">
        <Icon name="info" className="mt-0.5 size-4 shrink-0" />
        {t("honest")}
      </p>
    </section>
  );
}

// Illustration d'un échange (texte d'exemple, rien de cliquable) : décrite par sa légende.
async function CopilotDemo() {
  const t = await getTranslations("Landing.copilot.demo");

  return (
    <figure className="flex flex-col gap-3">
      <Card aria-hidden="true" className="flex flex-col gap-4 p-5 shadow-sm">
        <div className="flex items-center gap-2 border-b border-line pb-3">
          <Biirbou className="size-8" />
          <span className="font-display text-label-lg text-ink">{t("name")}</span>
        </div>
        <p className="ml-auto max-w-[85%] rounded-lg rounded-br-none bg-ink px-3.5 py-2.5 text-body-sm text-surface">{t("question")}</p>
        <p className="max-w-[90%] rounded-lg rounded-bl-none bg-surface-muted px-3.5 py-2.5 text-body-sm text-ink">{t("answer")}</p>
        <div className="flex flex-col gap-3 rounded-lg border border-line p-3.5">
          <p className="flex items-center gap-2 font-display text-label-md text-ink">
            <Icon name="sparkles" className="size-4 text-accent" />
            {t("proposal")}
          </p>
          <div className="flex gap-2">
            <span className={buttonClassName("sm", "pointer-events-none")}>{t("accept")}</span>
            <span className={buttonClassName("sm", "pointer-events-none", "secondary")}>{t("refuse")}</span>
          </div>
        </div>
      </Card>
      <figcaption className="text-center text-label-sm text-ink-soft">{t("caption")}</figcaption>
    </figure>
  );
}

async function PassOffer({ offer }: { offer: LandingOffer }) {
  const t = await getTranslations("Landing.pass");
  const format = await getFormatter();
  const price = offer.available && offer.priceEur !== null ? format.number(offer.priceEur, { style: "currency", currency: "EUR" }) : null;
  const free = [
    ["stories", {}],
    ["generate", {}],
    ["share", { max: TRIP_MAX_TRAVELERS }],
    ["expenses", {}],
    ["ai", { count: offer.aiDailyLimit }],
  ] as const;
  const premium = [
    ["ai", { count: offer.aiDailyLimitPass }],
    ["travel", {}],
    ["day", {}],
    ["exports", {}],
  ] as const;

  return (
    <section aria-labelledby="landing-pass">
      <SectionHeader id="landing-pass" eyebrow={t("eyebrow")} title={t("title")} text={t("text")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6 shadow-xs">
          <div>
            <h3 className="font-display text-headline-sm text-ink">{t("free.title")}</h3>
            <p className="text-body-sm text-ink-soft">{t("free.subtitle")}</p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {free.map(([key, values]) => (
              <li key={key} className="flex gap-2 text-body-md text-ink">
                <Icon name="check" className="mt-0.5 size-4.5 shrink-0 text-ink-soft" />
                {t(`free.items.${key}`, values)}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-4 border-2 border-accent p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 className="flex items-center gap-2 font-display text-headline-sm text-ink">
              <Icon name="sparkles" className="size-5 text-accent" />
              {t("premium.title")}
            </h3>
            {price ? (
              <p className="flex items-baseline gap-1.5">
                <span className="font-display text-headline-xl-mobile text-ink">{price}</span>
                <span className="text-label-md text-ink-soft">{t("premium.perTrip")}</span>
              </p>
            ) : (
              <p className="font-display text-label-lg text-ink-soft">{t("premium.soon")}</p>
            )}
          </div>
          <ul className="flex flex-col gap-2.5">
            {premium.map(([key, values]) => (
              <li key={key} className="flex gap-2 text-body-md text-ink">
                <Icon name="check" className="mt-0.5 size-4.5 shrink-0 text-accent" />
                {t(`premium.items.${key}`, values)}
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2 rounded-lg bg-surface-muted p-4">
            {(["group", "once", "forever"] as const).map((key) => (
              <li key={key} className="flex items-center gap-2 font-display text-label-md text-ink">
                <Icon name={key === "group" ? "group" : key === "once" ? "check" : "clock"} className="size-4 shrink-0 text-accent" />
                {t(`premium.terms.${key}`)}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <CreateTripLink placement="pass" className={buttonClassName("md", "gap-2")}>
          <Icon name="sparkles" className="size-4.5" />
          {t("cta")}
        </CreateTripLink>
        <p className="text-body-sm text-ink-soft">{t("how")}</p>
      </div>
    </section>
  );
}

const FINAL_STEPS = [
  { key: "inspire", icon: "book" },
  { key: "prepare", icon: "calendar" },
  { key: "live", icon: "explore" },
] as const satisfies readonly { key: string; icon: IconName }[];

async function FinalCall() {
  const t = await getTranslations("Landing.final");

  return (
    <section aria-labelledby="landing-final" className="flex flex-col items-center gap-8 rounded-lg bg-ink px-5 py-12 text-center text-surface md:px-10">
      {/* La mascotte garde ses couleurs : posée sur un disque blanc, jamais directement sur le fond sombre. */}
      <span className="rounded-full bg-surface p-3">
        <Biirbou className="size-12" />
      </span>
      <h2 id="landing-final" className="max-w-2xl font-display text-headline-xl-mobile text-balance md:text-headline-xl">
        {t("title")}
      </h2>
      <ol className="grid w-full max-w-4xl gap-6 sm:grid-cols-3">
        {FINAL_STEPS.map(({ key, icon }) => (
          <li key={key} className="flex flex-col items-center gap-2">
            <Icon name={icon} className="size-6 text-accent" />
            <h3 className="font-display text-label-lg">{t(`steps.${key}.title`)}</h3>
            <p className="text-body-sm text-surface/80">{t(`steps.${key}.text`)}</p>
          </li>
        ))}
      </ol>
      <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
        <CreateTripLink placement="final" className={buttonClassName("md", "w-full gap-2 sm:w-auto")}>
          <Icon name="sparkles" className="size-4.5" />
          {t("cta")}
        </CreateTripLink>
        <Link href={EXPLORE_HREF} className={buttonClassName("md", "w-full sm:w-auto", "inverse")}>
          {t("explore")}
        </Link>
      </div>
    </section>
  );
}
