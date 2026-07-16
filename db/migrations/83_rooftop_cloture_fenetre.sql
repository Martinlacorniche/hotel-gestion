-- ============================================================================
-- Rooftop — Fenêtre de clôture (J et J-1 seulement)
-- ============================================================================
-- Complète la migration 81. On pouvait naviguer sur n'importe quelle date et
-- clôturer rétroactivement un vieux service — verrouillant sa caisse par un
-- clic de trop en consultant l'historique.
--
-- Fenêtre = aujourd'hui ou hier. Le J-1 n'est pas du confort : un service de
-- rooftop se clôture souvent APRÈS minuit (le service du 16 encaissé à 1h30 le
-- 17). Le supprimer casserait le cas d'usage normal.
--
-- La date de référence est celle de PARIS, pas l'UTC de la base : à 1h30 à
-- Paris on est déjà le lendemain en heure locale mais encore la veille en UTC,
-- et la fenêtre doit suivre l'équipe, pas le serveur.
--
-- La clôture d'un service FUTUR n'a aucun sens (verrouiller la caisse d'un jour
-- qui n'a pas eu lieu) → refusée aussi.
--
-- Seul `create or replace` de la RPC : rien d'autre ne bouge.
-- À coller dans le SQL editor Supabase (après 81_rooftop_cloture_service.sql).
-- ============================================================================

create or replace function public.rooftop_cloturer_service(
  p_hotel uuid,
  p_date  date,
  p_nb    int,
  p_ca    numeric,
  p_recap jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.rooftop_service_cloture;
  v_reste int;
  v_nom   text;
  v_today date := (now() at time zone 'Europe/Paris')::date;
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 'refuse');
  end if;

  -- Déjà clôturé → on renvoie l'existant tel quel (double-clic, 2e poste…).
  -- AVANT le contrôle de fenêtre : consulter le récap d'un vieux service reste
  -- possible, c'est le CLÔTURER qui est fermé.
  select * into v_row from public.rooftop_service_cloture
   where hotel_id = p_hotel and date_service = p_date;
  if found then
    return jsonb_build_object('status', 'deja', 'cloture', to_jsonb(v_row));
  end if;

  if p_date > v_today then
    return jsonb_build_object('status', 'futur');
  end if;
  if p_date < v_today - 1 then
    return jsonb_build_object('status', 'trop_ancien', 'jour', p_date);
  end if;

  -- Additions encore ouvertes ET non vides = du CA sur la table. On ne clôture
  -- pas, et on ne supprime RIEN.
  select count(*) into v_reste
  from public.rooftop_orders o
  where o.hotel_id = p_hotel
    and o.date_service = p_date
    and o.statut = 'ouverte'
    and exists (select 1 from public.rooftop_order_items i where i.order_id = o.id);
  if v_reste > 0 then
    return jsonb_build_object('status', 'reste', 'nb', v_reste);
  end if;

  -- La colonne s'appelle bien `name` (cf. public.users).
  select u.name into v_nom from public.users u where u.id_auth = auth.uid();

  insert into public.rooftop_service_cloture
    (hotel_id, date_service, closed_by, closed_by_nom, nb_additions, ca_ttc, recap)
  values
    (p_hotel, p_date, auth.uid(), v_nom, coalesce(p_nb, 0), coalesce(p_ca, 0), coalesce(p_recap, '{}'::jsonb))
  on conflict (hotel_id, date_service) do nothing
  returning * into v_row;

  -- Course entre deux postes : l'autre a gagné, on renvoie sa ligne.
  if v_row.id is null then
    select * into v_row from public.rooftop_service_cloture
     where hotel_id = p_hotel and date_service = p_date;
    return jsonb_build_object('status', 'deja', 'cloture', to_jsonb(v_row));
  end if;

  return jsonb_build_object('status', 'ok', 'cloture', to_jsonb(v_row));
end $$;

revoke all on function public.rooftop_cloturer_service(uuid, date, int, numeric, jsonb) from public;
grant execute on function public.rooftop_cloturer_service(uuid, date, int, numeric, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Vérification : doit renvoyer 'trop_ancien' (appel anon → 'refuse' attendu si
-- exécuté hors session authentifiée).
-- ----------------------------------------------------------------------------
select public.rooftop_cloturer_service(
  '00000000-0000-0000-0000-000000000000'::uuid,
  (current_date - 30), 0, 0, '{}'::jsonb
) as doit_etre_refuse_ou_trop_ancien;
