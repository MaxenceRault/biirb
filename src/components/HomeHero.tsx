"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const INTERVAL_MS = 5000;

// Bannière de l'accueil : couvertures de récits en fondu enchaîné, slogan au centre.
export function HomeHero({ photos }: { photos: { slug: string; photo_url: string }[] }) {
  const t = useTranslations("Home");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Pas de défilement automatique si l'utilisateur a demandé moins d'animations.
    if (photos.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % photos.length), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [photos.length]);

  return (
    <section
      aria-label={t("heroLabel")}
      className="relative isolate flex h-64 items-center justify-center overflow-hidden rounded-lg bg-ink md:h-96"
    >
      {photos.map((photo, position) => (
        <Image
          key={photo.slug}
          src={photo.photo_url}
          alt=""
          fill
          priority={position === 0}
          sizes="(min-width: 1200px) 1200px, 100vw"
          className={`-z-10 object-cover transition-opacity duration-1000 ${position === index ? "opacity-100" : "opacity-0"}`}
        />
      ))}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-ink/45" />

      <div className="flex flex-col items-center gap-2 px-6 text-center text-surface">
        <p className="font-display text-display-lg-mobile md:text-display-lg">{t("heroBrand")}</p>
        <p className="font-display text-headline-sm text-balance md:text-headline-md">{t("heroTagline")}</p>
        <p className="max-w-xl text-body-md text-balance text-surface/90">{t("heroCopilot")}</p>
      </div>
    </section>
  );
}
