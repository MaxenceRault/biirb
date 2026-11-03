import { Icon, type IconName } from "@/components/ui/Icon";

// Bouton carré avec seulement une icône : le libellé sert au lecteur d'écran et à l'infobulle.
// pressed : bouton à bascule (aria-pressed), en accent quand il est enfoncé.
export function IconButton({ icon, label, onClick, pressed }: { icon: IconName; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`rounded-lg p-1.5 transition hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
        pressed ? "text-accent" : "text-ink-soft hover:text-ink"
      }`}
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}
