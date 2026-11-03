-- « Annuler » rend à une activité supprimée par Biirbou son id d'origine : l'imprévu qui la touchait (trip_message_impact,
-- item_id passé à null par le on delete set null) est relié de nouveau à elle, et elle redevient surlignée.
-- Seule la colonne item_id est modifiable : la copie de l'activité et la raison restent écrites une seule fois.

set role brb_admin;

grant update (item_id) on trip_message_impact to brb_app;

reset role;
