-- Copilote, première version.
-- Mémoire du voyage (#36) : contraintes durables exprimées dans la discussion (allergie, rythme, mobilité…), résumées par
-- Biirbou après chaque échange, modifiables et effaçables par les membres qui peuvent modifier le voyage.
-- Provenance d'une activité (#39) : proposée par Biirbou (génération, proposition acceptée) ou saisie à la main.
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces colonnes.

set role brb_admin;

-- Écrite par l'IA à partir des messages : donnée non fiable, filtrée par le serveur et toujours affichée comme texte.
alter table trip add column memory varchar(600) check (char_length(btrim(memory)) between 1 and 600);

create type trip_item_origin as enum ('ai', 'manual');
-- Activités existantes : générées par Biirbou dans leur immense majorité.
alter table trip_item add column origin trip_item_origin not null default 'ai';

-- brb_app : select, insert et update déjà accordés sur trip et trip_item pour toute la table (nouvelles colonnes comprises).

reset role;
