-- ============================================================================
-- Module Groupes — Lien vers le dossier commercial (lead)
-- ============================================================================
-- Chaque groupe est rattaché à un lead `suivi_commercial` (créé auto à la
-- création du groupe). Comme les devis (`quotes.lead_id`) et fiches de fonction
-- pendent du lead, le groupe peut ainsi avoir un devis + une fiche, et apparaît
-- comme tuile dans le pipeline Commercial.
-- `on delete set null` : supprimer un groupe ne détruit pas le dossier/devis.
-- Idempotent. À coller dans le SQL editor Supabase.
-- ============================================================================

alter table public.suivi_commercial add column if not exists groupe_id uuid references public.groupes(id) on delete set null;

create index if not exists idx_suivi_commercial_groupe on public.suivi_commercial(groupe_id);

-- Backfill : crée le dossier commercial manquant pour les groupes DÉJÀ existants
-- (hotel_id = hôtel de la 1ʳᵉ chambre du bloc). Idempotent (NOT EXISTS).
insert into public.suivi_commercial (groupe_id, hotel_id, nom_client, titre_demande, email, statut, source, date_evenement, date_fin_evenement, commentaires, created_at)
select g.id,
       (select gc.hotel_id from public.groupe_chambres gc where gc.groupe_id = g.id limit 1),
       g.nom,
       coalesce(nullif(g.contact_nom, ''), 'Groupe'),
       nullif(g.contact_email, ''),
       'Confirmé', 'Groupe',
       g.date_arrivee, g.date_depart,
       'Bloc de chambres (groupe) — géré dans l''app Groupes.',
       now()
from public.groupes g
where not exists (select 1 from public.suivi_commercial s where s.groupe_id = g.id)
  and exists (select 1 from public.groupe_chambres gc where gc.groupe_id = g.id);
