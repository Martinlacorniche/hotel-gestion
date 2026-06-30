-- ============================================================================
-- 44 — File de révocation des cartes de pass (suppression non bloquante)
-- ============================================================================
-- Supprimer un pass exigeait de blacklister sa carte sur TOUTES ses serrures
-- dans une seule requête HTTP → timeout / blocage dès qu'une serrure dort ou
-- qu'une passerelle est hors ligne, donc le pass ne se supprimait jamais.
--
-- Désormais : le DELETE retire le pass immédiatement et empile la carte ici.
-- Un cron draine la file serrure par serrure (fail-fast), retire les serrures
-- révoquées, et supprime la ligne quand `lock_ids` est vide.
--
-- À jouer dans le SQL Editor. Idempotent.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Table de file ───────────────────────────────────────────────────────────
create table if not exists public.pass_revocations (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid,
  card_no     text not null,
  pass_label  text,
  lock_ids    integer[] not null default '{}',   -- serrures RESTANT à révoquer
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_pass_revocations_pending
  on public.pass_revocations (created_at)
  where array_length(lock_ids, 1) > 0;

-- Accès service_role uniquement (les routes API + le drain passent par la clé
-- service qui bypasse RLS). RLS activée sans policy = invisible côté client.
alter table public.pass_revocations enable row level security;

-- ── Cron de drain (toutes les 10 min) ───────────────────────────────────────
-- ⚠️ AVANT DE COLLER, remplacer 1 valeur :
--   __SERRURES_REVOKE_SECRET__ → la valeur de SERRURES_REVOKE_SECRET (.env.local),
--      à poser AUSSI dans les variables d'env Netlify.
-- URL = sous-domaine Netlify PERMANENT de l'app consignes (cf. migration 38).

select cron.unschedule('pass-revoke-drain')
where exists (select 1 from cron.job where jobname = 'pass-revoke-drain');

select cron.schedule(
  'pass-revoke-drain',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://magnificent-gumdrop-4b7f4f.netlify.app/api/serrures/passes/revoke-drain',
    headers := '{"Content-Type":"application/json","x-revoke-secret":"__SERRURES_REVOKE_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Vérif :   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'pass-revoke-drain';
-- En file : SELECT pass_label, card_no, lock_ids, attempts, last_error FROM public.pass_revocations;
-- Stop :    SELECT cron.unschedule('pass-revoke-drain');
