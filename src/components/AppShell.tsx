'use client';

// Coquille d'app : UNE SEULE sidebar à gauche, montée une fois dans le layout.
// Elle se "morphe" entre deux états sans changer de DOM :
//   - PLIÉE (w-16) : rail d'icônes, libellés masqués, hubs en flyout.
//   - DÉPLIÉE (w-72) : largeur animée, libellés en fondu, hubs en accordéon,
//     sélecteur d'hôtel complet, footer profil/déconnexion.
// Les icônes sont ancrées au même x dans les deux états → elles ne sautent pas ;
// seuls les libellés (et le nom d'hôtel) apparaissent. Le contenu reste décalé de
// pl-16 ; dépliée, la sidebar passe PAR-DESSUS avec un voile (pas de reflow).
// Alimentée par la liste partagée src/lib/tools.
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Home, ChevronDown, Check, LogOut, GripVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/context/AuthContext';
import { useHotelScope } from '@/hooks/useHotelScope';
import { useGroupesAlert } from '@/hooks/useGroupesAlert';
import { supabase } from '@/lib/supabaseClient';
import {
  TOOLS, TOOL_CHILDREN, isToolVisible, toolHref, type ToolDef, type ToolVisibilityCtx,
} from '@/lib/tools';

// Pages accessibles SANS être connecté : flux d'authentification + pages de retour
// Stripe (le client qui paie n'est pas un utilisateur de l'app). Toute autre page
// est protégée : un visiteur non connecté est renvoyé au /login (garde global).
const PUBLIC_PREFIXES = [
  '/login', '/register', '/forgot-password', '/update-password', '/reset-password',
  '/paiement',
];

function basePath(t: ToolDef): string {
  return toolHref(t, '').split('?')[0];
}

