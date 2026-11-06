import "server-only";
import { DatabaseError } from "pg";
import { PHOTO_BUCKET } from "@/server/repositories/post.repository";
import type { UserRole } from "@/lib/roles";
import { getDb } from "@/server/infra/db";
import { getBucket, publicUrl } from "@/server/infra/storage";

export type PublicUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string | null;
  avatar_background_color: string | null;
  // role : droits (admin) et logique du mécène ; badge : ce qui s'affiche (choisi parmi les badges débloqués).
  role: UserRole;
  badge: UserRole;
};

export type UserWithPassword = PublicUser & { password_hash: string | null; banned_at: string | null };

type NewUser = {
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  // Version des CGU acceptées (src/lib/legal.ts), enregistrée avec la date.
  terms_version: string;
};

// Jamais d'email ni de hash.
export type ProfileUser = PublicUser & {
  location: string | null;
  created_at: string;
  // Réglages de confidentialité du profil public.
  is_private: boolean;
  show_saved: boolean;
};

// Réglages de confidentialité absents : inchangés.
type ProfileChanges = Pick<ProfileUser, "username" | "display_name" | "location" | "avatar_seed" | "avatar_background_color"> &
  Partial<Pick<ProfileUser, "is_private" | "show_saved">>;

export class UsernameTakenError extends Error {
  constructor() {
    super("username_taken");
  }
}

const PUBLIC_COLUMNS =
  "id, username, display_name, avatar_url, avatar_seed, avatar_background_color, role, coalesce(displayed_badge, role) as badge";
const PROFILE_COLUMNS = `${PUBLIC_COLUMNS}, location, created_at, is_private, show_saved`;
const UNIQUE_VIOLATION = "23505";

export async function findUserByEmail(email: string): Promise<UserWithPassword | null> {
  const db = await getDb();
  const { rows } = await db.query<UserWithPassword>(
    `select ${PUBLIC_COLUMNS}, password_hash, banned_at from users where email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function createUser(user: NewUser): Promise<PublicUser> {
  const db = await getDb();
  const { rows } = await db.query<PublicUser>(
    `insert into users (email, username, display_name, password_hash, terms_version, terms_accepted_at)
     values ($1, $2, $3, $4, $5, now())
     returning ${PUBLIC_COLUMNS}`,
    [user.email, user.username, user.display_name, user.password_hash, user.terms_version],
  );
  return rows[0];
}

// Profil consulté par un visiteur (/profile/{pseudo}). Compte banni : introuvable.
export async function findProfileByUsername(username: string): Promise<ProfileUser | null> {
  const db = await getDb();
  const { rows } = await db.query<ProfileUser>(
    `select ${PROFILE_COLUMNS} from users where username = $1 and banned_at is null`,
    [username],
  );
  return rows[0] ?? null;
}

export async function findProfileById(id: string): Promise<ProfileUser | null> {
  const db = await getDb();
  const { rows } = await db.query<ProfileUser>(`select ${PROFILE_COLUMNS} from users where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function updateProfile(id: string, changes: ProfileChanges): Promise<ProfileUser | null> {
  const db = await getDb();
  try {
    const { rows } = await db.query<ProfileUser>(
      `update users set username = $2, display_name = $3, location = $4, avatar_seed = $5, avatar_background_color = $6,
         is_private = coalesce($7, is_private), show_saved = coalesce($8, show_saved)
       where id = $1
       returning ${PROFILE_COLUMNS}`,
      [
        id,
        changes.username,
        changes.display_name,
        changes.location,
        changes.avatar_seed,
        changes.avatar_background_color,
        changes.is_private ?? null,
        changes.show_saved ?? null,
      ],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) throw new UsernameTakenError();
    throw error;
  }
}

const AVATAR_FOLDER = "avatars";

export async function findAvatarUrl(id: string): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ avatar_url: string | null }>("select avatar_url from users where id = $1", [id]);
  return rows[0]?.avatar_url ?? null;
}

