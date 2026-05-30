-- ============================================================================
-- Renommage des colonnes notes_* de fiches_fonctions
-- ============================================================================
-- Ces colonnes avaient été DÉTOURNÉES de leur usage d'origine :
--   notes_housekeeping  contenait en réalité les "notes générales"
--   notes_reception     contenait les "notes Gaëtan" (Mr Cocktail)
--   notes_food          contenait les "notes facturation"
-- On les renomme pour que le nom reflète le contenu réel.
--
-- Seul src/app/fiche/page.tsx lit/écrit ces colonnes (vérifié dans le repo).
--
-- ⚠️ DÉPLOIEMENT : appliquer cette migration ET déployer le code fiche mis à
--    jour ensemble — le nouveau code utilise notes_generales/notes_gaetan/
--    notes_facturation. (Idempotent : ne fait rien si déjà renommé.)
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'fiches_fonctions'
               and column_name = 'notes_housekeeping') then
    alter table public.fiches_fonctions rename column notes_housekeeping to notes_generales;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'fiches_fonctions'
               and column_name = 'notes_reception') then
    alter table public.fiches_fonctions rename column notes_reception to notes_gaetan;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'fiches_fonctions'
               and column_name = 'notes_food') then
    alter table public.fiches_fonctions rename column notes_food to notes_facturation;
  end if;
end $$;

-- Vérification
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'fiches_fonctions'
  and column_name in ('notes_generales', 'notes_gaetan', 'notes_facturation');
