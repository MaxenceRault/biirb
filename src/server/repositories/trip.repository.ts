import "server-only";
import type { PoolClient } from "pg";
import { getDb } from "@/server/infra/db";
import { TRIP_UNDO_HOURS, type TripItemCategory, type TripItemColor, type TripPlanChangeKind, type TripSuggestionAction } from "@/schemas/trip.schema";
import type { TripAccessRole } from "@/schemas/trip-share.schema";

export type TripSummary = {
  // Identifiant public (UUID) : la clé interne ne sort jamais du serveur.
  id: string;
  title: string;
  destination_country_code: string;
  destination_state_code: string | null;
  destination_city: string | null;
  start_date: string;
  end_date: string;
  archetype: { slug: string; label: string };
  item_count: number;
  // Nombre d'étapes (trip_destination) : la première est destination_*.
  destination_count: number;
  created_at: string;
  // Voyages partagés : le rôle de l'utilisateur et le propriétaire.
  role: TripAccessRole;
  owner_name: string;
};

export type TripDestinationRow = { country_code: string; state_code: string | null; city: string | null };

export type TripRow = Omit<TripSummary, "item_count" | "role" | "owner_name"> & {
  user_id: string;
  archetype_id: number;
  budget_lodging: number;
  budget_transit: number;
  budget_dining: number;
  budget_activities: number;
  budget_target: number | null;
  source_post_count: number;
  generated_at: string | null;
  season_note: string | null;
  // Étapes choisies, dans l'ordre de saisie.
  destinations: TripDestinationRow[];
  instructions: string | null;
  traveler_count: number;
  // Mémoire du voyage (contraintes retenues par Biirbou), null : rien retenu.
  memory: string | null;
  // Villes où séjourne le voyageur (carte) : vide pour un voyage généré avant la carte.
  stops: TripStopRow[];
};

export type TripStopRow = { name: string; country_code: string; latitude: number; longitude: number; start_day: string; end_day: string };

export type TripItemRow = {
  id: number;
  day: string;
  start_time: string;
  title: string;
  description: string | null;
  category: TripItemCategory;
  // null : couleur de la catégorie.
  color: TripItemColor | null;
  // Proposée par Biirbou ou saisie à la main.
  origin: TripItemOrigin;
  // Nom du lieu donné par Biirbou (« Meiji Jingu »), cherché pour les temps de trajet ; null : pas de lieu précis.
  place_name: string | null;
  source_post: { id: number; title: string; slug: string } | null;
};

export type TripItemOrigin = "ai" | "manual";

export type TripTaskRow = { id: number; label: string; detail: string | null; done: boolean };

export type NewTrip = {
  user_id: string;
  title: string;
  // La première étape devient trip.destination_*.
  destinations: TripDestinationRow[];
  start_date: string;
  end_date: string;
  archetype_id: number;
  instructions: string | null;
  traveler_count: number;
};

export type TripPlan = {
  items: {
    day: string;
    start_time: string;
    title: string;
    description: string | null;
    category: TripItemCategory;
    source_post_id: number | null;
    place_name: string | null;
  }[];
  tasks: { label: string; detail: string | null; done: boolean }[];
  budget: { lodging: number; transit: number; dining: number; activities: number };
  source_post_count: number;
  season_note: string | null;
  stops: TripStopRow[];
};

export type TripChanges = Partial<{
  title: string;
  memory: string | null;
  budget_target: number | null;
  budget_lodging: number;
  budget_transit: number;
  budget_dining: number;
  budget_activities: number;
}>;

export type TripItemFields = {
  day: string;
  start_time: string;
  title: string;
  description: string | null;
  category: TripItemCategory;
};

export type TripItemChanges = Partial<TripItemFields & { color: TripItemColor | null; origin: TripItemOrigin }>;

export type TripTaskChanges = Partial<{ label: string; done: boolean }>;

export type TripSuggestionStatus = "pending" | "accepted" | "rejected";

// update / delete : target = activité visée telle qu'elle est maintenant (null si supprimée entre-temps).
export type TripSuggestionRow = Omit<TripItemRow, "color" | "origin"> & {
  status: TripSuggestionStatus;
  action: TripSuggestionAction;
  target: { id: number; day: string; start_time: string; title: string } | null;
};

