-- 110_haccp_durees_recalculees.sql
-- Le registre annonçait des durées qui sont de la fiction.
--
-- Avant la migration 106, le bridge perdait la référence d'une alerte ouverte
-- (redémarrage, plusieurs alertes ouvertes sur la même sonde) : elle restait
-- ouverte des jours, et sa `resolved_at` a fini par être posée bien après le
-- vrai retour sous seuil. Résultat : « Frigo Gauche hors plage pendant 12 647
-- minutes » (8,8 jours) alors que 1,9 % seulement des relevés de la fenêtre
-- étaient réellement hors plage. C'était un dégivrage de 38 minutes.
--
-- La clôture rétroactive du 20/08 n'avait traité que 8 lignes. Il en restait 30.
--
-- ⚠️ Deux pièges rencontrés en écrivant ce recalcul, tous deux capables de
-- corrompre le registre s'ils passaient inaperçus :
--
--   1) Les sondes émettent en RAFALES. À 22:30:58 on trouve 3,5 puis 4,2 puis
--      3,5 — trois relevés dans la même seconde. Chercher « le premier relevé
--      revenu dans les clous » attrape le 3,5 de la rafale et conclut à une
--      alerte de 0 minute. On raisonne donc sur le dernier relevé HORS plage,
--      jamais sur le premier relevé rentré.
--
--   2) La coupure qui marque la fin d'un épisode doit être plus longue que la
--      cadence naturelle de la sonde. À 15 min, l'épisode réel de 13 h du 18/08
--      était tronqué à 11 minutes — une ZT01 se tait jusqu'à 30 min quand la
--      température est stable. 60 min laisse passer la cadence normale tout en
--      restant six fois plus court que l'intervalle de dégivrage.
--
-- Validé sur des cas témoins dont le registre était déjà juste (20/08, 18/08,
-- 15/08, 13/08, 08/08) : durées ET pics identiques au chiffre en place.
--
-- Rien n'est effacé : l'ancienne valeur est écrite dans `action_taken`, et la
-- table entière est sauvegardée avant l'opération.

begin;

create table if not exists public.haccp_alerts_avant_recalcul_20260821 as
  select * from public.haccp_alerts;

-- Les relevés hors plage de chaque alerte, avec l'écart au précédent.
create temporary table _hors on commit drop as
  select a.id as alerte, r.recorded_at,
         extract(epoch from (r.recorded_at - lag(r.recorded_at)
           over (partition by a.id order by r.recorded_at))) / 60 as trou_min
    from public.haccp_alerts a
    join public.haccp_sensors s on s.id = a.sensor_id
    join public.haccp_readings r on r.sensor_id = a.sensor_id
                                and r.recorded_at >= a.triggered_at
                                and r.recorded_at <= a.resolved_at
   where a.resolved_at is not null
     and case when a.threshold_type = 'high' then r.temperature > s.temp_max
              else r.temperature < s.temp_min end;

-- Fin de la série continue : le dernier relevé hors plage avant une coupure
-- de plus de 60 minutes.
create temporary table _fin on commit drop as
  with coupure as (
    select alerte, min(recorded_at) as apres_coupure
      from _hors where trou_min > 60 group by alerte
  )
  select h.alerte, max(h.recorded_at) as fin_hors
    from _hors h left join coupure c on c.alerte = h.alerte
   where c.apres_coupure is null or h.recorded_at < c.apres_coupure
   group by h.alerte;

create temporary table _corrections on commit drop as
  select a.id,
         a.resolved_at as ancienne_fin,
         a.peak_value  as ancien_pic,
         coalesce(
           (select min(r.recorded_at) from public.haccp_readings r
             where r.sensor_id = a.sensor_id and r.recorded_at > f.fin_hors
               and case when a.threshold_type = 'high' then r.temperature <= s.temp_max
                        else r.temperature >= s.temp_min end),
           f.fin_hors) as nouvelle_fin,
         case when a.threshold_type = 'high'
              then (select max(r.temperature) from public.haccp_readings r
                     where r.sensor_id = a.sensor_id
                       and r.recorded_at between a.triggered_at and f.fin_hors)
              else (select min(r.temperature) from public.haccp_readings r
                     where r.sensor_id = a.sensor_id
                       and r.recorded_at between a.triggered_at and f.fin_hors)
         end as nouveau_pic,
         a.triggered_at, a.action_taken
    from public.haccp_alerts a
    join public.haccp_sensors s on s.id = a.sensor_id
    join _fin f on f.alerte = a.id;

-- Seules les lignes matériellement fausses. Cinq minutes d'écart ne valent pas
-- une ligne de correction dans un registre.
delete from _corrections
 where ancienne_fin - nouvelle_fin <= interval '5 minutes';

update public.haccp_alerts a
   set resolved_at = c.nouvelle_fin,
       peak_value  = c.nouveau_pic,
       action_taken = trim(both ' ·' from
         coalesce(nullif(a.action_taken, '') || ' · ', '') ||
         'Durée recalculée le 21/08/2026 depuis les relevés : l''alerte était restée ' ||
         'ouverte par un défaut du collecteur (corrigé depuis). Fin précédemment ' ||
         'enregistrée le ' || to_char(c.ancienne_fin at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI') ||
         ' soit ' || round(extract(epoch from (c.ancienne_fin - c.triggered_at)) / 60) || ' min ; ' ||
         'retour effectif sous seuil constaté dans les relevés le ' ||
         to_char(c.nouvelle_fin at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI') ||
         ' soit ' || round(extract(epoch from (c.nouvelle_fin - c.triggered_at)) / 60) || ' min. ' ||
         'Pic recalculé sur la fenêtre réelle : ' ||
         replace(to_char(c.ancien_pic, 'FM990.0'), '.', ',') || ' °C → ' ||
         replace(to_char(c.nouveau_pic, 'FM990.0'), '.', ',') || ' °C.')
  from _corrections c
 where a.id = c.id;

commit;

-- Note : deux alertes du 25/05 (jour de la mise en service) ne contiennent
-- aucun relevé hors plage — leur `peak_value` est à la valeur exacte du seuil.
-- Elles ne sont pas touchées : on ne recalcule pas ce qu'on ne peut pas
-- reconstituer.
