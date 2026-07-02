-- Rooftop — permettre au STAFF de FORCER une réservation malgré la blacklist ou
-- un jour fermé, via un flag de session (`rooftop.force_insert`) honoré par les
-- triggers. Le parcours public (anon) reste bloqué : seule la fonction
-- rooftop_book_staff (réservée aux authentifiés) pose le flag.
-- À coller dans le SQL editor Supabase (après 53_rooftop_pos.sql).

-- 1) Les deux triggers de garde acceptent l'insert si le flag est posé.
create or replace function public.rooftop_reservations_block_blacklisted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('rooftop.force_insert', true), '') = 'on' then
    return new;
  end if;
  if public.is_rooftop_blacklisted(new.hotel_id, new.email, new.nom) then
    raise exception 'Réservation refusée (blacklist)' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

create or replace function public.rooftop_reservations_check_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('rooftop.force_insert', true), '') = 'on' then
    return new;
  end if;
  if public.rooftop_can_book(new.hotel_id, new.date_resa, new.couverts) <> 'ok' then
    raise exception 'Réservation indisponible pour cette date (fermé ou complet)' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- 2) RPC staff : pose le flag (local à la transaction) puis insère. Renvoie la
--    ligne créée. Attribution manuelle de la table (p_table) faite côté salle.
create or replace function public.rooftop_book_staff(
  p_hotel uuid, p_date date, p_heure text, p_pax int,
  p_nom text, p_tel text, p_email text, p_message text, p_table uuid
) returns public.rooftop_reservations
language plpgsql security definer set search_path = public as $$
declare v_row public.rooftop_reservations;
begin
  perform set_config('rooftop.force_insert', 'on', true);
  insert into public.rooftop_reservations
    (hotel_id, date_resa, heure, couverts, nom, telephone, email, message, statut, table_id)
  values
    (p_hotel, p_date, p_heure, greatest(coalesce(p_pax, 1), 1), p_nom,
     nullif(trim(p_tel), ''), nullif(trim(p_email), ''), nullif(trim(p_message), ''),
     'confirmee', p_table)
  returning * into v_row;
  perform set_config('rooftop.force_insert', 'off', true);
  return v_row;
end; $$;

-- Réservée à l'équipe authentifiée (surtout PAS anon → le public ne force jamais).
grant execute on function public.rooftop_book_staff(uuid, date, text, int, text, text, text, text, uuid) to authenticated;
