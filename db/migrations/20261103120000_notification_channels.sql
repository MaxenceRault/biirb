-- Notifications d'un voyage hors de l'app : navigateur (push web) et email, au choix de chaque membre, voyage par voyage.
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.
-- ⚠️ À exécuter AVANT de déployer le code qui lit ces tables.

set role brb_admin;

-- Choix d'un membre pour un voyage. Pas de ligne = rien hors de l'app (cases jamais pré-cochées).
create table trip_notification_setting (
  trip_id integer not null references trip (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  push boolean not null default false,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- Appareil abonné au push web (un navigateur = un abonnement). Supprimé à la déconnexion ou quand le service de push le refuse.
-- endpoint : adresse fournie par le navigateur, limitée par le serveur aux services de push connus ; jamais renvoyée au client.
create table push_subscription (
  id integer generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  endpoint varchar(2048) not null unique check (endpoint like 'https://%'),
  p256dh varchar(200) not null,
  auth varchar(100) not null,
  created_at timestamptz not null default now()
);

create index push_subscription_user_idx on push_subscription (user_id);

grant select, insert, delete on trip_notification_setting to brb_app;
grant update (push, email, updated_at) on trip_notification_setting to brb_app;
grant select, insert, delete on push_subscription to brb_app;
-- Même navigateur, autre compte : l'abonnement change de propriétaire.
grant update (user_id, p256dh, auth) on push_subscription to brb_app;

reset role;
