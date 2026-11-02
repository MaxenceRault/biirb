-- Kanban de l'administration : admins assignés à un ticket (plusieurs par ticket), support et développement.
-- Réservé aux admins : jamais renvoyé à l'auteur d'un ticket de support.
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces tables.

set role brb_admin;

create table support_ticket_assignee (
  ticket_id integer not null references support_ticket (id) on delete cascade,
  -- Compte supprimé : l'assignation disparaît avec lui.
  user_id uuid not null references users (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);

create table dev_ticket_assignee (
  ticket_id integer not null references dev_ticket (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);

-- Suppression d'un compte (cascade) sans parcourir toute la table.
create index support_ticket_assignee_user_idx on support_ticket_assignee (user_id);
create index dev_ticket_assignee_user_idx on dev_ticket_assignee (user_id);

grant select, insert, delete on support_ticket_assignee, dev_ticket_assignee to brb_app;

reset role;
