import "server-only";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { logInfo } from "@/server/logger";
import { detectImage } from "@/server/images";
import {
  deletePostPhoto,
  findPostsByAuthor,
  photoPathFromUrl,
  findSavedPostsByUser,
  type PostSummary,
  type PostSummaryWithAuthor,
} from "@/server/repositories/post.repository";
import {
  deleteAccount,
  deleteAvatar,
  findAccountDeletionImpact,
  findAvatarUrl,
  findPasswordCheck,
  findUserMediaUrls,
  findBadgeState,
  findProfileById,
  findProfileByUsername,
  setAvatarUrl,
  updateDisplayedBadge,
  updateProfile,
  uploadAvatar,
  UsernameTakenError,
  type ProfileUser,
} from "@/server/repositories/user.repository";
import type { UpdateProfileInput } from "@/schemas/user.schema";
import { BADGE_THRESHOLDS, USER_ROLES, type UserRole } from "@/lib/roles";

export class ProfileError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "USERNAME_TAKEN" | "INVALID_INPUT" | "BADGE_LOCKED" | "INVALID_CREDENTIALS" | "ADMIN_ACCOUNT",
  ) {
    super(code);
  }
}

export type MyProfile = {
  user: ProfileUser;
  stories: PostSummary[];
  storyCount: number;
  saved: PostSummaryWithAuthor[];
};

const STORIES_LIMIT = 12;
const SAVED_LIMIT = 48;

export async function getMyProfile(userId: string): Promise<MyProfile> {
  const [user, { posts, total }, saved] = await Promise.all([
    findProfileById(userId),
    findPostsByAuthor(userId, STORIES_LIMIT),
    findSavedPostsByUser(userId, SAVED_LIMIT),
  ]);

  // Token valide mais compte supprimé entre-temps.
  if (!user) throw new ProfileError("NOT_FOUND");
  return { user, stories: posts, storyCount: total, saved };
}

// Identité affichée même sur un profil privé (jamais email, rôle interne ni réglages).
export type PublicIdentity = Pick<
  ProfileUser,
  "id" | "username" | "display_name" | "avatar_url" | "avatar_seed" | "avatar_background_color" | "role"
>;

// Récit d'une grille publique : sans les champs internes (is_hidden, pending_review).
export type PublicStory = Omit<PostSummary, "is_hidden" | "pending_review">;

export type PublicProfile =
  | { isPrivate: true; user: PublicIdentity }
  | {
      isPrivate: false;
      user: PublicIdentity & Pick<ProfileUser, "location" | "created_at">;
      stories: PublicStory[];
      storyCount: number;
      // null : l'utilisateur ne montre pas ses enregistrés.
      saved: PostSummaryWithAuthor[] | null;
    };

// Profil vu par un visiteur (/profile/{pseudo}). Les réglages de confidentialité sont appliqués ICI :
// ce qui est caché n'est jamais envoyé au navigateur. Jamais les itinéraires IA.
export async function getPublicProfile(username: string): Promise<PublicProfile> {
  const profile = await findProfileByUsername(username);
  if (!profile) throw new ProfileError("NOT_FOUND");

  const { id, display_name, avatar_url, avatar_seed, avatar_background_color, badge } = profile;
  // role : le badge affiché, jamais le vrai rôle (un visiteur n'a pas à savoir qui est admin).
  const identity: PublicIdentity = { id, username: profile.username, display_name, avatar_url, avatar_seed, avatar_background_color, role: badge };
  if (profile.is_private) return { isPrivate: true, user: identity };

  const [{ posts, total }, saved] = await Promise.all([
    findPostsByAuthor(id, STORIES_LIMIT, { visibleOnly: true }),
    profile.show_saved ? findSavedPostsByUser(id, SAVED_LIMIT) : Promise.resolve(null),
  ]);

  return {
    isPrivate: false,
    user: { ...identity, location: profile.location, created_at: profile.created_at },
    stories: posts.map(toPublicStory),
    storyCount: total,
    saved,
  };
}

// Allowlist des champs d'un récit envoyés à un visiteur.
function toPublicStory(story: PostSummary): PublicStory {
  const { id, title, slug, photo_url, photo_alt, destination_country_code, destination_state_code, destination_city, start_date, created_at } = story;
  return { id, title, slug, photo_url, photo_alt, destination_country_code, destination_state_code, destination_city, start_date, created_at };
}

// L'id vient du token, jamais du body.
export async function updateMyProfile(userId: string, input: UpdateProfileInput): Promise<ProfileUser> {
  try {
    const user = await updateProfile(userId, input);
    if (!user) throw new ProfileError("NOT_FOUND");
    return user;
  } catch (error) {
    if (error instanceof UsernameTakenError) throw new ProfileError("USERNAME_TAKEN");
    throw error;
  }
}

