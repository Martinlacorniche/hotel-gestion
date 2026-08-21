-- 108_haccp_seuil_critique.sql
-- Règle d'alerte à deux étages.
--
-- Constat du 2026-08-21 : Frigo Gauche dégivre automatiquement 4 fois par jour
-- (écarts entre montées = multiples de ~6 h sur 21 jours, et l'heure glisse
-- d'une semaine à l'autre — un minuteur qui compte les heures de compresseur).
-- Chaque dégivrage monte à 7-9 °C pendant ~35 min puis redescend en 12 min.
-- Avec `alert_delay_min = 30`, chacun déclenche une alerte : sur 21 jours,
-- 106 dépassements de 4 °C, médiane 13 min, 90e centile 32 min — et seulement
-- DEUX au-delà de 60 min (138 min, et l'épisode de 13 h du 18/08).
--
-- Un registre noyé de fausses dérives est un risque en soi : il dilue les
-- vraies. Mais allonger simplement le délai rendrait sourd à un accident franc
-- — d'où le second étage : au-delà d'un seuil critique, on alerte sans
-- attendre. Un frigo à 10 °C n'a pas besoin de 45 minutes pour être un
-- problème.

alter table public.haccp_sensors
  add column if not exists temp_crit_max numeric,
  add column if not exists temp_crit_min numeric;

comment on column public.haccp_sensors.temp_crit_max is
  'Au-dessus, on alerte immédiatement sans attendre alert_delay_min. NULL = pas de second étage.';
comment on column public.haccp_sensors.temp_crit_min is
  'En dessous, on alerte immédiatement sans attendre alert_delay_min. NULL = pas de second étage.';

-- Pourquoi l'alerte est partie : « 45 min au-dessus du seuil » et « 10,5 °C
-- d'emblée » ne se lisent pas pareil dans un registre six mois plus tard.
alter table public.haccp_alerts
  add column if not exists trigger_reason text;

comment on column public.haccp_alerts.trigger_reason is
  'delai | seuil_critique — ce qui a déclenché. NULL pour les alertes antérieures au 21/08/2026.';

-- Les deux frigos : 45 min de tolérance (au-delà du dégivrage le plus long
-- observé), plafond dur à 10 °C.
-- `sensor_type` vaut 'positif' / 'negatif' : les positives sont exactement les
-- deux frigos, les négatives les trois congélateurs.
update public.haccp_sensors
   set alert_delay_min = 45,
       temp_crit_max   = 10
 where sensor_type = 'positif';

-- Les congélateurs restent tels quels : leur comportement de dégivrage n'a pas
-- été étudié, et inventer un seuil critique dans un registre réglementaire
-- sans données serait pire que de ne rien faire.
