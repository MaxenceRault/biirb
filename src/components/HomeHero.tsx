"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

const INTERVAL_MS = 5000;

// Bannière de l'accueil : couvertures de récits en fondu enchaîné derrière l'accroche (rendue par le serveur).
export function HomeHero({
  id,
  photos,
  label,
  children,
}: {
  id: string;
  photos: { slug: string; photo_url: string }[];
  label: string;
  children: ReactNode;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Pas de défilement automatique si l'utilisateur a demandé moins d'animations.
    if (photos.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % photos.length), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [photos.length]);

  return (
    <section
      id={id}
      aria-label={label}
      className="relative isolate flex min-h-80 scroll-mt-24 items-center justify-center overflow-hidden rounded-lg bg-ink px-5 py-10 md:px-10 md:py-14"
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
      {/* Plus sombre en bas : les boutons restent lisibles sur toutes les photos. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-ink/45 via-ink/50 to-ink/75" />
      {children}
    </section>
  );
}
