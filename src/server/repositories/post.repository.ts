import "server-only";
import type { UserRole } from "@/lib/roles";
import type { PostBody } from "@/schemas/post.schema";
import { getDb } from "@/server/infra/db";
import { getBucket, publicUrl } from "@/server/infra/storage";

// Photos des posts et avatars (public en lecture).
export const PHOTO_BUCKET = "biirb-post-photos";

export type NewPost = {
  author_id: string;
  title: string;
  photo_url: string;
  photo_alt: string;
  short_description: string;
  long_description: string;
  body: PostBody;
  body_photo_urls: string[];
  destination_country_code: string;
  destination_state_code: string | null;
  destination_city: string | null;
  start_date: string;
  end_date: string;
  archetype_id: number;
  is_hidden: boolean;
  // En attente de modération : masqué, seul un admin peut le publier.
  pending_review: boolean;
};

export type NewTag = {
  country_code: string;
  state_code: string | null;
  city: string | null;
};

// Slug généré par la base (trigger post_fill_slug). null si ce slug vient d'être pris.
export async function insertPost(post: NewPost): Promise<{ id: number; slug: string } | null> {
  const db = await getDb();
  const result = await db
    .query<{ id: number; slug: string }>(
      `insert into post (author_id, title, photo_url, photo_alt, short_description, long_description,
         destination_country_code, destination_state_code, destination_city, start_date, end_date, archetype_id, is_hidden, pending_review,
         body, body_photo_urls)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       returning id, slug`,
      [
        post.author_id,
        post.title,
        post.photo_url,
        post.photo_alt,
        post.short_description,
        post.long_description,
        post.destination_country_code,
        post.destination_state_code,
        post.destination_city,
        post.start_date,
        post.end_date,
        post.archetype_id,
        post.is_hidden,
        post.pending_review,
        JSON.stringify(post.body),
        post.body_photo_urls,
      ],
    )
    .catch((error: { code?: string; constraint?: string }) => {
      // Seule la collision de slug est attendue.
      if (error.code === "23505" && error.constraint === "post_slug_key") return null;
      throw error;
    });
  return result?.rows[0] ?? null;
}

// Anciens liens /post/{id}.
export async function findPostSlugById(id: number): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ slug: string }>("select slug from post where id = $1 and not is_hidden", [id]);
  return rows[0]?.slug ?? null;
}

// Nettoyage si la création échoue ; post_tag suit en cascade.
export async function deletePost(id: number) {
  const db = await getDb();
  await db.query("delete from post where id = $1", [id]);
}

// Le « do update » sans effet fait renvoyer aussi les lieux existants.
export async function upsertTags(tags: NewTag[]): Promise<number[]> {
  const db = await getDb();
  const { rows } = await db.query<{ id: number }>(
    `insert into tag (country_code, state_code, city)
     select * from unnest($1::char(2)[], $2::varchar[], $3::varchar[])
     on conflict (country_code, state_code, city) do update set country_code = excluded.country_code
     returning id`,
    [tags.map((tag) => tag.country_code), tags.map((tag) => tag.state_code), tags.map((tag) => tag.city)],
  );
  return rows.map(({ id }) => id);
}

export async function insertPostTags(postId: number, tagIds: number[]) {
  const db = await getDb();
  await db.query("insert into post_tag (post_id, tag_id) select $1, unnest($2::int[])", [postId, tagIds]);
}

