-- Replanification après un imprévu (#10, #11).
--   trip_item.pinned               → « Garder cette activité » : jamais modifiée ni supprimée par Biirbou (discussion,
--                                    jour re-généré, voyage réimaginé) ; seul le voyageur la change.
--   trip_plan_change.suggestion_ids → « Tout accepter » : propositions acceptées ensemble, remises en attente ensemble
--                                    par « Annuler » (suggestion_id reste pour une proposition acceptée seule).

set role brb_admin;

alter table trip_item add column pinned boolean not null default false;

alter table trip_plan_change add column suggestion_ids integer[];

-- trip_item et trip_plan_change : droits existants de brb_app sur toute la table (nouvelles colonnes comprises).

reset role;
