-- 103_maintenance_photos_jobs_machine.sql
-- Deux briques pour le bot Telegram.
--
-- 1) `maintenance.photos` — la clim a déjà ses photos (`clim_incidents.photos`
--    + bucket `clim-photos`) ; la maintenance non. On décline le même motif,
--    pour que le site, App-Consignes et le bot écrivent tous au même endroit.
--
-- 2) `jobs_machine` — la file d'attente des actions déclenchées depuis Telegram.
--    Netlify ne peut pas joindre serveur-corniche (il est derrière Tailscale),
--    donc un bouton n'exécute jamais rien directement : il dépose un ordre ici,
--    et l'agent du mini-PC le ramasse au passage de son battement de cœur —
--    exactement le motif déjà éprouvé par `jobs_encodeur` pour l'encodeur.

-- 1) Photos de maintenance ---------------------------------------------------

alter table public.maintenance
  add column if not exists photos text[];

insert into storage.buckets (id, name, public)
values ('maintenance-photos', 'maintenance-photos', true)
on conflict (id) do nothing;

drop policy if exists maintenance_photos_select on storage.objects;
create policy maintenance_photos_select on storage.objects
  for select to authenticated using (bucket_id = 'maintenance-photos');

drop policy if exists maintenance_photos_insert on storage.objects;
create policy maintenance_photos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'maintenance-photos');

drop policy if exists maintenance_photos_update on storage.objects;
create policy maintenance_photos_update on storage.objects
  for update to authenticated using (bucket_id = 'maintenance-photos');

drop policy if exists maintenance_photos_delete on storage.objects;
create policy maintenance_photos_delete on storage.objects
  for delete to authenticated using (bucket_id = 'maintenance-photos');

-- 2) File d'attente des actions machine --------------------------------------

create table if not exists public.jobs_machine (
  id          uuid primary key default gen_random_uuid(),
  machine_id  text not null references public.machine_watch(id) on delete cascade,
  action      text not null,          -- 'restart_service'
  payload     jsonb,                  -- {"service":"chromecast-hotel"}
  statut      text not null default 'en_attente'
              check (statut in ('en_attente','en_cours','fait','echec')),
  resultat    text,
  demande_par text,                   -- identifiant Telegram du demandeur
  -- de quoi revenir éditer le message d'origine pour y afficher le résultat
  tg_chat_id    text,
  tg_message_id bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists jobs_machine_a_faire
  on public.jobs_machine (machine_id, created_at)
  where statut = 'en_attente';

alter table public.jobs_machine enable row level security;

-- Lecture pour l'app ; l'agent et la route webhook écrivent en service_role,
-- qui contourne RLS. Aucun rôle authentifié ne peut créer un ordre : une action
-- sur une machine ne part que de la route webhook, après vérification de qui
-- a appuyé sur le bouton.
drop policy if exists jobs_machine_read on public.jobs_machine;
create policy jobs_machine_read on public.jobs_machine
  for select to authenticated using (true);
