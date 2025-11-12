'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { fr as frLocale } from 'date-fns/locale';
import { format as dfFormat, parse as dfParse } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ChevronDown, ChevronUp, Wrench, Lightbulb, Droplets, Fan, Hammer, PaintRoller, DoorClosed, PlugZap } from 'lucide-react';


type MaintItem = {
  id: string;
  hotel_id: string;
  group_id?: string | null;
  titre: string;
  type: string;
  chambre?: string | null;     // ✅ une seule chambre
  chambres?: string[] | null;  // legacy
  statut: 'À faire' | 'Fait';
  date_creation: string;
  date_resolution?: string | null;
  temps_travail?: number | null;
  budget?: number | null;
  commentaire?: string | null;
  created_at?: string;
};
const getRooms = (it: MaintItem) =>
  it.chambre ? [it.chambre] : (it.chambres || []);


const ROOM_OPTIONS = [
  '2','3','4','5','6','7','11','12','14','15','16','17','18',
  '21','22','23','24','25','26','27','31','32','33','34','35','36','37',
  '41','42','Patio','Lobby','PDJ','Seminaire','Couloirs','Sous-Sol'
];

const TYPE_OPTIONS = [
  'plomberie','electricité','luminaires','sol','salle de bain','murs','portes','clim','dégat','autres'
];

// Couleurs par type (badge)
const TYPE_COLORS: Record<string, string> = {
  'plomberie':     'bg-sky-100 text-sky-800 ring-1 ring-sky-200',
  'electricité':   'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
  'luminaires':    'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-200',
  'sol':           'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
  'salle de bain': 'bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200',
  'murs':          'bg-rose-100 text-rose-800 ring-1 ring-rose-200',
  'portes':        'bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-200',
  'clim':          'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200',
  'dégat':         'bg-red-100 text-red-800 ring-1 ring-red-200',
  'autres':        'bg-gray-100 text-gray-700 ring-1 ring-gray-200',
};

// Icône par type
const TypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'plomberie':     return <Droplets className="w-4 h-4" />;
    case 'electricité':   return <PlugZap className="w-4 h-4" />;
    case 'luminaires':    return <Lightbulb className="w-4 h-4" />;
    case 'sol':           return <Hammer className="w-4 h-4" />;
    case 'salle de bain': return <Droplets className="w-4 h-4" />;
    case 'murs':          return <PaintRoller className="w-4 h-4" />;
    case 'portes':        return <DoorClosed className="w-4 h-4" />;
    case 'clim':          return <Fan className="w-4 h-4" />;
    case 'dégat':         return <Wrench className="w-4 h-4" />;
    default:              return <Wrench className="w-4 h-4" />;
  }
};

// Badge type
const TypeBadge = ({ type }: { type: string }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-700 ring-1 ring-gray-200'}`}>
    <TypeIcon type={type} /> <span className="capitalize">{type}</span>
  </span>
);

// Chip chambre
const RoomChip = ({ r }: { r: string }) => (
  <span className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-700 ring-1 ring-gray-200">
    {r}
  </span>
);


