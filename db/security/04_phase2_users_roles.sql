-- ============================================================================
-- Phase 2.A — Migration vers le modèle 3 rôles : superadmin / admin / user
-- ============================================================================
-- État avant :
--   role 'employe' (19 lignes) + 'admin' (4 lignes), pas de CHECK constraint.
-- État après :
--   role 'user' (19 lignes) + 'admin' (3 lignes) + 'superadmin' (1 ligne = Martin),
--   CHECK constraint pour cadrer les 3 valeurs autorisées.
--
-- Le code applicatif teste encore `role === 'admin'` à plusieurs endroits
-- (page.tsx:239, caisse/page.tsx:88, planning/page.tsx:79, etc.) — il sera
-- mis à jour dans une étape suivante pour reconnaître 'admin' OU 'superadmin'.
--
-- Idempotent. À jouer dans Supabase SQL Editor.
-- ============================================================================

-- 1) Migration 'employe' → 'user' (19 lignes attendues)
update public.users
set role = 'user'
where role = 'employe';

-- 2) Promotion de Martin en superadmin (par id_auth, plus robuste que par email)
update public.users
set role = 'superadmin'
where id_auth = 'c29223b8-4afb-42ea-996c-055bbbe820d3';

-- 3) Forcer les éventuels NULL en 'user' (au cas où, pour pouvoir ajouter la CHECK)
update public.users
set role = 'user'
where role is null;

-- 4) Ajouter une CHECK constraint pour cadrer les valeurs autorisées
--    Si elle existe déjà (rejouage), on la drop d'abord.
alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role in ('superadmin', 'admin', 'user'));

-- 5) Index sur role : utile pour les RLS Phase 2 qui filtreront par rôle
create index if not exists idx_users_role on public.users(role);

-- 6) Vérification finale — doit montrer :
--    superadmin : 1
--    admin      : 3
--    user       : 19
select role, count(*) as nb
from public.users
group by role
order by
  case role
    when 'superadmin' then 1
    when 'admin' then 2
    when 'user' then 3
    else 4
  end;
