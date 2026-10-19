import Link from "next/link";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { FeedFilterLink } from "@/components/FeedFilterLink";
import { FeedList } from "@/components/FeedList";
import { HomeHero } from "@/components/HomeHero";
import { HomeShortcuts } from "@/components/HomeShortcuts";
import { HomeArchetypeNav, PlannerInvite, TrendingDestinations } from "@/components/HomeSidebar";
import { BackToTop } from "@/components/BackToTop";
import { NewPostButton } from "@/components/NewPostButton";
import { Card } from "@/components/ui/Card";
import { FEED_ANCHOR_ID, type Archetype, type FeedPage } from "@/lib/posts";
import { listActiveArchetypes } from "@/server/services/archetype.service";
import { getFeedPage, getHeroPhotos, getTrendingDestinations, searchPosts } from "@/server/services/post.service";
import { searchQuerySchema } from "@/schemas/post.schema";

type SearchParams = PageProps<"/">["searchParams"];

// Lus par le feed et par la colonne de gauche : une seule requête par affichage.
const getArchetypes = cache(listActiveArchetypes);

// undefined = tous les types (« Tendances ») ; null = résultats de recherche, aucun type actif.
async function resolveArchetype(searchParams: SearchParams, archetypes: Archetype[]): Promise<string | null | undefined> {
  const params = await searchParams;
  if (searchQuerySchema.safeParse(params.q).success) return null;
  // Un ?archetype= inconnu ou désactivé retombe sur le feed complet.
  return archetypes.find(({ slug }) => slug === params.archetype)?.slug;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const t = await getTranslations("Home");

  return (
    <>
      <Navbar />

      <main className="relative w-full flex-1 pt-24 pb-20">
        <Suspense fallback={<HeroSkeleton />}>
          <Hero searchParams={searchParams} />
        </Suspense>
        {/* Colonnes latérales sur grand écran : à droite dès lg, à gauche dès xl (types de récit + raccourcis). */}
        <div className="mx-auto max-w-190 px-4 md:px-6 lg:grid lg:max-w-300 lg:grid-cols-[minmax(0,1fr)_--spacing(72)] lg:items-start lg:gap-8 xl:grid-cols-[--spacing(52)_minmax(0,1fr)_--spacing(72)]">
          {/* Collante mais jamais plus haute que l'écran : la liste des types défile à l'intérieur. */}
          <aside className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto overscroll-contain p-1 -m-1 xl:flex">
            <Suspense fallback={<SidebarSkeleton />}>
              <LeftSidebar searchParams={searchParams} />
            </Suspense>
            <HomeShortcuts />
          </aside>

          {/* scroll-mt : sous la barre de navigation fixe quand un filtre ramène au début du feed. */}
          <div id={FEED_ANCHOR_ID} className="min-w-0 scroll-mt-24">
            <h1 className="sr-only">{t("title")}</h1>
            {/* Dépend de l'URL (?archetype=) : rendu à la requête. */}
            <Suspense fallback={<FeedSkeleton />}>
              <Feed searchParams={searchParams} />
            </Suspense>
          </div>

          <aside className="sticky top-24 hidden flex-col gap-4 lg:flex">
            <Suspense fallback={<SidebarSkeleton />}>
              <RightSidebar />
            </Suspense>
          </aside>
        </div>
      </main>

      {/* Boutons flottants empilés en bas à droite : jamais l'un sur l'autre. */}
      <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 md:right-6 md:bottom-6">
        <BackToTop />
        <NewPostButton />
      </div>

      <Footer />
    </>
  );
}