// Icônes d'outils : fond UNIFORME (fini l'arc-en-ciel de pastilles pastel), mais
// l'icône garde la couleur de son outil (identité/mémoire). L'outil ACTIF passe en
// teinte de MARQUE (thème de l'utilisateur) → la couleur y signale « vous êtes ici ».
// Les fonds par-outil (t.bg) ne sont plus utilisés.
function iconTone(active: boolean, glyph: string): string {
  return active ? 'bg-[var(--brand-bg)] text-[var(--brand)]' : `bg-slate-100 ${glyph}`;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { hotels, selectedHotelId, setSelectedHotelId, currentHotel } = useHotelScope(
    'id, nom, has_parking, has_coworking',
  );
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false); // >=1024px : sidebar dockée (pas d'overlay)
  const [navQuery, setNavQuery] = useState('');       // recherche d'outil dans la nav dépliée
  const [expanded, setExpanded] = useState<string | null>(null); // hub déplié (accordéon)
  const [flyout, setFlyout] = useState<{ id: string; top: number; left: number } | null>(null); // sous-menu plié
  const [hotelMenu, setHotelMenu] = useState(false);
  const [navOrder, setNavOrder] = useState<string[]>([]); // ordre perso du menu (par user)
  // Drag = appui maintenu (220ms) → un tap navigue, un maintien réordonne. Ne casse pas le scroll.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 8 } }));
  // Badge « groupes à traiter » (Commercial). Rafraîchi à chaque navigation.
  // Scopé sur l'hôtel du rail : la pastille ne s'allume que pour les groupes
  // ayant une chambre dans l'hôtel courant (cohérent avec le récap /groupes).
  // Fallback tous hôtels tant qu'aucun hôtel n'est encore sélectionné.
  const groupesUnread = useGroupesAlert(
    selectedHotelId ? [selectedHotelId] : hotels.map((h) => h.id),
    pathname,
  );

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Garde global : une fois la session restaurée, un visiteur non connecté qui
  // tente une page protégée est renvoyé au /login (les pages ne sont plus de
  // simples coquilles visibles sans compte).
  useEffect(() => {
    if (isLoading) return;
    if (!user && !isPublic) router.replace('/login');
  }, [isLoading, user, isPublic, router]);

  // Ordre perso du menu : chargé depuis la fiche user (comme planning_hidden_services).
  const navUid = (user as { id_auth?: string; id?: string } | null)?.id_auth
    || (user as { id?: string } | null)?.id;
  useEffect(() => {
    if (!navUid) return;
    supabase.from('users').select('nav_order').eq('id_auth', navUid).maybeSingle()
      .then(({ data }) => { if (Array.isArray(data?.nav_order)) setNavOrder(data.nav_order as string[]); });
  }, [navUid]);

  // Desktop (>=1024px) : la sidebar est DÉPLIÉE par défaut et dockée (pousse le
  // contenu, sans voile). Le choix plié/déplié de l'utilisateur est mémorisé
  // (localStorage) → « faut pouvoir la replier » et ça reste replié au retour.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    let saved: string | null = null;
    try { saved = localStorage.getItem('nav_open'); } catch { /* privé/SSR */ }
    setOpen(saved != null ? saved === '1' : mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Pages publiques : rendu direct, sans sidebar.
  if (isPublic) return <>{children}</>;

  // Page protégée sans utilisateur : on n'affiche PAS le contenu (chargement de
  // session ou redirection en cours vers /login).
  if (!user) {
    return (
      <div className="p-10 text-center text-gray-500 flex items-center justify-center min-h-screen">
        Chargement…
      </div>
    );
  }

  // Persiste le choix plié/déplié (bouton burger).
  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem('nav_open', v ? '1' : '0'); } catch { /* privé */ }
    if (!v) { setExpanded(null); setHotelMenu(false); setNavQuery(''); }
  };
  // Après une navigation : on ferme sous-menus/flyout ; on ne REPLIE la sidebar que
  // sur mobile (overlay). Sur desktop elle est dockée et reste ouverte.
  const closeAll = () => {
    setExpanded(null); setHotelMenu(false); setFlyout(null);
    if (!isDesktop) setOpen(false);
  };

  const isSuperadmin = user!.role === 'superadmin';
  const isAdmin = isSuperadmin || user!.role === 'admin';
  const nom = (currentHotel?.nom || '').toLowerCase();
  const ctx: ToolVisibilityCtx = {
    hasParking: !!currentHotel?.has_parking,
    hasCoworking: !!currentHotel?.has_coworking,
    isCorniche: nom.includes('corniche'),
    isVoiles: nom.includes('voiles'),
    isSuperadmin,
    isAdmin,
  };
  // Identité de l'utilisateur (personnalise le footer : avatar/emoji + nom + thème).
  const userEmoji = (user as { emoji?: string } | null)?.emoji;
  const userName = user?.name || user?.email || '';
  const userInitials = (user?.name || user?.email || '?').slice(0, 2).toUpperCase();

  const tools = TOOLS.filter((t) => isToolVisible(t, ctx));
  const hotelId = selectedHotelId || '';
  const isActive = (base: string) => (base === '/' ? pathname === '/' : pathname.startsWith(base));
  const childrenOf = (id: string) => (TOOL_CHILDREN[id] || []).filter((c) => isToolVisible(c, ctx));
  const flyoutKids = flyout ? childrenOf(flyout.id) : [];

  // Compteur à afficher sur une entrée donnée (Commercial + son enfant Groupes).
  const badgeCount = (id: string): number =>
    id === 'commercial' || id === 'com-groupes' ? groupesUnread : 0;
  // Incruste une pastille rouge sur une icône (visible aussi sur le rail plié).
  const withBadge = (node: React.ReactNode, count: number): React.ReactNode =>
    count <= 0 ? node : (
      <span className="relative shrink-0">
        {node}
        <span className="absolute -top-1.5 -right-1.5 z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-white">
          {count}
        </span>
      </span>
    );

  // Ordre du menu : items rangés selon la préférence user ; les ids absents
  // retombent à la fin dans l'ordre par défaut (tri stable). On masque les hubs vides.
  const rank = (id: string) => { const i = navOrder.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const visibleTools = tools.filter((t) => !TOOL_CHILDREN[t.id] || childrenOf(t.id).length > 0);
  const orderedTools = [...visibleTools].sort((a, b) => rank(a.id) - rank(b.id));

  // Recherche d'outil (nav dépliée) : on aplatit en FEUILLES cliquables (les enfants
  // d'un hub, sinon l'outil lui-même), dédupliquées, puis filtrées par libellé.
  const navQ = navQuery.trim().toLowerCase();
  const seenLeaf = new Set<string>();
  const leafTools: ToolDef[] = [];
  for (const t of visibleTools) {
    const kids = childrenOf(t.id);
    for (const l of kids.length ? kids : [t]) {
      if (!seenLeaf.has(l.id)) { seenLeaf.add(l.id); leafTools.push(l); }
    }
  }
  const searchHits = navQ ? leafTools.filter((t) => t.label.toLowerCase().includes(navQ)) : [];

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = orderedTools.map((t) => t.id);
    const oldI = ids.indexOf(String(active.id));
    const newI = ids.indexOf(String(over.id));
    if (oldI < 0 || newI < 0) return;
    const next = arrayMove(ids, oldI, newI);
    setNavOrder(next);
    if (navUid) supabase.from('users').update({ nav_order: next }).eq('id_auth', navUid).then(() => {});
  };

  // Rendu d'un item de 1er niveau (lien simple, hub à 1 enfant, ou hub accordéon/flyout).
  const renderTool = (t: ToolDef): React.ReactNode => {
    const isHub = !!TOOL_CHILDREN[t.id];
    const kids = isHub ? childrenOf(t.id) : [];
    const grip = open
      ? <GripVertical className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
      : undefined;

    if (!isHub || kids.length === 1) {
      const lead = isHub ? kids[0] : t;
      return (
        <Row open={open} href={toolHref(lead, hotelId)} label={lead.label} active={isActive(basePath(lead))} onClick={closeAll}
          trailing={grip}
          iconEl={withBadge(<span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconTone(isActive(basePath(lead)), lead.text)}`}><lead.icon className="w-5 h-5" /></span>, badgeCount(lead.id))} />
      );
    }

    const groupActive = isActive(basePath(t)) || kids.some((c) => isActive(basePath(c)));
    const isExp = expanded === t.id;
    const iconEl = withBadge(<span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconTone(groupActive, t.text)}`}><t.icon className="w-5 h-5" /></span>, badgeCount(t.id));
    return (
      <>
        <Row
          open={open}
          label={t.label}
          active={groupActive}
          iconEl={iconEl}
          trailing={<span className="flex items-center gap-1">{grip}<ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition ${isExp ? 'rotate-180' : ''}`} /></span>}
          onClick={(e) => {
            if (open) { setExpanded((v) => (v === t.id ? null : t.id)); return; }
            if (flyout?.id === t.id) { setFlyout(null); return; }
            const r = (e!.currentTarget as HTMLElement).getBoundingClientRect();
            setFlyout({ id: t.id, top: r.top, left: r.right + 8 });
          }}
        />
        {open && isExp && (
          <div className="mt-1 ml-7 pl-3 border-l border-slate-100 space-y-1">
            {kids.map((c) => (
              <Row key={c.id} open compact href={toolHref(c, hotelId)} label={c.label} active={isActive(basePath(c))} onClick={closeAll}
                iconEl={withBadge(<span className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${iconTone(isActive(basePath(c)), c.text)}`}><c.icon className="w-4 h-4" /></span>, badgeCount(c.id))} />
            ))}
          </div>
        )}
      </>
    );
  };

  // Switch hôtel : on identifie l'outil de la page courante pour griser l'hôtel
  // où cette page n'existe pas (ex. Clim → Voiles seulement) sur la bascule directe.
  const allTools = [...TOOLS, ...Object.values(TOOL_CHILDREN).flat()];
  const currentTool = allTools.find((t) => { const b = basePath(t); return b !== '/' && pathname.startsWith(b); });
  const hotelInitial = (h: { nom?: string }) => {
    const words = (h.nom || '').trim().split(/\s+/);
    return (words[words.length - 1] || '?')[0]?.toUpperCase() || '?';
  };
  const hotelAvailable = (h: Record<string, unknown>) => {
    if (!currentTool?.condition) return true;
    const n = String(h.nom || '').toLowerCase();
    return isToolVisible(currentTool, {
      hasParking: !!h.has_parking, hasCoworking: !!h.has_coworking,
      isCorniche: n.includes('corniche'), isVoiles: n.includes('voiles'), isSuperadmin, isAdmin,
    });
  };

  const curHotel = hotels.find((h) => h.id === selectedHotelId) || hotels[0];

  // Clic sur le contrôle hôtel.
  //  - Déplié : ouvre/ferme le menu de choix.
  //  - Plié + 2 hôtels : bascule directe vers l'autre (si la page existe).
  //  - Plié + >2 hôtels : déplie la sidebar pour choisir.
  const onHotelClick = () => {
    if (open) { setHotelMenu((v) => !v); return; }
    if (hotels.length === 2) {
      const other = hotels.find((h) => h.id !== curHotel?.id);
      if (other && hotelAvailable(other as Record<string, unknown>)) setSelectedHotelId(other.id);
      return;
    }
    setOpen(true);
  };
  // Bascule 2-hôtels indisponible pour la page courante → on grise (état plié only).
  const directOther = hotels.length === 2 ? hotels.find((h) => h.id !== curHotel?.id) : undefined;
  const directDisabled = !open && !!directOther && !hotelAvailable(directOther as Record<string, unknown>);

  return (
    <>
      {/* Voile — seulement en overlay MOBILE (desktop : sidebar dockée, pas de voile) */}
      {open && !isDesktop && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px] animate-in fade-in duration-150"
          onClick={closeAll}
        />
      )}

      {/* Sidebar unique (se morphe w-16 ↔ w-72) */}
      <aside
        className={`fixed left-0 top-0 bottom-0 z-50 bg-white border-r border-slate-200 flex flex-col py-2 shadow-sm overflow-x-hidden transition-[width] duration-200 ease-out ${open ? 'w-72 max-w-[85vw]' : 'w-16'}`}
      >
        {/* Barre haute : bouton replier/déplier + recherche d'outil (dépliée) sur la même ligne */}
        <div className="px-3.5 mb-1 flex items-center gap-2">
          <button
            onClick={() => setOpenPersist(!open)}
            aria-label={open ? 'Replier le menu' : 'Déplier le menu'}
            title={open ? 'Replier' : 'Menu'}
            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
          >
            {open ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          </button>
          {open && (
            <input
              type="text"
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Rechercher un outil…"
              aria-label="Rechercher un outil"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] transition"
            />
          )}
        </div>

        {/* Contrôle hôtel (morphe : avatar seul ↔ avatar + nom + chevron) */}
        {hotels.length > 1 && (
          <div className="relative px-1.5 pb-2 mb-1 border-b border-slate-100">
            <button
              onClick={onHotelClick}
              disabled={directDisabled}
              title={directDisabled ? `${directOther?.nom} — indisponible pour cette page` : (open ? 'Changer d’hôtel' : `Basculer (${curHotel?.nom})`)}
              className={`group relative flex items-center w-full h-11 rounded-xl px-2 transition ${directDisabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50'}`}
            >
              <span
                className={`shrink-0 w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center shadow-sm ${directDisabled ? 'bg-slate-100 text-slate-300' : 'bg-[var(--brand)] text-white'}`}
              >
                {hotelInitial(curHotel || {})}
              </span>
              <span className={`ml-3 flex-1 text-left whitespace-nowrap text-sm font-semibold text-slate-700 transition-opacity duration-150 ${open ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'}`}>
                {curHotel?.nom || 'Choisir un hôtel'}
              </span>
              {open && <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition ${hotelMenu ? 'rotate-180' : ''}`} />}
            </button>
            {open && hotelMenu && (
              <div className="mt-1 mx-1.5 bg-white border border-slate-200 rounded-xl shadow-lg p-1 animate-in fade-in zoom-in-95 duration-100">
                {hotels.map((h) => {
                  const active = h.id === selectedHotelId;
                  return (
                    <button
                      key={h.id}
                      onClick={() => { setSelectedHotelId(h.id); setHotelMenu(false); }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${active ? 'bg-slate-100 text-[var(--brand)]' : 'text-slate-700 hover:bg-slate-50'}`}
                    >
                      <span className="truncate">{h.nom}</span>
                      {active && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden w-full flex flex-col gap-1 py-1">
          <Row open={open} href="/" label="Accueil" active={isActive('/')} onClick={closeAll}
            iconEl={<span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center"><Home className="w-5 h-5" /></span>} />

          {open && navQ ? (
            searchHits.length ? (
              searchHits.map((c) => (
                <Row key={c.id} open href={toolHref(c, hotelId)} label={c.label} active={isActive(basePath(c))} onClick={closeAll}
                  iconEl={withBadge(<span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconTone(isActive(basePath(c)), c.text)}`}><c.icon className="w-5 h-5" /></span>, badgeCount(c.id))} />
              ))
            ) : (
              <div className="px-4 py-3 text-sm text-slate-400">Aucun outil « {navQuery} ».</div>
            )
          ) : open ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedTools.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {orderedTools.map((t) => <SortableTool key={t.id} id={t.id}>{renderTool(t)}</SortableTool>)}
              </SortableContext>
            </DndContext>
          ) : (
            orderedTools.map((t) => <div key={t.id}>{renderTool(t)}</div>)
          )}
        </nav>

        {/* Footer : avatar (toujours) → profil ; nom + déconnexion en déplié */}
        <div className="border-t border-slate-100 pt-2 px-1.5 flex items-center gap-1">
          <Link href="/profil" onClick={closeAll} className="flex-1 min-w-0 flex items-center h-12 px-2 rounded-xl hover:bg-slate-50 transition">
            <span className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm" style={{ backgroundColor: 'var(--brand, #4f46e5)' }}>
              {userEmoji ? <span className="text-base">{userEmoji}</span> : userInitials}
            </span>
            <span className={`ml-3 min-w-0 transition-opacity duration-150 ${open ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'}`}>
              <span className="block text-sm font-semibold text-slate-800 truncate">{userName}</span>
              <span className="block text-[11px] text-slate-400">Mon profil</span>
            </span>
          </Link>
          {open && (
            <button onClick={() => { closeAll(); logout(); }} title="Déconnexion" aria-label="Déconnexion" className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-rose-600 hover:bg-rose-50 transition">
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>
      </aside>

      {/* Flyout d'un hub (état plié) — fixed pour échapper au clipping de la sidebar */}
      {!open && flyout && flyoutKids.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFlyout(null)} />
          <div className="fixed z-50 w-52 bg-white rounded-xl shadow-xl border border-slate-100 p-1.5 animate-in fade-in slide-in-from-left-1 duration-150" style={{ top: flyout.top, left: flyout.left }}>
            {flyoutKids.map((c) => (
              <Link key={c.id} href={toolHref(c, hotelId)} onClick={() => setFlyout(null)}
                className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-medium transition ${isActive(basePath(c)) ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                {withBadge(<span className={`w-7 h-7 rounded-md flex items-center justify-center ${iconTone(isActive(basePath(c)), c.text)}`}><c.icon className="w-4 h-4" /></span>, badgeCount(c.id))}
                {c.label}
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Contenu : décalé du rail (pl-16) ; sur desktop déplié, la sidebar est dockée
          et pousse le contenu (pl-72). Sur mobile déplié, elle passe par-dessus (pl-16 + voile). */}
      <div className={`transition-[padding] duration-200 ease-out ${open && isDesktop ? 'pl-72' : 'pl-16'}`}>{children}</div>
    </>
  );
}

// Ligne de navigation partagée plié/déplié. L'icône est ancrée au même x dans les
// deux états (padding fixe) ; seul le libellé apparaît en fondu quand `open`.
function Row({
  open, active, iconEl, label, trailing, href, onClick, compact,
}: {
  open: boolean;
  active: boolean;
  iconEl: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  href?: string;
  onClick?: (e?: React.MouseEvent<HTMLElement>) => void;
  compact?: boolean;
}) {
  const cls = `group relative flex items-center w-full ${compact ? 'h-10' : 'h-12'} px-3.5 rounded-xl transition ${active ? 'bg-slate-100' : 'hover:bg-slate-50'}`;
  const inner = (
    <>
      {active && !compact && <span className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r bg-[var(--brand)]" />}
      {iconEl}
      <span className={`ml-3 flex-1 text-left whitespace-nowrap text-sm font-medium ${active ? 'text-slate-900' : 'text-slate-700'} transition-opacity duration-150 ${open ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'}`}>
        {label}
      </span>
      {open && trailing}
    </>
  );
  if (href) return <Link href={href} title={label} onClick={() => onClick?.()} className={cls} draggable={false}>{inner}</Link>;
  return <button type="button" title={label} onClick={(e) => onClick?.(e)} className={cls}>{inner}</button>;
}

// Wrapper drag & drop d'un item de 1er niveau (menu déplié). Appui maintenu (220ms)
// → glisser pour réordonner ; un tap navigue normalement (le lien reste cliquable).
function SortableTool({ id, children }: { id: string; children: React.ReactNode }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} className={isDragging ? 'opacity-80' : ''}>
      {children}
    </div>
  );
}
