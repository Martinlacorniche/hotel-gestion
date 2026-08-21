-- 105_haccp_alertes_telegram.sql
-- Les alertes HACCP naissent bien dans `haccp_alerts` (le bridge les ouvre, met
-- à jour le pic, les résout), mais `email_sent_at` est nul partout : personne
-- n'a jamais été prévenu. On branche Telegram sur le sujet Haccp.
--
-- Avec des boutons, et c'est le vrai gain : `acknowledged_at` et `action_taken`
-- existent depuis toujours et sont vides, parce que remplir une traçabilité sur
-- un écran, personne ne le fait. Un appui sur un bouton depuis le téléphone, si.
-- Le registre réglementaire se remplit donc en même temps qu'on réagit.
--
-- `acknowledged_by` reste nul : c'est un uuid qui référence `users`, et un
-- compte Telegram n'en est pas un. Qui a acquitté est écrit dans `action_taken`.
--
-- ⚠️ Les alertes déjà en base (certaines ouvertes depuis le 31/07) sont marquées
-- comme déjà notifiées : brancher le canal ne doit pas déverser l'arriéré.

alter table public.haccp_alerts
  add column if not exists telegram_sent_at     timestamptz,
  add column if not exists telegram_message_id  bigint,
  add column if not exists telegram_resolved_at timestamptz;

update public.haccp_alerts
   set telegram_sent_at     = coalesce(telegram_sent_at, now()),
       telegram_resolved_at = case when resolved_at is not null
                                   then coalesce(telegram_resolved_at, now()) end
 where telegram_sent_at is null;

create or replace function public.haccp_alert_notify()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  token  text;
  chat   text;
  thread text;
  a      record;
  msg    text;
  req    bigint;
begin
  select decrypted_secret into token  from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into chat   from vault.decrypted_secrets where name = 'telegram_chat_id';
  select decrypted_secret into thread from vault.decrypted_secrets where name = 'telegram_thread_haccp';
  if token is null or chat is null then
    return;
  end if;

  -- 1) Nouvelles alertes
  for a in
    select al.id, al.threshold_type, al.triggered_at, al.peak_value,
           s.location, s.temp_min, s.temp_max
      from public.haccp_alerts al
      join public.haccp_sensors s on s.id = al.sensor_id
     where al.telegram_sent_at is null
     order by al.triggered_at
  loop
    msg := '🌡️ ALERTE — ' || a.location || E'\n'
        || replace(to_char(a.peak_value, 'FM990.0'), '.', ',') || ' °C'
        || case when a.threshold_type = 'high'
                then ' (maximum ' || replace(to_char(a.temp_max, 'FM990.0'), '.', ',') || ' °C)'
                else ' (minimum ' || replace(to_char(a.temp_min, 'FM990.0'), '.', ',') || ' °C)' end
        || E'\nDepuis ' || to_char(a.triggered_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI');

    select net.http_post(
      url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_strip_nulls(jsonb_build_object(
                   'chat_id', chat,
                   'message_thread_id', thread,
                   'text', msg,
                   'reply_markup', jsonb_build_object('inline_keyboard', jsonb_build_array(
                     jsonb_build_array(jsonb_build_object('text', '👀 J''ai vu',            'callback_data', 'hc:' || a.id || ':vu')),
                     jsonb_build_array(jsonb_build_object('text', '🚪 Porte restée ouverte', 'callback_data', 'hc:' || a.id || ':porte')),
                     jsonb_build_array(jsonb_build_object('text', '🔧 Frigoriste appelé',    'callback_data', 'hc:' || a.id || ':frigo'))
                   )))),
      timeout_milliseconds := 15000
    ) into req;

    -- Marqué tout de suite : pg_net répond en différé, et une alerte notifiée
    -- deux fois serait pire qu'une alerte notifiée sans accusé de réception.
    update public.haccp_alerts set telegram_sent_at = now() where id = a.id;
  end loop;

  -- 2) Retours à la normale
  for a in
    select al.id, al.resolved_at, al.triggered_at, s.location
      from public.haccp_alerts al
      join public.haccp_sensors s on s.id = al.sensor_id
     where al.resolved_at is not null
       and al.telegram_sent_at is not null
       and al.telegram_resolved_at is null
  loop
    msg := '✅ Rentré dans les clous — ' || a.location || E'\n'
        || 'Après ' || trim(to_char(extract(epoch from (a.resolved_at - a.triggered_at)) / 60, '999999')) || ' min.';

    perform net.http_post(
      url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_strip_nulls(jsonb_build_object(
                   'chat_id', chat, 'message_thread_id', thread, 'text', msg)),
      timeout_milliseconds := 15000
    );

    update public.haccp_alerts set telegram_resolved_at = now() where id = a.id;
  end loop;
end;
$$;

revoke all on function public.haccp_alert_notify() from public, anon, authenticated;

select cron.unschedule('haccp-alert-notify')
where exists (select 1 from cron.job where jobname = 'haccp-alert-notify');

-- Toutes les minutes : une température qui dérive se rattrape en minutes, pas
-- en heures. Le coût est nul quand il n'y a rien à faire.
select cron.schedule('haccp-alert-notify', '* * * * *', $$ select public.haccp_alert_notify(); $$);
