import type { ComponentProps } from "react";

type ButtonSize = "md" | "sm";
type ButtonVariant = "primary" | "secondary" | "danger" | "inverse";

const SIZES: Record<ButtonSize, string> = {
  md: "h-12 px-4 text-label-lg md:h-11",
  sm: "h-9 gap-1.5 px-3.5 text-label-md",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:opacity-92",
  secondary: "border border-line bg-surface-muted text-ink hover:bg-surface",
  danger: "bg-error text-on-accent hover:opacity-92",
  // Sur un fond sombre ou une photo (bandeau de l'accueil).
  inverse: "border border-surface/40 bg-surface/10 text-surface backdrop-blur-sm hover:bg-surface/20",
};

// Exportées pour styler un <Link> comme un bouton.
export function buttonClassName(size: ButtonSize = "md", className = "", variant: ButtonVariant = "primary") {
  return `inline-flex items-center justify-center rounded-lg font-display transition focus-visible:ring-4 focus-visible:ring-accent/25 focus-visible:outline-none active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

type ButtonProps = ComponentProps<"button"> & { size?: ButtonSize; variant?: ButtonVariant };

export function Button({ className = "", type = "button", size = "md", variant = "primary", ...props }: ButtonProps) {
  return <button type={type} className={buttonClassName(size, className, variant)} {...props} />;
}
