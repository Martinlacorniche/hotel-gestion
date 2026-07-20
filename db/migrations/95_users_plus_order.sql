-- 95 — Ordre personnalisé des entrées de l'écran Plus (app mobile)
--
-- Tableau ORDONNÉ d'identifiants, même convention que users.mobile_tabs
-- (migration 92) : NULL = jamais réglé → ordre par défaut.
--
-- ⚠️ LE GRANT EST OBLIGATOIRE. La migration 93 a révoqué l'UPDATE global sur
-- public.users et le rouvre colonne par colonne. Une préférence ajoutée sans
-- être listée ici échoue EN SILENCE côté client : l'écran affiche le nouvel
-- ordre, et le réglage n'est jamais enregistré.

alter table public.users add column if not exists plus_order jsonb;

comment on column public.users.plus_order is
  'Ordre perso des entrées de l''écran Plus (app mobile). NULL = ordre par défaut.';

grant update (plus_order) on public.users to authenticated;
