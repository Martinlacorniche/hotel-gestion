-- 106_haccp_alertes_orphelines.sql
-- Neuf alertes traînaient ouvertes, la plus vieille depuis le 31/07, alors que
-- les frigos étaient rentrés dans les clous depuis longtemps. Deux défauts du
-- bridge (agent_zigbee/bridge/index.js) s'enchaînaient :
--
--   A. `client.on('message', async …)` n'est pas attendu par MQTT.js, et les
--      Tuya ZT01 émettent par bursts de 3-5 datapoints en <300 ms. Deux messages
--      du même burst traversaient `checkThreshold` en parallèle, voyaient tous
--      les deux `openAlertId === null`, et inséraient chacun leur alerte — d'où
--      des doublons au `triggered_at` identique à la milliseconde.
--   B. `loadOpenAlerts()` indexe par `sensor_id` dans une Map : sur plusieurs
--      alertes ouvertes pour une même sonde, seule la dernière survivait. Les
--      autres n'étaient plus référencées, donc plus jamais ni mises à jour ni
--      résolues. Orphelines à vie.
--
-- On ne date pas la clôture d'aujourd'hui : le registre doit dire quand la
-- température est réellement revenue, ce que les relevés savent. On recalcule
-- aussi `peak_value`, sous-évalué sur les orphelines (le bridge ne mettait plus
-- à jour que l'alerte survivante de la Map).
--
-- `telegram_resolved_at` est posé dans le même mouvement : sans lui, le cron
-- `haccp-alert-notify` déverserait neuf « ✅ rentré dans les clous » d'affilée
-- pour des épisodes vieux de trois semaines.

begin;

with borne as (
  select al.id,
         al.sensor_id,
         al.threshold_type,
         al.triggered_at,
         (select min(r.recorded_at)
            from public.haccp_readings r
           where r.sensor_id = al.sensor_id
             and r.recorded_at > al.triggered_at
             and (s.temp_max is null or r.temperature <= s.temp_max)
             and (s.temp_min is null or r.temperature >= s.temp_min)) as retour
    from public.haccp_alerts al
    join public.haccp_sensors s on s.id = al.sensor_id
   where al.resolved_at is null
)
update public.haccp_alerts al
   set resolved_at = b.retour,
       peak_value = coalesce(
         (select case when b.threshold_type = 'high'
                      then max(r.temperature) else min(r.temperature) end
            from public.haccp_readings r
           where r.sensor_id = b.sensor_id
             and r.recorded_at >= b.triggered_at
             and r.recorded_at <= b.retour),
         al.peak_value),
       telegram_resolved_at = now(),
       action_taken = case when coalesce(al.action_taken, '') = '' then '' 
                           else al.action_taken || E'\n' end
                   || 'Clôture rétroactive le 20/08/2026 : alerte restée ouverte '
                   || 'par un défaut du collecteur, jamais portée à connaissance. '
                   || 'Retour sous seuil constaté dans les relevés le '
                   || to_char(b.retour at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI')
                   || '. Pic recalculé depuis les relevés.'
  from borne b
 where al.id = b.id
   and b.retour is not null;

-- Le filet qui rend le bug A impossible à reproduire, quoi qu'il arrive au code
-- du bridge : une sonde ne peut pas avoir deux alertes ouvertes à la fois.
-- Partiel, donc l'historique résolu (doublons compris) n'est pas contraint.
create unique index if not exists haccp_alerts_une_seule_ouverte
  on public.haccp_alerts (sensor_id)
  where resolved_at is null;

commit;
