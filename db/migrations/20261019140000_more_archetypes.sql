-- Plus de types de récit (feed, éditeur de récit, planificateur), et une description pour ceux qui n'en avaient pas.
-- Données de référence, ensuite gérées depuis l'administration (libellé, description, actif).
-- À exécuter dans Cloud SQL Studio (Console GCP → SQL → biirb-db1), connecté avec son compte Google.

set role brb_admin;

insert into archetype (slug, label, description) values
  ('road_trip', 'Road trip', 'Sur la route en voiture ou en van, au gré des étapes'),
  ('backpacking', 'Sac à dos', 'Petit budget, auberges de jeunesse et rencontres'),
  ('city_break', 'City break', 'Quelques jours intenses dans une grande ville'),
  ('beach_relax', 'Plage & farniente', 'Soleil, mer et journées sans réveil'),
  ('island_hopping', 'Tour des îles', 'D''une île à l''autre en bateau ou en avion'),
  ('family', 'En famille', 'Des activités pour petits et grands, un rythme tranquille'),
  ('romantic', 'En amoureux', 'Escapade à deux, adresses intimistes et couchers de soleil'),
  ('with_friends', 'Entre amis', 'Activités de groupe, bonnes tables et soirées'),
  ('culture_museums', 'Culture & musées', 'Musées, monuments et histoire locale'),
  ('street_food', 'Street food', 'Marchés, stands et spécialités à manger sur le pouce'),
  ('wine_terroir', 'Vins & terroirs', 'Vignobles, dégustations et produits du terroir'),
  ('wildlife', 'Nature & faune sauvage', 'Parcs nationaux, safaris et observation des animaux'),
  ('hiking', 'Randonnée', 'Sentiers à la journée, panoramas et refuges'),
  ('winter_sports', 'Ski & neige', 'Stations, glisse et chalets en hiver'),
  ('water_sports', 'Plongée & surf', 'Spots de plongée, de surf et sports nautiques'),
  ('cycling', 'À vélo', 'Itinéraires cyclables, étapes à la force des mollets'),
  ('train_journey', 'Voyage en train', 'Grandes lignes et trains panoramiques, sans avion'),
  ('festivals_nightlife', 'Fêtes & festivals', 'Festivals, concerts et vie nocturne'),
  ('wellness', 'Bien-être & spa', 'Sources chaudes, spas et retraites pour se ressourcer'),
  ('spiritual', 'Spiritualité', 'Temples, pèlerinages et lieux sacrés'),
  ('luxury', 'Voyage de luxe', 'Hôtels d''exception, tables étoilées et service sur mesure'),
  ('digital_nomad', 'Nomade numérique', 'Travailler en voyageant : coworkings, cafés et longs séjours')
on conflict (slug) do nothing;

update archetype set description = case slug
  when 'slow_travel_photography' then 'Prendre son temps, s''attarder et photographier'
  when 'solo_architecture' then 'Seul, à la découverte des bâtiments et des villes'
  when 'culinary_heritage' then 'Recettes traditionnelles, produits et savoir-faire locaux'
  when 'mountain_trek' then 'Treks de plusieurs jours en altitude'
end
where description is null and slug in ('slow_travel_photography', 'solo_architecture', 'culinary_heritage', 'mountain_trek');

reset role;
