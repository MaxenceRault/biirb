"use client";

import { useEffect, useState, type MouseEvent } from "react";

export type SectionDot = { id: string; label: string };

// Points de navigation de l'accueil (grand écran), fixés à droite : montrent qu'il reste des blocs à découvrir
// et y mènent en un clic. Point actif = bloc au milieu de l'écran.
export function SectionDots({ label, sections }: { label: string; sections: SectionDot[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? null);

  useEffect(() => {
    // Bande au milieu de l'écran : le bloc qui la traverse est le bloc lu.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const { id } of sections) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  function goTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const element = document.getElementById(id);
    if (!element) return;
    // Pas de #ancre dans l'URL : défilement seul.
    event.preventDefault();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <nav
      aria-label={label}
      className="fixed top-1/2 right-3 z-40 hidden -translate-y-1/2 rounded-full border border-line bg-surface/80 px-1 py-2 shadow-sm backdrop-blur-sm md:block xl:right-5"
    >
      <ol className="flex flex-col items-center">
        {sections.map(({ id, label: name }) => {
          const isActive = active === id;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                onClick={(event) => goTo(event, id)}
                aria-label={name}
                aria-current={isActive ? "location" : undefined}
                className="group relative flex items-center justify-center p-1.5 focus-visible:outline-none"
              >
                <span
                  aria-hidden="true"
                  className={`block w-2 rounded-full transition-all duration-300 motion-reduce:transition-none ${
                    isActive ? "h-6 bg-accent" : "h-2 bg-ink-soft/30 group-hover:bg-ink-soft/60"
                  } group-focus-visible:ring-2 group-focus-visible:ring-accent/40`}
                />
                {/* Nom du bloc au survol ou au focus clavier. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-full mr-2 rounded-lg bg-ink px-2.5 py-1 font-display text-label-sm whitespace-nowrap text-surface opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {name}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
