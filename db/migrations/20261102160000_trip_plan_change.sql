-- Historique des changements faits par Biirbou dans un planning, pour pouvoir les annuler (24 h, le plus récent d'abord) :
-- proposition acceptée dans la discussion, re-génération complète, re-génération d'un jour.
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui écrit dans cette table.

set role brb_admin;

create type trip_plan_change_kind as enum ('suggestion', 'regenerate', 'regenerate_day');

create table trip_plan_change (
  id integer generated always as identity primary key,
  trip_id integer not null references trip (id) on delete cascade,
  kind trip_plan_change_kind not null,
  -- Proposition acceptée (kind = suggestion) : remise en attente si le changement est annulé.
  suggestion_id integer references trip_suggestion (id) on delete set null,
  -- État avant le changement, restauré par « Annuler » (activités ; tout le planning pour une re-génération).
  snapshot jsonb not null,
  -- Empreinte du planning juste après : différente au moment d'annuler = modifié à la main depuis, annulation refusée.
  fingerprint char(32) not null,
  created_at timestamptz not null default now()
);

-- Dernier changement d'un voyage.
create index trip_plan_change_trip_idx on trip_plan_change (trip_id, id desc);

grant select, insert, delete on trip_plan_change to brb_app;

reset role;
