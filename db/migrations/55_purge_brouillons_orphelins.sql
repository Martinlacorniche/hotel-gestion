-- Maintenance — purge des brouillons de planning ORPHELINS.
-- Contexte : quand un salarié est désactivé (users.active = false) ou retiré, ses
-- créneaux restés en brouillon (planning_entries.status = 'draft', jamais publiés)
-- ne sont pas nettoyés. Ils ne s'affichent plus (ligne absente) mais déclenchaient
-- l'alerte "Planning non publié". Le code les ignore désormais ; ce script supprime
-- le résidu en base.
--
-- SÉCURITÉ : ne touche QUE les brouillons (status = 'draft') dont le salarié n'est
-- pas actif. Les entrées PUBLIÉES (conservation légale) et les salariés actifs ne
-- sont jamais concernés — un salarié actif (dans n'importe quel hôtel) garde tout.
-- À coller dans le SQL editor Supabase.

-- ── 1) APERÇU (lance d'abord ça pour voir ce qui sera supprimé) ───────────────
select
  coalesce(u.name, '(salarié introuvable)') as salarie,
  u.active,
  pe.hotel_id,
  count(*) as brouillons
from public.planning_entries pe
left join public.users u on u.id_auth = pe.user_id
where pe.status = 'draft'
  and not exists (
    select 1 from public.users u2
    where u2.id_auth = pe.user_id and u2.active is not false   -- actif = true OU null
  )
group by u.name, u.active, pe.hotel_id
order by brouillons desc;

-- ── 2) PURGE (à exécuter une fois l'aperçu vérifié) ──────────────────────────
-- delete from public.planning_entries pe
-- where pe.status = 'draft'
--   and not exists (
--     select 1 from public.users u
--     where u.id_auth = pe.user_id and u.active is not false
--   );