export async function setAvatarUrl(id: string, url: string | null): Promise<ProfileUser | null> {
  const db = await getDb();
  const { rows } = await db.query<ProfileUser>(
    `update users set avatar_url = $2 where id = $1 returning ${PROFILE_COLUMNS}`,
    [id, url],
  );
  return rows[0] ?? null;
}

// Chemin généré côté serveur, jamais le nom envoyé par le client.
export async function uploadAvatar(userId: string, fileName: string, image: File, contentType: string): Promise<string> {
  const path = `${AVATAR_FOLDER}/${userId}/${fileName}`;
  await getBucket(PHOTO_BUCKET)
    .file(path)
    .save(Buffer.from(await image.arrayBuffer()), {
      contentType,
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  return publicUrl(PHOTO_BUCKET, path);
}

// Ignorée si l'URL n'est pas dans le dossier de l'utilisateur.
export async function deleteAvatar(userId: string, url: string) {
  const prefix = publicUrl(PHOTO_BUCKET, `${AVATAR_FOLDER}/${userId}/`);
  if (!url.startsWith(prefix)) return;
  await getBucket(PHOTO_BUCKET).file(decodeURIComponent(url.slice(publicUrl(PHOTO_BUCKET, "").length))).delete();
}

export type UserAccess = { role: UserRole; banned_at: string | null };

export async function findUserAccess(id: string): Promise<UserAccess | null> {
  const db = await getDb();
  const { rows } = await db.query<UserAccess>("select role, banned_at from users where id = $1", [id]);
  return rows[0] ?? null;
}

export type BadgeState = { role: UserRole; displayed_badge: UserRole | null; post_count: number; like_count: number };

// De quoi calculer les badges débloqués : rôle, récits publiés, récits aimés.
export async function findBadgeState(id: string): Promise<BadgeState | null> {
  const db = await getDb();
  const { rows } = await db.query<BadgeState>(
    `select role, displayed_badge,
       (select count(*)::int from post where author_id = users.id) as post_count,
       (select count(*)::int from post_like where user_id = users.id) as like_count
     from users where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// null : badge du rôle.
export async function updateDisplayedBadge(id: string, badge: UserRole | null) {
  const db = await getDb();
  await db.query("update users set displayed_badge = $2 where id = $1", [id, badge]);
}

// Destinataires des alertes internes (ex. demande de pass voyage) : jamais renvoyé au client.
export async function findActiveAdminEmails(): Promise<string[]> {
  const db = await getDb();
  const { rows } = await db.query<{ email: string }>(
    "select email from users where role = 'admin' and banned_at is null and email is not null",
  );
  return rows.map((row) => row.email);
}

// Admins assignables à un ticket (Kanban) : jamais d'email.
export type AssigneeRow = Pick<ProfileUser, "id" | "username" | "display_name" | "avatar_url" | "avatar_seed" | "avatar_background_color">;

export async function findActiveAdmins(): Promise<AssigneeRow[]> {
  const db = await getDb();
  const { rows } = await db.query<AssigneeRow>(
    `select id, username, display_name, avatar_url, avatar_seed, avatar_background_color
     from users where role = 'admin' and banned_at is null order by display_name`,
  );
  return rows;
}

export async function findUsername(id: string): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ username: string }>("select username from users where id = $1", [id]);
  return rows[0]?.username ?? null;
}

// Jamais d'email ni de hash : inutiles pour modérer.
export type AdminUserRow = PublicUser & { banned_at: string | null; created_at: string; post_count: number };

export async function findUsersForAdmin({
  search,
  offset,
  limit,
}: {
  search?: string;
  offset: number;
  limit: number;
}): Promise<{ users: AdminUserRow[]; total: number }> {
  const db = await getDb();
  const pattern = search ? `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const where = "where ($1::text is null or username ilike $1 escape '\\' or display_name ilike $1 escape '\\')";
  const [users, count] = await Promise.all([
    db.query<AdminUserRow>(
      `select ${PUBLIC_COLUMNS}, banned_at, created_at,
         (select count(*)::int from post p where p.author_id = users.id) as post_count
       from users ${where}
       order by created_at desc, id
       offset $2 limit $3`,
      [pattern, offset, limit],
    ),
    db.query<{ total: number }>(`select count(*)::int as total from users ${where}`, [pattern]),
  ]);
  return { users: users.rows, total: count.rows[0].total };
}

export async function updateUserRole(id: string, role: UserRole): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query("update users set role = $2 where id = $1", [id, role]);
  return rowCount === 1;
}

export async function updateUserBanned(id: string, banned: boolean): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query(
    "update users set banned_at = case when $2 then coalesce(banned_at, now()) else null end where id = $1",
    [id, banned],
  );
  return rowCount === 1;
}

export async function findUserMediaUrls(id: string): Promise<string[]> {
  const db = await getDb();
  const { rows } = await db.query<{ url: string }>(
    `select avatar_url as url from users where id = $1 and avatar_url is not null
     union all
     select photo_url from post where author_id = $1
     union all
     select unnest(body_photo_urls) from post where author_id = $1`,
    [id],
  );
  return rows.map(({ url }) => url);
}

export async function findPasswordCheck(id: string): Promise<{ password_hash: string | null; role: string } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ password_hash: string | null; role: string }>("select password_hash, role from users where id = $1", [id]);
  return rows[0] ?? null;
}

