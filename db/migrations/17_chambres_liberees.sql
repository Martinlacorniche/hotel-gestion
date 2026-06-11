-- ============================================================================
-- 17 — Chambres libérées (transmission récep → équipes, sans PMS connecté)
-- ============================================================================
-- La réception transmet la liste des chambres libérées (départs faits) via la
-- capture ✨ ("chambres libres 12 14 22") au lieu d'un SMS. Les équipes en
-- shift la voient dans l'app (carte du dashboard). Une ligne = une
-- transmission (peut en exister plusieurs dans la journée, ex. matin + fin de
-- matinée).
--
-- Idempotent : à jouer dans le SQL Editor Supabase.

CREATE TABLE IF NOT EXISTS public.chambres_liberees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hotels(id),
  chambres text[] NOT NULL DEFAULT '{}',
  auteur text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Requête type : les transmissions du jour pour un hôtel.
CREATE INDEX IF NOT EXISTS chambres_liberees_hotel_created_idx
  ON public.chambres_liberees (hotel_id, created_at DESC);

-- Même modèle de sécurité que le reste (cf. db/security/06) : tout
-- authentifié peut tout faire, la frontière de sécurité est le rôle côté API.
ALTER TABLE public.chambres_liberees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON public.chambres_liberees;
CREATE POLICY "authenticated_all" ON public.chambres_liberees
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
