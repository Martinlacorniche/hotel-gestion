-- 94 — Rôle DAF + saisie restauration manuelle
--
-- 1) Nouveau rôle 'daf' : accès nul sur le web, écran Tendance sur l'app mobile.
--    La contrainte posée en 04_phase2_users_roles.sql ne connaît que
--    superadmin/admin/user — on l'étend.
-- 2) La Corniche n'a pas de POS : son CA restauration est déclaratif,
--    saisi au mois dans l'app. On le range dans `kpis`, qui porte déjà
--    la clé (hotel_id, mois, annee) et le reste des KPI mensuels.

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('superadmin', 'admin', 'daf', 'user'));

alter table public.kpis add column if not exists resto_ca numeric;
alter table public.kpis add column if not exists resto_plats integer;

comment on column public.kpis.resto_ca is
  'CA restauration TTC du mois, saisie manuelle (hôtels sans POS, ex. La Corniche)';
comment on column public.kpis.resto_plats is
  'Nombre de plats servis dans le mois, saisie manuelle';
