-- ============================================================================
-- 86 — Groupes : les nuits retirées d'une chambre, une par une (remplace la 85)
-- ----------------------------------------------------------------------------
-- POURQUOI (Martin 2026-07-16). La migration 85 venait d'ajouter `date_debut` /
-- `date_fin` sur `groupe_chambres` : une chambre du bloc pouvait n'être offerte
-- que sur une SOUS-PLAGE CONTINUE du séjour.
--
-- Puis Martin a proposé l'interaction staff : « le bloc chambres ouvre le même
-- calendrier que côté client, on coche la chambre pour l'ouvrir, et en cliquant
-- sur une date on enlève cette date ». Cette interaction produit un ENSEMBLE
-- QUELCONQUE de nuits retirées — pas une plage continue.
--
-- Et c'est le monde réel qui a raison : une chambre peut très bien être déjà
-- vendue 2 nuits AU MILIEU du bloc (18→22 libre, 23-24 vendue, 25→29 libre).
-- `date_debut`/`date_fin` ne savent pas exprimer ça. Le modèle 85 était donc trop
-- faible : on le remplace avant que quiconque s'en serve.
--
-- Nouveau modèle : `nuits_exclues date[]` — la liste des nuits où CETTE chambre
-- n'est PAS offerte au groupe. Vide = toute la durée du groupe (défaut) → les
-- blocs existants ne bougent pas.
--   · « libre jusqu'au 28 seulement » = exclure la nuit du 28
--   · « vendue les 23 et 24 »          = exclure ces 2 nuits
-- Une NUIT est désignée par son jour de début (bornes [) partout dans ce module,
-- cf la contrainte d'exclusion de la migration 82).
--
-- Un tableau plutôt qu'une table de jointure : le volume est minuscule (quelques
-- nuits par chambre), la donnée n'a de sens qu'attachée à sa ligne, et l'UI
-- l'écrit d'un bloc.
--
-- Aucune reprise de données : au moment d'écrire, 108 lignes `groupe_chambres`,
-- 0 avec une fenêtre saisie.
-- ============================================================================

alter table public.groupe_chambres
  add column if not exists nuits_exclues date[] not null default '{}';

comment on column public.groupe_chambres.nuits_exclues is
  'Nuits où cette chambre n''est PAS offerte au groupe (une nuit = son jour de début, bornes [) ). Vide = disponible sur toute la durée du groupe. Permet de retirer des nuits isolées, y compris au milieu du séjour — ce que date_debut/date_fin (migration 85, retirée) ne savait pas faire.';

-- On retire le modèle de la 85, trop faible et jamais utilisé.
alter table public.groupe_chambres drop constraint if exists groupe_chambres_fenetre_check;
alter table public.groupe_chambres drop column if exists date_debut;
alter table public.groupe_chambres drop column if exists date_fin;
