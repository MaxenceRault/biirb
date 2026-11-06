set role brb_admin;

-- Suppression d'un compte (par l'utilisateur, #112, ou par un admin) : ses dons restent en base pour la comptabilité,
-- sans lien avec la personne, comme les pass voyage (trip_pass.user_id).
alter table patron_donation alter column user_id drop not null;
alter table patron_donation
  drop constraint patron_donation_user_id_fkey,
  add constraint patron_donation_user_id_fkey foreign key (user_id) references users (id) on delete set null;

reset role;
