"use client";

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { fr as frLocale } from 'date-fns/locale';
import { format as dfFormat, parse as dfParse } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { 
  ChevronDown, ChevronRight, Wrench, Lightbulb, Droplets, Fan, Hammer, 
  PaintRoller, DoorClosed, PlugZap, Plus, Calendar,
  CheckCircle, AlertCircle, Clock, Euro, ArrowRight, Trash2, Edit2,
  LayoutGrid, List, History
} from 'lucide-react';

// --- TYPES & CONSTANTES ---

type MaintItem = {
  id: string;
  hotel_id: string;
  group_id?: string | null;
  titre: string;
  type: string;
  chambre?: string | null;
  chambres?: string[] | null;
  statut: 'À faire' | 'Fait';
  date_creation: string;
  date_resolution?: string | null;
  temps_travail?: number | null;
  budget?: number | null;
  commentaire?: string | null;
  created_at?: string;
};

const getRooms = (it: MaintItem) => it.chambre ? [it.chambre] : (it.chambres || []);

const ROOM_OPTIONS = [
  '2','3','4','5','6','7','11','12','14','15','16','17','18',
  '21','22','23','24','25','26','27','31','32','33','34','35','36','37',
  '41','42','Patio','Lobby','PDJ','Seminaire','Couloirs','Sous-Sol'
];

const TYPE_OPTIONS = [
  'plomberie','electricité','luminaires','sol','salle de bain','murs','portes','clim','dégat','autres'
];

// Couleurs "Vibrantes" pour moderniser
const TYPE_COLORS: Record<string, string> = {
  'plomberie':     'text-sky-600 bg-sky-50 border-sky-100',
  'electricité':   'text-amber-600 bg-amber-50 border-amber-100',
  'luminaires':    'text-yellow-600 bg-yellow-50 border-yellow-100',
  'sol':           'text-emerald-600 bg-emerald-50 border-emerald-100',
  'salle de bain': 'text-cyan-600 bg-cyan-50 border-cyan-100',
  'murs':          'text-rose-600 bg-rose-50 border-rose-100',
  'portes':        'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-100',
  'clim':          'text-indigo-600 bg-indigo-50 border-indigo-100',
  'dégat':         'text-red-600 bg-red-50 border-red-100',
  'autres':        'text-slate-600 bg-slate-50 border-slate-100',
};

const TypeIcon = ({ type }: { type: string }) => {
  const props = { className: "w-4 h-4" };
  switch (type) {
    case 'plomberie':     return <Droplets {...props} />;
    case 'electricité':   return <PlugZap {...props} />;
    case 'luminaires':    return <Lightbulb {...props} />;
    case 'sol':           return <Hammer {...props} />;
    case 'salle de bain': return <Droplets {...props} />;
    case 'murs':          return <PaintRoller {...props} />;
    case 'portes':        return <DoorClosed {...props} />;
    case 'clim':          return <Fan {...props} />;
    case 'dégat':         return <AlertCircle {...props} />;
    default:              return <Wrench {...props} />;
  }
};

