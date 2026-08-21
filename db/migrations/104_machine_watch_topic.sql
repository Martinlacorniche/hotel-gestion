-- 104_machine_watch_topic.sql
-- Envoi des alertes machines dans un sujet précis du supergroupe.
--
-- Telegram identifie un sujet de forum par `message_thread_id`, à passer à
-- sendMessage. On le lit dans le Vault (`telegram_thread_machines`) plutôt que
-- de le figer ici : réorganiser les sujets ne doit pas demander une migration.
-- Absent → le message part dans le sujet Général, ce qui reste correct.
--
-- Rappel appris à l'installation : le sujet Général ne s'adresse PAS avec
-- `message_thread_id = 1` (Telegram répond « message thread not found ») mais
-- en omettant le champ. D'où le `jsonb_strip_nulls`.

create or replace function public.machine_watch_check()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  token   text;
  chat_id text;
  thread  text;
  m       record;
  msg     text;
  duree   interval;

  procedure_envoi text;
begin
  select decrypted_secret into token   from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into chat_id from vault.decrypted_secrets where name = 'telegram_chat_id';
  select decrypted_secret into thread  from vault.decrypted_secrets where name = 'telegram_thread_machines';
  if token is null or chat_id is null then
    return;
  end if;

  update public.machine_watch w
     set last_seen  = h.last_seen,
         detail     = h.detail,
         updated_at = now()
    from public.agent_heartbeat h
   where w.id = 'pc-tthotel-voiles'
     and h.hotel_id = w.hotel_id
     and w.last_seen is distinct from h.last_seen;

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
      body    := jsonb_strip_nulls(jsonb_build_object(
                   'chat_id', chat_id,
                   'message_thread_id', thread,
                   'text', msg)),
      timeout_milliseconds := 15000
    );

    update public.machine_watch
       set offline_since = coalesce(offline_since, m.last_seen),
           notified_at   = now()
     where id = m.id;
  end loop;

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
      body    := jsonb_strip_nulls(jsonb_build_object(
                   'chat_id', chat_id,
                   'message_thread_id', thread,
                   'text', msg)),
      timeout_milliseconds := 15000
    );

    update public.machine_watch
       set offline_since = null, notified_at = null
     where id = m.id;
  end loop;
end;
$$;

revoke all on function public.machine_watch_check() from public, anon, authenticated;
