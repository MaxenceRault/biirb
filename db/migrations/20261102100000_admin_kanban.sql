-- Kanban de l'administration : à faire, en cours, fait, clôturé.
-- Support : les tickets existants gagnent l'état « clôturé » (visible aussi par l'utilisateur).
-- Développement : tickets internes de l'équipe pour améliorer Biirb (jamais visibles hors de l'admin).
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces colonnes.

set role brb_admin;

alter type support_ticket_status add value if not exists 'closed';

create type dev_ticket_status as enum ('todo', 'in_progress', 'done', 'closed');
create type dev_ticket_priority as enum ('low', 'medium', 'high');

create table dev_ticket (
  id integer generated always as identity primary key,
  title varchar(120) not null check (char_length(btrim(title)) between 3 and 120),
  description varchar(2000) check (char_length(btrim(description)) between 1 and 2000),
  status dev_ticket_status not null default 'todo',
  priority dev_ticket_priority not null default 'medium',
  -- Admin qui l'a écrit (gardé si son compte est supprimé : null).
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colonnes du tableau, les plus récemment modifiés d'abord.
create index dev_ticket_status_idx on dev_ticket (status, updated_at desc);

grant select, insert, delete, update (title, description, status, priority, updated_at) on dev_ticket to brb_app;

reset role;
