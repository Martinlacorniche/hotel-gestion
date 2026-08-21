-- 107_haccp_alertes_dedup.sql
-- Dédoublonnage du registre HACCP.
--
-- 44 lignes en trop sur 107 (41 %), étalées de mai à août : avant la migration
-- 106, un redémarrage du bridge pouvait rouvrir une alerte déjà enregistrée.
-- Le dernier doublon date du 18/08, la 106 tient depuis — il ne reste que le
-- passif à nettoyer.
--
-- ⚠️ On FUSIONNE avant de supprimer. Dans 26 groupes sur 42, l'acquittement
-- n'est posé que sur une partie des jumelles : garder bêtement la première
-- effacerait la trace d'une action humaine dans un registre réglementaire.
-- Chaque champ est repris sur la valeur la plus défavorable ou la plus
-- renseignée, jamais la plus flatteuse.
--
-- Rien ne référence `haccp_alerts` (aucune clé étrangère entrante), et aucun
-- groupe ne contient d'alerte encore ouverte : la suppression est sans effet
-- de bord.

begin;

-- Filet : la table entière avant l'opération. À garder le temps de vérifier
-- un bilan, puis à supprimer à la main.
create table if not exists public.haccp_alerts_avant_dedup_20260821 as
  select * from public.haccp_alerts;

-- Les groupes en double, et la ligne qu'on garde (choix arbitraire mais stable).
create temporary table _groupes on commit drop as
  select sensor_id, triggered_at, min(id::text)::uuid as garde, count(*) as n
  from public.haccp_alerts
  group by sensor_id, triggered_at
  having count(*) > 1;

-- 1) Faire remonter dans la ligne gardée tout ce que portaient ses jumelles.
with fusion as (
  select g.garde,
         max(a.resolved_at)                                          as resolved_at,
         -- le pic le plus défavorable : le plus chaud pour un dépassement
         -- haut, le plus froid pour un dépassement bas.
         case when min(a.threshold_type) = 'high'
              then max(a.peak_value) else min(a.peak_value) end      as peak_value,
         min(a.acknowledged_at)                                      as acknowledged_at,
         (array_remove(array_agg(a.acknowledged_by
            order by a.acknowledged_at nulls last), null))[1]        as acknowledged_by,
         (select string_agg(distinct t, ' · ')
            from unnest(array_agg(nullif(a.action_taken, ''))) as t
           where t is not null)                                      as action_taken,
         min(a.email_sent_at)                                        as email_sent_at,
         min(a.telegram_sent_at)                                     as telegram_sent_at,
         max(a.telegram_message_id)                                  as telegram_message_id,
         min(a.telegram_resolved_at)                                 as telegram_resolved_at
  from _groupes g
  join public.haccp_alerts a
    on a.sensor_id = g.sensor_id and a.triggered_at = g.triggered_at
  group by g.garde
)
update public.haccp_alerts a set
  resolved_at          = f.resolved_at,
  peak_value           = f.peak_value,
  acknowledged_at      = f.acknowledged_at,
  acknowledged_by      = f.acknowledged_by,
  action_taken         = f.action_taken,
  email_sent_at        = f.email_sent_at,
  telegram_sent_at     = f.telegram_sent_at,
  telegram_message_id  = f.telegram_message_id,
  telegram_resolved_at = f.telegram_resolved_at
from fusion f
where a.id = f.garde;

-- 2) Supprimer les surnuméraires.
delete from public.haccp_alerts a
using _groupes g
where a.sensor_id = g.sensor_id
  and a.triggered_at = g.triggered_at
  and a.id <> g.garde;

-- 3) Empêcher que ça revienne. La 106 n'interdisait qu'une alerte *ouverte*
--    par sonde ; une fois résolue, rien n'empêchait un second exemplaire du
--    même épisode. Deux alertes ne peuvent pas naître à la même milliseconde
--    sur la même sonde.
create unique index if not exists haccp_alerts_episode_unique
  on public.haccp_alerts (sensor_id, triggered_at);

commit;
