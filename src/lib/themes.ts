// 15 thèmes prédéfinis pour la personnalisation utilisateur.
// Chaque thème expose un set de variables CSS appliquées sur :root
// au login (cf. useApplyTheme dans AuthContext).
//
// Niveau d'impact : "Niveau 2" — accent (boutons/badges/focus) + ambiance
// du fond (3 bulles aquarelle + bg body). Les couleurs identifiantes
// des features (planning indigo, contacts blue, etc.) sont préservées.

export type ThemeId =
  | 'classique' | 'ocean' | 'forest' | 'sunset' | 'mono'
  | 'lavande' | 'cerise' | 'sable' | 'menthe' | 'corail'
  | 'nuit' | 'creme' | 'prune' | 'brume' | 'tropical';

export type ThemeDef = {
  id: ThemeId;
  label: string;
  description: string;
  accent: string;
  accentHover: string;
  accentBg: string;
  accentText: string;
  bgBase: string;
  bgBlob1: string;
  bgBlob2: string;
  bgBlob3: string;
};

export const THEMES: ThemeDef[] = [
  {
    id: 'classique',
    label: 'Classique',
    description: 'Indigo intemporel',
    accent: '#4f46e5',       accentHover: '#4338ca', accentBg: '#eef2ff', accentText: '#ffffff',
    bgBase: '#f8fafc',
    bgBlob1: 'rgba(199, 210, 254, 0.40)',
    bgBlob2: 'rgba(186, 230, 253, 0.40)',
    bgBlob3: 'rgba(243, 232, 255, 0.50)',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    description: 'Frais, bord de mer',
    accent: '#0891b2',       accentHover: '#0e7490', accentBg: '#ecfeff', accentText: '#ffffff',
    bgBase: '#f0f9ff',
    bgBlob1: 'rgba(165, 243, 252, 0.50)',
    bgBlob2: 'rgba(186, 230, 253, 0.50)',
    bgBlob3: 'rgba(204, 251, 241, 0.45)',
  },
  {
    id: 'forest',
    label: 'Forest',
    description: 'Nature, calme',
    accent: '#059669',       accentHover: '#047857', accentBg: '#ecfdf5', accentText: '#ffffff',
    bgBase: '#f6fdf9',
    bgBlob1: 'rgba(167, 243, 208, 0.50)',
    bgBlob2: 'rgba(187, 247, 208, 0.45)',
    bgBlob3: 'rgba(254, 240, 199, 0.40)',
  },
  {
    id: 'sunset',
    label: 'Sunset',
    description: 'Chaleureux',
    accent: '#f97316',       accentHover: '#ea580c', accentBg: '#fff7ed', accentText: '#ffffff',
    bgBase: '#fffaf5',
    bgBlob1: 'rgba(254, 215, 170, 0.55)',
    bgBlob2: 'rgba(254, 205, 211, 0.45)',
    bgBlob3: 'rgba(254, 240, 138, 0.40)',
  },
  {
    id: 'mono',
    label: 'Mono',
    description: 'Sobre, corporate',
    accent: '#334155',       accentHover: '#1e293b', accentBg: '#f1f5f9', accentText: '#ffffff',
    bgBase: '#f8fafc',
    bgBlob1: 'rgba(203, 213, 225, 0.40)',
    bgBlob2: 'rgba(226, 232, 240, 0.50)',
    bgBlob3: 'rgba(241, 245, 249, 0.60)',
  },
  {
    id: 'lavande',
    label: 'Lavande',
    description: 'Doux, élégant',
    accent: '#8b5cf6',       accentHover: '#7c3aed', accentBg: '#f5f3ff', accentText: '#ffffff',
    bgBase: '#faf9ff',
    bgBlob1: 'rgba(221, 214, 254, 0.55)',
    bgBlob2: 'rgba(243, 232, 255, 0.50)',
    bgBlob3: 'rgba(252, 231, 243, 0.40)',
  },
  {
    id: 'cerise',
    label: 'Cerise',
    description: 'Vif, fun',
    accent: '#db2777',       accentHover: '#be185d', accentBg: '#fdf2f8', accentText: '#ffffff',
    bgBase: '#fff7fa',
    bgBlob1: 'rgba(251, 207, 232, 0.55)',
    bgBlob2: 'rgba(254, 215, 170, 0.40)',
    bgBlob3: 'rgba(243, 232, 255, 0.45)',
  },
  {
    id: 'sable',
    label: 'Sable',
    description: 'Chaud, méditerranéen',
    accent: '#d97706',       accentHover: '#b45309', accentBg: '#fffbeb', accentText: '#ffffff',
    bgBase: '#fefcf3',
    bgBlob1: 'rgba(253, 230, 138, 0.55)',
    bgBlob2: 'rgba(254, 215, 170, 0.45)',
    bgBlob3: 'rgba(251, 191, 36, 0.20)',
  },
  {
    id: 'menthe',
    label: 'Menthe',
    description: 'Frais, léger',
    accent: '#14b8a6',       accentHover: '#0d9488', accentBg: '#f0fdfa', accentText: '#ffffff',
    bgBase: '#f0fdfa',
    bgBlob1: 'rgba(153, 246, 228, 0.55)',
    bgBlob2: 'rgba(167, 243, 208, 0.45)',
    bgBlob3: 'rgba(204, 251, 241, 0.50)',
  },
  {
    id: 'corail',
    label: 'Corail',
    description: 'Doux, accueillant',
    accent: '#f43f5e',       accentHover: '#e11d48', accentBg: '#fff1f2', accentText: '#ffffff',
    bgBase: '#fffafa',
    bgBlob1: 'rgba(254, 205, 211, 0.55)',
    bgBlob2: 'rgba(254, 215, 170, 0.40)',
    bgBlob3: 'rgba(252, 231, 243, 0.45)',
  },
  {
    id: 'nuit',
    label: 'Nuit',
    description: 'Sobre, profond',
    accent: '#818cf8',       accentHover: '#6366f1', accentBg: '#312e81', accentText: '#ffffff',
    bgBase: '#0f172a',
    bgBlob1: 'rgba(67, 56, 202, 0.40)',
    bgBlob2: 'rgba(30, 64, 175, 0.30)',
    bgBlob3: 'rgba(88, 28, 135, 0.40)',
  },
  {
    id: 'creme',
    label: 'Crème',
    description: 'Solaire, doux',
    accent: '#ca8a04',       accentHover: '#a16207', accentBg: '#fefce8', accentText: '#ffffff',
    bgBase: '#fffce8',
    bgBlob1: 'rgba(254, 240, 138, 0.55)',
    bgBlob2: 'rgba(253, 230, 138, 0.45)',
    bgBlob3: 'rgba(254, 215, 170, 0.40)',
  },
  {
    id: 'prune',
    label: 'Prune',
    description: 'Élégant, profond',
    accent: '#7e22ce',       accentHover: '#6b21a8', accentBg: '#faf5ff', accentText: '#ffffff',
    bgBase: '#fbf7ff',
    bgBlob1: 'rgba(216, 180, 254, 0.55)',
    bgBlob2: 'rgba(192, 132, 252, 0.30)',
    bgBlob3: 'rgba(232, 121, 249, 0.30)',
  },
  {
    id: 'brume',
    label: 'Brume',
    description: 'Léger, neutre',
    accent: '#0ea5e9',       accentHover: '#0284c7', accentBg: '#f0f9ff', accentText: '#ffffff',
    bgBase: '#f8fafc',
    bgBlob1: 'rgba(186, 230, 253, 0.45)',
    bgBlob2: 'rgba(203, 213, 225, 0.50)',
    bgBlob3: 'rgba(226, 232, 240, 0.45)',
  },
  {
    id: 'tropical',
    label: 'Tropical',
    description: 'Énergique',
    accent: '#84cc16',       accentHover: '#65a30d', accentBg: '#f7fee7', accentText: '#ffffff',
    bgBase: '#f7fee7',
    bgBlob1: 'rgba(217, 249, 157, 0.55)',
    bgBlob2: 'rgba(153, 246, 228, 0.40)',
    bgBlob3: 'rgba(254, 240, 138, 0.40)',
  },
];

