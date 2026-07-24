-- 104 — Les règles maison de Junior, en base plutôt que dans le code.
--
-- POURQUOI (Martin 2026-07-24). Ce que Junior sait du métier vivait à deux
-- endroits, et aucun n'était consultable : en dur dans les prompts de
-- `mailActions.ts` (la saison des Voiles, Back You résilié), et dans la mémoire
-- des sessions de développement. Conséquences : l'AGENT qui enquête n'y avait
-- aucun accès — il ignorait que Back You est résilié —, et changer une phrase
-- demandait un développeur et un déploiement.
--
-- Trois lecteurs, une seule source : le classifieur quand il trie, l'agent quand
-- il enquête, et l'humain quand il veut relire ou corriger.
--
-- ⚠️ Ce ne sont PAS des instructions techniques : ce sont des faits métier
-- écrits en français, qu'un réceptionniste doit pouvoir lire et comprendre.

create table if not exists public.junior_regles (
  id          uuid primary key default gen_random_uuid(),
  -- null = vaut pour les deux hôtels (ex. « on ne dépose rien sur une marketplace »)
  hotel_key   text check (hotel_key in ('voiles', 'corniche')),
  titre       text not null,
  regle       text not null,
  -- Où la règle s'applique : au tri et à la rédaction (`redaction`), à l'agent qui
  -- enquête (`agent`), ou aux deux. Une règle de rédaction n'a rien à faire dans le
  -- contexte d'une enquête, et inversement — sans quoi les deux prompts gonflent.
  portee      text not null default 'les_deux' check (portee in ('redaction', 'agent', 'les_deux')),
  actif       boolean not null default true,
  -- Ce qui a motivé la règle : sans le pourquoi, une session future la « corrige »
  -- en croyant bien faire. C'est l'erreur qu'on a faite avec Provence Méditerranée.
  origine     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create index if not exists junior_regles_lecture_idx
  on public.junior_regles (actif, hotel_key, portee);

comment on table public.junior_regles is
  'Faits métier que Junior ne peut pas deviner. Lus par le classifieur, par l''agent, et relisibles par l''équipe.';

alter table public.junior_regles enable row level security;

drop policy if exists junior_regles_read on public.junior_regles;
create policy junior_regles_read on public.junior_regles
  for select to authenticated using (true);
-- L'écriture passe par le service_role (API), comme le reste de l'assistant.

-- ── Ce qui existait en dur, repris tel quel ────────────────────────────────
insert into public.junior_regles (hotel_key, titre, regle, portee, origine)
values
  ('voiles', 'De novembre à avril, ce n''est pas un hôtel',
   'De NOVEMBRE à AVRIL, Les Voiles ne fonctionne pas en hôtel. L''établissement se loue en entier, en formule autonome : AUCUN service hôtelier (pas de réception, pas de petit-déjeuner, pas de ménage quotidien), le client a un accès autonome, comme dans une location de vacances.
· Si les dates demandées tombent dans cette période, dis-le CLAIREMENT et sans détour : on peut accueillir, mais dans ce format-là. Ne promets jamais un service qui n''existera pas à cette date.
· Ordre de grandeur pratiqué : environ 800 € la nuit pour l''ensemble, sur une dizaine de chambres. N''invente aucun autre tarif. Si le volume demandé s''écarte nettement d''une dizaine de chambres, annonce le format sans chiffrer et signale-le : c''est la direction qui tranchera le prix.
· De mai à octobre, l''hôtel fonctionne normalement : cette règle ne s''applique pas.',
   'les_deux',
   'Demande HotelPlanner du 24/07/2026 (anniversaire, 10 chambres, 26-28 mars 2027) : sans cette règle, Junior partait sur une proposition hôtelière classique et promettait des services inexistants à cette date.'),

  ('corniche', 'Back You est résilié — nous n''y sommes plus',
   'Back You est la plateforme semi-interne de Best Western. Notre abonnement est RÉSILIÉ : nous n''avons plus aucun accès, nous avons notre propre outil de devis.
· Ne promets JAMAIS d''y créer un devis, d''y déposer une offre ou d''y répondre. Ce serait un engagement intenable.
· Si la centrale le demande — elle le fait régulièrement — dis-le simplement et sans polémique : nous n''utilisons plus cette plateforme, notre proposition a été envoyée par mail, et nous établirons le contrat directement avec le client.
· On continue de RECEVOIR les demandes par Best Western : c''est le canal, pas l''outil, qui reste.
· Annonce-le comme une information NEUVE. Pas de « comme indiqué précédemment » si ça n''a pas été dit dans le fil : ce serait reprocher à l''interlocuteur de ne pas savoir ce qu''on ne lui a jamais écrit.',
   'les_deux',
   'Martin 2026-07-24 : plateforme jugée mauvaise et coûteuse, abonnement arrêté, outil de devis refait en interne. Lila Ayed a redemandé une saisie sur Back You le même jour.'),

  (null, 'On ne dépose rien sur une place de marché',
   'Si une demande vient d''une PLATEFORME qui réclame de déposer l''offre sur son site (HotelPlanner, place de marché, mise en concurrence), on n''y va pas : on répond par mail et on l''annonce poliment en ouverture.',
   'redaction',
   'Demande HotelPlanner du 24/07/2026. Règle Martin : on traite en direct.')
on conflict do nothing;
