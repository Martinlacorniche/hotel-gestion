-- Identité légale par hôtel — mentions obligatoires des factures émises
-- (Rooftop Les Voiles notamment). Les Voiles (SAS) et La Corniche (SARL) sont
-- DEUX entités juridiques distinctes : ne jamais mélanger leurs mentions.
-- À coller dans le SQL editor Supabase (après 61_hotels_email_equipe.sql).

alter table public.hotels
  add column if not exists raison_sociale      text,
  add column if not exists forme_juridique     text,   -- 'SAS', 'SARL'…
  add column if not exists siret               text,
  add column if not exists tva_intra           text,   -- n° TVA intracommunautaire
  add column if not exists rcs                 text,   -- ex. 'RCS Toulon 795 063 304'
  add column if not exists capital             text,   -- ex. '10 000 €'
  add column if not exists iban                text,
  add column if not exists bic                 text,
  add column if not exists adresse_facturation text;

-- Les Voiles — SAS (source : annuaire-entreprises INSEE, 02/07/2026).
-- iban laissé NULL (non nécessaire : encaissement sur place au Rooftop).
update public.hotels set
  raison_sociale      = 'LES VOILES',
  forme_juridique     = 'SAS',
  capital             = '10 000 €',
  siret               = '795 063 304 00021',
  tva_intra           = 'FR82 795 063 304',
  rcs                 = 'RCS Toulon 795 063 304',
  adresse_facturation = 'Hôtel Les Voiles, 124 rue Gubler, 83000 Toulon'
where nom ilike '%voiles%';

-- La Corniche — SARL (valeurs déjà utilisées dans src/app/devis/QuotePDF.tsx).
-- On ne renseigne QUE ce qui est certain ; le devis Corniche garde par ailleurs
-- ses valeurs codées en dur, cette ligne ne fait qu'alimenter la même source.
update public.hotels set
  forme_juridique = 'SARL',
  siret           = '341 797 199 00013',
  tva_intra       = 'FR50 341 797 199',
  rcs             = 'RCS Toulon 87800562',
  capital         = '10 000 €'
where nom ilike '%corniche%';
