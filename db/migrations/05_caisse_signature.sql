-- ============================================================================
-- Module Caisse — Signature électronique de validation de shift
-- ============================================================================
-- Ajoute la signature électronique (PNG base64) capturée sur écran tactile au
-- moment de la validation d'un shift caisse (matin / soir / clôture).
--
-- - signature_data    : dataURL PNG base64 (~5-20 ko par signature)
-- - signed_by_user_id : auth.uid() de la personne qui a signé (peut différer
--                       du user_id qui a saisi le shift)
-- - signed_by_name    : nom affiché du signataire (snapshot, audit)
-- - signed_at         : horodatage de la signature
--
-- À la réouverture d'un shift (admin), ces 4 champs sont remis à null par le
-- code applicatif → toute revalidation impose une nouvelle signature.
--
-- Idempotent. À jouer dans Supabase SQL Editor.
-- ============================================================================

alter table public.caisse_shifts
  add column if not exists signature_data    text,
  add column if not exists signed_by_user_id uuid,
  add column if not exists signed_by_name    text,
  add column if not exists signed_at         timestamptz;

-- Vérification finale
select
  column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'caisse_shifts'
  and column_name in ('signature_data', 'signed_by_user_id', 'signed_by_name', 'signed_at')
order by column_name;
