-- 77_diffuseurs_fix.sql
-- Réconcilie `diffuseurs` : la 76 a pu être appliquée en plusieurs fois, et
-- `create table if not exists` ne modifie pas une table préexistante — la
-- contrainte unique sur device_id (requise par l'upsert de l'agent) et la
-- nullabilité de hotel_id ont donc pu ne pas être posées. Idempotent.

-- device_id unique : l'agent upsert les machines par device_id (on_conflict).
do $$ begin
  alter table public.diffuseurs add constraint diffuseurs_device_id_key unique (device_id);
exception when duplicate_object then null; end $$;

-- une machine par chambre.
do $$ begin
  alter table public.diffuseurs add constraint diffuseurs_room_unit_id_key unique (room_unit_id);
exception when duplicate_object then null; end $$;

-- hotel_id nullable (rempli au mapping, déduit de la chambre).
alter table public.diffuseurs alter column hotel_id drop not null;
