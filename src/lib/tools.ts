// Source unique de vérité des outils du menu (accueil + sidebar).
// Avant : le tableau vivait dans src/app/page.tsx. Extrait ici pour que la
// sidebar (AppShell) et la grille de l'accueil partagent la même liste.
import {
  CalendarDays, BookOpen, ShoppingCart, Car, Stamp, Package, Wrench,
  Thermometer, CreditCard, Tv2, Wifi, Wind, Monitor, Handshake,
  ListChecks, DoorOpen, Tag, Users, Euro, KeyRound, ConciergeBell, Martini, Wallet, LineChart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ToolCondition =
  | 'parking' | 'coworking' | 'corniche' | 'voiles' | 'superadmin' | 'admin';

export type ToolDef = {
  id: string;
  label: string;
  href: string | ((id: string) => string);
  icon: LucideIcon;
  bg: string;
  text: string;
  condition?: ToolCondition;
};

export const TOOLS: ToolDef[] = [
  { id: 'thune',        label: 'La thune',     href: (id) => `/caisse?hotel_id=${id}`,      icon: Wallet,       bg: 'bg-slate-50',   text: 'text-slate-700' },
  { id: 'gestion',      label: 'Gestion',      href: '/gestion',                            icon: LineChart,    bg: 'bg-emerald-50', text: 'text-emerald-700', condition: 'admin' },
  { id: 'serrures',     label: 'Clefs',        href: '/serrures',                           icon: KeyRound,     bg: 'bg-violet-50',  text: 'text-violet-700', condition: 'voiles' },
  { id: 'planning',     label: 'Planning',     href: '/planning',                           icon: CalendarDays, bg: 'bg-indigo-50',  text: 'text-indigo-600' },
  { id: 'infos',        label: 'Infos',        href: '/infos',                              icon: BookOpen,     bg: 'bg-indigo-50',  text: 'text-indigo-700' },
  { id: 'commercial',   label: 'Commercial',   href: (id) => `/commercial?hotel_id=${id}`,  icon: Handshake,    bg: 'bg-violet-50',  text: 'text-violet-700' },
  { id: 'clients',      label: 'Clients',      href: '/parking',                            icon: ConciergeBell, bg: 'bg-teal-50',   text: 'text-teal-700' },
  { id: 'technique',    label: 'Technique',    href: '/technique',                          icon: Wrench,       bg: 'bg-yellow-50',  text: 'text-yellow-700' },
  { id: 'commandes',    label: 'Commandes',    href: '/commandes',                          icon: ShoppingCart, bg: 'bg-orange-50',  text: 'text-orange-700' },
  { id: 'haccp',        label: 'HACCP',        href: '/haccp',                              icon: Thermometer,  bg: 'bg-rose-50',    text: 'text-rose-700' },
  { id: 'rooftop',      label: 'Rooftop',      href: '/rooftop',                            icon: Martini,      bg: 'bg-amber-50',   text: 'text-amber-700', condition: 'voiles' },
  // « Groupes & mariages » n'a pas de tuile : accès via la page Commercial.
];

// Sous-menu « La thune » : la caisse (tiroir) + l'encaissement (TPE / liens de paiement).
export const THUNE_CHILDREN: ToolDef[] = [
  { id: 'caisse',       label: 'Caisse',       href: (id) => `/caisse?hotel_id=${id}`, icon: Euro,       bg: 'bg-slate-50',   text: 'text-slate-700' },
  { id: 'encaissement', label: 'Encaissement', href: '/encaissement',                  icon: CreditCard, bg: 'bg-emerald-50', text: 'text-emerald-700' },
];

// Sous-outils du hub « Technique » — utilisés par la sidebar pour proposer un
// sous-menu déroulant qui pointe DIRECTEMENT sur chaque outil (sans passer par
// la page intermédiaire /technique). Mêmes conditions que la page /technique.
export const TECHNIQUE_CHILDREN: ToolDef[] = [
  { id: 'maintenance', label: 'Maintenance', href: '/maintenance', icon: Wrench,  bg: 'bg-yellow-50', text: 'text-yellow-700' },
  { id: 'chromecast',  label: 'Chromecasts', href: '/chromecast',  icon: Tv2,     bg: 'bg-slate-100', text: 'text-slate-700', condition: 'corniche' },
  { id: 'wifi-admin',  label: 'Wifi Client', href: '/wifi-admin',  icon: Wifi,    bg: 'bg-sky-50',    text: 'text-sky-700' },
  { id: 'clim',        label: 'Clim',        href: '/clim',        icon: Wind,    bg: 'bg-sky-50',    text: 'text-sky-700',   condition: 'voiles' },
  { id: 'ecran',       label: 'Écran',       href: '/ecran',       icon: Monitor, bg: 'bg-slate-100', text: 'text-slate-700', condition: 'superadmin' },
];

// Sous-menu Planning : la grille + la gestion d'équipe (admin → /users).
export const PLANNING_CHILDREN: ToolDef[] = [
  { id: 'planning-grille', label: 'Planning',  href: '/planning', icon: CalendarDays, bg: 'bg-indigo-50', text: 'text-indigo-600' },
  { id: 'planning-equipe', label: 'Équipe',    href: '/users',    icon: Users,        bg: 'bg-indigo-50', text: 'text-indigo-700', condition: 'admin' },
];

// Sous-menu Commercial : suivi, groupes, planning des salles, offres & tarifs.
export const COMMERCIAL_CHILDREN: ToolDef[] = [
  { id: 'com-suivi',   label: 'Suivi commercial',  href: '/commercial?tab=pipeline', icon: ListChecks, bg: 'bg-violet-50', text: 'text-violet-700' },
  { id: 'com-groupes', label: 'Groupes & mariages', href: '/groupes',                icon: Users,      bg: 'bg-rose-50',   text: 'text-rose-700' },
  { id: 'com-salles',  label: 'Planning salles',   href: '/commercial?tab=planning', icon: DoorOpen,   bg: 'bg-violet-50', text: 'text-violet-700' },
  { id: 'com-tarifs',  label: 'Offres & tarifs',   href: '/commercial?tab=tarifs',   icon: Tag,        bg: 'bg-violet-50', text: 'text-violet-700' },
];

// Sous-menu Clients : services aux clients (parking, coworking, curiosités).
// Enfants conditionnels par hôtel → le hub se masque si 0 enfant visible et
// pointe direct sur l'unique enfant s'il n'y en a qu'un (géré dans AppShell).
export const CLIENTS_CHILDREN: ToolDef[] = [
  { id: 'parking',     label: 'Parking',    href: '/parking',     icon: Car,     bg: 'bg-green-50',  text: 'text-green-700',  condition: 'parking' },
  { id: 'fidelite',    label: 'Co-Work',    href: '/fidelite',    icon: Stamp,   bg: 'bg-purple-50', text: 'text-purple-700', condition: 'coworking' },
  { id: 'objets-pret', label: 'Curiosités', href: '/objets-pret', icon: Package, bg: 'bg-amber-50',  text: 'text-amber-700',  condition: 'corniche' },
];

// Hubs ayant un sous-menu déroulant dans la sidebar (id de l'outil → enfants).
export const TOOL_CHILDREN: Record<string, ToolDef[]> = {
  thune: THUNE_CHILDREN,
  planning: PLANNING_CHILDREN,
  commercial: COMMERCIAL_CHILDREN,
  clients: CLIENTS_CHILDREN,
  technique: TECHNIQUE_CHILDREN,
};

export type ToolVisibilityCtx = {
  hasParking?: boolean;
  hasCoworking?: boolean;
  isCorniche?: boolean;
  isVoiles?: boolean;
  isSuperadmin?: boolean;
  isAdmin?: boolean;
};

// Un outil est visible selon sa condition (hôtel courant + rôle).
export function isToolVisible(t: ToolDef, ctx: ToolVisibilityCtx): boolean {
  switch (t.condition) {
    case 'parking':    return !!ctx.hasParking;
    case 'coworking':  return !!ctx.hasCoworking;
    case 'corniche':   return !!ctx.isCorniche;
    case 'voiles':     return !!ctx.isVoiles;
    case 'superadmin': return !!ctx.isSuperadmin;
    case 'admin':      return !!ctx.isAdmin;
    default:           return true;
  }
}

export function toolHref(t: ToolDef, hotelId: string): string {
  return typeof t.href === 'function' ? t.href(hotelId) : t.href;
}
