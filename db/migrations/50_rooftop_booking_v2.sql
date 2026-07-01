-- Rooftop réservations v2 — attribution auto d'une table + dispo par jour.
-- Modèle décidé : 1 service par jour (le soir), 1 table = 1 réservation max/jour,
-- attribution automatique de la plus petite table libre assez grande pour les couverts.
-- À coller dans le SQL editor Supabase (après 49_rooftop_tables.sql).

-- 1) Lien réservation → table
alter table public.rooftop_reservations
  add column if not exists table_id uuid references public.rooftop_tables(id) on delete set null;

create index if not exists idx_rooftop_reservations_table
  on public.rooftop_reservations (table_id, date_resa);

-- 2) Les TABLES gouvernent désormais la capacité → on neutralise les plafonds
--    couverts/réservations (ils restent réglables ; null = illimité).
update public.rooftop_config
  set max_couverts_jour = null, max_resa_jour = null
  where hotel_id = 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53';

-- 3) Disponibilité par jour pour un nombre de couverts (anon) → pour le calendrier client.
--    Renvoie chaque jour de l'intervalle avec available = true/false.
create or replace function public.rooftop_day_availability(
  p_hotel uuid, p_pax int, p_start date, p_end date
) returns table(day date, available boolean)
language sql
security definer
set search_path = public
as $$
  select d::date as day,
    (
      not exists (
        select 1 from public.rooftop_closures c
        where c.hotel_id = p_hotel and c.date_fermee = d::date
      )
      and exists (
        select 1 from public.rooftop_tables t
        where t.hotel_id = p_hotel and t.actif and t.couverts >= greatest(p_pax, 1)
          and not exists (
            select 1 from public.rooftop_reservations r
            where r.hotel_id = p_hotel and r.table_id = t.id
              and r.date_resa = d::date and r.statut <> 'annulee'
          )
      )
    ) as available
  from generate_series(p_start, p_end, interval '1 day') d;
$$;

grant execute on function public.rooftop_day_availability(uuid, int, date, date) to anon, authenticated;

-- 4) Réservation atomique avec attribution auto (anon). Renvoie un JSONB :
--    {status:'ok', table, id} | {status:'full'|'closed'|'blacklisted'}
create or replace function public.rooftop_book(
  p_hotel uuid, p_date date, p_heure text, p_pax int,
  p_nom text, p_tel text, p_email text, p_message text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table uuid;
  v_table_nom text;
  v_id uuid;
begin
  if public.is_rooftop_blacklisted(p_hotel, p_email, p_nom) then
    return jsonb_build_object('status', 'blacklisted');
  end if;

  if exists (select 1 from public.rooftop_closures where hotel_id = p_hotel and date_fermee = p_date) then
    return jsonb_build_object('status', 'closed');
  end if;

  -- Plus petite table libre assez grande (verrou léger anti-collision).
  select t.id, t.nom into v_table, v_table_nom
  from public.rooftop_tables t
  where t.hotel_id = p_hotel and t.actif and t.couverts >= greatest(p_pax, 1)
    and not exists (
      select 1 from public.rooftop_reservations r
      where r.hotel_id = p_hotel and r.table_id = t.id
        and r.date_resa = p_date and r.statut <> 'annulee'
    )
  order by t.couverts asc, t.ordre asc
  limit 1
  for update of t skip locked;

  if v_table is null then
    return jsonb_build_object('status', 'full');
  end if;

  insert into public.rooftop_reservations
    (hotel_id, date_resa, heure, couverts, nom, telephone, email, message, statut, table_id)
  values
    (p_hotel, p_date, p_heure, greatest(p_pax, 1), p_nom,
     nullif(trim(p_tel), ''), nullif(trim(p_email), ''), nullif(trim(p_message), ''),
     'confirmee', v_table)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'table', v_table_nom, 'id', v_id);
end;
$$;

grant execute on function public.rooftop_book(uuid, date, text, int, text, text, text, text) to anon, authenticated;
