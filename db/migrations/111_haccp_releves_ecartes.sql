-- 111_haccp_releves_ecartes.sql
-- Écarter des relevés qui ne mesuraient pas l'équipement.
--
-- Deux sondes de congélateur ont passé une semaine HORS de leur congélateur
-- (confirmé par Martin le 2026-08-21). La courbe ne laisse pas de doute : elle
-- passe de −27 °C à +22 °C en deux heures, tient la température ambiante des
-- jours durant, puis revient à −27 °C d'un coup. Un congélateur ne fait pas ça
-- avec la marchandise dedans.
--
--   · Congélateur Pain          09/06 21:59 → 16/06 11:35  (6,5 j, pic 30,5 °C)
--   · Congélateur Viennoiserie  06/07 13:56 → 17/07 13:01  (11 j,  pic 27,7 °C)
--
-- Tel quel, le registre affirme deux semaines de surgelés décongelés, et
-- n'importe quel bilan (min/max/moyenne, courbe, export CSV) est faux sur la
-- période. On ne supprime rien — supprimer d'un registre réglementaire n'est
-- jamais la réponse : on marque, et les lecteurs écartent ce qui est marqué.
--
-- La colonne est volontairement du texte libre et non un booléen : « pourquoi »
-- est ce qu'un contrôle demandera, et « oui » n'est pas une réponse.

alter table public.haccp_readings
  add column if not exists exclu_motif text;
alter table public.haccp_alerts
  add column if not exists exclu_motif text;

comment on column public.haccp_readings.exclu_motif is
  'Non NULL = relevé non représentatif de l''équipement (sonde déplacée, maintenance…). À écarter des bilans, jamais à supprimer.';
comment on column public.haccp_alerts.exclu_motif is
  'Non NULL = alerte issue de relevés non représentatifs. À écarter des comptages, jamais à supprimer.';

-- Index partiel : les lignes écartées sont rares, et tous les lecteurs vont
-- filtrer dessus.
create index if not exists haccp_readings_ecartes
  on public.haccp_readings (sensor_id, recorded_at) where exclu_motif is not null;

with periodes as (
  select s.id as sensor_id, p.debut, p.fin, p.motif
    from (values
      ('Congélateur Pain',
       '2026-06-09 19:59:00+00'::timestamptz, '2026-06-16 09:35:00+00'::timestamptz,
       'Sonde sortie du congélateur du 09/06/2026 21:59 au 16/06/2026 11:35 — relevés non représentatifs de l''équipement (confirmé le 21/08/2026).'),
      ('Congélateur Viennoiserie',
       '2026-07-06 11:56:00+00'::timestamptz, '2026-07-17 11:01:00+00'::timestamptz,
       'Sonde sortie du congélateur du 06/07/2026 13:56 au 17/07/2026 13:01 — relevés non représentatifs de l''équipement (confirmé le 21/08/2026).')
    ) as p(loc, debut, fin, motif)
    join public.haccp_sensors s on s.location = p.loc
)
update public.haccp_readings r
   set exclu_motif = p.motif
  from periodes p
 where r.sensor_id = p.sensor_id
   and r.recorded_at > p.debut
   and r.recorded_at < p.fin;

-- Les alertes nées de ces relevés suivent le même sort. On les garde : elles
-- disent la vérité de ce qui s'est passé (la sonde a bien vu 30 °C), mais elles
-- ne disent rien de la température du congélateur.
with periodes as (
  select s.id as sensor_id, p.debut, p.fin, p.motif
    from (values
      ('Congélateur Pain',
       '2026-06-09 19:59:00+00'::timestamptz, '2026-06-16 09:35:00+00'::timestamptz,
       'Alerte issue de relevés pris hors du congélateur (sonde sortie) — ne reflète pas la température de l''équipement. Constaté le 21/08/2026.'),
      ('Congélateur Viennoiserie',
       '2026-07-06 11:56:00+00'::timestamptz, '2026-07-17 11:01:00+00'::timestamptz,
       'Alerte issue de relevés pris hors du congélateur (sonde sortie) — ne reflète pas la température de l''équipement. Constaté le 21/08/2026.')
    ) as p(loc, debut, fin, motif)
    join public.haccp_sensors s on s.location = p.loc
)
update public.haccp_alerts a
   set exclu_motif = p.motif
  from periodes p
 where a.sensor_id = p.sensor_id
   and a.triggered_at > p.debut
   and a.triggered_at < p.fin;

-- ⚠️ Le piège des rafales, encore lui. À 16/06 11:35 la sonde a émis DEUX
-- valeurs dans le même instant : 22,7 °C (encore dehors) et −19,0 °C (déjà
-- remise). Une borne de fenêtre, si stricte soit-elle, en garde forcément une
-- des deux. On rattrape donc explicitement les relevés encore chauds situés à
-- la frontière : dans la minute qui suit la fin de la fenêtre, un relevé
-- au-dessus du seuil du congélateur ne mesure pas encore le congélateur.
with periodes as (
  select s.id as sensor_id, s.temp_max, p.debut, p.fin, p.motif
    from (values
      ('Congélateur Pain',
       '2026-06-09 19:59:00+00'::timestamptz, '2026-06-16 09:36:00+00'::timestamptz,
       'Sonde sortie du congélateur du 09/06/2026 21:59 au 16/06/2026 11:35 — relevés non représentatifs de l''équipement (confirmé le 21/08/2026).'),
      ('Congélateur Viennoiserie',
       '2026-07-06 11:56:00+00'::timestamptz, '2026-07-17 11:02:00+00'::timestamptz,
       'Sonde sortie du congélateur du 06/07/2026 13:56 au 17/07/2026 13:01 — relevés non représentatifs de l''équipement (confirmé le 21/08/2026).')
    ) as p(loc, debut, fin, motif)
    join public.haccp_sensors s on s.location = p.loc
)
update public.haccp_readings r
   set exclu_motif = p.motif
  from periodes p
 where r.sensor_id = p.sensor_id
   and r.exclu_motif is null
   and r.recorded_at > p.debut
   and r.recorded_at <= p.fin
   and r.temperature > p.temp_max;
