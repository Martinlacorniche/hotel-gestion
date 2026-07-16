-- ============================================================================
-- 84 — Groupes : affichage des tarifs + traitement de la taxe de séjour
-- ----------------------------------------------------------------------------
-- POURQUOI (Martin 2026-07-16, dossier CACTUS FILMS) :
--
-- 1) AFFICHAGE DES TARIFS. Sur un groupe pris en charge (tournage : la production
--    règle tout), afficher « 170 € / nuit » à chaque comédien n'a aucun sens — et
--    la barre « réservé 18 700 / 31 900 » leur montrerait la valeur du dossier.
--    Mais l'organisateur, lui, veut suivre la consommation du bloc. D'où un
--    interrupteur à 3 positions plutôt qu'un booléen :
--      · 'complet' → prix à la nuit + barre budget   (défaut = comportement actuel)
--      · 'budget'  → pas de prix, mais la barre reste (vue organisateur)
--      · 'masque'  → ni prix ni budget               (vue invité pris en charge)
--
-- 2) TAXE DE SÉJOUR. Elle doit compter dans le prix global du groupe, mais sa
--    place dépend de la négociation → la réception la déclare :
--      · 'sur_place' → le voyageur la règle à l'hôtel : HORS prix du bloc (défaut,
--                      c'est le cas courant)
--      · 'incluse'   → déjà comprise dans le tarif à la nuit : on n'ajoute RIEN
--      · 'ajoutee'   → s'additionne au tarif (cas CACTUS : le devis 159 la porte en
--                      ligne séparée, 2,83 €/nuit/personne)
--    Le MONTANT n'existait nulle part (il vivait dans les devis, à la main) → on le
--    stocke ici, par groupe : c'est un tarif réglementaire qui change selon l'année
--    et le classement, et la personne qui monte le bloc est celle qui le connaît.
--
-- Les défauts reproduisent EXACTEMENT le comportement d'avant : les groupes
-- existants (mariages) ne bougent pas.
-- ============================================================================

-- 1) Affichage des tarifs ----------------------------------------------------
alter table public.groupes
  add column if not exists affichage_tarifs text not null default 'complet';

alter table public.groupes drop constraint if exists groupes_affichage_tarifs_check;
alter table public.groupes
  add constraint groupes_affichage_tarifs_check
  check (affichage_tarifs in ('complet', 'budget', 'masque'));

comment on column public.groupes.affichage_tarifs is
  'Ce que l''invité voit du prix : complet = tarif/nuit + barre budget · budget = barre seule (organisateur) · masque = rien (groupe pris en charge).';

-- 2) Taxe de séjour ----------------------------------------------------------
alter table public.groupes
  add column if not exists taxe_sejour_mode text not null default 'sur_place';

alter table public.groupes drop constraint if exists groupes_taxe_sejour_mode_check;
alter table public.groupes
  add constraint groupes_taxe_sejour_mode_check
  check (taxe_sejour_mode in ('sur_place', 'incluse', 'ajoutee'));

alter table public.groupes
  add column if not exists taxe_sejour_montant numeric(6,2) not null default 0
  check (taxe_sejour_montant >= 0);

comment on column public.groupes.taxe_sejour_mode is
  'Place de la taxe de séjour dans le prix du bloc : sur_place = réglée à l''hôtel, hors prix · incluse = déjà dans le tarif/nuit · ajoutee = s''additionne au tarif.';
comment on column public.groupes.taxe_sejour_montant is
  'Taxe de séjour en € PAR NUIT ET PAR PERSONNE (ex. 2,83 à La Corniche en 2026). Ignoré si taxe_sejour_mode = incluse.';