export async function uploadPostPhoto(path: string, photo: File, contentType: string): Promise<string> {
  await getBucket(PHOTO_BUCKET)
    .file(path)
    .save(Buffer.from(await photo.arrayBuffer()), {
      contentType,
      resumable: false,
      // Jamais d'écrasement.
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  return publicUrl(PHOTO_BUCKET, path);
}

export async function deletePostPhoto(path: string) {
  await getBucket(PHOTO_BUCKET).file(path).delete();
}

export type PostSummary = {
  id: number;
  title: string;
  slug: string;
  photo_url: string;
  photo_alt: string;
  destination_country_code: string;
  destination_state_code: string | null;
  destination_city: string | null;
  start_date: string;
  created_at: string;
  is_hidden: boolean;
  pending_review: boolean;
};

const SUMMARY_COLUMNS = [
  "id",
  "title",
  "slug",
  "photo_url",
  "photo_alt",
  "destination_country_code",
  "destination_state_code",
  "destination_city",
  "start_date",
  "created_at",
  "is_hidden",
  "pending_review",
];

const prefixed = (alias: string, columns: string[]) => columns.map((column) => `${alias}.${column}`).join(", ");

// role : badge affiché par l'auteur (choisi, sinon celui de son rôle) ; affichage seulement, jamais pour des droits.
const AUTHOR_JSON = `json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name,
  'avatar_url', u.avatar_url, 'avatar_seed', u.avatar_seed,
  'avatar_background_color', u.avatar_background_color, 'role', coalesce(u.displayed_badge, u.role))`;

// visibleOnly : profil vu par un visiteur (sans les récits masqués ni ceux en attente de modération).
export async function findPostsByAuthor(
  authorId: string,
  limit: number,
  { visibleOnly = false }: { visibleOnly?: boolean } = {},
): Promise<{ posts: PostSummary[]; total: number }> {
  const db = await getDb();
  const [posts, count] = await Promise.all([
    db.query<PostSummary>(
      `select ${SUMMARY_COLUMNS.join(", ")} from post
       where author_id = $1 and (not $3 or not is_hidden)
       order by created_at desc limit $2`,
      [authorId, limit, visibleOnly],
    ),
    db.query<{ total: number }>(
      "select count(*)::int as total from post where author_id = $1 and (not $2 or not is_hidden)",
      [authorId, visibleOnly],
    ),
  ]);

  return { posts: posts.rows, total: count.rows[0].total };
}

export type PostDetailRow = {
  id: number;
  title: string;
  slug: string;
  photo_url: string;
  photo_alt: string;
  short_description: string;
  long_description: string;
  // null : ancien récit en texte brut.
  body: PostBody | null;
  destination_country_code: string;
  destination_state_code: string | null;
  destination_city: string | null;
  start_date: string;
  end_date: string;
  created_at: string;
  archetype: { slug: string; label: string };
  author: { id: string; username: string; display_name: string; avatar_url: string | null; avatar_seed: string | null; avatar_background_color: string | null; role: UserRole };
  post_tag: { tag: { country_code: string; state_code: string | null; city: string | null } }[];
};

// « column » vient de ce type fermé, jamais de l'utilisateur.
export async function findPostDetail(key: { slug: string } | { id: number }): Promise<PostDetailRow | null> {
  const [column, value] = "slug" in key ? ["slug", key.slug] : ["id", key.id];
  const db = await getDb();
  const { rows } = await db.query<PostDetailRow>(
    `select p.id, p.title, p.slug, p.photo_url, p.photo_alt, p.short_description, p.long_description, p.body,
       p.destination_country_code, p.destination_state_code, p.destination_city, p.start_date, p.end_date, p.created_at,
       json_build_object('slug', a.slug, 'label', a.label) as archetype,
       ${AUTHOR_JSON} as author,
       coalesce(
         (select json_agg(json_build_object('tag', json_build_object(
                   'country_code', t.country_code, 'state_code', t.state_code, 'city', t.city)))
            from post_tag pt join tag t on t.id = pt.tag_id
           where pt.post_id = p.id),
         '[]'
       ) as post_tag
     from post p
     join archetype a on a.id = p.archetype_id
     join users u on u.id = p.author_id
     where p.${column} = $1 and not p.is_hidden`,
    [value],
  );
  return rows[0] ?? null;
}

export type PlaceFilter = { country: string; state?: string; city?: string };

// Destination ou tag dans ce lieu ; un pays inclut ses régions et villes.
export async function findPostIdsByPlace({ country, state, city }: PlaceFilter): Promise<number[]> {
  const db = await getDb();
  const { rows } = await db.query<{ id: number }>(
    `select id from post
      where not is_hidden
        and destination_country_code = $1
        and ($2::text is null or destination_state_code = $2)
        and ($3::text is null or destination_city = $3)
     union
     select pt.post_id from post_tag pt
       join tag t on t.id = pt.tag_id
       join post p on p.id = pt.post_id and not p.is_hidden
      where t.country_code = $1
        and ($2::text is null or t.state_code = $2)
        and ($3::text is null or t.city = $3)`,
    [country, state ?? null, city ?? null],
  );
  return rows.map(({ id }) => id);
}

export type PostSummaryWithAuthor = PostSummary & {
  author: { id: string; username: string; display_name: string; avatar_url: string | null; avatar_seed: string | null; avatar_background_color: string | null };
};

export async function findPostSummariesByIds(ids: number[], limit: number): Promise<PostSummaryWithAuthor[]> {
  if (ids.length === 0) return [];

  const db = await getDb();
  const { rows } = await db.query<PostSummaryWithAuthor>(
    `select ${prefixed("p", SUMMARY_COLUMNS)}, ${AUTHOR_JSON} as author
     from post p join users u on u.id = p.author_id
     where p.id = any($1::int[]) and not p.is_hidden
     order by p.created_at desc
     limit $2`,
    [ids, limit],
  );
  return rows;
}

// Textes tronqués : taille du prompt maîtrisée.
export type PostForTrip = {
  id: number;
  title: string;
  short_description: string;
  long_description: string;
  destination_country_code: string;
  destination_state_code: string | null;
  destination_city: string | null;
  tags: { country_code: string; state_code: string | null; city: string | null }[];
  // Rang du récit selon chaque critère (1 = premier) : likes, date de publication, tirage au sort.
  like_rank: number;
  recent_rank: number;
  random_rank: number;
};

// Même filtre de lieu que findPostIdsByPlace, plus le type de récit : les `perCriterion` premiers récits selon
// chaque critère (les plus aimés, les plus récents, au hasard), dont le service tire sa sélection.
export async function findPostsForTrip(
  { country, state, city }: PlaceFilter,
  archetypeId: number,
  perCriterion: number,
): Promise<PostForTrip[]> {
  const db = await getDb();
  const { rows } = await db.query<PostForTrip>(
    `with candidate as (
       select p.id, p.created_at, (select count(*) from post_like l where l.post_id = p.id) as like_count
         from post p
        where p.archetype_id = $4
          and not p.is_hidden
          and p.id in (
            select id from post
             where destination_country_code = $1
               and ($2::text is null or destination_state_code = $2)
               and ($3::text is null or destination_city = $3)
            union
            select pt.post_id from post_tag pt join tag t on t.id = pt.tag_id
             where t.country_code = $1
               and ($2::text is null or t.state_code = $2)
               and ($3::text is null or t.city = $3)
          )
     ),
     ranked as (
       select id,
         row_number() over (order by like_count desc, created_at desc, id desc)::int as like_rank,
         row_number() over (order by created_at desc, id desc)::int as recent_rank,
         row_number() over (order by random())::int as random_rank
       from candidate
     )
     select p.id, p.title, p.short_description, left(p.long_description, 1500) as long_description,
       p.destination_country_code, p.destination_state_code, p.destination_city,
       r.like_rank, r.recent_rank, r.random_rank,
       coalesce(
         (select json_agg(json_build_object('country_code', t.country_code, 'state_code', t.state_code, 'city', t.city))
            from post_tag pt join tag t on t.id = pt.tag_id
           where pt.post_id = p.id),
         '[]'
       ) as tags
     from ranked r join post p on p.id = r.id
     where r.like_rank <= $5 or r.recent_rank <= $5 or r.random_rank <= $5`,
    [country, state ?? null, city ?? null, archetypeId, perCriterion],
  );
  return rows;
}

// Jamais d'email ni de hash.
export type FeedPostRow = {
  id: number;
  title: string;
  slug: string;
  short_description: string;
  photo_url: string;
  photo_alt: string;
  destination_country_code: string;
  destination_state_code: string | null;
  destination_city: string | null;
  created_at: string;
  like_count: number;
  archetype: { slug: string; label: string };
  author: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    avatar_seed: string | null;
    avatar_background_color: string | null;
    role: UserRole;
  };
};

// Pagination par curseur : les ids croissent dans le temps.
const FEED_SELECT = `select p.id, p.title, p.slug, p.short_description, p.photo_url, p.photo_alt,
       p.destination_country_code, p.destination_state_code, p.destination_city, p.created_at,
       (select count(*)::int from post_like l where l.post_id = p.id) as like_count,
       json_build_object('slug', a.slug, 'label', a.label) as archetype,
       ${AUTHOR_JSON} as author
     from post p
     join archetype a on a.id = p.archetype_id
     join users u on u.id = p.author_id`;

export async function findFeedPosts({
  archetype,
  beforeId,
  limit,
}: {
  archetype?: string;
  beforeId?: number;
  limit: number;
}): Promise<FeedPostRow[]> {
  const db = await getDb();
  const { rows } = await db.query<FeedPostRow>(
    `${FEED_SELECT}
     where not p.is_hidden
       and ($1::text is null or a.slug = $1)
       and ($2::int is null or p.id < $2)
     order by p.id desc
     limit $3`,
    [archetype ?? null, beforeId ?? null, limit],
  );
  return rows;
}

export async function findPostOwnership(
  id: number,
): Promise<{ author_id: string; photo_url: string; body_photo_urls: string[]; pending_review: boolean } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ author_id: string; photo_url: string; body_photo_urls: string[]; pending_review: boolean }>(
    "select author_id, photo_url, body_photo_urls, pending_review from post where id = $1",
    [id],
  );
  return rows[0] ?? null;
}

