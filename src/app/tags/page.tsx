import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { StoryCard, StoryGrid } from "@/components/StoryCard";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { flagEmoji } from "@/lib/country";
import { getPostsByPlace, type PlacePosts } from "@/server/services/post.service";
import { placeSchema } from "@/schemas/post.schema";

type SearchParams = PageProps<"/tags">["searchParams"];

// /tags?country=FR[&state=IDF&city=Montesson]. Lieu invalide ou inconnu → 404.
const getPlacePosts = cache(async (params: Awaited<SearchParams>): Promise<(PlacePosts & { countryCode: string }) | null> => {
  const place = placeSchema.safeParse(params);
  if (!place.success) return null;

  const result = await getPostsByPlace(place.data);
  return result && { ...result, countryCode: place.data.country };
});

export async function generateMetadata({ searchParams }: PageProps<"/tags">): Promise<Metadata> {
  const result = await getPlacePosts(await searchParams);
  if (!result) return {};

  const t = await getTranslations("Tags");
  return { title: t("metaTitle", { place: result.place.city ?? result.place.state ?? result.place.country }) };
}

export default function TagsPage({ searchParams }: PageProps<"/tags">) {
  return (
    <>
      <Navbar />
      <main className="w-full flex-1 pt-24 pb-20">
        <div className="mx-auto max-w-300 px-4 md:px-6">
          {/* Dépend de l'URL : rendu à la requête. */}
          <Suspense fallback={<PlaceSkeleton />}>
            <PlacePostsList searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}

async function PlacePostsList({ searchParams }: { searchParams: SearchParams }) {
  const result = await getPlacePosts(await searchParams);
  if (!result) notFound();

  const t = await getTranslations("Tags");
  const { place, posts } = result;
  const name = place.city ?? place.state ?? place.country;
  const parent = [place.city ? place.state : null, place.city || place.state ? place.country : null]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/explore"
          className="group flex w-fit items-center gap-1.5 font-display text-label-md text-ink-soft/70 transition hover:text-ink"
        >
          <Icon name="arrowBack" className="size-4 transition group-hover:-translate-x-0.5" />
          {t("back")}
        </Link>
        <h1 className="font-display text-headline-xl-mobile text-ink md:text-headline-xl">
          {t("title", { place: name })} <span aria-hidden="true">{flagEmoji(result.countryCode)}</span>
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-body-md text-ink-soft">
          {parent && (
            <>
              <span className="flex items-center gap-1">
                <Icon name="pin" className="size-4" />
                {parent}
              </span>
              <span aria-hidden="true">•</span>
            </>
          )}
          <span>{t("count", { count: posts.length })}</span>
        </p>
      </header>

      {posts.length === 0 ? (
        <Card className="px-6 py-12 text-center text-body-md text-ink-soft">{t("empty")}</Card>
      ) : (
        <StoryGrid>
          {posts.map((post) => (
            <li key={post.id}>
              <StoryCard story={post} />
            </li>
          ))}
        </StoryGrid>
      )}
    </div>
  );
}

function PlaceSkeleton() {
  return (
    <div aria-hidden="true" className="flex animate-pulse flex-col gap-8">
      <div className="h-12 w-80 max-w-full rounded-lg bg-surface-muted" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="aspect-4/3" />
        ))}
      </div>
    </div>
  );
}
