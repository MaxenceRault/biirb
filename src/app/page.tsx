import { connection } from "next/server";
import { Suspense } from "react";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { CurrentTripCard } from "@/components/CurrentTripCard";
import { LandingHero, LandingSections } from "@/components/Landing";
import type { CarouselStory } from "@/components/StoryCarousel";
import type { LandingAngle } from "@/lib/landing";
import { listActiveArchetypes } from "@/server/services/archetype.service";
import { getFeedPage, getHeroPhotos, getTrendingDestinations } from "@/server/services/post.service";
import { getTripPassOffer } from "@/server/services/trip-pass.service";
import { landingAngleSchema } from "@/schemas/landing.schema";

// Récits récents du carrousel : la première page du feed (même requête que la page Explorer).
const LANDING_STORIES = 9;

// Page d'arrivée d'une publicité (?angle=) ; null = accueil normal.
async function resolveAngle(searchParams: PageProps<"/">["searchParams"]): Promise<LandingAngle | null> {
  const angle = landingAngleSchema.safeParse((await searchParams).angle);
  return angle.success ? angle.data : null;
}

// Accueil : présente Biirb (s'inspirer → préparer gratuitement → Biirbou → pass voyage).
// Le flux complet des récits, ses filtres et la recherche sont sur la page Explorer (/explore).
export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <>
      <Navbar />

      <main className="relative w-full flex-1 pt-24 pb-20">
        {/* Connectés : le voyage en cours (programme du jour, Biirbou) ou le prochain, en premier. */}
        <div className="mx-auto max-w-300 px-4 md:px-6">
          <CurrentTripCard className="mb-8" />
        </div>
        <Suspense fallback={<LandingSkeleton />}>
          <Landing searchParams={searchParams} />
        </Suspense>
      </main>

      <Footer />
    </>
  );
}

async function Landing({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await connection();

  // Sections secondaires : une panne les omet sans bloquer l'accueil.
  const [angle, photos, destinations, archetypes, recent] = await Promise.all([
    resolveAngle(searchParams),
    getHeroPhotos().catch(() => []),
    getTrendingDestinations().catch(() => []),
    listActiveArchetypes().catch(() => []),
    getFeedPage({ limit: LANDING_STORIES })
      .then((page) => page.posts)
      .catch(() => []),
  ]);
  // Seulement ce qu'affiche le carrousel (composant client) : rien d'autre ne part vers le navigateur.
  const stories: CarouselStory[] = recent.map((post) => ({
    slug: post.slug,
    title: post.title,
    photoUrl: post.photoUrl,
    photoAlt: post.photoAlt,
    countryCode: post.countryCode,
    location: post.location,
    author: post.author.displayName,
  }));

  return (
    <>
      <div className="mx-auto mb-8 max-w-300 px-4 md:mb-10 md:px-6">
        <LandingHero angle={angle} photos={photos} />
      </div>
      <LandingSections angle={angle} destinations={destinations} archetypes={archetypes} stories={stories} offer={getTripPassOffer()} />
    </>
  );
}

function LandingSkeleton() {
  return (
    <div className="mx-auto mb-8 max-w-300 px-4 md:px-6">
      <div className="h-96 animate-pulse rounded-lg bg-surface-muted md:h-100" />
    </div>
  );
}
