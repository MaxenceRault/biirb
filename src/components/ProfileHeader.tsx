import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { RoleBadge } from "@/components/RoleBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { UserRole } from "@/lib/roles";

export type ProfileHeaderUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string | null;
  avatar_background_color: string | null;
  role: UserRole;
  // Badge choisi par l'utilisateur (profil du compte connecté) ; sinon role (déjà le badge affiché pour un visiteur).
  badge?: UserRole;
  // Absent (undefined) : non partagé (profil privé) → la ville n'est pas affichée.
  location?: string | null;
};

// En-tête d'un profil (le sien ou celui d'un autre) : bannière, avatar, nom, pseudo, ville.
// action : bouton à droite (ex. « Modifier le profil ») ; children : statistiques (ProfileStats).
// Sans hook client : utilisable par une page serveur comme par ProfileView (client).
export function ProfileHeader({ user, action, children }: { user: ProfileHeaderUser; action?: ReactNode; children?: ReactNode }) {
  const t = useTranslations("Profile");

  return (
    <Card className="overflow-hidden">
      <div aria-hidden="true" className="relative h-40 bg-[url(/home-bg.jpg)] bg-cover bg-center sm:h-56">
        <div className="absolute inset-0 bg-linear-to-t from-ink/60 via-ink/20 to-transparent" />
      </div>

      <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative z-10 -mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end">
          <div className="w-fit rounded-xl bg-surface p-1 shadow-md">
            <Avatar src={user.avatar_url} name={user.avatar_seed ?? user.id}
              backgroundColor={user.avatar_background_color} alt="" size={104} />
          </div>
          <div className="pb-1">
            <h1 className="flex flex-wrap items-center gap-2 font-display text-headline-md text-ink">
              {user.display_name}
              <RoleBadge role={user.badge ?? user.role} showDefault />
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-body-sm text-ink-soft/70">
              <span className="font-medium text-ink-soft">@{user.username}</span>
              {user.location !== undefined && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="flex items-center gap-1">
                    <Icon name="pin" className="size-3.5" />
                    {user.location ?? t("noLocation")}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        {action}
      </div>

      {children}
    </Card>
  );
}

// Bandeau de statistiques sous l'en-tête.
export function ProfileStats({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">{children}</dl>;
}

export function ProfileStat({ label, icon, children }: { label: string; icon: IconName; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-4">
      <dt className="font-display text-label-sm text-ink-soft/70 uppercase">{label}</dt>
      <dd className="flex items-center gap-1.5 font-display text-label-lg text-ink">
        <Icon name={icon} className="size-4 text-accent" />
        {children}
      </dd>
    </div>
  );
}

// Barre et onglets du profil (boutons dans ProfileView, liens sur un profil public).
export const PROFILE_TABS_CLASS_NAME =
  "flex w-full flex-wrap gap-1 rounded-lg border border-line bg-surface-muted p-1.5 sm:w-fit";

// Sur mobile, les onglets se partagent la largeur et passent à la ligne au lieu d'être coupés.
export function profileTabClassName(active: boolean) {
  return `flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-display text-label-lg whitespace-nowrap transition sm:flex-none ${
    active ? "bg-surface text-ink shadow-xs" : "text-ink-soft hover:text-ink"
  }`;
}
