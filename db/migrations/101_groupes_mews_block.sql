-- 101 — Allotement Mews d'un groupe.
--
-- Un groupe ne vivait que dans notre base : ses chambres restaient en vente dans
-- le PMS et sur tous les canaux. Constaté le 2026-07-23 sur les deux mariages de
-- 2027 — des privatisations complètes, dont les 16 chambres des Voiles étaient
-- aussi vendables qu'un mardi ordinaire.
--
-- On crée désormais un vrai allotement dans Mews. Ces colonnes sont notre SEULE
-- prise dessus : `availabilityBlocks/getAll` renvoie 0 même filtré par identifiant,
-- et `availabilityAdjustments/getAll` est fermé (401). Sans ces colonnes, un bloc
-- créé serait définitivement hors de portée — ni modifiable, ni supprimable.
--
-- `mews_rate_id` : Mews CLONE le tarif modèle en un tarif propre au bloc. C'est sur
-- ce clone qu'on pose les prix — écrire sur le modèle écraserait le tarif de tous
-- les autres groupes.

alter table public.groupes
  add column if not exists mews_block_id text,
  add column if not exists mews_rate_id  text,
  add column if not exists mews_sync_at  timestamptz;

comment on column public.groupes.mews_block_id is
  'Allotement Mews de ce groupe. NULL = pas encore créé. Seule prise sur le bloc : l''API ne sait pas les relister.';
comment on column public.groupes.mews_rate_id is
  'Tarif CLONÉ par Mews pour ce bloc. Les prix se posent dessus, jamais sur le tarif modèle partagé.';
comment on column public.groupes.mews_sync_at is
  'Dernière synchronisation réussie vers Mews (chambres + prix).';
