-- ============================================================================
-- 37 — Mews check-outs déjà vus (anti-doublon du poller)
-- ============================================================================
-- Le poller Mews (route /api/mews/poll-checkouts, déclenché par pg_cron) tourne
-- toutes les ~5 min entre 06h et 15h (Paris) et détecte les départs (résas à
-- l'état Processed) de l'hôtel Les Voiles. Pour qu'un même check-out ne génère
-- qu'UNE seule transmission `chambres_liberees` (= 1 notif housekeeping), on
-- mémorise ici les réservations déjà traitées. La clé primaire est le
-- reservation_id Mews : un INSERT en doublon échoue silencieusement (ON CONFLICT
-- DO NOTHING côté route) → idempotent même si deux polls se chevauchent.
--
-- Table purement interne : écrite uniquement par le service_role (côté serveur).
-- Aucun client n'y accède → RLS activé SANS policy = personne d'autre ne lit.
--
-- Idempotent : à jouer dans le SQL Editor Supabase.

CREATE TABLE IF NOT EXISTS public.mews_checkouts_vus (
  reservation_id text PRIMARY KEY,
  hotel_id       uuid REFERENCES public.hotels(id),
  chambre        text NOT NULL DEFAULT '',
  seen_at        timestamptz NOT NULL DEFAULT now()
);

-- Purge des anciennes entrées (le poller ne regarde que le jour courant ;
-- inutile de garder l'historique au-delà de quelques jours).
CREATE INDEX IF NOT EXISTS mews_checkouts_vus_seen_idx
  ON public.mews_checkouts_vus (seen_at);

-- RLS activé, aucune policy : seul le service_role (qui bypasse RLS) peut lire/écrire.
ALTER TABLE public.mews_checkouts_vus ENABLE ROW LEVEL SECURITY;
