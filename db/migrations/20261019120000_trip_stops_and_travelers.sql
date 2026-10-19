-- Carte du voyage : villes où séjourne le voyageur (étapes réelles du planning, avec dates), et nombre de voyageurs.
-- trip_stop est rempli par le serveur à chaque génération (parcours donné par l'IA, coordonnées de country-state-city).
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces colonnes.

set role brb_admin;

create table trip_stop (
  trip_id integer not null references trip (id) on delete cascade,
  -- Ordre du parcours, à partir de 1.
  position smallint not null check (position between 1 and 60),
  -- Nom affiché (en français), écrit par l'IA : donnée non fiable, affichée comme texte.
  name varchar(100) not null check (char_length(trim(name)) between 1 and 100),
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  -- Premier et dernier jour sur place (inclus).
  start_day date not null,
  end_day date not null,
  check (end_day >= start_day),
  primary key (trip_id, position)
);

-- Utilisé par l'IA pour le budget, l'hébergement et le rythme (10 voyageurs maximum : TRIP_MAX_TRAVELERS).
alter table trip add column traveler_count smallint not null default 1 check (traveler_count between 1 and 10);

-- Remplacées à chaque génération du planning (dans la même transaction).
grant select, insert, delete on trip_stop to brb_app;

reset role;