export type TripMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  off_topic: boolean;
  created_at: string;
  // Messages de l'utilisateur : qui l'a écrit (discussion partagée entre les membres).
  author: { id: string; display_name: string } | null;
  suggestions: TripSuggestionRow[];
  // Réponse de Biirbou : imprévu repéré (null : aucun) et activités touchées telles qu'elles étaient (item_id null :
  // supprimée depuis).
  disruption: {
    summary: string;
    duration: string | null;
    days: string[];
    impacted: { item_id: number | null; day: string; start_time: string; title: string; reason: string }[];
  } | null;
};

export type TripDisruptionRecord = {
  summary: string;
  duration: string | null;
  days: string[];
  impacted: { item_id: number; reason: string }[];
};

export type NewTripExchange = {
  user_content: string;
  assistant_content: string;
  off_topic: boolean;
  suggestions: (TripItemFields & {
    source_post_id: number | null;
    place_name: string | null;
    action: TripSuggestionAction;
    target_item_id: number | null;
  })[];
  disruption?: TripDisruptionRecord | null;
};

// Noms de colonnes issus de cette liste, jamais de l'entrée utilisateur.
const TRIP_COLUMNS = ["title", "memory", "budget_target", "budget_lodging", "budget_transit", "budget_dining", "budget_activities"] as const;
const ITEM_COLUMNS = ["day", "start_time", "title", "description", "category", "color", "origin"] as const;
const TASK_COLUMNS = ["label", "done"] as const;

const TRIP_SUMMARY_COLUMNS = `t.public_id as id, t.title, t.destination_country_code, t.destination_state_code, t.destination_city,
  t.start_date, t.end_date, json_build_object('slug', a.slug, 'label', a.label) as archetype, t.created_at,
  (select count(*)::int from trip_destination d where d.trip_id = t.id) as destination_count`;

// Postgres renvoie « HH:MM:SS ».
const ITEM_COLUMNS_SELECT = `i.id, i.day, to_char(i.start_time, 'HH24:MI') as start_time, i.title, i.description, i.category, i.color, i.place_name, i.origin,
  case when p.id is null then null else json_build_object('id', p.id, 'title', p.title, 'slug', p.slug) end as source_post`;

