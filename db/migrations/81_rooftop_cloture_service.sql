-- ============================================================================
-- Rooftop — Clôture de service (Les Voiles)
-- ============================================================================
-- Une ligne par (hôtel, jour de service). Tant qu'elle existe, la caisse de ce
-- jour est VERROUILLÉE EN BASE : plus aucune addition, ligne ni règlement, même
-- depuis un autre poste, un vieil onglet ou un client bugué. Le verrou ne vit
-- pas dans l'UI — l'UI ne fait que l'expliquer.
--
-- Ce que la clôture ne fait PAS : rien n'est envoyé à Mews. Les encaissements y
-- sont déjà partis un par un au moment de l'encaissement (payments/addExternal,
-- idempotent). La clôture ne fait que figer et verrouiller.
--
-- Rouvrir un service = supprimer sa ligne (admin/superadmin). Acte délibéré et
-- tracé, pas un effet de bord.
--
-- À coller dans le SQL editor Supabase (après 74_rooftop_cb_amex.sql).
-- Dépend de public.is_superadmin() (db/security/11_planning_retroactive_lock.sql).
-- ============================================================================

create table if not exists public.rooftop_service_cloture (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  date_service  date not null,
  closed_at     timestamptz not null default now(),
  closed_by     uuid,                       -- auth.uid() de l'auteur
  closed_by_nom text,                       -- snapshot lisible (l'user peut partir)
  nb_additions  int not null default 0,
  ca_ttc        numeric(10,2) not null default 0,
  -- Récap figé (ventilation TVA + par moyen de paiement + soft/food/alcool).
  -- Snapshot d'affichage : la source de vérité reste orders/items/payments.
  recap         jsonb not null default '{}'::jsonb,
  unique (hotel_id, date_service)
);

create index if not exists idx_rooftop_cloture_hotel_date
  on public.rooftop_service_cloture (hotel_id, date_service);

alter table public.rooftop_service_cloture enable row level security;

-- Lecture + clôture : équipe authentifiée. Réouverture : admin/superadmin.
drop policy if exists "rooftop_cloture read"   on public.rooftop_service_cloture;
drop policy if exists "rooftop_cloture insert" on public.rooftop_service_cloture;
drop policy if exists "rooftop_cloture delete" on public.rooftop_service_cloture;
drop policy if exists "rooftop_cloture update" on public.rooftop_service_cloture;

create policy "rooftop_cloture read" on public.rooftop_service_cloture
  for select to authenticated using (true);

create policy "rooftop_cloture insert" on public.rooftop_service_cloture
  for insert to authenticated with check (true);

-- Pas d'UPDATE : une clôture ne se retouche pas, elle se rouvre et se refait.
create policy "rooftop_cloture delete" on public.rooftop_service_cloture
  for delete to authenticated
  using (exists (select 1 from public.users
                 where id_auth = auth.uid() and role in ('admin', 'superadmin')));

-- ----------------------------------------------------------------------------
-- Helpers de verrou
-- ----------------------------------------------------------------------------
create or replace function public.rooftop_service_cloture_existe(p_hotel uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rooftop_service_cloture
    where hotel_id = p_hotel and date_service = p_date
  );
$$;

-- rooftop_order_items ne porte que order_id : on remonte à l'addition.
create or replace function public.rooftop_order_est_cloture(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.rooftop_orders o
    join public.rooftop_service_cloture c
      on c.hotel_id = o.hotel_id and c.date_service = o.date_service
    where o.id = p_order
  );
$$;

revoke all on function public.rooftop_service_cloture_existe(uuid, date) from public;
revoke all on function public.rooftop_order_est_cloture(uuid) from public;
grant execute on function public.rooftop_service_cloture_existe(uuid, date) to authenticated;
grant execute on function public.rooftop_order_est_cloture(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Verrou : policies RESTRICTIVE (AND'ées avec les PERMISSIVE existantes).
-- SELECT n'est jamais bloqué — un service clôturé reste consultable.
-- ----------------------------------------------------------------------------

-- ── Additions ────────────────────────────────────────────────────────────────
drop policy if exists "rooftop_orders_cloture_insert" on public.rooftop_orders;
drop policy if exists "rooftop_orders_cloture_update" on public.rooftop_orders;
drop policy if exists "rooftop_orders_cloture_delete" on public.rooftop_orders;

create policy "rooftop_orders_cloture_insert" on public.rooftop_orders
  as restrictive for insert to authenticated
  with check (not public.rooftop_service_cloture_existe(hotel_id, date_service)
              or public.is_superadmin());

create policy "rooftop_orders_cloture_update" on public.rooftop_orders
  as restrictive for update to authenticated
  using      (not public.rooftop_service_cloture_existe(hotel_id, date_service)
              or public.is_superadmin())
  with check (not public.rooftop_service_cloture_existe(hotel_id, date_service)
              or public.is_superadmin());

create policy "rooftop_orders_cloture_delete" on public.rooftop_orders
  as restrictive for delete to authenticated
  using (not public.rooftop_service_cloture_existe(hotel_id, date_service)
         or public.is_superadmin());

-- ── Lignes ───────────────────────────────────────────────────────────────────
drop policy if exists "rooftop_items_cloture_insert" on public.rooftop_order_items;
drop policy if exists "rooftop_items_cloture_update" on public.rooftop_order_items;
drop policy if exists "rooftop_items_cloture_delete" on public.rooftop_order_items;

create policy "rooftop_items_cloture_insert" on public.rooftop_order_items
  as restrictive for insert to authenticated
  with check (not public.rooftop_order_est_cloture(order_id) or public.is_superadmin());

create policy "rooftop_items_cloture_update" on public.rooftop_order_items
  as restrictive for update to authenticated
  using      (not public.rooftop_order_est_cloture(order_id) or public.is_superadmin())
  with check (not public.rooftop_order_est_cloture(order_id) or public.is_superadmin());

create policy "rooftop_items_cloture_delete" on public.rooftop_order_items
  as restrictive for delete to authenticated
  using (not public.rooftop_order_est_cloture(order_id) or public.is_superadmin());

-- ── Règlements ───────────────────────────────────────────────────────────────
drop policy if exists "rooftop_pays_cloture_insert" on public.rooftop_order_payments;
drop policy if exists "rooftop_pays_cloture_update" on public.rooftop_order_payments;
drop policy if exists "rooftop_pays_cloture_delete" on public.rooftop_order_payments;

create policy "rooftop_pays_cloture_insert" on public.rooftop_order_payments
  as restrictive for insert to authenticated
  with check (not public.rooftop_service_cloture_existe(hotel_id, date_service)
              or public.is_superadmin());

create policy "rooftop_pays_cloture_update" on public.rooftop_order_payments
  as restrictive for update to authenticated
  using      (not public.rooftop_service_cloture_existe(hotel_id, date_service)
              or public.is_superadmin())
  with check (not public.rooftop_service_cloture_existe(hotel_id, date_service)
              or public.is_superadmin());

create policy "rooftop_pays_cloture_delete" on public.rooftop_order_payments
  as restrictive for delete to authenticated
  using (not public.rooftop_service_cloture_existe(hotel_id, date_service)
         or public.is_superadmin());

-- ----------------------------------------------------------------------------
-- Clôture : le garde-fou « reste à encaisser » vit ICI, pas dans le client.
-- Idempotent : re-cliquer renvoie la clôture existante, n'en crée pas une 2e.
-- Le récap est fourni par l'appelant (même moteur TVA que les factures,
-- src/lib/rooftopTva.ts) — le dupliquer en SQL le ferait diverger.
-- ----------------------------------------------------------------------------
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
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 'refuse');
  end if;

  -- Déjà clôturé → on renvoie l'existant tel quel (double-clic, 2e poste…).
  select * into v_row from public.rooftop_service_cloture
   where hotel_id = p_hotel and date_service = p_date;
  if found then
    return jsonb_build_object('status', 'deja', 'cloture', to_jsonb(v_row));
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
-- Vérification
-- ----------------------------------------------------------------------------
select tablename, policyname, permissive, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('rooftop_orders', 'rooftop_order_items', 'rooftop_order_payments', 'rooftop_service_cloture')
order by tablename, permissive, policyname;
