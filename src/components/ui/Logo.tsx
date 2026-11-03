// Décoratif : le nom de l'app est toujours affiché ou annoncé à côté. Même dessin et mêmes couleurs (encre, comme Biirbou) que public/logo.svg, app/icon.svg et public/icons/*.png.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <g transform="translate(0 2)">
        <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink">
          <path d="M46 18.5 A11 11 0 0 0 27.7 20.2 C 24 31 18 42 7 48" />
          <path d="M46 29.5 C 45 41 30 49 7 48" />
        </g>
        <circle cx="39" cy="23" r="2.6" className="fill-ink" />
        <path
          d="M62.5 24 L50.5 18.5 L54.5 24 L50.5 29.5 Z"
          strokeWidth="1.5"
          strokeLinejoin="round"
          className="fill-accent stroke-accent"
        />
      </g>
    </svg>
  );
}
