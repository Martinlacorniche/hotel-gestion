-- ============================================================================
-- Module HACCP — Plan de nettoyage : RESET La Corniche
-- ============================================================================
-- Supprime toutes les zones/tâches/logs de nettoyage de La Corniche pour
-- permettre de rejouer proprement le seed light 10_haccp_cleaning_seed_corniche.sql.
--
-- ⚠️ Destructif sur La Corniche uniquement. Aucun impact sur Les Voiles ou
-- autre hôtel. À utiliser uniquement parce qu'une première version trop
-- complète du seed a été appliquée le 2026-05-27 avant validation terrain.
--
-- Cascade :
--   haccp_cleaning_zones → haccp_cleaning_tasks → haccp_cleaning_logs
--   (les FK sont déclarées on delete cascade dans la migration 09)
--
-- À jouer une seule fois, puis enchaîner avec 10_haccp_cleaning_seed_corniche.sql.
-- ============================================================================

do $$
declare
  v_hotel_id        uuid;
  v_zones_deleted   int;
begin
  select id into v_hotel_id
  from public.hotels
  where nom ilike 'La Corniche'
  limit 1;

  if v_hotel_id is null then
    raise exception 'Hôtel La Corniche introuvable';
  end if;

  delete from public.haccp_cleaning_zones
  where hotel_id = v_hotel_id;

  get diagnostics v_zones_deleted = row_count;
  raise notice 'Reset La Corniche : % zone(s) supprimée(s) (avec cascade tâches + logs).', v_zones_deleted;
end $$;

-- Vérification : doit afficher 0 partout
select
  (select count(*) from public.haccp_cleaning_zones z
   join public.hotels h on h.id = z.hotel_id
   where h.nom ilike 'La Corniche')                                 as nb_zones,
  (select count(*) from public.haccp_cleaning_tasks t
   join public.haccp_cleaning_zones z on z.id = t.zone_id
   join public.hotels h on h.id = z.hotel_id
   where h.nom ilike 'La Corniche')                                 as nb_taches,
  (select count(*) from public.haccp_cleaning_logs l
   join public.hotels h on h.id = l.hotel_id
   where h.nom ilike 'La Corniche')                                 as nb_logs;
