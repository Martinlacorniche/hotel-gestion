-- ============================================================================
-- Groupes — la taxe de séjour n'a plus que 2 modes : incluse | ajoutee
-- ============================================================================
-- `sur_place` mélangeait deux notions distinctes :
--   • la taxe est-elle DANS le tarif du bloc, ou en plus ?   → taxe_sejour_mode
--   • le séjour se règle-t-il en ligne ou à l'hôtel ?        → mode_paiement
-- Décision Martin (2026-07-16) : « juste la taxe sur place, ça n'existera pas ».
-- Soit on règle tout sur place (mode_paiement = 'aucun'/'optionnel'), soit la
-- taxe suit l'hébergement. Le mode `sur_place` disparaît donc.
--
-- Conversion : le seul groupe concerné (« Mariage Mathilde & Henry », 8Z2W29,
-- sur_place à 0,00 €) passe en `ajoutee` à 2,83 € — cohérent avec les autres
-- groupes. Aucun paiement n'avait encore été pris (vérifié), donc aucun client
-- ne s'était vu annoncer un total sans taxe.
--
-- Ordre impératif : convertir les données AVANT de resserrer la contrainte.
-- ============================================================================

begin;

-- 1) Plus aucune ligne ne doit rester en 'sur_place'.
--    Le montant par défaut (2,83 €) est celui de La Corniche ; 1,86 € aux Voiles
--    — mais le montant est porté par le GROUPE, pas par l'hôtel, et tous les
--    groupes existants sont à 2,83 €.
update public.groupes
   set taxe_sejour_mode = 'ajoutee',
       taxe_sejour_montant = case when coalesce(taxe_sejour_montant, 0) > 0
                                  then taxe_sejour_montant else 2.83 end
 where taxe_sejour_mode = 'sur_place';

-- 2) Nouveau défaut pour les groupes à venir.
alter table public.groupes
  alter column taxe_sejour_mode set default 'ajoutee';

-- 3) Resserrer la contrainte.
alter table public.groupes drop constraint if exists groupes_taxe_sejour_mode_check;
alter table public.groupes
  add constraint groupes_taxe_sejour_mode_check
  check (taxe_sejour_mode = any (array['incluse'::text, 'ajoutee'::text]));

commit;

-- Vérification
select nom, code_acces, mode_paiement, taxe_sejour_mode, taxe_sejour_montant
from public.groupes order by created_at desc;