// null : retire la photo. L'ancienne est supprimée du bucket après coup.
export async function setMyAvatar(userId: string, image: File | null): Promise<ProfileUser> {
  const previous = await findAvatarUrl(userId);

  let url: string | null = null;
  if (image) {
    // Type réel lu dans le fichier, pas l'extension.
    const detected = await detectImage(image);
    if (!detected) throw new ProfileError("INVALID_INPUT");
    url = await uploadAvatar(userId, `${randomUUID()}.${detected.extension}`, image, detected.contentType);
  }

  let user: ProfileUser | null;
  try {
    user = await setAvatarUrl(userId, url);
  } catch (error) {
    // Base en échec : la nouvelle photo ne doit pas rester orpheline.
    if (url) await deleteAvatar(userId, url).catch(() => {});
    throw error;
  }
  if (!user) throw new ProfileError("NOT_FOUND");

  if (previous && previous !== url) await deleteAvatar(userId, previous).catch(() => {});
  return user;
}

export type MyBadges = {
  // Dans l'ordre d'affichage ; unlocked : choisissable.
  badges: { badge: UserRole; unlocked: boolean }[];
  displayed: UserRole;
  progress: { posts: number; likes: number };
  thresholds: typeof BADGE_THRESHOLDS;
};

// Débloqués : voyageur toujours ; globe-trotteur / rêveur par les seuils ou attribués par un admin ; mécène et admin par le rôle.
function unlockedBadges(state: { role: UserRole; post_count: number; like_count: number }): Set<UserRole> {
  const unlocked = new Set<UserRole>(["traveler", state.role]);
  if (state.post_count >= BADGE_THRESHOLDS.globetrotter) unlocked.add("globetrotter");
  if (state.like_count >= BADGE_THRESHOLDS.dreamer) unlocked.add("dreamer");
  return unlocked;
}

export async function getMyBadges(userId: string): Promise<MyBadges> {
  const state = await findBadgeState(userId);
  if (!state) throw new ProfileError("NOT_FOUND");
  const unlocked = unlockedBadges(state);
  // Admin et mécène ne s'affichent dans la liste que pour qui les a (rien à « débloquer » pour les autres).
  const listed = USER_ROLES.filter((badge) => (badge === "admin" || badge === "patron" ? unlocked.has(badge) : true));
  return {
    badges: listed.map((badge) => ({ badge, unlocked: unlocked.has(badge) })),
    displayed: state.displayed_badge && unlocked.has(state.displayed_badge) ? state.displayed_badge : state.role,
    progress: { posts: state.post_count, likes: state.like_count },
    thresholds: BADGE_THRESHOLDS,
  };
}

// null : badge du rôle. Un badge non débloqué est refusé (vérifié ici, jamais seulement dans l'interface).
export async function setMyBadge(userId: string, badge: UserRole | null): Promise<MyBadges> {
  const state = await findBadgeState(userId);
  if (!state) throw new ProfileError("NOT_FOUND");
  if (badge !== null && !unlockedBadges(state).has(badge)) throw new ProfileError("BADGE_LOCKED");
  await updateDisplayedBadge(userId, badge === state.role ? null : badge);
  return getMyBadges(userId);
}

// Avant de confirmer (#112) : voyages transmis à un membre, supprimés, et voyages des autres que le compte quitte.
export async function getAccountDeletionPreview(userId: string) {
  const impact = await findAccountDeletionImpact(userId);
  return { ownedShared: impact.owned_shared, ownedAlone: impact.owned_alone, memberOf: impact.member_of };
}

// Suppression du compte par son titulaire (#112), mot de passe exigé (un token volé ne suffit pas). Un admin doit
// d'abord être rétrogradé par un autre admin : l'administration ne se retrouve jamais sans responsable par erreur.
export async function deleteMyAccount(userId: string, password: string) {
  const account = await findPasswordCheck(userId);
  if (!account) throw new ProfileError("NOT_FOUND");
  if (!account.password_hash || !(await bcrypt.compare(password, account.password_hash))) throw new ProfileError("INVALID_CREDENTIALS");
  if (account.role === "admin") throw new ProfileError("ADMIN_ACCOUNT");

  const mediaUrls = await findUserMediaUrls(userId);
  const result = await deleteAccount(userId);
  if (!result) throw new ProfileError("NOT_FOUND");
  // Trace de la demande (obligation de preuve), sans donnée personnelle : l'identifiant ne désigne plus personne.
  logInfo("account", { message: "compte supprimé par son titulaire", userId, ...result });

  // Le compte est supprimé : une photo qui résiste ne fait pas échouer la requête.
  await Promise.all(
    mediaUrls.map((url) => {
      const path = photoPathFromUrl(url);
      return path ? deletePostPhoto(path).catch(() => {}) : null;
    }),
  );
}