export const THEME_MAP: Record<ThemeId, ThemeDef> =
  Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ThemeId, ThemeDef>;

export type FontId = 'inter' | 'poppins' | 'dm_sans' | 'lora' | 'playfair' | 'caveat';

export const FONTS: { id: FontId; label: string; description: string; cssVar: string }[] = [
  { id: 'inter',    label: 'Inter',              description: 'Moderne, neutre',     cssVar: 'var(--font-inter)' },
  { id: 'poppins',  label: 'Poppins',            description: 'Rond, friendly',      cssVar: 'var(--font-poppins)' },
  { id: 'dm_sans',  label: 'DM Sans',            description: 'Tech, propre',        cssVar: 'var(--font-dm-sans)' },
  { id: 'lora',     label: 'Lora',               description: 'Serif lisible',       cssVar: 'var(--font-lora)' },
  { id: 'playfair', label: 'Playfair Display',   description: 'Serif élégant',       cssVar: 'var(--font-playfair)' },
  { id: 'caveat',   label: 'Caveat',             description: 'Manuscrit, fun',      cssVar: 'var(--font-caveat)' },
];

// Applique un thème sur :root (à appeler dans un useEffect côté client).
// On utilise --brand-* au lieu de --accent-* pour ne pas entrer en conflit
// avec le système shadcn qui a déjà sa propre variable --accent.
export function applyTheme(themeId: ThemeId | null | undefined) {
  if (typeof document === 'undefined') return;
  const theme = (themeId && THEME_MAP[themeId]) || THEME_MAP.classique;
  const root = document.documentElement;
  root.style.setProperty('--brand', theme.accent);
  root.style.setProperty('--brand-hover', theme.accentHover);
  root.style.setProperty('--brand-bg', theme.accentBg);
  root.style.setProperty('--brand-text', theme.accentText);
  root.style.setProperty('--bg-base', theme.bgBase);
  root.style.setProperty('--bg-blob-1', theme.bgBlob1);
  root.style.setProperty('--bg-blob-2', theme.bgBlob2);
  root.style.setProperty('--bg-blob-3', theme.bgBlob3);
  root.dataset.theme = theme.id;
}

export function applyFont(fontId: FontId | null | undefined) {
  if (typeof document === 'undefined') return;
  const font = FONTS.find((f) => f.id === fontId) || FONTS[0];
  document.documentElement.style.setProperty('--font-current', font.cssVar);
}
