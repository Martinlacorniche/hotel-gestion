-- ============================================================================
-- 39 — Cache du taux d'occupation prévisionnel Mews (mois par mois) [Les Voiles]
-- ============================================================================
-- La route /api/mews/refresh-occupancy (déclenchée par pg_cron, cf. migration 40)
-- calcule l'occupation "on the books" mois par mois côté Mews et la stocke ici.
-- Le dashboard lit ce cache → aucun appel Mews depuis le navigateur.
--
-- 1 ligne = 1 (hôtel, mois). `month` au format 'YYYY-MM' (mois civil, Paris).
-- `occupancy` = pourcentage 0-100. Données purement agrégées (aucune PII).
-- Écrite uniquement par le service_role (la route) ; lecture par l'app via RLS
-- (cf. db/security/22_mews_occupancy_rls.sql).
--
-- Idempotent : à jouer dans le SQL Editor Supabase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mews_occupancy (
  hotel_id         uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  month            text NOT NULL,                 -- 'YYYY-MM'
  occupied_nights  integer NOT NULL DEFAULT 0,
  available_nights integer NOT NULL DEFAULT 0,
  occupancy        numeric(5,2) NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, month)
);

ALTER TABLE public.mews_occupancy ENABLE ROW LEVEL SECURITY;
