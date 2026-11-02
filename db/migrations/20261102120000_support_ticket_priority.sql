-- Priorité des tickets de support (Kanban de l'administration), comme les tickets de développement.
-- Réservée aux admins : jamais renvoyée à l'auteur du ticket.
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit cette colonne.

set role brb_admin;

-- Un seul type de priorité pour les deux tableaux.
alter type dev_ticket_priority rename to ticket_priority;

alter table support_ticket add column priority ticket_priority not null default 'medium';

grant update (priority) on support_ticket to brb_app;

reset role;
