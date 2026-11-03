-- Imprévu repéré par Biirbou dans un échange (#06, #08) : résumé, durée et jours concernés sur sa réponse ; activités
-- touchées, avec la raison et une copie de l'activité à ce moment, dans trip_message_impact. Écrits par le serveur
-- après revérification (jours du voyage, activités de ce voyage), jamais par le voyageur.

set role brb_admin;

alter table trip_message
  add column disruption_summary varchar(160) check (char_length(btrim(disruption_summary)) between 1 and 160),
  -- Null : durée inconnue (jamais inventée).
  add column disruption_duration varchar(80) check (char_length(btrim(disruption_duration)) between 1 and 80),
  add column disruption_days date[],
  add constraint trip_message_disruption_days check ((disruption_summary is null) = (disruption_days is null));

create table trip_message_impact (
  id integer generated always as identity primary key,
  message_id integer not null references trip_message (id) on delete cascade,
  -- Activité supprimée ou remplacée depuis : null (plus surlignée), la copie ci-dessous reste dans la discussion.
  item_id integer references trip_item (id) on delete set null,
  day date not null,
  start_time time not null,
  title varchar(120) not null,
  reason varchar(160) not null check (char_length(btrim(reason)) between 1 and 160),
  -- Sert aussi d'index pour lire les activités d'un message.
  unique (message_id, item_id)
);

-- Suppression d'une activité (set null) sans parcourir toute la table.
create index trip_message_impact_item_idx on trip_message_impact (item_id);

-- Les nouvelles colonnes de trip_message sont couvertes par le droit existant (select, insert sur la table).
grant select, insert on trip_message_impact to brb_app;

reset role;
