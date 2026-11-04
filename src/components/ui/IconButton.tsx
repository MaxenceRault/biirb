import { useId } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

// Bouton carré avec seulement une icône : le libellé sert au lecteur d'écran et à l'infobulle.
// pressed : bouton à bascule (aria-pressed), en accent quand il est enfoncé.
// hint : infobulle courte (survol et clavier) qui remplace le libellé à l'écran ; le libellé reste lu par le lecteur d'écran.
export function IconButton({
  icon,
  label,
  hint,
  onClick,
  pressed,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  const hintId = useId();
  return (
    <span className="group/hint relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        aria-describedby={hint ? hintId : undefined}
        title={hint ? undefined : label}
        className={`rounded-lg p-1.5 transition hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
          pressed ? "text-accent" : "text-ink-soft hover:text-ink"
        }`}
      >
        <Icon name={icon} className="size-4" />
      </button>
      {hint && (
        <span
          id={hintId}
          role="tooltip"
          className="pointer-events-none absolute right-0 bottom-full z-30 mb-1.5 w-max max-w-60 rounded-lg bg-ink px-2.5 py-1.5 text-label-sm text-surface opacity-0 shadow-sm transition-opacity group-hover/hint:opacity-100 group-has-focus-visible/hint:opacity-100"
        >
          {hint}
        </span>
      )}
    </span>
  );
}
