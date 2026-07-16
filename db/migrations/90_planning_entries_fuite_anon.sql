-- ============================================================================
-- SÉCURITÉ — planning_entries lisible SANS SESSION (clé anon)
-- ============================================================================
-- La policy « Users can read own planning » portait :
--     for select TO PUBLIC using (true)
-- `public` inclut le rôle `anon` → n'importe qui muni de la clé anon (livrée
-- dans le bundle JS du site, donc publique par nature) lisait **5985 lignes**
-- de planning sans jamais se connecter : dates, shifts, horaires, hotel_id.
-- Vérifié le 2026-07-16 par un simple curl.
--
-- Ni le nom ni l'intention de la policy ne correspondaient à son effet. Elle a
-- vraisemblablement été écrite pour « chacun lit son planning », et la
-- visibilité d'équipe (VOULUE — c'est elle qui alimente « avec toi ce jour-là »
-- dans l'app) a été obtenue avec `using (true)`, sans voir que `public`
-- embarquait aussi les visiteurs anonymes.
--
-- Portée de la fuite : LIMITÉE et pseudonymisée. `users` est fermée, donc les
-- user_id restent des UUID sans nom. Les autres tables (cp_requests, contrats,
-- trousseau, suivi_commercial…) sont correctement bloquées — vérifié.
--
-- CE QU'ON NE CHANGE PAS : la visibilité d'équipe entre salariés connectés.
-- `using (true)` reste, seul le ROLE change → `authenticated`.
--
-- Sans risque, vérifié avant application : tous les lecteurs légitimes sont
--   • service role (contourne le RLS) : apiAuth.ts, onDuty.ts, brief/route.ts,
--     edge functions send-flash et send-chambres-liberees ;
--   • ou en session authentifiée : ShiftContext (web + app), planning/page.tsx,
--     App-Consignes/app/(tabs)/planning.js.
-- La vitrine Site-BW ne lit jamais planning_entries.
--
-- À coller dans le SQL editor Supabase (ou `node scripts/sql.mjs -f <ce fichier>`).
-- ============================================================================

begin;

drop policy if exists "Users can read own planning" on public.planning_entries;

-- Nom corrigé : elle n'a jamais restreint à « own », et ce n'est pas un bug —
-- l'app affiche volontairement les collègues du jour.
create policy "Staff connecte lit le planning" on public.planning_entries
  for select to authenticated
  using (true);

commit;

-- Vérification : plus aucune policy SELECT ouverte à `public`/`anon`.
select policyname, permissive, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename = 'planning_entries'
 order by permissive desc, cmd;
