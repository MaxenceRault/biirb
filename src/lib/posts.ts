import type { UserRole } from "@/lib/roles";

// Type de récit géré depuis l'admin. slug : identifiant stable (URL ?archetype=).
export type Archetype = { slug: string; label: string };

// id de la colonne du feed (page Explorer) : point de retour quand on change de type de récit.
export const FEED_ANCHOR_ID = "feed";

export type FeedPost = {
  id: number;
  title: string;
  slug: string;
  shortDescription: string;
  // Ville, sinon région ; null pour un pays entier.
  location: string | null;
  countryCode: string;
  archetype: Archetype;
  photoUrl: string;
  photoAlt: string;
  createdAt: Date;
  likeCount: number;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarSeed: string | null;
    avatarBackgroundColor: string | null;
    role: UserRole;
  };
};

// Pays le plus raconté : destination ou tag d'un récit visible (même compte que /tags?country=).
export type TrendingDestination = { countryCode: string; postCount: number };

// nextCursor null : plus rien à charger.
export type FeedPage = { posts: FeedPost[]; nextCursor: number | null };
