-- 101_machine_watch_cron.sql
-- Le surveillant : un cron Supabase qui, toutes les 3 minutes, regarde la
-- fraîcheur des battements de `machine_watch` et prévient sur Telegram.
--
-- Pourquoi ici et pas sur une des machines : le surveillant doit être ailleurs
-- que ce qu'il surveille. Depuis Supabase il survit à une coupure de courant ou
-- d'internet sur site, à une panne Netlify et à la box de Martin. Il ne peut pas
-- non plus *sonder* les machines (elles sont derrière Tailscale) — d'où le
-- modèle « la machine pousse, le silence alerte ».
--
-- Le jeton du bot est dans Supabase Vault, jamais dans ce fichier ni dans le
-- corps de la fonction :
--   select vault.create_secret('123456:AA…', 'telegram_bot_token');
--   select vault.create_secret('-1002…',     'telegram_chat_id');
-- Tant que les deux secrets n'existent pas, la fonction ne fait rien.

alter table public.machine_watch
  add column if not exists notified_at timestamptz;   -- dernière notif « hors ligne »

create or replace function public.machine_watch_check()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  token   text;
  chat_id text;
  m       record;
  msg     text;
  duree   interval;
begin
  select decrypted_secret into token   from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into chat_id from vault.decrypted_secrets where name = 'telegram_chat_id';
  if token is null or chat_id is null then
    return;   -- pas encore configuré
  end if;

  -- 1) Le PC TTHotel des Voiles n'a pas d'agent dédié : son agent encodeur écrit
  --    déjà dans `agent_heartbeat` toutes les 10 s, on recopie simplement.
  update public.machine_watch w
     set last_seen  = h.last_seen,
         detail     = h.detail,
         updated_at = now()
    from public.agent_heartbeat h
   where w.id = 'pc-tthotel-voiles'
     and h.hotel_id = w.hotel_id
     and w.last_seen is distinct from h.last_seen;

  -- 2) Bascule EN LIGNE → HORS LIGNE (première alerte), et relance toutes les 6 h
  --    tant que ça ne revient pas : une seule notification à 3 h du matin se rate.
  --    `last_seen is not null` : on n'alerte jamais sur une machine qui n'a
  --    jamais émis — ça, c'est une erreur de config, pas une panne.
  for m in
    select * from public.machine_watch
     where actif
       and last_seen is not null
       and last_seen < now() - make_interval(secs => seuil_sec)
       and (notified_at is null or notified_at < now() - interval '6 hours')
  loop
    duree := now() - m.last_seen;

    msg := '🔴 HORS LIGNE — ' || m.label || E'\n'
        || 'Plus de signe de vie depuis ' || to_char(m.last_seen at time zone 'Europe/Paris', 'DD/MM à HH24:MI')
        || ' (' || trim(to_char(extract(epoch from duree) / 60, '999999')) || ' min).';

    if m.detail is not null then
      msg := msg || E'\nDernier état connu : ' || m.detail::text;
    end if;

    perform net.http_post(
      url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object('chat_id', chat_id, 'text', msg),
      timeout_milliseconds := 15000
    );

    update public.machine_watch
       set offline_since = coalesce(offline_since, m.last_seen),
           notified_at   = now()
     where id = m.id;
  end loop;

  -- 3) Retour en ligne
  for m in
    select * from public.machine_watch
     where offline_since is not null
       and last_seen >= now() - make_interval(secs => seuil_sec)
  loop
    duree := m.last_seen - m.offline_since;

    msg := '🟢 De retour — ' || m.label || E'\n'
        || 'Absent pendant ' || trim(to_char(extract(epoch from duree) / 60, '999999')) || ' min.';

    perform net.http_post(
      url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object('chat_id', chat_id, 'text', msg),
      timeout_milliseconds := 15000
    );

    update public.machine_watch
       set offline_since = null, notified_at = null
     where id = m.id;
  end loop;
end;
$$;

revoke all on function public.machine_watch_check() from public, anon, authenticated;

select cron.unschedule('machine-watch')
where exists (select 1 from cron.job where jobname = 'machine-watch');

select cron.schedule('machine-watch', '*/3 * * * *', $$ select public.machine_watch_check(); $$);
