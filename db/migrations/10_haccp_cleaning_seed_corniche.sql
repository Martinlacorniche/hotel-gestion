-- ============================================================================
-- Module HACCP — Plan de nettoyage : SEED initial La Corniche (version light)
-- ============================================================================
-- 9 zones et 40 tâches récurrentes couvrant les 4 fréquences
-- (daily / weekly / monthly / quarterly). Calibré sur l'équipement réel
-- La Corniche : pas de plaques de cuisson, pas de hotte d'extraction, pas
-- de trancheuse / robot pâtissier, pas de presse-orange.
--
-- Idempotent : peut être rejoué sans créer de doublons (filtre `where not
-- exists` sur (hotel_id + name) pour les zones et (zone_id + name) pour
-- les tâches).
--
-- Redéployable pour Les Voiles : changer `v_hotel_name` dans le DO block
-- ci-dessous puis rejouer.
--
-- À jouer dans Supabase SQL Editor APRÈS la migration 09_haccp_cleaning.sql.
-- (Et après 11_haccp_cleaning_corniche_reset.sql si une ancienne version
--  du seed avait déjà été appliquée.)
-- ============================================================================

do $$
declare
  v_hotel_name constant text := 'La Corniche';   -- ⚠️ changer ici pour Les Voiles
  v_hotel_id   uuid;