// Clé interne (suite du traitement) et identifiant public (renvoyé au client). Voyage et étapes dans une transaction.
export async function insertTrip(trip: NewTrip): Promise<{ id: number; publicId: string }> {
  const [first] = trip.destinations;
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: number; public_id: string }>(
      `insert into trip (user_id, title, destination_country_code, destination_state_code, destination_city,
         start_date, end_date, archetype_id, instructions, traveler_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, public_id`,
      [
        trip.user_id,
        trip.title,
        first.country_code,
        first.state_code,
        first.city,
        trip.start_date,
        trip.end_date,
        trip.archetype_id,
        trip.instructions,
        trip.traveler_count,
      ],
    );
    await client.query(
      `insert into trip_destination (trip_id, position, country_code, state_code, city)
       select $1, position, country_code, state_code, city
         from unnest($2::char(2)[], $3::varchar[], $4::varchar[]) with ordinality as d (country_code, state_code, city, position)`,
      [
        rows[0].id,
        trip.destinations.map((place) => place.country_code),
        trip.destinations.map((place) => place.state_code),
        trip.destinations.map((place) => place.city),
      ],
    );
    await client.query("commit");
    return { id: rows[0].id, publicId: rows[0].public_id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// null : aucun voyage avec cet identifiant public.
export async function findTripInternalId(publicId: string): Promise<number | null> {
  const db = await getDb();
  const { rows } = await db.query<{ id: number }>("select id from trip where public_id = $1", [publicId]);
  return rows[0]?.id ?? null;
}

// Voyages créés par l'utilisateur et voyages dont il est membre.
export async function findTripsByUser(userId: string): Promise<TripSummary[]> {
  const db = await getDb();
  const { rows } = await db.query<TripSummary>(
    `select ${TRIP_SUMMARY_COLUMNS}, (select count(*)::int from trip_item i where i.trip_id = t.id) as item_count,
       case when t.user_id = $1 then 'owner' else m.role::text end as role, owner.display_name as owner_name
     from trip t
     join archetype a on a.id = t.archetype_id
     join users owner on owner.id = t.user_id
     left join trip_member m on m.trip_id = t.id and m.user_id = $1
     where t.user_id = $1 or m.user_id is not null
     order by t.start_date desc, t.id desc`,
    [userId],
  );
  return rows;
}

export async function findTripById(id: number): Promise<TripRow | null> {
  const db = await getDb();
  const { rows } = await db.query<TripRow>(
    `select ${TRIP_SUMMARY_COLUMNS}, t.user_id, t.archetype_id, t.budget_lodging, t.budget_transit, t.budget_dining,
       t.budget_activities, t.budget_target, t.source_post_count, t.generated_at, t.season_note, t.instructions, t.traveler_count, t.memory,
       coalesce(
         (select json_agg(json_build_object('name', s.name, 'country_code', s.country_code, 'latitude', s.latitude,
                   'longitude', s.longitude, 'start_day', s.start_day, 'end_day', s.end_day) order by s.position)
            from trip_stop s where s.trip_id = t.id),
         '[]'
       ) as stops,
       coalesce(
         (select json_agg(json_build_object('country_code', d.country_code, 'state_code', d.state_code, 'city', d.city) order by d.position)
            from trip_destination d where d.trip_id = t.id),
         '[]'
       ) as destinations
     from trip t join archetype a on a.id = t.archetype_id
     where t.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateTrip(id: number, changes: TripChanges) {
  const entries = TRIP_COLUMNS.filter((column) => changes[column] !== undefined).map((column) => [column, changes[column]] as const);
  if (entries.length === 0) return;

  const db = await getDb();
  await db.query(
    `update trip set ${entries.map(([column], index) => `${column} = $${index + 2}`).join(", ")} where id = $1`,
    [id, ...entries.map(([, value]) => value)],
  );
}

export async function deleteTrip(id: number) {
  const db = await getDb();
  await db.query("delete from trip where id = $1", [id]);
}

export async function findTripItems(tripId: number): Promise<TripItemRow[]> {
  const db = await getDb();
  const { rows } = await db.query<TripItemRow>(
    `select ${ITEM_COLUMNS_SELECT}
     from trip_item i left join post p on p.id = i.source_post_id
     where i.trip_id = $1
     order by i.day, i.start_time, i.id`,
    [tripId],
  );
  return rows;
}

export async function findTripTasks(tripId: number): Promise<TripTaskRow[]> {
  const db = await getDb();
  const { rows } = await db.query<TripTaskRow>(
    "select id, label, detail, done from trip_task where trip_id = $1 order by id",
    [tripId],
  );
  return rows;
}

// Une transaction : jamais de planning à moitié enregistré.
// record : re-génération (annulable) ; false à la création du voyage (rien à restaurer).
export async function replaceTripPlan(tripId: number, plan: TripPlan, { record }: { record: boolean }) {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    const before = record ? await beginPlanChange(client, tripId, "regenerate") : null;
    await client.query("delete from trip_item where trip_id = $1", [tripId]);
    await client.query("delete from trip_task where trip_id = $1", [tripId]);
    await client.query("delete from trip_stop where trip_id = $1", [tripId]);

    if (plan.stops.length > 0) {
      await client.query(
        `insert into trip_stop (trip_id, position, name, country_code, latitude, longitude, start_day, end_day)
         select $1, position, name, country_code, latitude, longitude, start_day, end_day
           from unnest($2::varchar[], $3::char(2)[], $4::float8[], $5::float8[], $6::date[], $7::date[])
             with ordinality as s (name, country_code, latitude, longitude, start_day, end_day, position)`,
        [
          tripId,
          plan.stops.map((stop) => stop.name),
          plan.stops.map((stop) => stop.country_code),
          plan.stops.map((stop) => stop.latitude),
          plan.stops.map((stop) => stop.longitude),
          plan.stops.map((stop) => stop.start_day),
          plan.stops.map((stop) => stop.end_day),
        ],
      );
    }

    if (plan.items.length > 0) {
      await client.query(
        `insert into trip_item (trip_id, day, start_time, title, description, category, source_post_id, place_name)
         select $1, * from unnest($2::date[], $3::time[], $4::varchar[], $5::varchar[], $6::trip_item_category[], $7::int[], $8::varchar[])`,
        [
          tripId,
          plan.items.map((item) => item.day),
          plan.items.map((item) => item.start_time),
          plan.items.map((item) => item.title),
          plan.items.map((item) => item.description),
          plan.items.map((item) => item.category),
          plan.items.map((item) => item.source_post_id),
          plan.items.map((item) => item.place_name),
        ],
      );
    }

    if (plan.tasks.length > 0) {
      await client.query(
        `insert into trip_task (trip_id, label, detail, done)
         select $1, * from unnest($2::varchar[], $3::varchar[], $4::boolean[])`,
        [tripId, plan.tasks.map((task) => task.label), plan.tasks.map((task) => task.detail), plan.tasks.map((task) => task.done)],
      );
    }

    await client.query(
      `update trip set budget_lodging = $2, budget_transit = $3, budget_dining = $4, budget_activities = $5,
         source_post_count = $6, season_note = $7, generated_at = now()
       where id = $1`,
      [tripId, plan.budget.lodging, plan.budget.transit, plan.budget.dining, plan.budget.activities, plan.source_post_count, plan.season_note],
    );
    if (before) await endPlanChange(client, tripId, "regenerate", before, null);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// Une transaction : le jour n'est jamais vidé si l'insertion échoue. Les autres jours ne bougent pas.
export async function replaceTripDayItems(tripId: number, day: string, items: TripPlan["items"]) {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    const before = await beginPlanChange(client, tripId, "regenerate_day");
    await client.query("delete from trip_item where trip_id = $1 and day = $2", [tripId, day]);
    if (items.length > 0) {
      await client.query(
        `insert into trip_item (trip_id, day, start_time, title, description, category, source_post_id, place_name)
         select $1, * from unnest($2::date[], $3::time[], $4::varchar[], $5::varchar[], $6::trip_item_category[], $7::int[], $8::varchar[])`,
        [
          tripId,
          items.map((item) => item.day),
          items.map((item) => item.start_time),
          items.map((item) => item.title),
          items.map((item) => item.description),
          items.map((item) => item.category),
          items.map((item) => item.source_post_id),
          items.map((item) => item.place_name),
        ],
      );
    }
    await endPlanChange(client, tripId, "regenerate_day", before, null);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function insertTripItem(tripId: number, item: TripItemFields): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: number }>(
    `insert into trip_item (trip_id, day, start_time, title, description, category, origin)
     values ($1, $2, $3, $4, $5, $6, 'manual')
     returning id`,
    [tripId, item.day, item.start_time, item.title, item.description, item.category],
  );
  return rows[0].id;
}

export async function updateTripItem(tripId: number, itemId: number, changes: TripItemChanges): Promise<boolean> {
  const entries = ITEM_COLUMNS.filter((column) => changes[column] !== undefined).map((column) => [column, changes[column]] as const);
  if (entries.length === 0) return true;

  // Titre changé : le lieu donné par Biirbou ne correspond plus (à droite du =, title est encore l'ancien titre).
  const titleParam = entries.findIndex(([column]) => column === "title");
  const placeReset = titleParam === -1 ? "" : `, place_name = case when title = $${titleParam + 3}::varchar then place_name end`;
  const db = await getDb();
  const { rowCount } = await db.query(
    `update trip_item set ${entries.map(([column], index) => `${column} = $${index + 3}`).join(", ")}${placeReset}
     where id = $1 and trip_id = $2`,
    [itemId, tripId, ...entries.map(([, value]) => value)],
  );
  return rowCount === 1;
}

export async function deleteTripItem(tripId: number, itemId: number): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query("delete from trip_item where id = $1 and trip_id = $2", [itemId, tripId]);
  return rowCount === 1;
}

export async function insertTripTask(tripId: number, label: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: number }>(
    "insert into trip_task (trip_id, label) values ($1, $2) returning id",
    [tripId, label],
  );
  return rows[0].id;
}

export async function updateTripTask(tripId: number, taskId: number, changes: TripTaskChanges): Promise<boolean> {
  const entries = TASK_COLUMNS.filter((column) => changes[column] !== undefined).map((column) => [column, changes[column]] as const);
  if (entries.length === 0) return true;

  const db = await getDb();
  const { rowCount } = await db.query(
    `update trip_task set ${entries.map(([column], index) => `${column} = $${index + 3}`).join(", ")}
     where id = $1 and trip_id = $2`,
    [taskId, tripId, ...entries.map(([, value]) => value)],
  );
  return rowCount === 1;
}

export async function deleteTripTask(tripId: number, taskId: number): Promise<boolean> {
  const db = await getDb();
  const { rowCount } = await db.query("delete from trip_task where id = $1 and trip_id = $2", [taskId, tripId]);
  return rowCount === 1;
}

export async function findTripMessages(tripId: number): Promise<TripMessageRow[]> {
  const db = await getDb();
  const { rows } = await db.query<TripMessageRow>(
    `select m.id, m.role, m.content, m.off_topic, m.created_at,
       case when u.id is null then null else json_build_object('id', u.id, 'display_name', u.display_name) end as author,
       coalesce(
         (select json_agg(json_build_object(
             'id', s.id, 'day', to_char(s.day, 'YYYY-MM-DD'), 'start_time', to_char(s.start_time, 'HH24:MI'),
             'title', s.title, 'description', s.description, 'category', s.category, 'status', s.status, 'action', s.action,
             'source_post', case when p.id is null then null else json_build_object('id', p.id, 'title', p.title, 'slug', p.slug) end,
             'target', case when t.id is null then null else json_build_object(
               'id', t.id, 'day', to_char(t.day, 'YYYY-MM-DD'), 'start_time', to_char(t.start_time, 'HH24:MI'), 'title', t.title) end
           ) order by s.day, s.start_time, s.id)
          from trip_suggestion s
          left join post p on p.id = s.source_post_id
          left join trip_item t on t.id = s.target_item_id
          where s.message_id = m.id),
         '[]'
       ) as suggestions,
       case when m.disruption_summary is null then null else json_build_object(
         'summary', m.disruption_summary,
         'duration', m.disruption_duration,
         'days', (select coalesce(json_agg(to_char(d, 'YYYY-MM-DD') order by d), '[]') from unnest(m.disruption_days) d),
         'impacted', (select coalesce(json_agg(json_build_object(
             'item_id', x.item_id, 'day', to_char(x.day, 'YYYY-MM-DD'), 'start_time', to_char(x.start_time, 'HH24:MI'), 'title', x.title,
             'reason', x.reason
           ) order by x.day, x.start_time, x.id), '[]')
          from trip_message_impact x
          where x.message_id = m.id)
       ) end as disruption
     from trip_message m left join users u on u.id = m.author_id
     where m.trip_id = $1
     order by m.id`,
    [tripId],
  );
  return rows;
}

// Activités touchées par le dernier imprévu repéré par Biirbou, s'il date de moins de `hours` heures (surlignées dans
// le planning).
export async function findRecentImpacts(tripId: number, hours: number): Promise<{ item_id: number; reason: string }[]> {
  const db = await getDb();
  const { rows } = await db.query<{ item_id: number; reason: string }>(
    `select x.item_id, x.reason from trip_message_impact x
     where x.item_id is not null and x.message_id = (
       select id from trip_message
       where trip_id = $1 and role = 'assistant' and disruption_summary is not null and created_at > now() - make_interval(hours => $2)
       order by id desc limit 1)`,
    [tripId, hours],
  );
  return rows;
}

export async function countTripUserMessages(tripId: number): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ count: number }>(
    "select count(*)::int as count from trip_message where trip_id = $1 and role = 'user'",
    [tripId],
  );
  return rows[0].count;
}

// Une transaction : jamais de question sans sa réponse.
export async function insertTripExchange(tripId: number, authorId: string, exchange: NewTripExchange) {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into trip_message (trip_id, role, content, off_topic, author_id) values ($1, 'user', $2, $3, $4)`,
      [tripId, exchange.user_content, exchange.off_topic, authorId],
    );
    const { disruption } = exchange;
    const { rows } = await client.query<{ id: number }>(
      `insert into trip_message (trip_id, role, content, off_topic, disruption_summary, disruption_duration, disruption_days)
       values ($1, 'assistant', $2, $3, $4, $5, $6::date[]) returning id`,
      [tripId, exchange.assistant_content, exchange.off_topic, disruption?.summary ?? null, disruption?.duration ?? null, disruption?.days ?? null],
    );
    // Activités de ce voyage uniquement (revérifié ici aussi : jointure sur trip_item du même voyage).
    if (disruption && disruption.impacted.length > 0) {
      await client.query(
        `insert into trip_message_impact (message_id, item_id, day, start_time, title, reason)
         select $1, i.id, i.day, i.start_time, i.title, k.reason from unnest($3::int[], $4::varchar[]) as k (item_id, reason)
         join trip_item i on i.id = k.item_id and i.trip_id = $2`,
        [rows[0].id, tripId, disruption.impacted.map((item) => item.item_id), disruption.impacted.map((item) => item.reason)],
      );
    }

    const { suggestions } = exchange;
    if (suggestions.length > 0) {
      await client.query(
        `insert into trip_suggestion (trip_id, message_id, day, start_time, title, description, category, source_post_id, action, target_item_id,
           place_name)
         select $1, $2, * from unnest($3::date[], $4::time[], $5::varchar[], $6::varchar[], $7::trip_item_category[], $8::int[],
           $9::trip_suggestion_action[], $10::int[], $11::varchar[])`,
        [
          tripId,
          rows[0].id,
          suggestions.map((item) => item.day),
          suggestions.map((item) => item.start_time),
          suggestions.map((item) => item.title),
          suggestions.map((item) => item.description),
          suggestions.map((item) => item.category),
          suggestions.map((item) => item.source_post_id),
          suggestions.map((item) => item.action),
          suggestions.map((item) => item.target_item_id),
          suggestions.map((item) => item.place_name),
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// Acceptée, la proposition est appliquée au planning (ajout, modification ou suppression).
// "outdated" : l'activité visée n'existe plus, la proposition est classée refusée. false : déjà traitée ou d'un autre voyage.
export async function answerTripSuggestion(tripId: number, suggestionId: number, accepted: boolean): Promise<boolean | "outdated"> {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ action: TripSuggestionAction; target_item_id: number | null }>(
      `update trip_suggestion set status = $3 where id = $1 and trip_id = $2 and status = 'pending'
       returning action, target_item_id`,
      [suggestionId, tripId, accepted ? "accepted" : "rejected"],
    );
    const suggestion = rows[0];
    if (!suggestion) {
      await client.query("rollback");
      return false;
    }

    if (accepted) {
      const before = await beginPlanChange(client, tripId, "suggestion");
      const applied = await applySuggestion(client, tripId, suggestionId, suggestion);
      if (!applied) {
        await client.query("update trip_suggestion set status = 'rejected' where id = $1", [suggestionId]);
        await client.query("commit");
        return "outdated";
      }
      await endPlanChange(client, tripId, "suggestion", before, suggestionId);
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// L'activité visée doit appartenir au même voyage (la proposition vient de l'IA : jamais d'id d'un autre voyage).
async function applySuggestion(
  client: PoolClient,
  tripId: number,
  suggestionId: number,
  { action, target_item_id: targetId }: { action: TripSuggestionAction; target_item_id: number | null },
): Promise<boolean> {
  if (action === "add") {
    await client.query(
      `insert into trip_item (trip_id, day, start_time, title, description, category, source_post_id, place_name)
       select trip_id, day, start_time, title, description, category, source_post_id, place_name
       from trip_suggestion where id = $1`,
      [suggestionId],
    );
    return true;
  }
  if (targetId === null) return false;
  if (action === "delete") {
    const { rowCount } = await client.query("delete from trip_item where id = $1 and trip_id = $2", [targetId, tripId]);
    return rowCount === 1;
  }
  const { rowCount } = await client.query(
    `update trip_item i
     set day = s.day, start_time = s.start_time, title = s.title, description = s.description, category = s.category,
       source_post_id = s.source_post_id, place_name = s.place_name, origin = 'ai'
     from trip_suggestion s
     where s.id = $1 and i.id = $2 and i.trip_id = $3`,
    [suggestionId, targetId, tripId],
  );
  return rowCount === 1;
}

// Historique des changements de Biirbou (trip_plan_change) : photo avant, empreinte après, restauration par « Annuler ».
// Contenu seulement (jamais les ids) : un planning restauré a de nouveaux ids mais la même empreinte.
const PLAN_ITEMS = `coalesce((select json_agg(json_build_object('day', i.day, 'start_time', i.start_time, 'title', i.title,
    'description', i.description, 'category', i.category, 'source_post_id', i.source_post_id, 'color', i.color, 'origin', i.origin)
    order by i.day, i.start_time, i.title, i.description, i.category, i.color, i.source_post_id, i.origin)
  from trip_item i where i.trip_id = $1), '[]'::json)`;
// Photo : le lieu en plus. Hors de l'empreinte : il ne change qu'avec le titre (déjà dedans) ou par Biirbou.
const PLAN_ITEMS_SNAPSHOT = `coalesce((select json_agg(json_build_object('day', i.day, 'start_time', i.start_time, 'title', i.title,
    'description', i.description, 'category', i.category, 'source_post_id', i.source_post_id, 'color', i.color, 'origin', i.origin,
    'place_name', i.place_name)
    order by i.day, i.start_time, i.title, i.description, i.category, i.color, i.source_post_id, i.origin)
  from trip_item i where i.trip_id = $1), '[]'::json)`;
const PLAN_TASKS = `coalesce((select json_agg(json_build_object('label', t.label, 'detail', t.detail, 'done', t.done) order by t.id)
  from trip_task t where t.trip_id = $1), '[]'::json)`;
// Empreinte sans « fait » : cocher la checklist ne bloque pas l'annulation d'une re-génération.
const PLAN_TASK_LABELS = `coalesce((select json_agg(json_build_array(t.label, t.detail) order by t.id)
  from trip_task t where t.trip_id = $1), '[]'::json)`;
const PLAN_STOPS = `coalesce((select json_agg(json_build_object('position', s.position, 'name', s.name, 'country_code', s.country_code,
    'latitude', s.latitude, 'longitude', s.longitude, 'start_day', s.start_day, 'end_day', s.end_day) order by s.position)
  from trip_stop s where s.trip_id = $1), '[]'::json)`;
const PLAN_TRIP = `(select json_build_object('budget_lodging', t.budget_lodging, 'budget_transit', t.budget_transit,
    'budget_dining', t.budget_dining, 'budget_activities', t.budget_activities, 'source_post_count', t.source_post_count,
    'season_note', t.season_note, 'generated_at', t.generated_at)
  from trip t where t.id = $1)`;
const PLAN_TRIP_FINGERPRINT = `(select json_build_array(t.budget_lodging, t.budget_transit, t.budget_dining, t.budget_activities,
    t.source_post_count, t.season_note)
  from trip t where t.id = $1)`;

type Queryable = Pick<PoolClient, "query">;

// Proposition ou jour : les activités ; re-génération : tout ce qu'elle remplace (activités, checklist, séjours, budget).
async function readPlanState(db: Queryable, tripId: number, kind: TripPlanChangeKind): Promise<{ snapshot: unknown; fingerprint: string }> {
  const full = kind === "regenerate";
  const { rows } = await db.query<{ snapshot: unknown; fingerprint: string }>(
    `select json_build_object('items', ${PLAN_ITEMS_SNAPSHOT}${full ? `, 'tasks', ${PLAN_TASKS}, 'stops', ${PLAN_STOPS}, 'trip', ${PLAN_TRIP}` : ""}) as snapshot,
       md5(json_build_array(${PLAN_ITEMS}${full ? `, ${PLAN_TASK_LABELS}, ${PLAN_STOPS}, ${PLAN_TRIP_FINGERPRINT}` : ""})::text) as fingerprint`,
    [tripId],
  );
  return rows[0];
}

// Voyage verrouillé : un changement et une annulation du même voyage ne se croisent jamais.
async function beginPlanChange(client: PoolClient, tripId: number, kind: TripPlanChangeKind) {
  await client.query("select id from trip where id = $1 for update", [tripId]);
  return (await readPlanState(client, tripId, kind)).snapshot;
}

async function endPlanChange(client: PoolClient, tripId: number, kind: TripPlanChangeKind, snapshot: unknown, suggestionId: number | null) {
  const { fingerprint } = await readPlanState(client, tripId, kind);
  // Au-delà du délai, plus rien n'est annulable : l'historique ne grossit pas.
  await client.query("delete from trip_plan_change where trip_id = $1 and created_at < now() - make_interval(hours => $2)", [tripId, TRIP_UNDO_HOURS]);
  await client.query(
    "insert into trip_plan_change (trip_id, kind, suggestion_id, snapshot, fingerprint) values ($1, $2, $3, $4, $5)",
    [tripId, kind, suggestionId, JSON.stringify(snapshot), fingerprint],
  );
}

type PlanChangeRow = { id: number; kind: TripPlanChangeKind; suggestion_id: number | null; fingerprint: string; created_at: string };

async function findLastPlanChange(db: Queryable, tripId: number): Promise<PlanChangeRow | null> {
  const { rows } = await db.query<PlanChangeRow>(
    `select id, kind, suggestion_id, fingerprint, created_at from trip_plan_change
     where trip_id = $1 and created_at >= now() - make_interval(hours => $2)
     order by id desc limit 1`,
    [tripId, TRIP_UNDO_HOURS],
  );
  return rows[0] ?? null;
}

// Dernier changement encore annulable : dans le délai, et planning inchangé depuis (sinon l'annuler effacerait ces modifications).
export async function findUndoablePlanChange(tripId: number): Promise<{ kind: TripPlanChangeKind; created_at: string } | null> {
  const db = await getDb();
  const change = await findLastPlanChange(db, tripId);
  if (!change) return null;
  const { fingerprint } = await readPlanState(db, tripId, change.kind);
  return fingerprint === change.fingerprint ? { kind: change.kind, created_at: change.created_at } : null;
}

// "none" : rien à annuler (ou délai passé). "changed" : planning modifié à la main depuis, rien n'est restauré.
export async function undoLastPlanChange(tripId: number): Promise<"undone" | "none" | "changed"> {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
    await client.query("select id from trip where id = $1 for update", [tripId]);
    const change = await findLastPlanChange(client, tripId);
    if (!change) {
      await client.query("rollback");
      return "none";
    }
    if ((await readPlanState(client, tripId, change.kind)).fingerprint !== change.fingerprint) {
      await client.query("rollback");
      return "changed";
    }

    // Récit supprimé depuis : l'activité restaurée perd seulement son lien (comme le on delete set null de trip_item).
    await client.query("delete from trip_item where trip_id = $1", [tripId]);
    // Photo prise avant la provenance ou le lieu des activités : origin absent = activité de Biirbou, place_name absent = null.
    await client.query(
      `insert into trip_item (trip_id, day, start_time, title, description, category, source_post_id, color, origin, place_name)
       select $1, x.day, x.start_time, x.title, x.description, x.category, (select p.id from post p where p.id = x.source_post_id), x.color,
         coalesce(x.origin, 'ai'), x.place_name
       from trip_plan_change c,
         jsonb_to_recordset(c.snapshot -> 'items')
           as x (day date, start_time time, title varchar, description varchar, category trip_item_category, source_post_id int, color varchar,
             origin trip_item_origin, place_name varchar)
       where c.id = $2`,
      [tripId, change.id],
    );
    if (change.kind === "regenerate") {
      await client.query("delete from trip_task where trip_id = $1", [tripId]);
      await client.query(
        `insert into trip_task (trip_id, label, detail, done)
         select $1, x.label, x.detail, x.done
         from trip_plan_change c,
           rows from (jsonb_to_recordset(c.snapshot -> 'tasks') as (label varchar, detail varchar, done boolean))
             with ordinality as x (label, detail, done, n)
         where c.id = $2 order by x.n`,
        [tripId, change.id],
      );
      await client.query("delete from trip_stop where trip_id = $1", [tripId]);
      await client.query(
        `insert into trip_stop (trip_id, position, name, country_code, latitude, longitude, start_day, end_day)
         select $1, x.position, x.name, x.country_code, x.latitude, x.longitude, x.start_day, x.end_day
         from trip_plan_change c,
           jsonb_to_recordset(c.snapshot -> 'stops')
             as x (position smallint, name varchar, country_code char(2), latitude float8, longitude float8, start_day date, end_day date)
         where c.id = $2`,
        [tripId, change.id],
      );
      await client.query(
        `update trip t set budget_lodging = x.budget_lodging, budget_transit = x.budget_transit, budget_dining = x.budget_dining,
           budget_activities = x.budget_activities, source_post_count = x.source_post_count, season_note = x.season_note,
           generated_at = x.generated_at
         from trip_plan_change c,
           jsonb_to_record(c.snapshot -> 'trip')
             as x (budget_lodging int, budget_transit int, budget_dining int, budget_activities int, source_post_count int,
               season_note varchar, generated_at timestamptz)
         where c.id = $2 and t.id = $1`,
        [tripId, change.id],
      );
    }
    // La proposition annulée redevient une proposition en attente : l'utilisateur peut encore l'accepter plus tard.
    if (change.suggestion_id !== null) {
      await client.query("update trip_suggestion set status = 'pending' where id = $1 and trip_id = $2", [change.suggestion_id, tripId]);
    }
    await client.query("delete from trip_plan_change where id = $1", [change.id]);
    await client.query("commit");
    return "undone";
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