// Ce que la suppression du compte (#112) fait aux voyages : partagés (transmis à un membre), seuls (supprimés),
// voyages des autres (le compte en sort).
export type AccountDeletionImpact = { owned_shared: number; owned_alone: number; member_of: number };

export async function findAccountDeletionImpact(id: string): Promise<AccountDeletionImpact> {
  const db = await getDb();
  const { rows } = await db.query<AccountDeletionImpact>(
    `select
       count(*) filter (where heir.trip_id is not null)::int as owned_shared,
       count(*) filter (where heir.trip_id is null)::int as owned_alone,
       (select count(*)::int from trip_member where user_id = $1) as member_of
     from trip t
     left join lateral (
       select m.trip_id from trip_member m join users u on u.id = m.user_id and u.banned_at is null
        where m.trip_id = t.id limit 1
     ) heir on true
     where t.user_id = $1`,
    [id],
  );
  return rows[0];
}

// Suppression du compte par son titulaire (#112), en une transaction : chaque voyage partagé passe au plus ancien
// éditeur (sinon au plus ancien lecteur) non banni, qui devient propriétaire ; les autres voyages, récits, likes et
// sessions suivent en cascade. Le nom reste sur ses lignes de dépenses (historique des comptes des autres membres).
// Pass voyage et dons restent, sans lien avec lui (on delete set null). null : compte introuvable.
export async function deleteAccount(id: string): Promise<{ transferred: number; deletedTrips: number } | null> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows: user } = await client.query<{ display_name: string }>("select display_name from users where id = $1 for update", [id]);
    if (user.length === 0) {
      await client.query("rollback");
      return null;
    }
    await client.query("update trip_participant set name = coalesce(name, left($2, 60)) where user_id = $1", [id, user[0].display_name]);
    const { rowCount: transferred } = await client.query(
      `with heir as (
         select distinct on (m.trip_id) m.trip_id, m.user_id
           from trip_member m
           join trip t on t.id = m.trip_id and t.user_id = $1
           join users u on u.id = m.user_id and u.banned_at is null
          order by m.trip_id, (m.role = 'editor') desc, m.added_at, m.user_id
       ),
       moved as (
         update trip t set user_id = heir.user_id from heir where t.id = heir.trip_id returning t.id, heir.user_id
       )
       delete from trip_member m using moved where m.trip_id = moved.id and m.user_id = moved.user_id`,
      [id],
    );
    const { rows: deleted } = await client.query<{ count: number }>("select count(*)::int as count from trip where user_id = $1", [id]);
    await client.query("delete from users where id = $1", [id]);
    await client.query("commit");
    return { transferred: transferred ?? 0, deletedTrips: deleted[0].count };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