begin
  -- ----------------------------------------------------------------------
  -- Résolution de l'hôtel (table hotels, colonne `nom`)
  -- ----------------------------------------------------------------------
  select id into v_hotel_id
  from public.hotels
  where nom ilike v_hotel_name
  limit 1;

  if v_hotel_id is null then
    raise exception 'Hôtel introuvable : %', v_hotel_name;
  end if;

  raise notice 'Seed plan de nettoyage pour hôtel % (id=%)', v_hotel_name, v_hotel_id;

  -- ----------------------------------------------------------------------
  -- 1) Zones
  -- ----------------------------------------------------------------------
  insert into public.haccp_cleaning_zones (hotel_id, name, icon, sort_order)
  select v_hotel_id, z.name, z.icon, z.sort_order
  from (values
    ('Cuisine chaude',               '🔥', 10),
    ('Cuisine froide / pâtisserie',  '🥗', 20),
    ('Buffet petit-déjeuner',        '🥐', 30),
    ('Plonge / laverie',             '🧽', 40),
    ('Chambres froides',             '❄️', 50),
    ('Local poubelles',              '🗑️', 60),
    ('Sanitaires & vestiaires staff','🚻', 70),
    ('Réserves sèches',              '📦', 80),
    ('Réception marchandises',       '🚚', 90)
  ) as z(name, icon, sort_order)
  where not exists (
    select 1 from public.haccp_cleaning_zones zz
    where zz.hotel_id = v_hotel_id and zz.name = z.name
  );

  -- ----------------------------------------------------------------------
  -- 2) Tâches récurrentes
  -- ----------------------------------------------------------------------
  insert into public.haccp_cleaning_tasks
    (zone_id, name, frequency, product, instructions, estimated_min, sort_order)
  select z.id, t.name, t.frequency, t.product, t.instructions, t.estimated_min, t.sort_order
  from (values
    -- ===================== Cuisine chaude =====================
    ('Cuisine chaude', 'Nettoyer et désinfecter plans de travail',
      'daily', 'Détergent désinfectant alimentaire (NF EN 1276)',
      'Débarrasser → détergent → temps de contact 5 min → rinçage eau potable → essuie-tout à usage unique.',
      10, 10),
    ('Cuisine chaude', 'Désinfecter poignées, interrupteurs, écrans tactiles',
      'daily', 'Désinfectant alimentaire (lingettes ou spray)',
      'Tous les points de contact main après chaque service.',
      5, 20),
    ('Cuisine chaude', 'Détartrer four vapeur / mixte',
      'weekly', 'Détartrant alimentaire',
      'Lancer cycle détartrage selon notice constructeur.',
      20, 30),
    ('Cuisine chaude', 'Nettoyage carrelage mural et joints',
      'monthly', 'Détergent + désinfectant',
      'Du bas vers le haut, rincer abondamment, vérifier état des joints.',
      45, 40),
    ('Cuisine chaude', 'Décrassage sol (autolaveuse ou manuel)',
      'monthly', 'Détergent sol cuisine',
      'Après service du soir : balayage humide + lavage en profondeur.',
      30, 50),

    -- ===================== Cuisine froide / pâtisserie =====================
    ('Cuisine froide / pâtisserie', 'Nettoyer plans de travail froids',
      'daily', 'Désinfectant alimentaire',
      'Idem cuisine chaude : détergent → contact 5 min → rinçage → séchage.',
      10, 10),
    ('Cuisine froide / pâtisserie', 'Détartrer évier et robinetterie',
      'weekly', 'Détartrant alimentaire',
      'Action 15 min puis rinçage abondant.',
      10, 20),
    ('Cuisine froide / pâtisserie', 'Nettoyer four à micro-ondes',
      'weekly', 'Détergent alimentaire',
      'Intérieur + plateau tournant.',
      5, 30),
    ('Cuisine froide / pâtisserie', 'Décongélation et nettoyage frigos pâtisserie',
      'monthly', 'Détergent + désinfectant alimentaire',
      'Vider, débrancher, dégivrer, laver, désinfecter, sécher avant remise en marche.',
      60, 40),

    -- ===================== Buffet petit-déjeuner =====================
    ('Buffet petit-déjeuner', 'Nettoyer et désinfecter comptoir buffet',
      'daily', 'Désinfectant alimentaire',
      'Après service : démonter présentoirs, laver, désinfecter, sécher.',
      15, 10),
    ('Buffet petit-déjeuner', 'Nettoyer machine à café et bac marc',
      'daily', 'Pastilles / liquide nettoyant café spécifique',
      'Cycle nettoyage automatique + vidage bac marc + nettoyage buse vapeur.',
      10, 20),
    ('Buffet petit-déjeuner', 'Nettoyer chafing dishes / bains-marie',
      'daily', 'Détergent + désinfectant',
      'Vider eau, laver cuves, sécher, ranger.',
      10, 30),
    ('Buffet petit-déjeuner', 'Cycle nettoyage hebdomadaire machine à café',
      'weekly', 'Pastilles de nettoyage constructeur',
      'Lancer le cycle de nettoyage hebdomadaire complet (programme dédié de la machine).',
      15, 40),
    ('Buffet petit-déjeuner', 'Nettoyage approfondi mobilier salle PDJ',
      'monthly', 'Détergent multi-surfaces',
      'Tables, chaises, banquettes, plinthes.',
      45, 50),

    -- ===================== Plonge / laverie =====================
    ('Plonge / laverie', 'Vider et nettoyer lave-vaisselle (cuve + filtres)',
      'daily', 'Détergent lave-vaisselle pro',
      'Fin de service : vidange cuve, démontage et rinçage des filtres.',
      15, 10),
    ('Plonge / laverie', 'Désinfecter plonges inox',
      'daily', 'Désinfectant alimentaire',
      'Après chaque service : action 5 min puis rinçage.',
      10, 20),
    ('Plonge / laverie', 'Sortir poubelles cuisine',
      'daily', null,
      'Avant fermeture : sacs fermés, déposer au local poubelles.',
      5, 30),
    ('Plonge / laverie', 'Détartrer lave-vaisselle',
      'weekly', 'Détartrant lave-vaisselle pro',
      'Cycle détartrage à vide selon dosage constructeur.',
      20, 40),
    ('Plonge / laverie', 'Contrôler dosage produits lavage et rinçage',
      'monthly', null,
      'Vérifier consommation vs cycles, ajuster pompes doseuses si besoin.',
      10, 50),
    ('Plonge / laverie', 'Contrôle technique lave-vaisselle (T° rinçage ≥ 82°C)',
      'quarterly', 'Thermomètre étalonné',
      'Test température rinçage final, noter la valeur dans le champ notes.',
      15, 60),

    -- ===================== Chambres froides =====================
    ('Chambres froides', 'Nettoyer intérieur et étagères chambre froide positive',
      'weekly', 'Détergent + désinfectant alimentaire',
      'Vider, laver étagères et parois, rincer, sécher, remettre en service.',
      30, 10),
    ('Chambres froides', 'Nettoyer intérieur chambre froide négative',
      'weekly', 'Désinfectant alimentaire compatible froid',
      'Profiter d''un dégivrage ou d''un stock bas.',
      20, 20),
    ('Chambres froides', 'Décongélation complète et désinfection chambres froides',
      'monthly', 'Détergent + désinfectant',
      'Sortir produits en glacière, débrancher, dégivrer, laver, désinfecter, remettre en T° avant rechargement.',
      90, 30),
    ('Chambres froides', 'Contrôle joints de portes (étanchéité)',
      'quarterly', null,
      'Vérifier état caoutchouc, remplacer si fissure ou écrasement.',
      10, 40),

    -- ===================== Local poubelles =====================
    ('Local poubelles', 'Sortir et trier poubelles vers conteneurs',
      'daily', null,
      'Tri OM / cartons / verre selon consignes mairie.',
      10, 10),
    ('Local poubelles', 'Désinfecter bacs à roulettes intérieurs',
      'daily', 'Désinfectant locaux',
      'Après vidage : spray désinfectant.',
      5, 20),
    ('Local poubelles', 'Lavage complet local poubelles (sol + murs)',
      'weekly', 'Détergent désinfectant locaux + jet eau',
      'Jet basse pression, eau de javel diluée 0,5%, rinçage abondant.',
      30, 30),
    ('Local poubelles', 'Détartrage point d''eau local poubelles',
      'monthly', 'Détartrant',
      'Robinetterie + siphon.',
      10, 40),

    -- ===================== Sanitaires & vestiaires staff =====================
    ('Sanitaires & vestiaires staff', 'Nettoyer et désinfecter WC, lavabos, robinetterie',
      'daily', 'Détergent désinfectant sanitaires',
      'Cuvette, lunette, lavabo, miroir, robinetterie.',
      15, 10),
    ('Sanitaires & vestiaires staff', 'Recharger savon, papier WC, essuie-mains',
      'daily', null,
      'Vérifier consommables et remplacer si besoin.',
      5, 20),
    ('Sanitaires & vestiaires staff', 'Lavage sol sanitaires et vestiaires',
      'weekly', 'Détergent désinfectant sol',
      'Balayage humide puis lavage en profondeur (sanitaires + vestiaires).',
      20, 30),
    ('Sanitaires & vestiaires staff', 'Nettoyer armoires et bancs vestiaires',
      'weekly', 'Détergent multi-usage',
      'Lingettes sur armoires, bancs, points de contact.',
      15, 40),
    ('Sanitaires & vestiaires staff', 'Détartrage robinetterie sanitaires',
      'monthly', 'Détartrant ménager',
      'Action sur calcaire 15 min puis rinçage.',
      10, 50),
    ('Sanitaires & vestiaires staff', 'Désinfection complète vestiaires',
      'monthly', 'Désinfectant locaux',
      'Sol + parois + points de contact (poignées, bancs).',
      20, 60),

    -- ===================== Réserves sèches =====================
    ('Réserves sèches', 'Vérifier rotation stocks et DLC',
      'weekly', null,
      'FIFO/PEPS, retirer produits périmés, noter actions dans le champ notes.',
      15, 10),
    ('Réserves sèches', 'Nettoyer étagères réserve',
      'weekly', 'Détergent multi-usage',
      'Surfaces et joints, vérifier absence de traces de nuisibles.',
      15, 20),
    ('Réserves sèches', 'Lavage sol réserve',
      'monthly', 'Détergent désinfectant sol',
      'Décaler les stocks par zones successives pour accéder au sol.',
      30, 30),
    ('Réserves sèches', 'Contrôle pièges nuisibles (prestataire)',
      'quarterly', null,
      'Vérifier passage prestataire dératisation, archiver rapport dans documents HACCP.',
      10, 40),

    -- ===================== Réception marchandises =====================
    ('Réception marchandises', 'Nettoyer zone après livraison',
      'daily', 'Détergent multi-usage',
      'Sol et surface de dépose des cartons après chaque livraison.',
      5, 10),
    ('Réception marchandises', 'Lavage complet sol réception',
      'weekly', 'Détergent désinfectant sol',
      'Après le dernier camion de la semaine.',
      15, 20)
  ) as t(zone_name, name, frequency, product, instructions, estimated_min, sort_order)
  join public.haccp_cleaning_zones z
    on z.hotel_id = v_hotel_id and z.name = t.zone_name
  where not exists (
    select 1 from public.haccp_cleaning_tasks tt
    where tt.zone_id = z.id and tt.name = t.name
  );

  raise notice 'Seed terminé.';
