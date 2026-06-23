'use client';

// Coquille d'app : un RAIL d'icônes fixe à gauche (permanent), monté une seule
// fois dans le layout. Il enveloppe le contenu et lui réserve sa largeur (pl-16)
// pour que toutes les pages se décalent proprement — sans éditer chaque page.
// Un bouton ☰ ouvre un tiroir complet (libellés + sélecteur d'hôtel).
// Les hubs déclarés dans TOOL_CHILDREN (Planning, Commercial, Technique) sont des
// sous-menus déroulants qui pointent DIRECTEMENT sur chaque sous-outil — pas de
// page intermédiaire. Alimenté par la liste partagée src/lib/tools.
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, X, Home, ChevronDown, Building2, Check, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useHotelScope } from '@/hooks/useHotelScope';
import {
  TOOLS, TOOL_CHILDREN, isToolVisible, toolHref, type ToolDef, type ToolVisibilityCtx,
} from '@/lib/tools';

const HIDE_PREFIXES = ['/login', '/register', '/forgot-password', '/update-password'];

function basePath(t: ToolDef): string {
  return toolHref(t, '').split('?')[0];
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname() || '/';
  const { hotels, selectedHotelId, setSelectedHotelId, currentHotel } = useHotelScope(
    'id, nom, has_parking, has_coworking',
  );
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null); // groupe déplié (tiroir)
  const [flyout, setFlyout] = useState<{ id: string; top: number; left: number } | null>(null); // sous-menu rail
  const [hotelMenu, setHotelMenu] = useState(false);

  const hideShell = !user || HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (hideShell) return <>{children}</>;

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
  // Identité de l'utilisateur (personnalise le burger : avatar/emoji + nom + thème).
  const userEmoji = (user as { emoji?: string } | null)?.emoji;
  const userName = user?.name || user?.email || '';
  const userInitials = (user?.name || user?.email || '?').slice(0, 2).toUpperCase();

  const tools = TOOLS.filter((t) => isToolVisible(t, ctx));
  const hotelId = selectedHotelId || '';
  const isActive = (base: string) => (base === '/' ? pathname === '/' : pathname.startsWith(base));
  const childrenOf = (id: string) => (TOOL_CHILDREN[id] || []).filter((c) => isToolVisible(c, ctx));
  const flyoutKids = flyout ? childrenOf(flyout.id) : [];

  // Switch hôtel direct dans le rail : on identifie l'outil de la page courante
  // pour griser l'hôtel où cette page n'existe pas (ex. Clim → Voiles seulement).
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

  return (
    <>
      {/* RAIL fixe */}
      <aside className="fixed left-0 top-0 bottom-0 w-16 z-40 bg-white border-r border-slate-200 flex flex-col items-center py-2 shadow-sm">
        <button
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition mb-1"
          title="Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Switch hôtel direct dans le rail.
            2 hôtels → un seul bouton-toggle (affiche l'actuel, clic = bascule).
            >2 hôtels → pastilles empilées. Grisé si la page n'existe pas pour la cible. */}
        {hotels.length === 2 && (() => {
          const cur = hotels.find((h) => h.id === selectedHotelId) || hotels[0];
          const other = hotels.find((h) => h.id !== cur.id)!;
          const avail = hotelAvailable(other as Record<string, unknown>);
          return (
            <div className="pb-2 mb-1 border-b border-slate-100 w-full flex justify-center">
              <button
                onClick={() => { if (avail) setSelectedHotelId(other.id); }}
                disabled={!avail}
                title={avail ? `Basculer sur ${other.nom}` : `${other.nom} — indisponible pour cette page`}
                className={`w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center transition ${!avail ? 'bg-slate-50 text-slate-300 cursor-not-allowed' : 'bg-[var(--brand)] text-white shadow-sm hover:opacity-90'}`}
              >
                {hotelInitial(cur)}
              </button>
            </div>
          );
        })()}
        {hotels.length > 2 && (
          <div className="flex flex-col items-center gap-1 pb-2 mb-1 border-b border-slate-100 w-full">
            {hotels.map((h) => {
              const active = h.id === selectedHotelId;
              const avail = hotelAvailable(h as Record<string, unknown>);
              const disabled = !active && !avail;
              return (
                <button
                  key={h.id}
                  onClick={() => { if (!active && avail) setSelectedHotelId(h.id); }}
                  disabled={disabled}
                  title={avail ? h.nom : `${h.nom} — indisponible pour cette page`}
                  className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center transition ${active ? 'bg-[var(--brand)] text-white shadow-sm' : disabled ? 'text-slate-300 cursor-not-allowed' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                >
                  {hotelInitial(h)}
                </button>
              );
            })}
          </div>
        )}

        <nav className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-1 py-1">
          <RailItem href="/" label="Accueil" active={isActive('/')}>
            <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center"><Home className="w-5 h-5" /></span>
          </RailItem>

          {tools.map((t) => {
            const isHub = !!TOOL_CHILDREN[t.id];
            const kids = isHub ? childrenOf(t.id) : [];
            if (isHub && kids.length === 0) return null;

            // Hub avec ≥2 enfants → groupe (flyout)
            if (isHub && kids.length >= 2) {
              const groupActive = isActive(basePath(t)) || kids.some((c) => isActive(basePath(c)));
              const isThisFlyout = flyout?.id === t.id;
              return (
                <button
                  key={t.id}
                  onClick={(e) => {
                    if (isThisFlyout) { setFlyout(null); return; }
                    const r = e.currentTarget.getBoundingClientRect();
                    setFlyout({ id: t.id, top: r.top, left: r.right + 8 });
                  }}
                  title={t.label}
                  className={`group relative flex items-center justify-center w-12 h-12 rounded-xl transition ${groupActive || isThisFlyout ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  {groupActive && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[var(--brand)]" />}
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${t.bg} ${t.text}`}><t.icon className="w-5 h-5" /></span>
                </button>
              );
            }

            // Lien simple : outil normal, ou hub à 1 seul enfant → pointe direct dessus
            const lead = isHub ? kids[0] : t;
            const href = isHub ? (lead.href as string) : toolHref(t, hotelId);
            return (
              <RailItem key={t.id} href={href} label={lead.label} active={isActive(basePath(lead))}>
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${lead.bg} ${lead.text}`}><lead.icon className="w-5 h-5" /></span>
              </RailItem>
            );
          })}
        </nav>
      </aside>

      {/* Flyout d'un hub (rail) — en fixed pour échapper au clipping du rail */}
      {flyout && flyoutKids.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFlyout(null)} />
          <div className="fixed z-50 w-52 bg-white rounded-xl shadow-xl border border-slate-100 p-1.5 animate-in fade-in slide-in-from-left-1 duration-150" style={{ top: flyout.top, left: flyout.left }}>
            {flyoutKids.map((c) => (
              <Link key={c.id} href={c.href as string} onClick={() => setFlyout(null)}
                className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-medium transition ${isActive(basePath(c)) ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                <span className={`w-7 h-7 rounded-md flex items-center justify-center ${c.bg} ${c.text}`}><c.icon className="w-4 h-4" /></span>
                {c.label}
              </Link>
            ))}
          </div>
        </>
      )}

      {/* TIROIR complet */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            {/* En-tête : sélecteur d'hôtel + croix sur la même ligne */}
            <div className="p-3 flex items-center gap-2 border-b border-slate-100">
              {hotels.length > 1 ? (
                <div className="relative flex-1 min-w-0">
                  <button onClick={() => setHotelMenu((v) => !v)} className="w-full flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 h-10 text-sm font-semibold text-slate-700 hover:border-slate-300 transition">
                    <span className="flex items-center gap-2 min-w-0"><Building2 className="w-4 h-4 text-slate-400 shrink-0" /><span className="truncate">{currentHotel?.nom || 'Choisir un hôtel'}</span></span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition ${hotelMenu ? 'rotate-180' : ''}`} />
                  </button>
                  {hotelMenu && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-10 animate-in fade-in zoom-in-95 duration-100">
                      {hotels.map((h) => {
                        const active = h.id === selectedHotelId;
                        return (
                          <button key={h.id} onClick={() => { setSelectedHotelId(h.id); setHotelMenu(false); }}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${active ? 'bg-slate-100 text-[var(--brand)]' : 'text-slate-700 hover:bg-slate-50'}`}>
                            <span className="truncate">{h.nom}</span>
                            {active && <Check className="w-4 h-4 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : <div className="flex-1" />}
              <button onClick={() => setOpen(false)} aria-label="Fermer le menu" className="p-1.5 shrink-0 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50 transition"><X className="w-5 h-5" /></button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2 space-y-1">
              <DrawerItem href="/" label="Accueil" active={isActive('/')} onClick={() => setOpen(false)}>
                <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><Home className="w-[18px] h-[18px]" /></span>
              </DrawerItem>

              {tools.map((t) => {
                const isHub = !!TOOL_CHILDREN[t.id];
                const kids = isHub ? childrenOf(t.id) : [];
                if (isHub && kids.length === 0) return null;

                // Lien simple : outil normal, ou hub à 1 seul enfant → pointe direct dessus
                if (!isHub || kids.length === 1) {
                  const lead = isHub ? kids[0] : t;
                  const href = isHub ? (lead.href as string) : toolHref(t, hotelId);
                  return (
                    <DrawerItem key={t.id} href={href} label={lead.label} active={isActive(basePath(lead))} onClick={() => setOpen(false)}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${lead.bg} ${lead.text}`}><lead.icon className="w-[18px] h-[18px]" /></span>
                    </DrawerItem>
                  );
                }
                const groupActive = isActive(basePath(t)) || kids.some((c) => isActive(basePath(c)));
                const isExp = expanded === t.id;
                return (
                  <div key={t.id}>
                    <button onClick={() => setExpanded((v) => (v === t.id ? null : t.id))} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition ${groupActive ? 'text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${t.bg} ${t.text}`}><t.icon className="w-[18px] h-[18px]" /></span>
                      <span className="flex-1 text-left">{t.label}</span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition ${isExp ? 'rotate-180' : ''}`} />
                    </button>
                    {isExp && (
                      <div className="mt-1 ml-5 pl-3 border-l border-slate-100 space-y-1">
                        {kids.map((c) => (
                          <DrawerItem key={c.id} href={c.href as string} label={c.label} active={isActive(basePath(c))} onClick={() => setOpen(false)}>
                            <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${c.bg} ${c.text}`}><c.icon className="w-4 h-4" /></span>
                          </DrawerItem>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>

            {/* Identité utilisateur (avatar + nom dans sa couleur) + déconnexion */}
            <div className="border-t border-slate-100 p-2 flex items-center gap-2">
              <Link href="/profil" onClick={() => setOpen(false)} className="flex-1 min-w-0 flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 transition">
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-sm" style={{ backgroundColor: 'var(--brand, #4f46e5)' }}>
                  {userEmoji ? <span className="text-base">{userEmoji}</span> : userInitials}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800 truncate">{userName}</span>
                  <span className="block text-[11px] text-slate-400">Mon profil</span>
                </span>
              </Link>
              <button onClick={() => { setOpen(false); logout(); }} title="Déconnexion" aria-label="Déconnexion" className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-rose-600 hover:bg-rose-50 transition">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Contenu décalé de la largeur du rail */}
      <div className="pl-16">{children}</div>
    </>
  );
}

function RailItem({ href, label, active, children }: { href: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} title={label} className={`relative flex items-center justify-center w-12 h-12 rounded-xl transition ${active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
      {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[var(--brand)]" />}
      {children}
    </Link>
  );
}

function DrawerItem({ href, label, active, onClick, children }: { href: string; label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onClick} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition ${active ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
      {children}
      {label}
    </Link>
  );
}