// Double la vérification du service : un post d'un autre auteur n'est jamais touché.
export async function updatePostVisibility(id: number, authorId: string, hidden: boolean): Promise<boolean> {
  const db = await getDb();
  // Jamais de réaffichage par l'auteur d'un post en attente de modération.
  const { rowCount } = await db.query("update post set is_hidden = $3 where id = $1 and author_id = $2 and (not pending_review or $3)", [
    id,
    authorId,
    hidden,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function deleteAuthorPost(id: number, authorId: string): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query("delete from post where id = $1 and author_id = $2", [id, authorId]);
  return (rowCount ?? 0) > 0;
}

// null si la photo est hébergée ailleurs (ex. Unsplash pour la démo).
export function photoPathFromUrl(url: string): string | null {
  const prefix = publicUrl(PHOTO_BUCKET, "");
  return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null;
}

export async function findSavedPostsByUser(userId: string, limit: number): Promise<PostSummaryWithAuthor[]> {
  const db = await getDb();
  const { rows } = await db.query<PostSummaryWithAuthor>(
    `select ${prefixed("p", SUMMARY_COLUMNS)}, ${AUTHOR_JSON} as author
     from post_save s
     join post p on p.id = s.post_id and not p.is_hidden
     join users u on u.id = p.author_id
     where s.user_id = $1
     order by s.created_at desc
     limit $2`,
    [userId, limit],
  );
  return rows;
}

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type SearchPlace = { country: string; state: string | null; city: string | null };

// Classement : lieu (tag ou destination), puis titre, puis texte ; à égalité, le plus récent.
export async function searchFeedPosts({
  text,
  places,
  limit,
}: {
  text: string;
  places: SearchPlace[];
  limit: number;
}): Promise<FeedPostRow[]> {
  const db = await getDb();
  const { rows } = await db.query<FeedPostRow>(
    `with wanted as (
       select * from jsonb_to_recordset($2::jsonb) as w(country text, state text, city text)
     ),
     ranked as (
       select p.id,
         case
           when exists (
             select 1 from wanted w
              where (p.destination_country_code = w.country
                     and (w.state is null or p.destination_state_code = w.state)
                     and (w.city is null or p.destination_city = w.city))
                 or exists (select 1 from post_tag pt join tag t on t.id = pt.tag_id
                             where pt.post_id = p.id and t.country_code = w.country
                               and (w.state is null or t.state_code = w.state)
                               and (w.city is null or t.city = w.city))
           ) then 1
           when p.title ilike $1 escape '\\' then 2
           when p.short_description ilike $1 escape '\\' or p.long_description ilike $1 escape '\\' then 3
         end as rank
       from post p
       where not p.is_hidden
     )
     ${FEED_SELECT}
     join ranked r on r.id = p.id
     where r.rank is not null
     order by r.rank, p.id desc
     limit $3`,
    [`%${escapeLike(text)}%`, JSON.stringify(places), limit],
  );
  return rows;
}

export type AdminPostRow = {
  id: number;
  title: string;
  slug: string;
  photo_url: string;
  is_hidden: boolean;
  created_at: string;
  archetype: { slug: string; label: string };
  author: { id: string; username: string; display_name: string };
  open_report_count: number;
};

export async function findPostsForAdmin({
  search,
  visibility,
  offset,
  limit,
}: {
  search?: string;
  visibility: "all" | "visible" | "hidden";
  offset: number;
  limit: number;
}): Promise<{ posts: AdminPostRow[]; total: number }> {
  const db = await getDb();
  const pattern = search ? `%${escapeLike(search)}%` : null;
  const where = `where ($1::text is null or p.title ilike $1 escape '\\' or u.username ilike $1 escape '\\')
       and ($2::text = 'all' or p.is_hidden = ($2::text = 'hidden'))`;
  const [posts, count] = await Promise.all([
    db.query<AdminPostRow>(
      `select p.id, p.title, p.slug, p.photo_url, p.is_hidden, p.created_at,
         json_build_object('slug', a.slug, 'label', a.label) as archetype,
         json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name) as author,
         (select count(*)::int from post_report r where r.post_id = p.id and r.status = 'open') as open_report_count
       from post p
       join archetype a on a.id = p.archetype_id
       join users u on u.id = p.author_id
       ${where}
       order by p.id desc
       offset $3 limit $4`,
      [pattern, visibility, offset, limit],
    ),
    db.query<{ total: number }>(
      `select count(*)::int as total from post p join users u on u.id = p.author_id ${where}`,
      [pattern, visibility],
    ),
  ]);
  return { posts: posts.rows, total: count.rows[0].total };
}

export async function updatePostVisibilityById(id: number, hidden: boolean): Promise<boolean> {
  const db = await getDb();
  // Réaffiché par un admin : la modération est validée.
  const { rowCount } = await db.query(
    "update post set is_hidden = $2, pending_review = pending_review and $2 where id = $1",
    [id, hidden],
  );
  return rowCount === 1;
}

// Renvoie les URL des photos (couverture et récit) à retirer du bucket, null si le post n'existe pas.
export async function deletePostById(id: number): Promise<string[] | null> {
  const db = await getDb();
  const { rows } = await db.query<{ urls: string[] }>(
    "delete from post where id = $1 returning array_prepend(photo_url, body_photo_urls) as urls",
    [id],
  );
  return rows[0]?.urls ?? null;
}

// Même règle que findPostIdsByPlace (destination ou tag, récits visibles) : le compte correspond à /tags?country=.
export async function findTrendingCountries(limit: number): Promise<{ country_code: string; post_count: number }[]> {
  const db = await getDb();
  const { rows } = await db.query<{ country_code: string; post_count: number }>(
    `select country_code, count(*)::int as post_count
       from (select destination_country_code as country_code, id as post_id from post where not is_hidden
             union
             select t.country_code, pt.post_id from post_tag pt
               join tag t on t.id = pt.tag_id
               join post p on p.id = pt.post_id and not p.is_hidden) places
      group by country_code
      order by post_count desc, country_code
      limit $1`,
    [limit],
  );
  return rows;
}

export type CoverPhoto = { slug: string; photo_url: string };

// Couvertures de posts visibles tirées au hasard (bannière de l'accueil).
export async function findRandomCoverPhotos(limit: number): Promise<CoverPhoto[]> {
  const db = await getDb();
  const { rows } = await db.query<CoverPhoto>(
    "select slug, photo_url from post where not is_hidden order by random() limit $1",
    [limit],
  );
  return rows;
}
