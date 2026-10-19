-- Voyage à plusieurs étapes (pays, régions ou villes, dans l'ordre), consignes du voyageur pour Biirbou,
-- et durée maximale portée de 1 à 3 mois (92 jours, début et fin inclus : TRIP_MAX_DAYS).
-- trip.destination_* reste la première étape (cartes, fil d'Ariane, anciens voyages) ; trip_destination donne la liste complète.
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces colonnes.

set role brb_admin;

create table trip_destination (
  trip_id integer not null references trip (id) on delete cascade,
  -- Ordre de l'itinéraire, à partir de 1 (8 étapes maximum : TRIP_MAX_DESTINATIONS).
  position smallint not null check (position between 1 and 8),
  -- Mêmes règles que trip.destination_*.
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  state_code varchar(10) check (state_code ~ '^[A-Za-z0-9-]{1,10}$'),
  city varchar(100) check (char_length(city) between 1 and 100),
  check (city is null or state_code is not null),
  primary key (trip_id, position)
);

-- Anciens voyages : leur destination devient la première étape.
insert into trip_destination (trip_id, position, country_code, state_code, city)
select id, 1, destination_country_code, destination_state_code, destination_city from trip;

-- Envies du voyageur à la création (itinéraire, villes, jours déjà prévus…) : réutilisées par Biirbou à chaque génération.
alter table trip add column instructions varchar(1000) check (char_length(trim(instructions)) between 1 and 1000);

-- 3 mois maximum.
alter table trip drop constraint trip_max_length_check;
alter table trip add constraint trip_max_length_check check (end_date - start_date < 92);

-- Étapes supprimées avec le voyage (cascade), jamais modifiées.
grant select, insert on trip_destination to brb_app;

reset role;
