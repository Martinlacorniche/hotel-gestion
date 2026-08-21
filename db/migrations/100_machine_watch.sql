-- 100_machine_watch.sql
-- « La machine est-elle encore en vie ? » — surveillance des deux PC sur site :
--   · serveur-corniche  : stack HACCP (zigbee2mqtt/mosquitto/bridge) + proxy Chromecast
--                         + relais écran SmallTV, à La Corniche
--   · pc-tthotel-voiles : PC TTHotel des Voiles, qui héberge l'agent encodeur
--
-- Principe : chaque machine pousse un battement de cœur ; c'est le SILENCE qui
-- alerte (une machine morte ne peut pas signaler sa propre mort). Le surveillant
-- est un cron Supabase (cf. 101_machine_watch_cron.sql) : il vit en dehors des
-- deux hôtels, donc il survit à une coupure de courant ou d'internet sur site.
--
-- `offline_since` sert d'anti-répétition : rempli = l'alerte « hors ligne » est
-- déjà partie, on ne la renvoie pas toutes les 3 minutes. Remis à NULL au retour,
-- ce qui déclenche le message « de retour en ligne ».

create table if not exists public.machine_watch (
  id            text primary key,        -- 'serveur-corniche'
  label         text not null,           -- libellé lisible dans l'alerte Telegram
  hotel_id      uuid references public.hotels(id) on delete set null,
  seuil_sec     integer not null default 300,
  actif         boolean not null default true,
  last_seen     timestamptz,
  detail        jsonb,                   -- état des services au dernier battement
  offline_since timestamptz,             -- non NULL = alerte hors ligne déjà envoyée
  updated_at    timestamptz not null default now()
);

alter table public.machine_watch enable row level security;

-- Lecture pour les utilisateurs authentifiés (voyant dans /technique plus tard).
-- Écriture par les agents avec la clé service_role, qui contourne RLS.
drop policy if exists machine_watch_read on public.machine_watch;
create policy machine_watch_read on public.machine_watch
  for select to authenticated using (true);

insert into public.machine_watch (id, label, hotel_id, seuil_sec) values
  ('serveur-corniche',  'Serveur Corniche (sondes + Chromecast)', 'f9d59e56-9a2f-433e-bcf4-f9753f105f32', 300),
  ('pc-tthotel-voiles', 'PC TTHotel Les Voiles',                  'ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 300)
on conflict (id) do nothing;
