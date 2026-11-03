-- Nom du lieu d'une activité donné par Biirbou (#31) : « Meiji Jingu » plutôt que le titre « Visite du sanctuaire
-- Meiji », qu'OpenRouteService ne trouve pas. Null : pas de lieu précis (balade, repas libre) ou activité saisie à la main.
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui écrit ces colonnes.

set role brb_admin;

alter table trip_item
  add column place_name varchar(120) check (char_length(trim(place_name)) between 1 and 120);

-- Proposition de la discussion : le lieu suit l'activité quand elle est acceptée.
alter table trip_suggestion
  add column place_name varchar(120) check (char_length(trim(place_name)) between 1 and 120);

-- Droits inchangés : brb_app a déjà select / insert / update sur trip_item et trip_suggestion.

reset role;
