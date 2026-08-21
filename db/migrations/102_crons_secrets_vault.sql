-- 102_crons_secrets_vault.sql
-- Répare trois crons qui n'ont JAMAIS fonctionné, et supprime la cause.
--
-- Constat du 2026-08-20 : `pass-revoke-drain`, `mail-purge-junk` et
-- `groupes-paiement-programme` ont été planifiés en gardant le placeholder
-- littéral (`__SERRURES_REVOKE_SECRET__`, `__CRON_SECRET__`) au lieu de la vraie
-- valeur — exactement le piège annoncé en commentaire de la migration 75.
-- Résultat : 401 à chaque passage, en silence, depuis leur création.
--   · les révocations de passes ne partaient plus
--   · les indésirables ne se purgeaient plus
--   · les paiements programmés des groupes n'étaient plus déclenchés
--
-- La cause n'est pas l'étourderie, c'est le procédé : un secret qu'il faut
-- penser à recopier à la main finira toujours par ne pas l'être, et rien ne
-- le signale. On lit donc désormais le secret depuis Supabase Vault **au moment
-- de l'exécution**. Ce fichier ne contient plus aucun secret, et faire tourner
-- un secret ne demande plus de replanifier quoi que ce soit.
--
-- Les secrets attendus (créés hors git) :
--   select vault.create_secret('…', 'serrures_revoke_secret');
--   select vault.create_secret('…', 'cron_secret');

do $$
declare
  base text := 'https://magnificent-gumdrop-4b7f4f.netlify.app';
begin
  -- 1) Révocation des passes de serrures — toutes les 10 min
  perform cron.unschedule('pass-revoke-drain')
  where exists (select 1 from cron.job where jobname = 'pass-revoke-drain');

  perform cron.schedule('pass-revoke-drain', '*/10 * * * *', format($f$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-revoke-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'serrures_revoke_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $f$, base || '/api/serrures/passes/revoke-drain'));

  -- 2) Purge des indésirables — tous les 3 jours à 4h UTC
  perform cron.unschedule('mail-purge-junk')
  where exists (select 1 from cron.job where jobname = 'mail-purge-junk');

  perform cron.schedule('mail-purge-junk', '0 4 */3 * *', format($f$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $f$, base || '/api/mail-assistant/purge-junk'));

  -- 3) Paiements programmés des groupes — tous les jours à 5h UTC
  perform cron.unschedule('groupes-paiement-programme')
  where exists (select 1 from cron.job where jobname = 'groupes-paiement-programme');

  perform cron.schedule('groupes-paiement-programme', '0 5 * * *', format($f$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $f$, base || '/api/groupes/paiement-programme'));
end $$;

-- Garde-fou : plus aucun cron ne doit contenir de placeholder non remplacé.
do $$
declare n int;
begin
  select count(*) into n from cron.job where command ~ '__[A-Z_]+__';
  if n > 0 then
    raise exception 'Il reste % cron(s) avec un placeholder non remplacé', n;
  end if;
end $$;