const TypeBadge = ({ type }: { type: string }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-full border ${TYPE_COLORS[type] ?? 'text-gray-600 bg-gray-50 border-gray-200'}`}>
    <TypeIcon type={type} /> <span>{type}</span>
  </span>
);

const RoomChip = ({ r }: { r: string }) => (
  <span className="inline-flex items-center px-2 py-1 text-[10px] font-bold rounded-md bg-white text-slate-600 border border-slate-200 shadow-sm">
    #{r}
  </span>
);

const toFr = (iso?: string | null) =>
  iso ? dfFormat(new Date(iso), 'd MMM', { locale: frLocale }) : '';

const toISO = (frStr: string) => {
  try { return dfFormat(dfParse(frStr, 'dd/MM/yyyy', new Date()), 'yyyy-MM-dd'); }
  catch { return ''; }
};

// --- COMPOSANT PRINCIPAL ---

function MaintenancePageInner() {
  const { user: rawUser } = useAuth();
  const searchParams = useSearchParams();

  const [hotelId, setHotelId] = useState<string>('');
  const [items, setItems] = useState<MaintItem[]>([]);
  const [loading, setLoading] = useState(false);

  // UI States
  const [showCreate, setShowCreate] = useState(false);
  const [showClose, setShowClose] = useState<null | MaintItem>(null);
  const [editItem, setEditItem] = useState<MaintItem | null>(null);
  
  // Forms
  const [editForm, setEditForm] = useState({ titre: '', type: TYPE_OPTIONS[0], chambre: '', commentaire: '' });
  const [newItem, setNewItem] = useState<Partial<MaintItem>>({ titre: '', type: TYPE_OPTIONS[0], chambres: [], commentaire: '' });

  // Filter States for Accordions
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});
  const [openRooms, setOpenRooms] = useState<Record<string, boolean>>({});
  const [openHistTypes, setOpenHistTypes] = useState<Record<string, boolean>>({});
  const [openHistRooms, setOpenHistRooms] = useState<Record<string, boolean>>({});

  // History Filter States
  const [histStart, setHistStart] = useState<string>('');
  const [histEnd, setHistEnd] = useState<string>('');

  const toggleType = (t: string) => setOpenTypes(p => ({ ...p, [t]: !p[t] }));
  const toggleRoom = (r: string) => setOpenRooms(p => ({ ...p, [r]: !p[r] }));
  const toggleHistType = (t: string) => setOpenHistTypes(p => ({ ...p, [t]: !p[t] }));
  const toggleHistRoom = (r: string) => setOpenHistRooms(p => ({ ...p, [r]: !p[r] }));

  // --- DATA LOADING ---
  useEffect(() => {
    (async () => {
      const fromQS = searchParams?.get('hotel_id');
      if (fromQS) { setHotelId(fromQS); return; }
      if (typeof window !== 'undefined') {
        const fromLS = window.localStorage.getItem('selectedHotelId');
        if (fromLS) { setHotelId(fromLS); return; }
      }
      const { data: authRes } = await supabase.auth.getUser();
      if (authRes?.user?.id) {
        const { data: u } = await supabase.from('users').select('hotel_id').eq('id_auth', authRes.user.id).maybeSingle();
        if (u?.hotel_id) {
          setHotelId(u.hotel_id);
          if (typeof window !== 'undefined') window.localStorage.setItem('selectedHotelId', u.hotel_id);
        }
      }
    })();
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      if (!hotelId) return;
      setLoading(true);
      const { data, error } = await supabase.from('maintenance').select('*').eq('hotel_id', hotelId).order('date_creation', { ascending: false }).order('created_at', { ascending: false });
      if (!error) setItems((data as any) || []);
      setLoading(false);
    })();
  }, [hotelId]);

  // --- COMPUTED DATA ---
  const inDateRange = (iso?: string | null) => {
    if (!iso) return false;
    if (histStart && iso < histStart) return false;
    if (histEnd && iso > histEnd) return false;
    return true;
  };

  const histByType = useMemo(() => {
    const map = new Map<string, MaintItem[]>();
    items.filter(i => i.statut === 'Fait').filter(i => inDateRange(i.date_resolution)).forEach(it => {
      if (!map.has(it.type)) map.set(it.type, []);
      map.get(it.type)!.push(it);
    });
    return Array.from(map.entries());
  }, [items, histStart, histEnd]);

  const histByRoom = useMemo(() => {
    const map = new Map<string, MaintItem[]>();
    items.filter(i => i.statut === 'Fait').filter(i => inDateRange(i.date_resolution)).forEach(it => {
      getRooms(it).forEach(r => {
        if (!map.has(r)) map.set(r, []);
        map.get(r)!.push(it);
      });
    });
    const order = new Map(ROOM_OPTIONS.map((r, i) => [r, i]));
    return Array.from(map.entries()).sort((a, b) => (order.get(a[0]) ?? 9999) - (order.get(b[0]) ?? 9999));
  }, [items, histStart, histEnd]);

  const byType = useMemo(() => {
    const map = new Map<string, MaintItem[]>();
    items.forEach(it => {
      if (!map.has(it.type)) map.set(it.type, []);
      map.get(it.type)!.push(it);
    });
    return Array.from(map.entries());
  }, [items]);

  const byRoom = useMemo(() => {
    const map = new Map<string, MaintItem[]>();
    items.forEach(it => getRooms(it).forEach(r => {
      if (!map.has(r)) map.set(r, []);
      map.get(r)!.push(it);
    }));
    const order = new Map(ROOM_OPTIONS.map((r, i) => [r, i]));
    return Array.from(map.entries()).sort((a, b) => (order.get(a[0]) ?? 9999) - (order.get(b[0]) ?? 9999));
  }, [items]);

  // --- ACTIONS ---
  const createItem = async () => {
    if (!hotelId || !newItem.titre?.trim() || !newItem.type || !newItem.chambres?.length) return;
    const groupId = crypto.randomUUID();
    const today = dfFormat(new Date(), 'yyyy-MM-dd');
    const payloads = (newItem.chambres as string[]).map((room) => ({
      hotel_id: hotelId, group_id: groupId, titre: newItem.titre!.trim(), type: newItem.type!, chambre: room, chambres: [room], statut: 'À faire' as const, commentaire: newItem.commentaire || null, date_creation: today,
    }));
    const { data, error } = await supabase.from('maintenance').insert(payloads).select();
    if (!error) {
        setItems(prev => [...(data as any), ...prev]);
        setShowCreate(false);
        setNewItem({ titre: '', type: TYPE_OPTIONS[0], chambres: [], commentaire: '' });
    }
  };

  const closeItem = async (fields: { temps: number; budget: number; dateFr: string }) => {
    if (!showClose) return;
    const dateISO = toISO(fields.dateFr) || dfFormat(new Date(), 'yyyy-MM-dd');
    const payload = { statut: 'Fait' as const, temps_travail: Number(fields.temps) || null, budget: Number(fields.budget) || null, date_resolution: dateISO };
    await supabase.from('maintenance').update(payload).eq('id', showClose.id);
    setItems(prev => prev.map(x => x.id === showClose.id ? { ...x, ...payload } : x));
    setShowClose(null);
  };

  const reopenItem = async (id: string) => {
    const payload = { statut: 'À faire' as const, date_resolution: null, temps_travail: null, budget: null };
    await supabase.from('maintenance').update(payload).eq('id', id);
    setItems(prev => prev.map(x => x.id === id ? { ...x, ...payload } : x));
  };

  const removeItem = async (id: string) => {
    if (!confirm('Supprimer cette maintenance ?')) return;
    await supabase.from('maintenance').delete().eq('id', id);
    setItems(prev => prev.filter(x => x.id !== id));
  };

  const saveEdit = async () => {
    if (!editItem || !editForm.titre.trim()) return;
    const payload = { titre: editForm.titre.trim(), type: editForm.type, chambre: editForm.chambre || null, chambres: editForm.chambre ? [editForm.chambre] : [], commentaire: editForm.commentaire || null };
    await supabase.from('maintenance').update(payload).eq('id', editItem.id);
    setItems(prev => prev.map(x => (x.id === editItem.id ? { ...x, ...payload } : x)));
    setEditItem(null);
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* --- MAIN CONTENT --- */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        
        {/* Header Flottant Moderne */}
        <div className="h-20 shrink-0 flex items-center justify-between px-8 z-20">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-2xl shadow-sm flex items-center justify-center">
                    <Wrench className="w-5 h-5 text-indigo-600" />
                </div>
                <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Maintenance</h1>
            </div>
            <Button onClick={() => setShowCreate(true)} disabled={!hotelId} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 rounded-2xl px-6 h-12 text-sm font-bold transition-all hover:-translate-y-0.5">
                <Plus className="w-5 h-5 mr-2" /> Signalement
            </Button>
        </div>

        {/* Tabs & Content */}
        <div className="flex-1 overflow-hidden px-4 md:px-8 pb-4">
            <Tabs defaultValue="type" className="h-full flex flex-col">
                <div className="shrink-0 mb-6">
                    <TabsList className="bg-white/60 backdrop-blur-md p-1.5 rounded-2xl border border-white shadow-sm w-full max-w-md grid grid-cols-3">
                        <TabsTrigger value="type" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-md font-bold text-xs py-2.5 transition-all">
                            <LayoutGrid className="w-4 h-4 mr-2 mb-0.5 inline-block" />Par Type
                        </TabsTrigger>
                        <TabsTrigger value="chambre" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-md font-bold text-xs py-2.5 transition-all">
                            <List className="w-4 h-4 mr-2 mb-0.5 inline-block" />Par Chambre
                        </TabsTrigger>
                        <TabsTrigger value="historique" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-md font-bold text-xs py-2.5 transition-all">
                            <History className="w-4 h-4 mr-2 mb-0.5 inline-block" />Historique
                        </TabsTrigger>
                    </TabsList>
                </div>

                {/* SCROLLABLE AREA */}
                <div className="flex-1 overflow-y-auto pr-2 pb-20 custom-scrollbar">
                    
                    {/* --- PAR TYPE --- */}
                    <TabsContent value="type" className="space-y-6 mt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {byType.map(([type, arr]) => {
                            const enCours = arr.filter(x => x.statut === 'À faire');
                            const open = !!openTypes[type];
                            if (enCours.length === 0) return null;

                            return (
                                <div key={type} className="group">
                                    <button onClick={() => toggleType(type)} className="w-full flex items-center justify-between mb-3 px-2 hover:px-4 transition-all duration-300">
                                        <div className="flex items-center gap-4">
                                            <h2 className="text-lg font-black text-slate-800 capitalize flex items-center gap-2">
                                                {type} <span className="text-xs font-medium text-slate-400 bg-white px-2 py-1 rounded-full shadow-sm border border-slate-100">{enCours.length}</span>
                                            </h2>
                                        </div>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${open ? 'bg-indigo-100 text-indigo-600 rotate-180' : 'bg-white text-slate-400'}`}>
                                            <ChevronDown className="w-5 h-5" />
                                        </div>
                                    </button>
                                    
                                    {open && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                                            {enCours.map(it => (
                                                <TaskCard 
                                                    key={it.id} item={it} 
                                                    onEdit={() => { setEditItem(it); setEditForm({ titre: it.titre, type: it.type, chambre: getRooms(it)[0] || '', commentaire: it.commentaire || '' }); }}
                                                    onClose={() => setShowClose(it)}
                                                    onDelete={() => removeItem(it.id)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {byType.every(([_, arr]) => arr.filter(x => x.statut === 'À faire').length === 0) && (
                            <EmptyState message="Tout est en ordre ! Aucune maintenance à faire." />
                        )}
                    </TabsContent>

                    {/* --- PAR CHAMBRE --- */}
                    <TabsContent value="chambre" className="space-y-6 mt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {byRoom.map(([room, arr]) => {
                            const enCours = arr.filter(x => x.statut === 'À faire');
                            const open = !!openRooms[room];
                            if (enCours.length === 0) return null;

                            return (
                                <div key={room} className="group">
                                    <button onClick={() => toggleRoom(room)} className="w-full flex items-center justify-between mb-3 px-2 hover:px-4 transition-all duration-300">
                                        <div className="flex items-center gap-4">
                                            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                                Chambre {room} <span className="text-xs font-medium text-slate-400 bg-white px-2 py-1 rounded-full shadow-sm border border-slate-100">{enCours.length}</span>
                                            </h2>
                                        </div>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${open ? 'bg-indigo-100 text-indigo-600 rotate-180' : 'bg-white text-slate-400'}`}>
                                            <ChevronDown className="w-5 h-5" />
                                        </div>
                                    </button>
                                    {open && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                                            {enCours.map(it => (
                                                <TaskCard 
                                                    key={it.id} item={it} 
                                                    onEdit={() => { setEditItem(it); setEditForm({ titre: it.titre, type: it.type, chambre: getRooms(it)[0] || '', commentaire: it.commentaire || '' }); }}
                                                    onClose={() => setShowClose(it)}
                                                    onDelete={() => removeItem(it.id)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </TabsContent>

                    {/* --- HISTORIQUE --- */}
                    <TabsContent value="historique" className="mt-0 h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* 1. Filtres */}
                        <div className="bg-white p-3 rounded-3xl border border-slate-100 shadow-sm mb-4 flex flex-wrap items-center gap-3 shrink-0">
                            <div className="flex items-center gap-2 text-sm text-indigo-900 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                                <Calendar className="w-4 h-4" />
                                <span className="font-bold text-xs uppercase tracking-wide">Période</span>
                            </div>
                            <div className="flex items-center bg-slate-50 rounded-xl p-1 border border-slate-200">
                                <input type="date" value={histStart} onChange={(e) => setHistStart(e.target.value)} className="bg-transparent text-xs font-medium px-2 outline-none text-slate-600" />
                                <ArrowRight className="w-3 h-3 text-slate-300" />
                                <input type="date" value={histEnd} onChange={(e) => setHistEnd(e.target.value)} className="bg-transparent text-xs font-medium px-2 outline-none text-slate-600" />
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => { setHistStart(''); setHistEnd(''); }} className="text-xs text-slate-400 hover:text-slate-600 h-8 rounded-xl hover:bg-slate-100 ml-auto">Effacer</Button>
                        </div>

                        {/* 2. BARRE DE TOTAUX (KPI) */}
                        {(() => {
                            const allHistoryItems = items.filter(it => it.statut === 'Fait' && inDateRange(it.date_resolution));
                            const globalBudget = allHistoryItems.reduce((acc, curr) => acc + (Number(curr.budget) || 0), 0);
                            const globalTime = allHistoryItems.reduce((acc, curr) => acc + (Number(curr.temps_travail) || 0), 0);

                            return (
                                <div className="grid grid-cols-3 gap-3 mb-6 shrink-0">
                                    <div className="bg-white border border-slate-100 p-3 rounded-2xl shadow-sm flex flex-col items-center justify-center">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Dépensé</span>
                                        <span className="text-lg font-extrabold text-emerald-600 flex items-center gap-1">
                                            {globalBudget.toFixed(2)} <Euro className="w-4 h-4" />
                                        </span>
                                    </div>
                                    <div className="bg-white border border-slate-100 p-3 rounded-2xl shadow-sm flex flex-col items-center justify-center">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Temps</span>
                                        <span className="text-lg font-extrabold text-blue-600 flex items-center gap-1">
                                            {globalTime} <span className="text-xs font-bold text-blue-400">min</span>
                                        </span>
                                    </div>
                                    <div className="bg-white border border-slate-100 p-3 rounded-2xl shadow-sm flex flex-col items-center justify-center">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Tâches</span>
                                        <span className="text-lg font-extrabold text-slate-700 flex items-center gap-1">
                                            {allHistoryItems.length} <CheckCircle className="w-4 h-4 text-slate-300" />
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}

                        <Tabs defaultValue="h-type" className="w-full flex-1 overflow-hidden flex flex-col">
                            <TabsList className="w-full bg-transparent justify-start rounded-none p-0 mb-4 h-auto space-x-6 border-b border-slate-200 shrink-0">
                                <TabsTrigger value="h-type" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:bg-transparent pb-3 font-bold text-sm text-slate-400 hover:text-slate-600 transition-colors">Par Type</TabsTrigger>
                                <TabsTrigger value="h-room" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:bg-transparent pb-3 font-bold text-sm text-slate-400 hover:text-slate-600 transition-colors">Par Chambre</TabsTrigger>
                            </TabsList>

                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                <TabsContent value="h-type" className="space-y-4 mt-0">
                                    {histByType.map(([type, arr]) => (
                                        <HistoryFolder key={type} title={type} items={arr} openState={openHistTypes} toggleFunc={() => toggleHistType(type)} id={type} onReopen={reopenItem} />
                                    ))}
                                    {histByType.length === 0 && <EmptyState message="Aucun historique." />}
                                </TabsContent>

                                <TabsContent value="h-room" className="space-y-4 mt-0">
                                    {histByRoom.map(([room, arr]) => (
                                        <HistoryFolder key={room} title={`Chambre ${room}`} items={arr} openState={openHistRooms} toggleFunc={() => toggleHistRoom(room)} id={room} onReopen={reopenItem} />
                                    ))}
                                </TabsContent>
                            </div>
                        </Tabs>
                    </TabsContent>
                </div>
            </Tabs>
        </div>

      </div>

      {/* --- MODALS --- */}
      
      {/* CREATE */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-3xl w-full max-w-lg space-y-6 shadow-2xl animate-in fade-in zoom-in duration-200 border border-white/50">
            <h2 className="text-2xl font-extrabold text-slate-800">Nouveau signalement</h2>
            <Input placeholder="Qu'est-ce qui ne va pas ?" className="text-lg font-medium h-12 rounded-xl bg-slate-50 border-slate-200 focus:ring-indigo-500" value={newItem.titre || ''} onChange={(e) => setNewItem({ ...newItem, titre: e.target.value })} />
            
            <div className="grid grid-cols-1 gap-4">
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Type de problème</label>
                    <div className="flex flex-wrap gap-2">
                        {TYPE_OPTIONS.map(t => (
                            <button key={t} onClick={() => setNewItem({ ...newItem, type: t })} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${newItem.type === t ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Lieux concernés</label>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-40 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-100 custom-scrollbar">
                {ROOM_OPTIONS.map(r => (
                    <label key={r} className={`cursor-pointer flex items-center justify-center px-2 py-2 rounded-lg border text-xs font-bold transition-all ${newItem.chambres?.includes(r) ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>
                        <input type="checkbox" className="hidden" checked={newItem.chambres?.includes(r)} onChange={(e) => { const cur = new Set(newItem.chambres || []); if (e.target.checked) cur.add(r); else cur.delete(r); setNewItem({ ...newItem, chambres: Array.from(cur) }); }} />
                        {r}
                    </label>
                ))}
              </div>
            </div>

            <textarea rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none placeholder:text-slate-400" placeholder="Détails supplémentaires..." value={newItem.commentaire || ''} onChange={(e) => setNewItem({ ...newItem, commentaire: e.target.value })} />

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setShowCreate(false)} className="rounded-xl hover:bg-slate-100 text-slate-500">Annuler</Button>
              <Button onClick={createItem} className="bg-indigo-600 hover:bg-indigo-700 rounded-xl px-6 font-bold shadow-lg shadow-indigo-200">Créer</Button>
            </div>
          </div>
        </div>
      )}

      {/* CLOSE */}
      {showClose && (
        <CloseModal item={showClose} onCancel={() => setShowClose(null)} onConfirm={closeItem} />
      )}

      {/* EDIT */}
      {editItem && (
        <EditModal item={editItem} form={editForm} setForm={setEditForm} onCancel={() => setEditItem(null)} onSave={saveEdit} />
      )}

    </div>
  );
}

