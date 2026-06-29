-- ============================================================================
-- Checklist d'avancement + clôture sur fiches_fonctions
-- ============================================================================
-- Transforme la fiche de fonction (champ libre) en déroulé guidé : une colonne
-- JSONB porte les cases manuelles de la checklist (restauration calée,
-- hébergement confirmé, prestations consommées vérifiées) et l'état de clôture
-- (facture finale émise dans le PMS + date, fiche clôturée + date).
--
-- Les items "auto" (salles réservées) sont dérivés en live côté UI, pas stockés.
--
-- ⚠️ RÉTRO-COMPATIBLE : colonne NULLABLE. Les fiches existantes ont
--    checklist = NULL → traité comme checklist vide côté code. Rien ne casse.
--
-- Forme du JSON (toutes les clés optionnelles) :
--   {
--     "resto": true,                       -- restauration calée
--     "hebergement": false,                -- hébergement confirmé
--     "prestations_verifiees": false,      -- consommé/extras/no-show vérifiés
--     "facture_pms": false,                -- facture finale émise dans le PMS
--     "facture_pms_date": "2026-07-03",
--     "cloturee": false,                   -- fiche clôturée
--     "cloturee_at": "2026-07-03T10:00:00Z"
--   }
-- ============================================================================

alter table public.fiches_fonctions
  add column if not exists checklist jsonb;

-- Cache de l'analyse IA (assistant dossier). Forme :
--   { "result": {...}, "signature": "<hash des entrées>", "generated_at": "..." }
-- La "signature" est un hash de tout ce que l'IA a lu (lead + salles + devis +
-- programme + notes). À l'ouverture, le serveur recompare : empreinte identique
-- → on renvoie le cache (0 appel payant) ; différente → ré-analyse auto.
alter table public.fiches_fonctions
  add column if not exists audit jsonb;

-- Vérification
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'fiches_fonctions'
  and column_name in ('checklist', 'audit');