// Sur le feed seulement : pas sur les résultats de recherche.
async function Hero({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await connection();
  if (searchQuerySchema.safeParse((await searchParams).q).success) return null;

  const photos = await getHeroPhotos().catch(() => []);
  if (photos.length === 0) return null;
  return (
    <div className="mx-auto mb-8 max-w-300 px-4 md:px-6">
      <HomeHero photos={photos} />
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="mx-auto mb-8 max-w-300 px-4 md:px-6">
      <div className="h-64 animate-pulse rounded-lg bg-surface-muted md:h-96" />
    </div>
  );
}

async function LeftSidebar({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const archetypes = await getArchetypes().catch(() => []);
  return <HomeArchetypeNav archetypes={archetypes} active={await resolveArchetype(searchParams, archetypes)} />;
}

// Section secondaire : une panne n'empêche pas l'accueil de s'afficher, la section est simplement omise.
async function RightSidebar() {
  await connection();
  const destinations = await getTrendingDestinations().catch(() => []);

  return (
    <>
      <TrendingDestinations destinations={destinations} />
      <PlannerInvite />
    </>
  );
}

function SidebarSkeleton() {
  return <div className="h-64 animate-pulse rounded-lg bg-surface-muted" />;
}

async function Feed({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  // Dates relatives : rendu à chaque requête.
  await connection();
  const params = await searchParams;
  const query = searchQuerySchema.safeParse(params.q);
  if (query.success) return <SearchResults query={query.data} />;

  const t = await getTranslations("Home");

  let archetypes: Archetype[] = [];
  let archetype: string | undefined;
  let page: FeedPage | null;
  try {
    // Server Component = couche controller : appel direct au service.
    archetypes = await getArchetypes();
    archetype = (await resolveArchetype(searchParams, archetypes)) ?? undefined;
    page = await getFeedPage({ archetype });
  } catch {
    page = null;
  }
  const now = new Date();

  return (
    <>
      <ArchetypeTabs archetypes={archetypes} active={archetype} />

      {page === null && <p className="py-10 text-center text-body-md text-ink-soft">{t("error")}</p>}
      {page?.posts.length === 0 && <p className="py-10 text-center text-body-md text-ink-soft">{t("empty")}</p>}

      {/* key : un changement d'onglet repart d'une liste neuve. */}
      {page && page.posts.length > 0 && (
        <FeedList
          key={archetype ?? "all"}
          initialPosts={page.posts}
          initialCursor={page.nextCursor}
          archetype={archetype}
          now={now}
        />
      )}
    </>
  );
}

async function SearchResults({ query }: { query: string }) {
  const t = await getTranslations("Home");

  let posts: FeedPage["posts"] | null;
  try {
    posts = await searchPosts(query);
  } catch {
    posts = null;
  }

  return (
    <>
      <header className="mb-8 flex flex-col gap-2 border-b border-line pb-4">
        <h2 className="font-display text-headline-md text-ink">{t("searchTitle", { query })}</h2>
        <p className="flex flex-wrap items-center gap-3 text-body-md text-ink-soft">
          {posts && <span>{t("searchCount", { count: posts.length })}</span>}
          <Link href="/" className="font-display text-label-md text-ink-soft underline transition hover:text-ink">
            {t("searchClear")}
          </Link>
        </p>
      </header>

      {posts === null && <p className="py-10 text-center text-body-md text-ink-soft">{t("error")}</p>}
      {posts?.length === 0 && <p className="py-10 text-center text-body-md text-ink-soft">{t("searchEmpty")}</p>}
      {posts && posts.length > 0 && (
        <FeedList key={`search:${query}`} initialPosts={posts} initialCursor={null} now={new Date()} />
      )}
    </>
  );
}

async function ArchetypeTabs({ archetypes, active }: { archetypes: Archetype[]; active: string | undefined }) {
  const t = await getTranslations("Home");
  const tabs = [
    { key: "all", label: t("allArchetypes"), href: "/", isActive: active === undefined },
    ...archetypes.map(({ slug, label }) => ({
      key: slug,
      label,
      href: `/?archetype=${slug}`,
      isActive: active === slug,
    })),
  ];

  return (
    <nav aria-label={t("archetypesLabel")} className="mb-8 border-b border-line pb-3 xl:hidden">
      <ul className="flex items-center gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <FeedFilterLink
              href={tab.href}
              aria-current={tab.isActive ? "page" : undefined}
              className={`block rounded-lg border px-3.5 py-1.5 font-display text-label-md whitespace-nowrap transition ${
                tab.isActive
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-ink-soft hover:border-ink-soft/25 hover:text-ink"
              }`}
            >
              {tab.label}
            </FeedFilterLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function FeedSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-12 pt-14">
      {[0, 1].map((i) => (
        <Card key={i} className="h-150 animate-pulse p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-surface-muted" />
            <div className="h-4 w-40 rounded-lg bg-surface-muted" />
          </div>
          <div className="h-105 rounded-lg bg-surface-muted" />
        </Card>
      ))}
    </div>
  );
}