// --- SUB COMPONENTS (MODERNIZED) ---

function TaskCard({ item, onEdit, onClose, onDelete }: { item: MaintItem, onEdit: () => void, onClose: () => void, onDelete: () => void }) {
    return (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col gap-3 group">
            <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                    <div className="flex gap-2 items-center mb-1">
                        {getRooms(item).map(r => <RoomChip key={r} r={r}/>)}
                    </div>
                    <h3 className="font-bold text-slate-800 text-sm leading-tight">{item.titre}</h3>
                </div>
                <TypeBadge type={item.type} />
            </div>
            
            {item.commentaire && (
                <div className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-100">
                    "{item.commentaire}"
                </div>
            )}

            <div className="mt-auto pt-3 flex items-center justify-between border-t border-slate-50">
                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3"/> {toFr(item.date_creation)}</span>
                
                <div className="flex items-center gap-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={onEdit} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"><Edit2 className="w-4 h-4"/></button>
                    <button onClick={onDelete} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-4 h-4"/></button>
                    <button onClick={onClose} className="ml-1 flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white hover:bg-black rounded-lg text-xs font-bold transition shadow-md transform active:scale-95">
                        <CheckCircle className="w-3.5 h-3.5"/> Fait
                    </button>
                </div>
            </div>
        </div>
    )
}

