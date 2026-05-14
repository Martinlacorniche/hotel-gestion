-- ============================================================================
-- Préférences utilisateur : emoji, hôtel par défaut, thème, police
-- ============================================================================
-- Ajoute 4 colonnes optionnelles sur public.users pour la personnalisation
-- des comptes salariés (voir /profil dans le code).
-- Idempotent.
-- ============================================================================

alter table public.users
  add column if not exists emoji text,
  add column if not exists default_hotel_id uuid references public.hotels(id) on delete set null,
  add column if not exists theme text default 'classique',
  add column if not exists font_family text default 'inter';

-- CHECK constraints pour cadrer les valeurs autorisées (idempotent : drop puis re-add)
alter table public.users drop constraint if exists users_theme_check;
alter table public.users
  add constraint users_theme_check
  check (theme in (
    'classique','ocean','forest','sunset','mono',
    'lavande','cerise','sable','menthe','corail',
    'nuit','creme','prune','brume','tropical'
  ));

alter table public.users drop constraint if exists users_font_family_check;
alter table public.users
  add constraint users_font_family_check
  check (font_family in ('inter','poppins','dm_sans','lora','playfair','caveat'));

-- Vérification
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'users'
  and column_name in ('emoji','default_hotel_id','theme','font_family')
order by column_name;
