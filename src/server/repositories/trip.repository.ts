import "server-only";
import type { PoolClient } from "pg";
import { getDb } from "@/server/infra/db";
import type { TripItemCategory, TripItemColor, TripSuggestionAction } from "@/schemas/trip.schema";
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
  source_post: { id: number; title: string; slug: string } | null;
};

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
  items: { day: string; start_time: string; title: string; description: string | null; category: TripItemCategory; source_post_id: number | null }[];
  tasks: { label: string; detail: string | null; done: boolean }[];
  budget: { lodging: number; transit: number; dining: number; activities: number };
  source_post_count: number;
  season_note: string | null;
  stops: TripStopRow[];
};

export type TripChanges = Partial<{
  title: string;
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

export type TripItemChanges = Partial<TripItemFields & { color: TripItemColor | null }>;

export type TripTaskChanges = Partial<{ label: string; done: boolean }>;

export type TripSuggestionStatus = "pending" | "accepted" | "rejected";

// update / delete : target = activité visée telle qu'elle est maintenant (null si supprimée entre-temps).
export type TripSuggestionRow = Omit<TripItemRow, "color"> & {
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
};

export type NewTripExchange = {
  user_content: string;
  assistant_content: string;
  off_topic: boolean;
  suggestions: (TripItemFields & { source_post_id: number | null; action: TripSuggestionAction; target_item_id: number | null })[];
};

// Noms de colonnes issus de cette liste, jamais de l'entrée utilisateur.
const TRIP_COLUMNS = ["title", "budget_target", "budget_lodging", "budget_transit", "budget_dining", "budget_activities"] as const;
const ITEM_COLUMNS = ["day", "start_time", "title", "description", "category", "color"] as const;
const TASK_COLUMNS = ["label", "done"] as const;

const TRIP_SUMMARY_COLUMNS = `t.public_id as id, t.title, t.destination_country_code, t.destination_state_code, t.destination_city,
  t.start_date, t.end_date, json_build_object('slug', a.slug, 'label', a.label) as archetype, t.created_at,
  (select count(*)::int from trip_destination d where d.trip_id = t.id) as destination_count`;

// Postgres renvoie « HH:MM:SS ».
const ITEM_COLUMNS_SELECT = `i.id, i.day, to_char(i.start_time, 'HH24:MI') as start_time, i.title, i.description, i.category, i.color,
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
       t.budget_activities, t.budget_target, t.source_post_count, t.generated_at, t.season_note, t.instructions, t.traveler_count,
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
export async function replaceTripPlan(tripId: number, plan: TripPlan) {
  const client = await (await getDb()).connect();
  try {
    await client.query("begin");
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
        `insert into trip_item (trip_id, day, start_time, title, description, category, source_post_id)
         select $1, * from unnest($2::date[], $3::time[], $4::varchar[], $5::varchar[], $6::trip_item_category[], $7::int[])`,
        [
          tripId,
          plan.items.map((item) => item.day),
          plan.items.map((item) => item.start_time),
          plan.items.map((item) => item.title),
          plan.items.map((item) => item.description),
          plan.items.map((item) => item.category),
          plan.items.map((item) => item.source_post_id),
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
    await client.query("delete from trip_item where trip_id = $1 and day = $2", [tripId, day]);
    if (items.length > 0) {
      await client.query(
        `insert into trip_item (trip_id, day, start_time, title, description, category, source_post_id)
         select $1, * from unnest($2::date[], $3::time[], $4::varchar[], $5::varchar[], $6::trip_item_category[], $7::int[])`,
        [
          tripId,
          items.map((item) => item.day),
          items.map((item) => item.start_time),
          items.map((item) => item.title),
          items.map((item) => item.description),
          items.map((item) => item.category),
          items.map((item) => item.source_post_id),
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

export async function insertTripItem(tripId: number, item: TripItemFields): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: number }>(
    `insert into trip_item (trip_id, day, start_time, title, description, category)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [tripId, item.day, item.start_time, item.title, item.description, item.category],
  );
  return rows[0].id;
}

export async function updateTripItem(tripId: number, itemId: number, changes: TripItemChanges): Promise<boolean> {
  const entries = ITEM_COLUMNS.filter((column) => changes[column] !== undefined).map((column) => [column, changes[column]] as const);
  if (entries.length === 0) return true;

  const db = await getDb();
  const { rowCount } = await db.query(
    `update trip_item set ${entries.map(([column], index) => `${column} = $${index + 3}`).join(", ")}
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
       ) as suggestions
     from trip_message m left join users u on u.id = m.author_id
     where m.trip_id = $1
     order by m.id`,
    [tripId],
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
    const { rows } = await client.query<{ id: number }>(
      `insert into trip_message (trip_id, role, content, off_topic) values ($1, 'assistant', $2, $3) returning id`,
      [tripId, exchange.assistant_content, exchange.off_topic],
    );

    const { suggestions } = exchange;
    if (suggestions.length > 0) {
      await client.query(
        `insert into trip_suggestion (trip_id, message_id, day, start_time, title, description, category, source_post_id, action, target_item_id)
         select $1, $2, * from unnest($3::date[], $4::time[], $5::varchar[], $6::varchar[], $7::trip_item_category[], $8::int[],
           $9::trip_suggestion_action[], $10::int[])`,
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
      const applied = await applySuggestion(client, tripId, suggestionId, suggestion);
      if (!applied) {
        await client.query("update trip_suggestion set status = 'rejected' where id = $1", [suggestionId]);
        await client.query("commit");
        return "outdated";
      }
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
      `insert into trip_item (trip_id, day, start_time, title, description, category, source_post_id)
       select trip_id, day, start_time, title, description, category, source_post_id
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
       source_post_id = s.source_post_id
     from trip_suggestion s
     where s.id = $1 and i.id = $2 and i.trip_id = $3`,
    [suggestionId, targetId, tripId],
  );
  return rowCount === 1;
}