end $$;

-- ----------------------------------------------------------------------------
-- Vérification finale : combien de zones et tâches sur La Corniche
-- ----------------------------------------------------------------------------
select
  h.nom                                                    as hotel,
  (select count(*) from public.haccp_cleaning_zones z
   where z.hotel_id = h.id and z.active)                   as nb_zones,
  (select count(*) from public.haccp_cleaning_tasks t
   join public.haccp_cleaning_zones z on z.id = t.zone_id
   where z.hotel_id = h.id and t.active)                   as nb_taches,
  (select count(*) from public.haccp_cleaning_tasks t
   join public.haccp_cleaning_zones z on z.id = t.zone_id
   where z.hotel_id = h.id and t.active and t.frequency = 'daily')      as nb_daily,
  (select count(*) from public.haccp_cleaning_tasks t
   join public.haccp_cleaning_zones z on z.id = t.zone_id
   where z.hotel_id = h.id and t.active and t.frequency = 'weekly')     as nb_weekly,
  (select count(*) from public.haccp_cleaning_tasks t
   join public.haccp_cleaning_zones z on z.id = t.zone_id
   where z.hotel_id = h.id and t.active and t.frequency = 'monthly')    as nb_monthly,
  (select count(*) from public.haccp_cleaning_tasks t
   join public.haccp_cleaning_zones z on z.id = t.zone_id
   where z.hotel_id = h.id and t.active and t.frequency = 'quarterly')  as nb_quarterly
from public.hotels h
where h.nom ilike 'La Corniche';
