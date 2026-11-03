// Biirbou, le hibou copilote (même trait que le logo, bec à l'accent). Décoratif : son nom est toujours écrit à côté.
// Le trait prend la couleur du texte (currentColor) : gris, encre ou blanc selon le fond.
export function Biirbou({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={`shrink-0 ${className}`}>
      <g fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 9 Q19.5 17.5 32 17.5 Q44.5 17.5 51 9 Q53.5 20 53 31 Q53 54 32 54.5 Q11 54 11 31 Q10.5 20 13 9 Z" />
        <circle cx="24.8" cy="29.5" r="7.2" />
        <circle cx="39.2" cy="29.5" r="7.2" />
        <path d="M16.5 37.5 Q18 47 25.5 51" />
        <path d="M47.5 37.5 Q46 47 38.5 51" />
      </g>
      <circle cx="25.6" cy="30.3" r="2.8" fill="currentColor" />
      <circle cx="38.4" cy="30.3" r="2.8" fill="currentColor" />
      <path d="M29.7 37.2 L32 42.2 L34.3 37.2 Z" strokeWidth="1.6" strokeLinejoin="round" className="fill-accent stroke-accent" />
    </svg>
  );
}
