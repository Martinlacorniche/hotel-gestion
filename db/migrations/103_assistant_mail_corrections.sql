-- 103 — Corrections apportées par l'humain aux propositions de Junior.
--
-- Jusqu'ici, une erreur de classement ne laissait AUCUNE trace : la réception
-- ignorait la ligne et traitait le mail à la main, et personne ne le savait. Les
-- règles ne s'apprenaient donc qu'en session, à partir de ce que Martin avait vu
-- passer — c'est-à-dire une fraction de la réalité.
--
-- Une correction est de la DONNÉE, pas une conversation : l'équipe dit ce qui
-- aurait dû être fait, l'app retraite le mail immédiatement (aucun appel LLM), et
-- la ligne s'accumule ici. Les récurrences deviennent des règles à la session
-- suivante — le coût n'est plus par mail, il est par apprentissage.
--
-- `commentaire` est le champ le plus précieux : il porte ce que l'assistant ne
-- pourra jamais voir (l'état d'Hotsoft, ce qui s'est dit au téléphone).

create table if not exists public.assistant_mail_corrections (
  id             uuid primary key default gen_random_uuid(),
  log_id         uuid not null references public.assistant_mail_log(id) on delete cascade,
  mailbox        text not null,
  subject        text,
  from_addr      text,
  -- ce que Junior avait proposé…
  category_avant text not null,
  action_avant   text not null,
  -- …et ce que l'humain a retenu (null = seulement un commentaire, sans reclassement)
  category_apres text,
  action_apres   text,
  commentaire    text,
  corrige_par    uuid,
  created_at     timestamptz not null default now()
);

create index if not exists assistant_mail_corrections_created_idx
  on public.assistant_mail_corrections (created_at desc);
-- Sert au dépouillement : « quelle famille se fait corriger le plus cette semaine ? »
create index if not exists assistant_mail_corrections_cat_idx
  on public.assistant_mail_corrections (category_avant, category_apres);

comment on table public.assistant_mail_corrections is
  'Ce que Junior a proposé vs ce que l''humain a retenu. Matière première des règles : on dépouille les récurrences en session plutôt que d''appeler un LLM sur chaque mail.';

alter table public.assistant_mail_corrections enable row level security;

drop policy if exists amc_read on public.assistant_mail_corrections;
create policy amc_read on public.assistant_mail_corrections
  for select to authenticated using (true);
