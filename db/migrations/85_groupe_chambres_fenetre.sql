-- ⚠️⚠️ MIGRATION REMPLACÉE PAR LA 86 — NE PAS S'EN INSPIRER ⚠️⚠️
-- Elle a réellement été appliquée en prod le 2026-07-16, puis annulée quelques
-- minutes plus tard par la 86 (qui DROP ses colonnes) : conservée uniquement pour
-- que l'historique soit fidèle et sans trou de numérotation.
-- Pourquoi elle était fausse : `date_debut`/`date_fin` ne sait exprimer qu'une
-- sous-plage CONTINUE. Or une chambre peut être vendue des nuits AU MILIEU du bloc.
-- Voir 86_groupe_chambres_nuits_exclues.sql.

-- ============================================================================
-- 85 — Groupes : une fenêtre de dates PAR CHAMBRE du bloc
-- ----------------------------------------------------------------------------
-- POURQUOI (Martin 2026-07-16) : « un bloc peut me prendre des chambres mais pas
-- toutes sur les mêmes dates, genre certaines jusqu'au 28 mais d'autres jusqu'au
-- 29. Là on a un seul bloc avec toutes les chambres jusqu'au 29. »
--
-- Aujourd'hui `groupe_chambres` ne porte AUCUNE date : (groupe_id, chambre_id,
-- hotel_id, tarif_nuit). Une chambre du bloc est donc implicitement disponible sur
-- TOUTE la fenêtre du groupe. Si la 03 est déjà vendue la nuit du 28, on n'a aucun
-- moyen de l'exprimer — il faut la sortir du bloc entièrement, alors qu'elle est
-- parfaitement vendable au groupe du 18 au 28.
--
-- C'est exactement le cas CACTUS : « départs les 28 ET 29 ».
--
-- Modèle : deux dates NULLABLES.
--   · NULL = la chambre suit la fenêtre du groupe → **les blocs existants ne
--     bougent pas**, aucune reprise de données.
--   · renseignées = la chambre n'est réservable QUE dans cette sous-fenêtre.
--
-- La fenêtre est INCLUSE dans celle du groupe (contrainte impossible à écrire en
-- CHECK — elle référencerait `groupes` — donc vérifiée côté API, comme l'est déjà
-- « Dates hors des bornes du séjour »).
-- ============================================================================

alter table public.groupe_chambres
  add column if not exists date_debut date,
  add column if not exists date_fin   date;

-- Cohérence interne : au moins une nuit quand les deux sont renseignées.
alter table public.groupe_chambres drop constraint if exists groupe_chambres_fenetre_check;
alter table public.groupe_chambres
  add constraint groupe_chambres_fenetre_check
  check (date_debut is null or date_fin is null or date_fin > date_debut);

comment on column public.groupe_chambres.date_debut is
  'Début de disponibilité de CETTE chambre dans le bloc. NULL = la date d''arrivée du groupe.';
comment on column public.groupe_chambres.date_fin is
  'Fin de disponibilité de CETTE chambre dans le bloc (bornes [) : dernière nuit = date_fin - 1). NULL = la date de départ du groupe. Sert quand une chambre n''est libre que sur une partie du séjour (ex. déjà vendue la dernière nuit).';
