-- 79_parfum_reconcile.sql
-- Réconciliation COMPLÈTE du module parfum. La 76 a été appliquée en plusieurs
-- fois et `create table if not exists` n'altère pas une table préexistante :
-- des tables ont gardé un schéma antérieur (parfums.hotel_id NOT NULL → seed en
-- échec → table vide ; diffuseurs sans unique(device_id) ; policies d'écriture
-- absentes). Ce script remet tout à l'état cible. Idempotent — rejouable sans risque.

-- ============================ parfums (catalogue global) ====================
alter table public.parfums drop constraint if exists parfums_hotel_id_code_key;
alter table public.parfums drop column if exists hotel_id;
do $$ begin
  alter table public.parfums add constraint parfums_code_key unique (code);
exception when duplicate_object then null; end $$;

insert into public.parfums (code, nom, emoji, couleur, ordre) values
  ('figue',      'Figue',       '🌸', '#A9757F', 1),
  ('petitgrain', 'Petit grain', '🍊', '#C4863B', 2),
  ('thenoir',    'Thé noir',    '🤍', '#524C43', 3)
on conflict (code) do nothing;

-- ============================ diffuseurs ====================================
do $$ begin
  alter table public.diffuseurs add constraint diffuseurs_device_id_key unique (device_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.diffuseurs add constraint diffuseurs_room_unit_id_key unique (room_unit_id);
exception when duplicate_object then null; end $$;
alter table public.diffuseurs alter column hotel_id drop not null;

-- ============================ RLS : lecture + écriture ======================
alter table public.parfums          enable row level security;
alter table public.diffuseurs       enable row level security;
alter table public.diffuseur_buses  enable row level security;
alter table public.consignes_parfum enable row level security;

-- lecture pour tout utilisateur authentifié
drop policy if exists parfums_read on public.parfums;
create policy parfums_read on public.parfums for select to authenticated using (true);
drop policy if exists diffuseurs_read on public.diffuseurs;
create policy diffuseurs_read on public.diffuseurs for select to authenticated using (true);
drop policy if exists diffuseur_buses_read on public.diffuseur_buses;
create policy diffuseur_buses_read on public.diffuseur_buses for select to authenticated using (true);
drop policy if exists consignes_parfum_read on public.consignes_parfum;
create policy consignes_parfum_read on public.consignes_parfum for select to authenticated using (true);

-- écriture staff : mapping, config flacons, consignes
drop policy if exists diffuseurs_update on public.diffuseurs;
create policy diffuseurs_update on public.diffuseurs for update to authenticated using (true) with check (true);
drop policy if exists diffuseur_buses_write on public.diffuseur_buses;
create policy diffuseur_buses_write on public.diffuseur_buses for all to authenticated using (true) with check (true);
drop policy if exists consignes_parfum_insert on public.consignes_parfum;
create policy consignes_parfum_insert on public.consignes_parfum for insert to authenticated with check (true);
