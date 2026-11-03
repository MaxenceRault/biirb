-- Voyages partagés : conflits de modification (#73) et notifications des membres (#50, #62).
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces colonnes et cette table.

set role brb_admin;

-- Verrouillage optimiste : incrémentée à chaque modification. Un membre qui modifie une version périmée
-- (en-tête If-Match) reçoit 412 et choisit entre sa version et celle déjà enregistrée.
-- Voyage : titre et budget seulement (la mémoire de Biirbou ne crée pas de conflit).
alter table trip add column version integer not null default 1;
alter table trip_item add column version integer not null default 1;

-- brb_app : select, insert et update déjà accordés sur trip et trip_item pour toute la table (nouvelles colonnes comprises).

create type notification_kind as enum (
  'plan_regenerated',
  'day_regenerated',
  'plan_undone',
  'suggestion_accepted',
  'item_added',
  'item_updated',
  'item_deleted',
  'trip_updated'
);

-- Centre de notifications : changement fait par un membre, signalé aux autres membres du voyage.
create table notification (
  id integer generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  trip_id integer not null references trip (id) on delete cascade,
  -- Membre à l'origine du changement (null : compte supprimé depuis).
  actor_id uuid references users (id) on delete set null,
  kind notification_kind not null,
  -- Titre de l'activité ou jour concerné : affiché comme texte, jamais comme HTML.
  detail varchar(120) check (char_length(detail) <= 120),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Liste d'un utilisateur (les plus récentes d'abord) et compteur des non lues.
create index notification_user_idx on notification (user_id, id desc);
create index notification_unread_idx on notification (user_id) where read_at is null;

grant select, insert, delete on notification to brb_app;
grant update (read_at) on notification to brb_app;

reset role;
