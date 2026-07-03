-- Rooftop — fermetures en PÉRIODES (une ligne = une plage date_debut→date_fin),
-- au lieu d'une ligne par jour. Supprime le besoin du garde-fou « 92 jours max »
-- côté front et rend la liste lisible. Backfill des lignes existantes en journées.
-- À coller dans le SQL editor Supabase (après 63_rooftop_facturation.sql).

-- Nécessaire pour l'exclusion anti-chevauchement (égalité hotel_id + range gist).
create extension if not exists btree_gist;

-- 1) Nouvelles colonnes de période.
alter table public.rooftop_closures
  add column if not exists date_debut date,
  add column if not exists date_fin   date;

-- 2) Backfill : chaque ancienne ligne (un jour) devient une période d'un jour.
update public.rooftop_closures
  set date_debut = coalesce(date_debut, date_fermee),
      date_fin   = coalesce(date_fin,   date_fermee)
  where date_debut is null or date_fin is null;

-- 3) Période obligatoire ; l'ancienne colonne jour devient facultative (compat).
alter table public.rooftop_closures alter column date_debut set not null;
alter table public.rooftop_closures alter column date_fin   set not null;
alter table public.rooftop_closures alter column date_fermee drop not null;

-- 4) Ancienne unicité (hotel_id, date_fermee) → remplacée par anti-chevauchement.
alter table public.rooftop_closures drop constraint if exists rooftop_closures_hotel_id_date_fermee_key;

alter table public.rooftop_closures drop constraint if exists rooftop_closures_no_overlap;
alter table public.rooftop_closures
  add constraint rooftop_closures_no_overlap
  exclude using gist (
    hotel_id with =,
    daterange(date_debut, date_fin, '[]') with &&
  );

create index if not exists idx_rooftop_closures_hotel_periode
  on public.rooftop_closures (hotel_id, date_debut, date_fin);

-- 5) Réécriture des prédicats « jour fermé ? » : date_fermee = jour → jour BETWEEN debut AND fin.
--    (Fonctions partagées avec la vitrine publique — mêmes signatures.)

create or replace function public.rooftop_can_book(p_hotel uuid, p_date date, p_couverts int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_c int; v_max_r int;
  v_used_c int; v_used_r int;
begin
  if exists (
    select 1 from public.rooftop_closures
    where hotel_id = p_hotel and p_date between date_debut and date_fin
  ) then
    return 'closed';
  end if;

  select max_couverts_jour, max_resa_jour into v_max_c, v_max_r
    from public.rooftop_config where hotel_id = p_hotel;

  select coalesce(sum(couverts), 0), count(*) into v_used_c, v_used_r
    from public.rooftop_reservations
    where hotel_id = p_hotel and date_resa = p_date and statut <> 'annulee';

  if v_max_c is not null and v_used_c + coalesce(p_couverts, 0) > v_max_c then return 'full'; end if;
  if v_max_r is not null and v_used_r + 1 > v_max_r then return 'full'; end if;
  return 'ok';
end;
$$;
grant execute on function public.rooftop_can_book(uuid, date, int) to anon, authenticated;

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
        where c.hotel_id = p_hotel and d::date between c.date_debut and c.date_fin
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

  if exists (
    select 1 from public.rooftop_closures
    where hotel_id = p_hotel and p_date between date_debut and date_fin
  ) then
    return jsonb_build_object('status', 'closed');
  end if;

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
