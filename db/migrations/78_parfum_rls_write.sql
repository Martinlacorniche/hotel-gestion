-- 78_parfum_rls_write.sql
-- Policies d'ÉCRITURE manquantes : le staff mappe les machines et configure les
-- flacons côté client (rôle `authenticated`). La 76 n'avait posé que des policies
-- de lecture → les UPDATE/UPSERT étaient bloqués en silence (0 ligne). Idempotent.

-- Mapping machine -> chambre (update de diffuseurs).
drop policy if exists diffuseurs_update on public.diffuseurs;
create policy diffuseurs_update on public.diffuseurs
  for update to authenticated using (true) with check (true);

-- Configuration des flacons (insert + update de diffuseur_buses).
drop policy if exists diffuseur_buses_write on public.diffuseur_buses;
create policy diffuseur_buses_write on public.diffuseur_buses
  for all to authenticated using (true) with check (true);
