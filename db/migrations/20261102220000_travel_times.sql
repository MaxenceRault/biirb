-- Temps de trajet entre les activités d'un jour (#31, pass voyage) : OpenRouteService (données OpenStreetMap).
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces colonnes et cette table.

set role brb_admin;

-- Lieu d'une activité, cherché par le serveur à partir de son titre (une seule fois tant que la recherche ne change pas).
-- place_query : texte recherché ; différent de la recherche actuelle (titre modifié) = à chercher de nouveau.
-- place_query renseigné sans coordonnées : lieu introuvable (« Déjeuner dans un izakaya »), pas de nouvel essai.
alter table trip_item
  add column place_query varchar(300),
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint trip_item_coordinates_check check ((latitude is null) = (longitude is null)),
  add constraint trip_item_place_query_check check (place_query is not null or latitude is null);

create type travel_profile as enum ('foot-walking', 'driving-car');

-- Trajets déjà calculés, partagés entre voyages : ni utilisateur ni voyage, seulement deux points publics
-- (arrondis à 4 décimales, ≈ 10 m) et un mode. Économise le quota d'OpenRouteService.
create table travel_leg (
  from_latitude numeric(7, 4) not null,
  from_longitude numeric(7, 4) not null,
  to_latitude numeric(7, 4) not null,
  to_longitude numeric(7, 4) not null,
  profile travel_profile not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  distance_meters integer not null check (distance_meters >= 0),
  created_at timestamptz not null default now(),
  primary key (from_latitude, from_longitude, to_latitude, to_longitude, profile)
);

-- trip_item : déjà en select / insert / update / delete pour brb_app (nouvelles colonnes comprises).
-- travel_leg : lecture, et ajout d'un trajet calculé (on conflict do nothing) ; jamais modifié ni supprimé par l'app.
grant select, insert on travel_leg to brb_app;

reset role;
