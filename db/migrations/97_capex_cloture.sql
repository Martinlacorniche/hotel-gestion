-- 97 — Clôture des CAPEX et report d'un mois sur l'autre
--
-- Ce que la 96 ratait : un investissement prévu en mars et payé en juin
-- disparaissait de l'écran dès qu'on quittait mars. Or c'est exactement
-- l'inverse du besoin — une enveloppe non soldée doit RESTER SOUS LES YEUX
-- jusqu'à ce qu'on la solde.
--
-- Une ligne a donc désormais DEUX dates, et il faut les distinguer :
--   • (annee, mois)                 = le mois d'ORIGINE, quand on décide.
--   • (cloture_annee, cloture_mois) = le mois où on solde, quand on paie.
-- Entre les deux, la ligne se reporte : elle apparaît sur tous les mois
-- intermédiaires, dans le reste à engager.
--
-- LE MONTANT RÉEL COMPTE DANS LE MOIS DE CLÔTURE (décision de la direction) :
-- l'engagé d'un mois reflète le décaissement, pas la décision. C'est la lecture
-- trésorerie, cohérente avec le suivi en TTC.
--
-- La contrainte ci-dessous porte la règle métier « on ne solde pas sans
-- chiffre » : clôturer exige un montant réel. Sans elle, un clic malheureux
-- ferait disparaître une enveloppe du suivi sans que rien n'ait été payé, et
-- le reste à engager mentirait en silence.

alter table public.capex add column if not exists cloture_annee integer;
alter table public.capex add column if not exists cloture_mois   integer;
alter table public.capex add column if not exists cloture_at     timestamptz;
alter table public.capex add column if not exists cloture_by     uuid references public.users(id_auth);

alter table public.capex drop constraint if exists capex_cloture_coherente;
alter table public.capex add constraint capex_cloture_coherente check (
  (cloture_annee is null and cloture_mois is null)
  or (
    cloture_annee is not null
    and cloture_mois between 1 and 12
    and montant_reel_ttc is not null
  )
);

comment on column public.capex.annee is
  'Mois d''ORIGINE : quand la dépense a été décidée. Point de départ du report.';
comment on column public.capex.cloture_annee is
  'Mois de CLÔTURE : quand la ligne a été soldée. NULL = encore à engager, la ligne se reporte. Le montant réel est rattaché à CE mois.';

-- L'écran interroge « les lignes encore ouvertes », toutes années confondues :
-- une enveloppe de 2025 jamais soldée doit continuer à remonter en 2026.
create index if not exists capex_ouvertes_idx
  on public.capex (hotel_id) where cloture_annee is null;
