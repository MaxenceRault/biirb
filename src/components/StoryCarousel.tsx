"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import { countryName, flagEmoji } from "@/lib/country";

export type CarouselStory = {
  slug: string;
  title: string;
  photoUrl: string;
  photoAlt: string;
  countryCode: string;
  location: string | null;
  author: string;
};

const TRACK_ID = "story-carousel-track";

// Récits récents en cartes photo : défilement natif (swipe, molette, clavier, focus), flèches sur grand écran.
// Pas de défilement automatique : rien ne bouge sans action du visiteur (WCAG 2.2.2).
export function StoryCarousel({ stories }: { stories: CarouselStory[] }) {
  const t = useTranslations("Landing.inspiration.carousel");
  const locale = useLocale();
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: stories.length <= 1 });

  // Flèche désactivée au début ou à la fin ; recalculé au défilement et au redimensionnement.
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () =>
      setEdges({
        start: element.scrollLeft <= 4,
        end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 4,
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);

  function scrollBy(direction: 1 | -1) {
    const element = track.current;
    if (!element) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * element.clientWidth * 0.9, behavior: reduceMotion ? "auto" : "smooth" });
  }

  if (stories.length === 0) return null;

  return (
    <section aria-roledescription={t("role")} aria-label={t("label")} className="relative min-w-0">
      <ul
        ref={track}
        id={TRACK_ID}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:none] md:mx-0 md:scroll-px-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {stories.map((story, index) => {
          const country = countryName(story.countryCode, locale);
          return (
            <li
              key={story.slug}
              aria-roledescription={t("slide")}
              aria-label={t("position", { index: index + 1, total: stories.length })}
              className="w-[72%] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)]"
            >
              <Link
                href={`/post/${story.slug}`}
                className="group relative isolate flex aspect-4/5 flex-col justify-end overflow-hidden rounded-lg bg-ink p-4 text-surface focus-visible:ring-4 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <Image
                  src={story.photoUrl}
                  alt={story.photoAlt}
                  fill
                  sizes="(min-width: 1200px) 340px, (min-width: 640px) 45vw, 72vw"
                  className="-z-10 object-cover transition duration-500 group-hover:scale-105 motion-reduce:transition-none"
                />
                <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-ink/85 via-ink/25 to-transparent" />
                <p className="flex items-center gap-1.5 text-label-sm text-surface/90">
                  <span aria-hidden="true">{flagEmoji(story.countryCode)}</span>
                  <span className="truncate">{story.location ? `${story.location}, ${country}` : country}</span>
                </p>
                <h3 className="mt-1 line-clamp-2 font-display text-headline-sm text-balance">{story.title}</h3>
                <p className="mt-2 truncate text-label-sm text-surface/80">{t("by", { author: story.author })}</p>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Flèches sur grand écran ; sur mobile, le swipe suffit. */}
      {(["prev", "next"] as const).map((direction) => {
        const disabled = direction === "prev" ? edges.start : edges.end;
        return (
          <button
            key={direction}
            type="button"
            aria-controls={TRACK_ID}
            aria-label={t(direction)}
            title={t(direction)}
            disabled={disabled}
            onClick={() => scrollBy(direction === "prev" ? -1 : 1)}
            className={`absolute top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md transition hover:bg-surface-muted focus-visible:ring-4 focus-visible:ring-accent/25 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0 md:flex ${
              direction === "prev" ? "-left-4" : "-right-4"
            }`}
          >
            <Icon name="arrowBack" className={`size-5 ${direction === "next" ? "rotate-180" : ""}`} />
          </button>
        );
      })}
    </section>
  );
}