function HistoryFolder({ title, items, openState, toggleFunc, id, onReopen }: any) {
    const open = !!openState[id];
    // CALCULS SÉCURISÉS
    const totalTime = items.reduce((acc:any, curr:any) => acc + (Number(curr.temps_travail) || 0), 0);
    const totalBudget = items.reduce((acc:any, curr:any) => acc + (Number(curr.budget) || 0), 0);

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden group">
            <button onClick={toggleFunc} className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-xl transition-colors ${open ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-indigo-500'}`}>
                        {open ? <ChevronDown className="w-5 h-5"/> : <ChevronRight className="w-5 h-5"/>}
                    </div>
                    <div className="text-left">
                        <h3 className="font-bold text-slate-800 capitalize text-sm">{title}</h3>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200">{items.length} résolus</span>
                            {totalTime > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1"><Clock className="w-3 h-3"/> {totalTime}m</span>}
                            
                            {/* BADGE BUDGET CORRIGÉ ET FORCÉ */}
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1">
                                <Euro className="w-3 h-3"/> {totalBudget.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            </button>
            {open && (
                <div className="border-t border-slate-100 bg-slate-50/50">
                    {items.map((it: any) => (
                        <div key={it.id} className="flex items-center justify-between p-4 border-b border-slate-100 last:border-0 hover:bg-white transition-colors">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-slate-800 text-sm">{it.titre}</span>
                                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">#{getRooms(it).join(', ')}</span>
                                </div>
                                <div className="text-xs text-slate-500 flex gap-3 items-center">
                                    <span>{toFr(it.date_resolution)}</span>
                                    {it.temps_travail ? <span>• {it.temps_travail} min</span> : null}
                                    
                                    {/* PRIX INDIVIDUEL LIGNE */}
                                    <span className="font-bold text-emerald-600 bg-emerald-50 px-1.5 rounded border border-emerald-100 flex items-center">
                                        {Number(it.budget || 0).toFixed(2)} €
                                    </span>
                                </div>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => onReopen(it.id)} className="text-xs h-8 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 text-slate-600">Rouvrir</Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function CloseModal({ item, onCancel, onConfirm }: any) {
  const [temps, setTemps] = useState('');
  const [budget, setBudget] = useState('');
  const [dateFr, setDateFr] = useState(dfFormat(new Date(), 'dd/MM/yyyy', { locale: frLocale }));

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white p-8 rounded-3xl w-full max-w-sm space-y-6 shadow-2xl border border-white/50">
        <div className="text-center">
            <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-800">Tâche terminée !</h2>
            <p className="text-sm text-slate-500 mt-1 line-clamp-1">{item.titre}</p>
        </div>
        <div className="space-y-4">
            <div className="relative">
                <Clock className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                <Input type="number" placeholder="Temps passé (min)" className="pl-10 h-12 rounded-xl bg-slate-50 border-slate-200" value={temps} onChange={(e) => setTemps(e.target.value)} />
            </div>
            <div className="relative">
                <Euro className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                <Input type="number" placeholder="Coût (€)" className="pl-10 h-12 rounded-xl bg-slate-50 border-slate-200" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <div className="relative">
                <Calendar className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                <Input placeholder="Date" className="pl-10 h-12 rounded-xl bg-slate-50 border-slate-200" value={dateFr} onChange={(e) => setDateFr(e.target.value)} />
            </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} className="rounded-xl hover:bg-slate-100 text-slate-500 font-bold">Annuler</Button>
          <Button onClick={() => onConfirm({ temps: Number(temps), budget: Number(budget), dateFr })} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl px-6 shadow-lg shadow-emerald-200">Valider</Button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ item, form, setForm, onCancel, onSave }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-3xl w-full max-w-lg space-y-4 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-800">Modifier</h2>
        <Input placeholder="Titre" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} className="rounded-xl h-12 font-medium" />
        <div className="grid grid-cols-2 gap-4">
            <select className="w-full border rounded-xl px-3 h-12 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="w-full border rounded-xl px-3 h-12 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500" value={form.chambre} onChange={(e) => setForm({ ...form, chambre: e.target.value })}>
                <option value="">Zone...</option>
                {ROOM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
        </div>
        <textarea rows={3} className="w-full border rounded-xl px-3 py-3 text-sm resize-none bg-slate-50" value={form.commentaire} onChange={(e) => setForm({ ...form, commentaire: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} className="rounded-xl">Annuler</Button>
          <Button onClick={onSave} className="bg-indigo-600 hover:bg-indigo-700 rounded-xl font-bold text-white">Sauvegarder</Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-slate-300">
            <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-4 animate-pulse">
                <CheckCircle className="w-10 h-10 text-slate-200" />
            </div>
            <p className="text-lg font-medium text-slate-400">{message}</p>
        </div>
    )
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-slate-400">Chargement...</div>}>
      <MaintenancePageInner />
    </Suspense>
  );
}