-- 109_haccp_sonde_muette.sql
-- Une sonde qui se tait n'alerte personne — et c'est justement le pire cas.
--
-- Trou constaté le 2026-08-21 : `machine_watch` surveille les MACHINES, pas les
-- sondes. Si une pile meurt ou que la stack Zigbee tombe pendant que le mini-PC
-- va très bien, le registre HACCP s'arrête pour ce frigo sans que personne ne
-- soit prévenu. Un registre qui cesse d'enregistrer est un problème de
-- conformité, pas une panne technique mineure.
--
-- Ce n'est pas théorique : du 09/07 au 14/07, les CINQ sondes se sont tues
-- pendant 4,9 jours. Personne ne l'a su.
--
-- On décline exactement le motif de `machine_watch` (100) — un marqueur
-- anti-répétition sur la ligne surveillée plutôt qu'une table d'épisodes — pour
-- que ça se lise pareil et se débogue pareil.

-- Seuil : les Tuya ZT01 se taisent naturellement jusqu'à 30 min quand la
-- température est stable (les congélateurs tournent à 17-20 min d'écart moyen ;
-- seul Frigo Gauche est bavard, 2,6 min, parce qu'il cycle sans arrêt). Sur
-- 60 jours, un seuil à 2 h aurait produit 10 signalements, dont 5 pour la seule
-- panne globale de juillet. C'est le bon ordre de grandeur : assez haut pour ne
-- pas crier sur une cadence normale, assez bas pour ne pas perdre une journée.
alter table public.haccp_sensors
  add column if not exists silence_max_min integer not null default 120,
  -- non NULL = la sonde est considérée muette ; porte la date du dernier relevé
  add column if not exists silence_since timestamptz,
  -- non NULL = Telegram a été prévenu. Distinct de `silence_since` : quand la
  -- machine entière est hors ligne on note le silence sans le crier (machine_watch
  -- l'a déjà fait), et il ne faut pas annoncer un retour qu'on n'a jamais annoncé.
  add column if not exists silence_notified_at timestamptz;

comment on column public.haccp_sensors.silence_max_min is
  'Minutes de silence tolérées avant signalement. La cadence naturelle d''une ZT01 monte à 30 min.';

create or replace function public.haccp_silence_check()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  token   text;
  chat    text;
  thread  text;
  s       record;
  dernier timestamptz;
  muette  boolean;
  machine_hs boolean;
  msg     text;
  minutes integer;
begin
  select decrypted_secret into token  from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into chat   from vault.decrypted_secrets where name = 'telegram_chat_id';
  select decrypted_secret into thread from vault.decrypted_secrets where name = 'telegram_thread_haccp';

  for s in
    select id, location, hotel_id, silence_max_min, silence_since, silence_notified_at
      from public.haccp_sensors
     where active
  loop
    select max(recorded_at) into dernier
      from public.haccp_readings where sensor_id = s.id;

    -- Une sonde sans le moindre relevé n'est pas « muette », elle n'a jamais
    -- parlé : c'est une sonde qu'on vient de déclarer et pas encore appairée.
    if dernier is null then
      continue;
    end if;

    muette := dernier < now() - make_interval(mins => s.silence_max_min);

    -- La machine du site est-elle elle-même tombée ? Si oui, machine_watch a
    -- déjà crié : cinq messages « sonde muette » par-dessus ne diraient rien de
    -- plus et noieraient le vrai message.
    select coalesce(bool_or(offline_since is not null), false) into machine_hs
      from public.machine_watch
     where actif and hotel_id = s.hotel_id;

    if muette and s.silence_since is null then
      update public.haccp_sensors
         set silence_since = dernier,
             silence_notified_at = case when machine_hs then null else now() end
       where id = s.id;

      if not machine_hs and token is not null and chat is not null then
        minutes := round(extract(epoch from (now() - dernier)) / 60);
        msg := '🔕 Sonde muette — ' || s.location || E'\n'
            || 'Aucun relevé depuis le '
            || to_char(dernier at time zone 'Europe/Paris', 'DD/MM à HH24:MI')
            || ' (' || minutes || ' min).' || E'\n'
            || 'Le registre HACCP ne s''écrit plus pour cet équipement.';
        perform net.http_post(
          url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body    := jsonb_strip_nulls(jsonb_build_object(
                       'chat_id', chat, 'message_thread_id', thread, 'text', msg)),
          timeout_milliseconds := 15000
        );
      end if;

    elsif not muette and s.silence_since is not null then
      -- Retour à la parole. On n'annonce le retour que si on avait annoncé le
      -- départ, sinon le fil raconte une histoire dont il manque le début.
      if s.silence_notified_at is not null and token is not null and chat is not null then
        minutes := round(extract(epoch from (now() - s.silence_since)) / 60);
        msg := '🔔 Sonde de retour — ' || s.location || E'\n'
            || 'Après ' || minutes || ' min de silence.';
        perform net.http_post(
          url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body    := jsonb_strip_nulls(jsonb_build_object(
                       'chat_id', chat, 'message_thread_id', thread, 'text', msg)),
          timeout_milliseconds := 15000
        );
      end if;
      update public.haccp_sensors
         set silence_since = null, silence_notified_at = null
       where id = s.id;
    end if;
  end loop;
end;
$$;

revoke all on function public.haccp_silence_check() from public, anon, authenticated;

select cron.unschedule('haccp-silence-check')
where exists (select 1 from cron.job where jobname = 'haccp-silence-check');

-- Toutes les 5 minutes : on parle d'un seuil de 2 heures, la minute près n'a
-- aucun intérêt et le cron des alertes tourne déjà chaque minute.
select cron.schedule('haccp-silence-check', '*/5 * * * *', $$ select public.haccp_silence_check(); $$);
