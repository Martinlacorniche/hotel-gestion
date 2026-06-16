-- ============================================================================
-- Module Écran — RLS policy (messages vers l'écran SmallTV)
-- ============================================================================
-- Contrairement aux autres tables (modèle "authenticated_all"), screen_messages
-- est une fonction SUPERADMIN ONLY et discrète. On ne veut donc PAS de policy
-- ouverte aux `authenticated`.
--
-- RLS activé + AUCUNE policy => deny par défaut pour tout rôle `authenticated`.
-- Les accès légitimes passent par :
--   - l'API route Next.js /api/screen/message (service_role, garde superadmin)
--   - le worker Python sur le LAN (service_role)
-- Le `service_role` bypass toujours la RLS : ces deux chemins fonctionnent,
-- mais aucun client navigateur (même authentifié) ne peut lire/écrire en direct.
--
-- Idempotent.
-- ============================================================================

alter table public.screen_messages enable row level security;

-- On retire toute policy résiduelle pour garantir le deny par défaut.
drop policy if exists "authenticated_all" on public.screen_messages;

-- Vérification finale : la table doit avoir RLS activé et 0 policy.
select
  c.relname              as table_name,
  c.relrowsecurity       as rls_enabled,
  count(p.policyname)    as nb_policies
from pg_class c
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = c.relname
where c.relname = 'screen_messages'
group by c.relname, c.relrowsecurity;