// Compteurs compacts (header de groupe) — orange uniquement si > 0
const CountChip = ({ label }: { label: string }) => {
  const isTodo = label.toLowerCase().includes('à faire');
  const hasTasks = parseInt(label) > 0;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] rounded-full ring-1
        ${isTodo && hasTasks
          ? 'bg-orange-100 text-orange-800 ring-orange-200'
          : 'bg-gray-50 text-gray-500 ring-gray-200'
        }`}
    >
      {label}
    </span>
  );
};




const toFr = (iso?: string | null) =>
  iso ? dfFormat(new Date(iso), 'dd/MM/yyyy', { locale: frLocale }) : '';

const toISO = (frStr: string) => {
  try { return dfFormat(dfParse(frStr, 'dd/MM/yyyy', new Date()), 'yyyy-MM-dd'); }
  catch { return ''; }
};




export default function MaintenancePage() {
  const { user: rawUser } = useAuth();
  const user = rawUser as any;
  const search = useSearchParams();

  const [hotelId, setHotelId] = useState<string>('');
  const [items, setItems] = useState<MaintItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Colonne gauche
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<MaintItem | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showClose, setShowClose] = useState<null | MaintItem>(null);

  // Form création
  const [newItem, setNewItem] = useState<Partial<MaintItem>>({
    titre: '',
    type: TYPE_OPTIONS[0],
    chambres: [],
    commentaire: ''
  });

  // Filtres Historique
  const [filterType, setFilterType] = useState<string>('Tous');
  const [filterRoom, setFilterRoom] = useState<string>('Toutes');

  // juste après tes autres useState
const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});
const [openRooms, setOpenRooms] = useState<Record<string, boolean>>({});

const toggleType = (t: string) => setOpenTypes(p => ({ ...p, [t]: !p[t] }));
const toggleRoom = (r: string) => setOpenRooms(p => ({ ...p, [r]: !p[r] }));

const [openHistTypes, setOpenHistTypes] = useState<Record<string, boolean>>({});
const [openHistRooms, setOpenHistRooms] = useState<Record<string, boolean>>({});
const toggleHistType = (t: string) => setOpenHistTypes(p => ({ ...p, [t]: !p[t] }));
const toggleHistRoom = (r: string) => setOpenHistRooms(p => ({ ...p, [r]: !p[r] }));

const [histStart, setHistStart] = useState<string>(''); // ISO yyyy-MM-dd
const [histEnd, setHistEnd] = useState<string>('');     // ISO yyyy-MM-dd

useEffect(() => {
  setOpenHistTypes({});
  setOpenHistRooms({});
}, [histStart, histEnd]);

const inDateRange = (iso?: string | null) => {
  if (!iso) return false; // une tâche "Fait" devrait avoir date_resolution, sinon on l’exclut
  if (histStart && iso < histStart) return false;
  if (histEnd && iso > histEnd) return false;
  return true;
};



const histByType = useMemo(() => {
  const map = new Map<string, MaintItem[]>();
  items
    .filter(i => i.statut === 'Fait')
    .filter(i => inDateRange(i.date_resolution || undefined))
    .forEach(it => {
      if (!map.has(it.type)) map.set(it.type, []);
      map.get(it.type)!.push(it);
    });
  return Array.from(map.entries());
}, [items, histStart, histEnd]);

const histByRoom = useMemo(() => {
  const map = new Map<string, MaintItem[]>();
  items
    .filter(i => i.statut === 'Fait')
    .filter(i => inDateRange(i.date_resolution || undefined))
    .forEach(it => {
      getRooms(it).forEach(r => {
        if (!map.has(r)) map.set(r, []);
        map.get(r)!.push(it);
      });
    });
  const order = new Map(ROOM_OPTIONS.map((r, i) => [r, i]));
  return Array.from(map.entries()).sort((a, b) => (order.get(a[0]) ?? 9999) - (order.get(b[0]) ?? 9999));
}, [items, histStart, histEnd]);



  // ===== Résolution hotel_id (QS -> localStorage -> table users) =====
  useEffect(() => {
    (async () => {
      const fromQS = search?.get('hotel_id');
      if (fromQS) { setHotelId(fromQS); return; }

      if (typeof window !== 'undefined') {
        const fromLS = window.localStorage.getItem('selectedHotelId');
        if (fromLS) { setHotelId(fromLS); return; }
      }

      const { data: authRes } = await supabase.auth.getUser();
      const idAuth = authRes?.user?.id;
      if (idAuth) {
        const { data: u } = await supabase
          .from('users')
          .select('hotel_id').eq('id_auth', idAuth).maybeSingle();
        if (u?.hotel_id) {
          setHotelId(u.hotel_id);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem('selectedHotelId', u.hotel_id);
          }
          return;
        }
      }
      alert("Aucun hôtel sélectionné. Ouvre l’accueil et choisis un hôtel, ou passe ?hotel_id=XXX dans l’URL.");
    })();
  }, [search]);

  // ===== Chargement liste =====
  useEffect(() => {
    (async () => {
      if (!hotelId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('maintenance')
        .select('*')
        .eq('hotel_id', hotelId)
        .order('date_creation', { ascending: false })
        .order('created_at', { ascending: false });
      if (!error) setItems((data as any) || []);
      setLoading(false);
    })();
  }, [hotelId]);

  // ===== CRUD =====
  const createItem = async () => {
  if (!hotelId) { alert('Sélectionne un hôtel.'); return; }
  if (!newItem.titre?.trim() || !newItem.type || !newItem.chambres?.length) return;

  const groupId = crypto.randomUUID();
  const today = dfFormat(new Date(), 'yyyy-MM-dd');

  const payloads = (newItem.chambres as string[]).map((room) => ({
    hotel_id: hotelId,
    group_id: groupId,
    titre: newItem.titre!.trim(),
    type: newItem.type!,
    chambre: room,
    chambres: [room],             // compat si la colonne existe encore
    statut: 'À faire' as const,
    commentaire: newItem.commentaire || null,
    date_creation: today,
  }));

  const { data, error } = await supabase
    .from('maintenance')
    .insert(payloads)
    .select();

  if (error) { alert(error.message); return; }

  setItems(prev => [...(data as any), ...prev]);
  setShowCreate(false);
  setNewItem({ titre: '', type: TYPE_OPTIONS[0], chambres: [], commentaire: '' });
};


  const openCloseModal = (it: MaintItem) => setShowClose(it);

  const closeItem = async (fields: { temps: number; budget: number; dateFr: string }) => {
    if (!showClose) return;
    const dateISO = toISO(fields.dateFr) || dfFormat(new Date(), 'yyyy-MM-dd');
    const payload = {
      statut: 'Fait' as const,
      temps_travail: Number(fields.temps) || null,
      budget: Number(fields.budget) || null,
      date_resolution: dateISO,
    };
    const { error } = await supabase.from('maintenance').update(payload).eq('id', showClose.id);
    if (error) { alert(error.message); return; }
    setItems(prev => prev.map(x => x.id === showClose.id ? { ...x, ...payload } : x));
    setSelected(s => s && s.id === showClose.id ? { ...s, ...payload } : s);
    setShowClose(null);
  };

  const reopenItem = async (id: string) => {
    const { error } = await supabase.from('maintenance')
      .update({ statut: 'À faire', date_resolution: null, temps_travail: null, budget: null })
      .eq('id', id);
    if (error) { alert(error.message); return; }
    setItems(prev => prev.map(x => x.id === id ? { ...x, statut: 'À faire', date_resolution: null, temps_travail: null, budget: null } : x));
    setSelected(s => s && s.id === id ? { ...s, statut: 'À faire', date_resolution: null, temps_travail: null, budget: null } : s);
  };

  const removeItem = async (id: string) => {
    if (!confirm('Supprimer cette maintenance ?')) return;
    const { error } = await supabase.from('maintenance').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    setItems(prev => prev.filter(x => x.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  // ===== Colonne gauche (recherche / liste) =====
  const leftList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter(it => {
        if (!needle) return true;
        const hay = `${it.titre} ${it.type} ${(it.chambres||[]).join(' ')}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => {
        // À faire d’abord, puis récent -> ancien
        if (a.statut !== b.statut) return a.statut === 'À faire' ? -1 : 1;
        return (new Date(b.date_creation).getTime()) - (new Date(a.date_creation).getTime());
      });
  }, [items, q]);

  // ===== Onglets 'Par type' / 'Par chambre' / 'Historique' =====
  const byType = useMemo(() => {
    const map = new Map<string, MaintItem[]>();
    items.forEach(it => {
      if (!map.has(it.type)) map.set(it.type, []);
      map.get(it.type)!.push(it);
    });
    return Array.from(map.entries()); // [type, items[]]
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

  const historyFiltered = useMemo(() => {
    return items
      .filter(it => it.statut === 'Fait')
      .filter(it => filterType === 'Tous' ? true : it.type === filterType)
      .filter(it => filterRoom === 'Toutes' ? true : getRooms(it).includes(filterRoom))
      .sort((a, b) => (b.date_resolution?.localeCompare(a.date_resolution || '') || 0));
  }, [items, filterType, filterRoom]);

  return (
    <div className="p-4">
      {/* Barre de titre */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Maintenance</h1>
        <Button onClick={() => setShowCreate(true)} disabled={!hotelId}>➕ Nouvelle maintenance</Button>
      </div>

<Card>
  <CardContent className="p-6">
    <Tabs defaultValue="type" className="w-full">
      <TabsList className="grid grid-cols-3 w-full">
        <TabsTrigger value="type">Par type</TabsTrigger>
        <TabsTrigger value="chambre">Par chambre</TabsTrigger>
        <TabsTrigger value="historique">Historique</TabsTrigger>
      </TabsList>



      {/* ===== Par type ===== */}
      <TabsContent value="type">
        <div className="space-y-3 mt-3">
          {byType.map(([type, arr]) => {
            const enCours = arr.filter(x => x.statut === 'À faire');
            const fait = arr.filter(x => x.statut === 'Fait');
            const temps = arr.reduce((s, x) => s + (x.temps_travail || 0), 0);
            const budget = arr.reduce((s, x) => s + (x.budget || 0), 0);
            const open = !!openTypes[type];

            return (
              <div key={type} className="border rounded-lg bg-white">
                {/* En-tête cliquable */}
                <button
  onClick={() => toggleType(type)}
  className={`w-full flex items-center justify-between p-3 rounded-t-lg ${open ? 'bg-gray-50' : 'bg-white'} hover:bg-gray-50`}
>
  <div className="flex items-center gap-3">
    <TypeBadge type={type} />
    <CountChip label={`${enCours.length} à faire`} />
  </div>
  <div className="text-gray-500">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
</button>


                {/* Contenu déployé : TÂCHES À FAIRE */}
                {open && (
                  <div className="border-t p-3 space-y-2">
                    {enCours.length === 0 && (
                      <div className="text-sm text-gray-500">Rien à faire dans ce type.</div>
                    )}
                    {enCours.map(it => (
                      <div key={it.id} className="flex items-center justify-between border rounded-md p-2">
                        <div className="text-sm">
                          <div className="font-medium">{it.titre}</div>
                          <div className="text-xs text-gray-600 flex items-center gap-2">
  <span>Créé le {toFr(it.date_creation)}</span>
  <span>•</span>
  <div className="flex items-center gap-1">
    {getRooms(it).map((r) => <RoomChip key={r} r={r} />)}
  </div>
</div>


                          {it.commentaire && (
                            <div className="text-xs text-gray-700 mt-1 whitespace-pre-line">{it.commentaire}</div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => openCloseModal(it)}>
                            Job Done !
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => removeItem(it.id)}>
                            🗑️
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </TabsContent>

      {/* ===== Par chambre ===== */}
      <TabsContent value="chambre">
        <div className="space-y-3 mt-3">
          {byRoom.map(([room, arr]) => {
            const enCours = arr.filter(x => x.statut === 'À faire');
            const fait = arr.filter(x => x.statut === 'Fait');
            const open = !!openRooms[room];

            return (
              <div key={room} className="border rounded-lg bg-white">
                <button
  onClick={() => toggleRoom(room)}
  className={`w-full flex items-center justify-between p-3 rounded-t-lg ${open ? 'bg-gray-50' : 'bg-white'} hover:bg-gray-50`}
>
  <div className="flex items-center gap-3">
    <span className="font-semibold"># {room}</span>
    <CountChip label={`${enCours.length} à faire`} />
  </div>
  <div className="text-gray-500">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
</button>


                {open && (
                  <div className="border-t p-3 space-y-2">
                    {enCours.length === 0 && (
                      <div className="text-sm text-gray-500">Rien à faire dans cette chambre.</div>
                    )}
                    {enCours.map(it => (
                      <div key={it.id} className="flex items-center justify-between border rounded-md p-2">
                        <div className="text-sm">
                          <div className="font-medium">{it.titre}</div>
                          <div className="text-xs text-gray-600 flex items-center gap-2">
  <TypeBadge type={it.type} />
  <span>•</span>
  <span>Créé le {toFr(it.date_creation)}</span>
</div>

                          {it.commentaire && (
                            <div className="text-xs text-gray-700 mt-1 whitespace-pre-line">{it.commentaire}</div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => openCloseModal(it)}>
                            Job Done
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => removeItem(it.id)}>
                            🗑️
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </TabsContent>

      {/* ===== Historique (inchangé, mais plus de “selected”) ===== */}
      
      <TabsContent value="historique">
  {/* ICI on ajoute la barre de filtres + on rend histByType / histByRoom */}
  <div className="flex flex-wrap items-center gap-2 mt-3">
    <label className="text-sm text-gray-600">Période :</label>
    <input
      type="date"
      value={histStart}
      onChange={(e) => setHistStart(e.target.value)}
      className="border rounded px-2 py-1 text-sm"
    />
    <span className="text-gray-500">→</span>
    <input
      type="date"
      value={histEnd}
      onChange={(e) => setHistEnd(e.target.value)}
      className="border rounded px-2 py-1 text-sm"
    />
    <Button variant="outline" className="ml-2" onClick={() => { setHistStart(''); setHistEnd(''); }}>
      Réinitialiser
    </Button>
  </div>

  

  <div className="mt-3">
    <Tabs defaultValue="h-type" className="w-full">
      <TabsList className="grid grid-cols-2 w-full">
        <TabsTrigger value="h-type">Par type</TabsTrigger>
        <TabsTrigger value="h-room">Par chambre</TabsTrigger>
      </TabsList>

      {/* Historique par type */}
      <TabsContent value="h-type">
        <div className="space-y-3 mt-3">
          {histByType.map(([type, arr]) => {
  const open = !!openHistTypes[type];
  const fait   = arr.length;
  const temps  = arr.reduce((s, x) => s + (x.temps_travail || 0), 0);
  const budget = arr.reduce((s, x) => s + (x.budget || 0), 0);

  return (
    <div key={type} className="border rounded-lg bg-white">
      {/* Bandeau cliquable */}
      <button
  onClick={() => toggleHistType(type)}
  className={`w-full flex items-center justify-between p-3 rounded-t-lg ${open ? 'bg-gray-50' : 'bg-white'} hover:bg-gray-50`}
  aria-expanded={open}
>

        <div className="flex items-center gap-3">
  <TypeBadge type={type} />
  <CountChip label={`${fait} fait`} />
  <CountChip label={`${temps} min`} />
  <CountChip label={`${budget.toFixed(2)} €`} />
</div>
<div className="text-gray-500">
  {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
</div>

      </button>

      {/* Détails dépliés uniquement si open */}
      {open && (
        <div className="border-t p-3 space-y-2">
          {arr.map(it => (
            <div key={it.id} className="flex items-center justify-between border rounded-md p-2">
              <div className="text-sm">
                <div className="font-medium">{it.titre}</div>
                <div className="text-xs text-gray-600">
                  Chambre: {getRooms(it).join(', ')} • Créé le {toFr(it.date_creation)} • Résolu le {toFr(it.date_resolution)}
                  {typeof it.temps_travail === 'number' && ` • ${it.temps_travail} min`}
                  {typeof it.budget === 'number' && ` • ${Number(it.budget).toFixed(2)} €`}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => reopenItem(it.id)}>Rouvrir</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
})}

          {histByType.length === 0 && <div className="text-sm text-gray-500">Aucun élément.</div>}
        </div>
      </TabsContent>

      {/* Historique par chambre */}
      <TabsContent value="h-room">
        <div className="space-y-3 mt-3">
          {histByRoom.map(([room, arr]) => {
  const open = !!openHistRooms[room];
  const fait   = arr.length;
  const temps  = arr.reduce((s, x) => s + (x.temps_travail || 0), 0);
  const budget = arr.reduce((s, x) => s + (x.budget || 0), 0);

  return (
    <div key={room} className="border rounded-lg bg-white">
      {/* Bandeau cliquable */}
      <button
  onClick={() => toggleHistRoom(room)}
  className={`w-full flex items-center justify-between p-3 rounded-t-lg ${open ? 'bg-gray-50' : 'bg-white'} hover:bg-gray-50`}
  aria-expanded={open}
>

        <div className="flex items-center gap-3">
  <span className="font-semibold"># {room}</span>
  <CountChip label={`${fait} fait`} />
  <CountChip label={`${temps} min`} />
  <CountChip label={`${budget.toFixed(2)} €`} />
</div>
<div className="text-gray-500">
  {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
</div>

      </button>

      {/* Détails dépliés uniquement si open */}
      {open && (
        <div className="border-t p-3 space-y-2">
          {arr.map(it => (
            <div key={it.id} className="flex items-center justify-between border rounded-md p-2">
              <div className="text-sm">
                <div className="font-medium">{it.titre}</div>
                <div className="text-xs text-gray-600">
                  {it.type} • Créé le {toFr(it.date_creation)} • Résolu le {toFr(it.date_resolution)}
                  {typeof it.temps_travail === 'number' && ` • ${it.temps_travail} min`}
                  {typeof it.budget === 'number' && ` • ${Number(it.budget).toFixed(2)} €`}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => reopenItem(it.id)}>Rouvrir</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
})}

          {histByRoom.length === 0 && <div className="text-sm text-gray-500">Aucun élément.</div>}
        </div>
      </TabsContent>
    </Tabs>
  </div>
</TabsContent>


    </Tabs>
  </CardContent>
</Card>


      {/* Modal création */}
      {showCreate && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-lg space-y-3">
            <h2 className="text-xl font-bold">Nouvelle maintenance</h2>

            <Input placeholder="Titre / description" value={newItem.titre || ''} onChange={(e) => setNewItem({ ...newItem, titre: e.target.value })} />

            <select className="w-full border rounded px-2 py-2" value={newItem.type || TYPE_OPTIONS[0]} onChange={(e) => setNewItem({ ...newItem, type: e.target.value })}>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <div>
              <div className="text-sm font-medium mb-1">Chambres / zones</div>
              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-auto p-2 border rounded">
                {ROOM_OPTIONS.map(r => {
                  const checked = (newItem.chambres || []).includes(r);
                  return (
                    <label key={r} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = new Set(newItem.chambres || []);
                          if (e.target.checked) cur.add(r); else cur.delete(r);
                          setNewItem({ ...newItem, chambres: Array.from(cur) });
                        }}
                      />
                      {r}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-xs text-gray-600 mb-1">Commentaire (optionnel)</label>
              <textarea rows={3} className="w-full border rounded px-2 py-1" value={newItem.commentaire || ''} onChange={(e) => setNewItem({ ...newItem, commentaire: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
              <Button onClick={createItem}>Créer</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal clôture */}
      {showClose && (
        <CloseModal
          item={showClose}
          onCancel={() => setShowClose(null)}
          onConfirm={closeItem}
        />
      )}
    </div>
  );
}

function CloseModal({ item, onCancel, onConfirm }:{
  item: MaintItem,
  onCancel: () => void,
  onConfirm: (p:{temps:number; budget:number; dateFr:string}) => void
}) {
  const [temps, setTemps] = useState<string>('');
  const [budget, setBudget] = useState<string>('');
  const [dateFr, setDateFr] = useState<string>(dfFormat(new Date(), 'dd/MM/yyyy', { locale: frLocale }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg w-full max-w-md space-y-3">
        <h2 className="text-lg font-semibold">Clôturer</h2>
        <div className="text-sm text-gray-600">
  {item.titre} • Chambre: {getRooms(item).join(', ')}
</div>


        <Input type="number" placeholder="Temps de travail (min)" value={temps} onChange={(e) => setTemps(e.target.value)} />
        <Input type="number" placeholder="Budget dépensé (€)" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <Input placeholder="Date de résolution (JJ/MM/AAAA)" value={dateFr} onChange={(e) => setDateFr(e.target.value)} />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Annuler</Button>
          <Button onClick={() => onConfirm({ temps: Number(temps||0), budget: Number(budget||0), dateFr })}>Valider</Button>
        </div>
      </div>
    </div>
  );
}
