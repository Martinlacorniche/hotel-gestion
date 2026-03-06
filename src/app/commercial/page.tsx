'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient'; 
import { useAuth } from '@/context/AuthContext';
import { format, isBefore, isToday, parseISO, getYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Search, PlusCircle, Phone, Mail, Clock, 
  Edit2, Trash2, Layout, XCircle, CalendarDays, ChevronDown, User, 
  MessageSquareText, CreditCard, Wallet, Check, Info,
  FileText // <--- Ajoute ça ici
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// --- TYPES ---
interface Hotel {
  id: string;
  nom: string;
}
interface Lead {
  id: string;
  created_at: string;
  nom_client: string;
  email?: string;
  telephone?: string;
  titre_demande: string;
  statut: 'Nouveau' | 'Devis envoyé' | 'Option' | 'Confirmé' | 'Refus';
  etat_paiement?: 'Attente acompte' | 'Acompte reçu' | 'RGT/P' | 'Soldé' | 'Facture envoyée' | 'Finalisé';
  budget_estime?: number;
  montant_paye?: number; 
  date_relance?: string | null;
  date_evenement?: string | null;
  commentaires?: string;
  motif_perte?: string;
  updated_at?: string;
  updated_by?: string;
  hotel_id?: string;
  besoin_gaetan?: 'Pas besoin' | 'À valider' | 'Validé' | 'Pas dispo';
}

const STATUS_COLORS: Record<string, string> = {
  'Nouveau': 'bg-blue-500',
  'Devis envoyé': 'bg-amber-400',
  'Option': 'bg-purple-500',
  'Confirmé': 'bg-emerald-500',
  'Refus': 'bg-red-500',
};

const PAYMENT_COLORS: Record<string, string> = {
  'Attente acompte': 'bg-red-500',
  'Acompte reçu': 'bg-amber-500',
  'RGT/P': 'bg-orange-400',
  'Soldé': 'bg-blue-400',
  'Facture envoyée': 'bg-purple-400',
  'Finalisé': 'bg-emerald-500',
};

export default function CommercialDashboard() {
  const { user } = useAuth();
const [hotels, setHotels] = useState<Hotel[]>([]);
const [selectedHotelId, setSelectedHotelId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'pipeline' | 'tarifs' | 'planning'>('pipeline');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [filterStatut, setFilterStatut] = useState<string>('Pipeline');
  const [clientSuggestions, setClientSuggestions] = useState<Lead[]>([]);
  const [planningData, setPlanningData] = useState<any[]>([]);
const [rooms, setRooms] = useState<any[]>([]);
const [viewDate, setViewDate] = useState(new Date());
  
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);     
  const [openPaymentId, setOpenPaymentId] = useState<string | null>(null); 
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [openFinanceId, setOpenFinanceId] = useState<string | null>(null); 

  const [tempFinance, setTempFinance] = useState({ budget: 0, paye: 0 });

  const [currentLead, setCurrentLead] = useState<Partial<Lead>>({
    statut: 'Nouveau',
    etat_paiement: 'Attente acompte',
    budget_estime: 0,
    montant_paye: 0,
    date_relance: '',
    date_evenement: ''
  });

  const [currentReservations, setCurrentReservations] = useState<any[]>([]);

// Fonction pour ouvrir la modale proprement avec ou sans données
const openLeadModal = async (lead?: Partial<Lead>, defaultDate?: string, defaultRoomName?: string) => {
    if (lead && lead.id) {
        setCurrentLead(lead);
        // On récupère les salles déjà bloquées pour ce dossier
        const { data } = await supabase.from('seminar_reservations').select('*').eq('lead_id', lead.id);
        if (data) setCurrentReservations(data);
    } else {
        setCurrentLead({ statut: 'Nouveau', etat_paiement: 'Attente acompte', budget_estime: 0, montant_paye: 0, date_relance: '', date_evenement: defaultDate || '' });
        
        // Si on clique depuis le planning, on pré-remplit la salle direct
        if (defaultRoomName) {
            const room = rooms.find(r => r.name === defaultRoomName);
            if (room) {
                setCurrentReservations([{ room_id: room.id, start_date: defaultDate, end_date: defaultDate, start_time: '09:00', end_time: '18:00' }]);
            } else {
                setCurrentReservations([]);
            }
        } else {
            setCurrentReservations([]);
        }
    }
    setShowModal(true);
};

const fetchPlanning = async () => {
  if (!selectedHotelId) return;
  
  // A. Récupérer les salles
  const { data: roomsList } = await supabase
    .from('seminar_rooms')
    .select('*')
    .eq('hotel_id', selectedHotelId)
    .order('name');
  if (roomsList) setRooms(roomsList);

  // B. Récupérer les réservations via la VIEW (7 jours à partir de viewDate)
  const start = format(viewDate, 'yyyy-MM-dd');
  const end = format(new Date(viewDate.getTime() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

  const { data: events } = await supabase
    .from('view_planning_seminaires')
    .select('*')
    .eq('hotel_id', selectedHotelId)
    .gte('start_date', start)
    .lte('start_date', end);
    
  if (events) setPlanningData(events);
};

const openCreateFromPlanning = (dateStr: string, roomName: string) => {
  setCurrentLead({
    statut: 'Nouveau',
    etat_paiement: 'Attente acompte',
    budget_estime: 0,
    montant_paye: 0,
    date_evenement: dateStr, 
    // Option A : On laisse vide pour ne pas polluer
    titre_demande: '', 
    // Option B : On met juste la salle en commentaire pour mémoire
    commentaires: `Salle souhaitée : ${roomName}`, 
  });
  setShowModal(true);
};

// Modifie ton useEffect existant (Ligne ~118) pour inclure fetchPlanning
useEffect(() => {
  if (selectedHotelId) {
    localStorage.setItem('selectedHotelId', selectedHotelId);
    fetchLeads();
    fetchPlanning(); // <--- Ajouté
  }
}, [selectedHotelId, viewDate]);
  const fetchLeads = async () => {
  if (!selectedHotelId) return; // Sécurité
  
  setLoading(true);
  const { data, error } = await supabase
    .from('suivi_commercial')
    .select('*')
    .eq('hotel_id', selectedHotelId); // <--- On utilise l'état local
    
  if (!error && data) setLeads(data);
  setLoading(false);
};

  // Charger la liste des hôtels et l'ID sauvegardé
useEffect(() => {
  const initHotels = async () => {
    const { data, error } = await supabase.from('hotels').select('id, nom').order('nom');
    if (!error && data) {
      setHotels(data);
      const saved = localStorage.getItem('selectedHotelId');
      // On prend soit le saved, soit le premier de la liste
      if (saved && data.find(h => h.id === saved)) {
        setSelectedHotelId(saved);
      } else if (data.length > 0) {
        setSelectedHotelId(data[0].id);
      }
    }
  };
  initHotels();
}, []);

// Recharger les données dès que l'ID de l'hôtel change
useEffect(() => {
  if (selectedHotelId) {
    localStorage.setItem('selectedHotelId', selectedHotelId);
    fetchLeads();
  }
}, [selectedHotelId]);

  const getUpdateTrace = () => ({
    updated_at: new Date().toISOString(),
    updated_by: (user as any)?.name || 'Staff'
  });

  const handleClientSearch = (input: string) => {
  setCurrentLead({ ...currentLead, nom_client: input });
  if (input.length > 2) {
    // On cherche dans les leads existants les noms qui matchent
    const matches = leads.filter(l => 
      l.nom_client.toLowerCase().includes(input.toLowerCase())
    );
    // On garde uniquement les clients uniques (si le même client a 10 dossiers)
    const uniqueMatches = matches.filter((v, i, a) => a.findIndex(t => t.nom_client === v.nom_client) === i);
    setClientSuggestions(uniqueMatches);
  } else {
    setClientSuggestions([]);
  }
};

  const handleQuickStatusChange = async (id: string, newStatut: string) => {
    setOpenMenuId(null);
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, statut: newStatut as any, ...trace } : l));
    await supabase.from('suivi_commercial').update({ statut: newStatut, ...trace }).eq('id', id);
    fetchLeads();
  };

  const handleUpdateMotif = async (id: string, motif: string) => {
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, motif_perte: motif, ...trace } : l));
    await supabase.from('suivi_commercial').update({ motif_perte: motif, ...trace }).eq('id', id);
};

const handleGaetanChange = async (id: string, value: string) => {
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, besoin_gaetan: value as any, ...trace } : l));
    await supabase.from('suivi_commercial').update({ besoin_gaetan: value, ...trace }).eq('id', id);
};

  const handleQuickPaymentChange = async (id: string, newPaiement: string) => {
    setOpenPaymentId(null);
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, etat_paiement: newPaiement as any, ...trace } : l));
    await supabase.from('suivi_commercial').update({ etat_paiement: newPaiement, ...trace }).eq('id', id);
    fetchLeads();
  };

  const saveQuickFinance = async (id: string) => {
    setOpenFinanceId(null);
    const trace = getUpdateTrace();
    const payload = {
        budget_estime: tempFinance.budget,
        montant_paye: tempFinance.paye,
        ...trace
    };
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...payload } : l));
    await supabase.from('suivi_commercial').update(payload).eq('id', id);
    fetchLeads();
  };

const handleSave = async () => {
    if (!currentLead.nom_client || !currentLead.titre_demande) return alert("Nom et Titre obligatoires");
    const trace = getUpdateTrace();
    
    const payload = {
        ...currentLead,
        hotel_id: selectedHotelId,
        date_relance: currentLead.date_relance === '' ? null : currentLead.date_relance,
        date_evenement: currentLead.date_evenement === '' ? null : currentLead.date_evenement,
        ...trace
    };

    let leadId = currentLead.id;

    // 1. Sauvegarde du dossier (Lead)
    if (leadId) {
        const { error } = await supabase.from('suivi_commercial').update(payload).eq('id', leadId);
        if (error) return alert(error.message);
    } else {
        const { data, error } = await supabase.from('suivi_commercial').insert([{ ...payload, created_at: new Date().toISOString() }]).select().single();
        if (error) return alert(error.message);
        leadId = data.id;
    }

    // 2. Sauvegarde des salles sur le planning
    if (leadId) {
        // On nettoie l'historique de ce dossier pour éviter les doublons
        await supabase.from('seminar_reservations').delete().eq('lead_id', leadId);
        
        if (currentReservations.length > 0) {
            const resasToInsert = currentReservations.map(r => ({
                lead_id: leadId,
                room_id: r.room_id,
                start_date: r.start_date || currentLead.date_evenement,
                end_date: r.start_date || currentLead.date_evenement,
                start_time: r.start_time || null,
                end_time: r.end_time || null,
                status: currentLead.statut === 'Confirmé' ? 'reserved' : 'option' // Sécurité couleur planning
            }));
            await supabase.from('seminar_reservations').insert(resasToInsert);
        }
    }

    setShowModal(false);
    fetchLeads();
    fetchPlanning(); // Rafraîchit le planning instantanément
};

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce dossier ?")) return;
    await supabase.from('suivi_commercial').delete().eq('id', id);
    setLeads(prev => prev.filter(l => l.id !== id));
  };

  const getRelanceStatus = (dateStr?: string | null, statut?: string) => {
    if (['Gagné', 'Perdu'].includes(statut || '')) return 'done';
    if (!dateStr) return 'none';
    const date = parseISO(dateStr);
    if (isBefore(date, new Date()) && !isToday(date)) return 'late';
    if (isToday(date)) return 'today';
    return 'future';
  };

  const sortedLeads = useMemo(() => {
  let filtered = leads.filter(l => {
    const matchSearch = (
      l.nom_client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.titre_demande.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.email && l.email.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    
    let matchFilter = false;
    
    // Définir si l'événement est passé par rapport à aujourd'hui
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const eventDate = l.date_evenement ? new Date(l.date_evenement).getTime() : Infinity;
    const isPast = eventDate < now.getTime();

    if (filterStatut === 'Tous') {
      matchFilter = true;
    } else if (filterStatut === 'Pipeline') {
      matchFilter = ['Nouveau', 'Devis envoyé', 'Option'].includes(l.statut);
    } else if (filterStatut === 'Confirmé') {
      matchFilter = l.statut === 'Confirmé' && !isPast; 
    } else if (filterStatut === 'Terminées') {
      matchFilter = isPast; 
    } else if (filterStatut === 'Refus') {
      matchFilter = l.statut === 'Refus';
    } else if (filterStatut === 'Débiteurs') {
      const budget = l.budget_estime || 0;
      const paye = l.montant_paye || 0;
      matchFilter = isPast && l.statut !== 'Refus' && (budget - paye > 0);
    }

    return matchSearch && matchFilter;
  });

  return filtered.sort((a, b) => {
    const statusA = getRelanceStatus(a.date_relance, a.statut);
    const statusB = getRelanceStatus(b.date_relance, b.statut);
    const isUrgentA = statusA === 'late' || statusA === 'today';
    const isUrgentB = statusB === 'late' || statusB === 'today';

    // 1. Les urgences en haut
    if (isUrgentA && !isUrgentB) return -1;
    if (!isUrgentA && isUrgentB) return 1;

    // 2. Séparation Passé / Futur
    const now = new Date();
    // On met à minuit pour ne pas fausser le tri sur la journée en cours
    now.setHours(0, 0, 0, 0); 
    
    const timeA = a.date_evenement ? new Date(a.date_evenement).getTime() : Infinity;
    const timeB = b.date_evenement ? new Date(b.date_evenement).getTime() : Infinity;
    
    const isPastA = timeA < now.getTime();
    const isPastB = timeB < now.getTime();

    // Les événements passés vont en bas
    if (isPastA && !isPastB) return 1;
    if (!isPastA && isPastB) return -1;

    // 3. Tri chronologique classique pour le reste
    if (timeA !== timeB) {
        // Ordre croissant pour le futur, décroissant pour le passé (les plus récents d'abord)
        return isPastA ? timeB - timeA : timeA - timeB; 
    }

    // 4. En cas d'égalité de date d'événement, tri par date de mise à jour
    const dateA = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
    const dateB = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
    return dateB - dateA;
  });
}, [leads, searchTerm, filterStatut]);

  const stats = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const pipeline = leads.filter(l => !['Confirmé', 'Refus'].includes(l.statut)).reduce((acc, curr) => acc + (curr.budget_estime || 0), 0);
    const won = leads.filter(l => l.statut === 'Confirmé' && getYear(parseISO(l.created_at)) === currentYear).reduce((acc, curr) => acc + (curr.budget_estime || 0), 0);
    const lost = leads.filter(l => l.statut === 'Refus' && getYear(parseISO(l.created_at)) === currentYear).reduce((acc, curr) => acc + (curr.budget_estime || 0), 0);
    const lateCount = leads.filter(l => getRelanceStatus(l.date_relance, l.statut) === 'late').length;
    const todayCount = leads.filter(l => getRelanceStatus(l.date_relance, l.statut) === 'today').length;
    return { pipeline, won, lost, lateCount, todayCount };
  }, [leads]);

  const handleGlobalClick = () => {
    setOpenMenuId(null);
    setOpenPaymentId(null);
    setOpenCommentId(null);
    setOpenFinanceId(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900" onClick={handleGlobalClick}>
      <select 
    value={selectedHotelId}
    onChange={(e) => setSelectedHotelId(e.target.value)}
    className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-bold text-slate-700 shadow-sm outline-none"
  >
    {hotels.map(h => (
      <option key={h.id} value={h.id}>{h.nom}</option>
    ))}
  </select>

      
      {/* TABS SELECTION */}
      
<div className="flex items-center gap-8 mb-8 overflow-x-auto pb-2">
  {['pipeline', 'planning', 'tarifs'].map((tab) => (
    <button 
      key={tab}
      onClick={() => setActiveTab(tab as any)}
      className={`text-2xl font-bold transition-colors whitespace-nowrap ${activeTab === tab ? 'text-slate-800' : 'text-slate-300 hover:text-slate-400'}`}
    >
      {tab === 'pipeline' ? 'Suivi Commercial' : tab === 'planning' ? 'Planning Salles' : 'Offres & Tarifs'}
    </button>
  ))}
</div>


{/* 1. SECTION PLANNING */}
{activeTab === 'planning' && (
  <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-300 mb-10">
    {/* HEADER DU PLANNING */}
    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
            <h2 className="text-xl font-black text-slate-800 uppercase italic">Disponibilités Salles</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Vue 7 jours — {format(viewDate, 'MMMM yyyy', { locale: fr })}
            </p>
        </div>
        <div className="flex items-center gap-3">
    {/* Sélecteur de date rapide (Calendrier) */}
    <div className="relative">
      <input 
        type="date" 
        value={format(viewDate, 'yyyy-MM-dd')}
        onChange={(e) => setViewDate(new Date(e.target.value))}
        className="bg-white border border-slate-200 text-slate-700 text-[11px] font-black uppercase rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm cursor-pointer"
      />
    </div>

    {/* Navigation par flèches et raccourci */}
    <div className="flex gap-1 bg-slate-200/50 p-1 rounded-xl border border-slate-100">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setViewDate(new Date(viewDate.getTime() - 7 * 24 * 60 * 60 * 1000))} 
          className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
        >
          <ChevronDown className="w-4 h-4 rotate-90" />
        </Button>
        
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setViewDate(new Date())} 
          className="h-8 text-[10px] font-black uppercase px-3 hover:bg-white hover:shadow-sm"
        >
          Aujourd'hui
        </Button>
        
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setViewDate(new Date(viewDate.getTime() + 7 * 24 * 60 * 60 * 1000))} 
          className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
        >
          <ChevronDown className="w-4 h-4 -rotate-90" />
        </Button>
    </div>
</div>
    </div>

    {/* GRILLE DU PLANNING */}
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-white">
            <th className="p-4 border-b border-r border-slate-100 min-w-[180px] bg-white sticky left-0 z-10 text-left text-[10px] font-black uppercase text-slate-400">Salles</th>
            {[...Array(7)].map((_, i) => {
              const d = new Date(viewDate.getTime() + i * 24 * 60 * 60 * 1000);
              return (
                <th key={i} className={`p-4 border-b border-slate-100 text-center min-w-[140px] ${isToday(d) ? 'bg-indigo-50/50' : ''}`}>
                  <div className="text-[10px] font-black text-slate-400 uppercase">{format(d, 'EEEE', { locale: fr })}</div>
                  <div className={`text-lg font-black ${isToday(d) ? 'text-indigo-600' : 'text-slate-700'}`}>{format(d, 'dd')}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rooms.map(room => (
            <tr key={room.id} className="group hover:bg-slate-50/30">
              <td className="p-4 border-r border-b border-slate-100 font-black text-xs text-slate-600 sticky left-0 bg-white z-10 group-hover:bg-slate-50 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: room.color || '#cbd5e1' }}></span>
                    <span className="truncate">{room.name}</span>
                </div>
                <div className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{room.capacity} pers. — {room.surface}m²</div>
              </td>
              {[...Array(7)].map((_, i) => {
                const d = format(new Date(viewDate.getTime() + i * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
                const resas = planningData.filter(r => r.room_name === room.name && r.start_date === d);
                
                return (
                  <td key={i} className={`p-2 border-b border-slate-50 min-h-[100px] align-top transition-colors ${resas.length > 1 ? 'bg-red-50/30' : ''}`}>
                    <div className="space-y-1.5">
                      {resas.map(res => (
                        <div 
  key={res.reservation_id} 
  className={`p-2 rounded-xl text-[10px] font-bold border leading-tight shadow-sm transition-all hover:scale-[1.02] cursor-pointer
    ${res.display_status === 'Gagné' 
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700' // Vert pour Validé
      : 'bg-indigo-50 border-indigo-200 text-indigo-700'}   // Bleu pour Option
  `}
  onClick={() => window.open(`/devis?leadId=${res.reservation_id}`, '_blank')}

>
 <div className="flex justify-between items-start mb-0.5">
    <span className="truncate uppercase max-w-[80%]">{res.nom_client}</span>
    <div className={`w-1.5 h-1.5 rounded-full ${res.display_status === 'Gagné' ? 'bg-emerald-500' : 'bg-indigo-400'}`} />
</div>
<div className="opacity-70 truncate font-medium italic mb-1">{res.titre_demande || 'Sans titre'}</div>

{/* Affichage des horaires si on les a */}
{(res.start_time || res.end_time) && (
    <div className="text-[9px] font-black bg-white/50 inline-block px-1.5 py-0.5 rounded text-indigo-800">
        {res.start_time?.substring(0,5) || '??'} - {res.end_time?.substring(0,5) || '??'}
    </div>
)}
</div>
                      ))}
                      {resas.length === 0 && (
  <button 
    onClick={(e) => { 
      e.stopPropagation(); 
      openLeadModal(undefined, d, room.name);
    }}
    className="h-12 w-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-50 rounded-xl"
  >
    <PlusCircle className="w-5 h-5 text-indigo-400" />
  </button>
)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}

{/* 2. SECTION PIPELINE */}
{activeTab === 'pipeline' && (
  <>
    {/* HEADER KPIS */}
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
      {/* ... (Tes KPIs restent inchangés) ... */}
      <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
        <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">En retard</span>
        <span className="text-xl font-bold text-slate-800">{stats.lateCount}</span>
      </div>
      <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
        <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wider">À relancer</span>
        <span className="text-xl font-bold text-slate-800">{stats.todayCount}</span>
      </div>
      <div className="bg-white p-3 rounded-xl shadow-sm border border-blue-100 relative overflow-hidden flex flex-col items-center justify-center">
        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
        <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Pipeline</span>
        <span className="text-lg font-bold text-slate-800">{stats.pipeline.toLocaleString()} €</span>
      </div>
      <div className="bg-white p-3 rounded-xl shadow-sm border border-emerald-100 relative overflow-hidden flex flex-col items-center justify-center">
        <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Gagné (An)</span>
        <span className="text-lg font-bold text-emerald-700">+{stats.won.toLocaleString()} €</span>
      </div>
      <div className="bg-white p-3 rounded-xl shadow-sm border border-red-50 relative overflow-hidden flex flex-col items-center justify-center">
        <div className="absolute top-0 left-0 w-1 h-full bg-red-400"></div>
        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Perdu (An)</span>
        <span className="text-lg font-bold text-red-400">-{stats.lost.toLocaleString()} €</span>
      </div>
    </div>

    {/* FILTRES & RECHERCHE */}
    <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
  <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
      {['Pipeline', 'Confirmé', 'Terminées', 'Débiteurs', 'Refus', 'Tous'].map(st => (
          <button 
              key={st}
              onClick={(e) => { e.stopPropagation(); setFilterStatut(st); }}
              className={`px-5 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                  filterStatut === st 
                  ? (st === 'Débiteurs' ? 'bg-red-500 text-white shadow-md' : 'bg-slate-800 text-white shadow-md') 
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
          >
              {st}
          </button>
      ))}
  </div>
      <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input placeholder="Rechercher..." className="pl-9 bg-white rounded-full shadow-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <Button 
    onClick={(e) => { e.stopPropagation(); openLeadModal(); }} 
    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full px-6"
>
    <PlusCircle className="mr-2 h-4 w-4" /> Nouveau
</Button>
      </div>
    </div>

    {/* LISTE PIPELINE */}
    <div className="space-y-3 pb-20">
      {loading ? (
        <div className="text-center py-10 text-slate-400">Chargement...</div>
      ) : (
        sortedLeads.map((lead) => {
          const relanceStatus = getRelanceStatus(lead.date_relance, lead.statut);
          const isMenuOpen = openMenuId === lead.id;
          const isPaymentOpen = openPaymentId === lead.id;
          const isCommentOpen = openCommentId === lead.id;
          const hasComment = lead.commentaires && lead.commentaires.trim().length > 0;
          const budget = lead.budget_estime || 0;
          const paye = lead.montant_paye || 0;
          const reste = Math.max(0, budget - paye);

          return (
            <div 
              key={lead.id} 
              className={`group bg-white border rounded-xl p-4 transition-all hover:shadow-md relative
                ${relanceStatus === 'late' ? 'border-l-4 border-l-red-500' : 
                  relanceStatus === 'today' ? 'border-l-4 border-l-orange-400' : 
                  'border-l-4 border-l-slate-200'}
              `}
            >
              {/* ... Reste du contenu de ta ligne Lead inchangé ... */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                {/* 1. NOM & TITRE */}
                <div className="md:col-span-3 flex flex-col min-w-0">
                  <span className="font-black text-slate-800 text-base truncate leading-tight">{lead.nom_client}</span>
                  <span className="text-sm font-medium text-slate-500 truncate">{lead.titre_demande}</span>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                    <User className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">
                      {format(parseISO(lead.updated_at ?? lead.created_at), 'dd/MM', { locale: fr })} — {lead.updated_by ?? '—'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase whitespace-nowrap">Gaétan</span>
                    <select
                      value={lead.besoin_gaetan ?? 'Pas besoin'}
                      onChange={(e) => handleGaetanChange(lead.id, e.target.value)}
                      className="h-7 flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-semibold uppercase text-slate-600 hover:border-indigo-300 focus:outline-none"
                    >
                      <option value="Pas besoin">Pas besoin</option>
                      <option value="À valider">À valider</option>
                      <option value="Validé">Validé</option>
                      <option value="Pas dispo">Pas dispo</option>
                    </select>
                  </div>
                </div>
                {/* 2. DATE */}
                <div className="md:col-span-1 flex flex-col items-center justify-center border-l border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Date</span>
                    <span className="text-xs font-black text-indigo-600 whitespace-nowrap">
                        {lead.date_evenement ? format(parseISO(lead.date_evenement), 'dd MMM yy', { locale: fr }) : '--'}
                    </span>
                </div>
                {/* 3. FINANCE */}
                <div className="md:col-span-2 px-1">
                    <div className="bg-slate-50/80 p-2 rounded-xl border border-slate-200 flex flex-col gap-1 shadow-sm">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Budget</span>
                            <span className="font-bold text-slate-700 text-xs">{budget.toLocaleString()} €</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Réglé</span>
                            <span className="font-bold text-emerald-600 text-xs">{paye.toLocaleString()} €</span>
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-slate-300 mt-0.5">
                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-tighter">Solde</span>
                            <span className={`font-black text-sm ${reste > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                {reste.toLocaleString()} €
                            </span>
                        </div>
                    </div>
                </div>
                {/* 4. STATUT */}
                <div className="md:col-span-2 relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : lead.id); }} 
                        className="flex items-center gap-2 px-3 py-2.5 rounded-full border border-slate-200 bg-white hover:border-indigo-300 w-full justify-between shadow-sm min-w-0"
                    >
                        <div className="flex items-center gap-2 overflow-hidden">
                            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${STATUS_COLORS[lead.statut]}`} />
                            <span className="text-[10px] font-black text-slate-700 uppercase truncate">{lead.statut}</span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    </button>
                    {isMenuOpen && (
                        <div className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
                            {Object.keys(STATUS_COLORS).map((st) => (
                                <button key={st} onClick={(e) => { e.stopPropagation(); handleQuickStatusChange(lead.id, st); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[st]}`} /> {st}
                                    {lead.statut === st && <Check className="w-3 h-3 ml-auto text-indigo-600" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {/* 5. PAIEMENT */}
                <div className="md:col-span-2 relative min-w-0">
                    {lead.statut === 'Confirmé' && (
                        <>
                            <button 
                                onClick={(e) => { e.stopPropagation(); setOpenPaymentId(isPaymentOpen ? null : lead.id); }} 
                                className="flex items-center gap-1.5 px-3 py-2.5 rounded-full border border-slate-100 bg-slate-50 w-full hover:border-indigo-200 shadow-sm transition-all overflow-hidden"
                            >
                                <CreditCard className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                <span className="flex-1 text-[9px] font-black text-slate-600 truncate uppercase text-center" title={lead.etat_paiement || 'À demander'}>
                                    {lead.etat_paiement || 'À demander'}
                                </span>
                                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${PAYMENT_COLORS[lead.etat_paiement || 'À demander']}`} />
                            </button>
                            {isPaymentOpen && (
                                <div className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
                                    {Object.keys(PAYMENT_COLORS).map((p) => (
                                        <button key={p} onClick={(e) => { e.stopPropagation(); handleQuickPaymentChange(lead.id, p); }} className="flex items-center gap-2 w-full px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                            <div className={`w-2 h-2 rounded-full ${PAYMENT_COLORS[p]}`} /> {p}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
                {/* 6. ACTIONS */}
                <div className="md:col-span-2 flex items-center justify-end gap-1.5 pr-2">
                    <button 
                        onClick={(e) => { e.stopPropagation(); window.open(`/devis?leadId=${lead.id}`, '_blank'); }} 
                        className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                        title="Générer / Voir le devis"
                    >
                        <FileText className="w-4 h-4" />
                    </button>

                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setOpenCommentId(isCommentOpen ? null : lead.id); }} 
                            className={`p-2 rounded-lg transition-all ${hasComment ? 'text-indigo-600 bg-indigo-50 border border-indigo-200 shadow-sm' : 'text-slate-300 hover:bg-slate-100'}`}
                        >
                            <MessageSquareText className="w-4 h-4" />
                        </button>
                        
                        {isCommentOpen && (
                            <div className="absolute bottom-full right-0 mb-3 w-72 p-4 bg-white border-2 border-slate-200 rounded-2xl shadow-2xl z-[70] text-sm text-slate-700 animate-in fade-in slide-in-from-bottom-2">
                                <div className="font-black text-indigo-600 uppercase text-[10px] mb-2 border-b pb-1 flex justify-between">
                                    <span>Notes Internes</span>
                                </div>
                                <div className="whitespace-pre-wrap max-h-48 overflow-y-auto">
                                    {hasComment ? lead.commentaires : "Aucune note."}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex gap-1 border-l pl-1.5 ml-0.5 border-slate-200">
                        <button 
    onClick={(e) => { e.stopPropagation(); openLeadModal(lead); }} 
    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors"
    title="Modifier le dossier"
>
    <Edit2 className="w-3.5 h-3.5" />
</button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }} 
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded transition-colors"
                            title="Supprimer"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  </>
)}

{/* 3. SECTION TARIFS (L'onglet par défaut ou 'tarifs') */}
{activeTab === 'tarifs' && (
  <div className="space-y-8 animate-in fade-in duration-500">
    <section>
      <h2 className="text-lg font-bold text-indigo-600 mb-4 flex items-center gap-2">
        <CalendarDays className="w-5 h-5" /> Location Salles TTC (Café d'accueil offert)
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { n: 'Telo Segreto', d: '57m² - 30/40 pers.', p: '239€ (Demi-Journée) / 359€ (journée)' },
          { n: 'Telo Maritimo', d: '50m² - 30 pers.', p: '299€, disponible a partir de 11h)' },
          { n: 'Telo Intimo', d: '18m² - 5 pers.', p: '96€ (Réunion Intime)' },
          { n: 'Patio Tropical', d: '100m² - 60 pers.', p: 'Événementiel' },
        ].map(s => (
          <div key={s.n} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative group">
            <div className="font-bold text-slate-800">{s.n}</div>
            <div className="text-[10px] text-slate-500">{s.d}</div>
            <div className="mt-2 text-sm font-bold text-indigo-600">{s.p}</div>
          </div>
        ))}
      </div>
    </section>

    {/* SECTION RESTAURATION (Celle que tu voulais pas perdre) */}
    <section>
      <h2 className="text-lg font-bold text-emerald-600 mb-4 flex items-center gap-2">
        <MessageSquareText className="w-5 h-5" /> Restauration TTC (With Gaétan)
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* MENUS ASSIS */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest px-1">Menus à table</h3>
          {[
            { n: 'Menu Starter', c: 'Menu 2 temps (sans alcool)', p: '29 €' },
            { n: 'Menu Confort', c: 'Menu 3 temps (sans alcool)', p: '41 €' },
            { n: 'Menu Privilège', c: 'Menu 3 temps cocktail signature', p: '50 €' },
            { n: 'Menu Privilège++', c: 'Menu 3 temps Cocktail signature Mises en bouche', p: '55 €' },
          ].map(m => (
            <div key={m.n} className="bg-white p-3 rounded-lg border-l-4 border-l-emerald-500 shadow-sm flex justify-between items-center">
              <div className="overflow-hidden mr-2">
                <div className="text-sm font-bold truncate">{m.n}</div>
                <div className="text-[10px] text-slate-500 truncate">{m.c}</div>
              </div>
              <div className="font-bold text-emerald-700 whitespace-nowrap">{m.p}</div>
            </div>
          ))}
        </div>

        {/* COCKTAILS */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest px-1">Cocktails Dinatoires</h3>
          {[
            { n: 'Cocktail starter', c: '5 pièces salés (Chaud/froid) eaux/café', p: '29 €' },
            { n: 'Cocktail starter ++', c: '5 pièces salés + cocktail sans alcool', p: '35 €' },
            { n: 'Cocktail confort', c: '5 pièces salés (Chaud/froid) + 3 pièces sucrées', p: '44 €' },
            { n: 'Cocktail privilège', c: '5 pièces salés + 3 pièces sucrées + Animation culinaire', p: '50 €' },
            { n: 'Cocktail prestige', c: '5 pièces salés + 13 pièces sucrées + Animation + Cocktail apéritif', p: '60 €' },
          ].map(m => (
            <div key={m.n} className="bg-white p-3 rounded-lg border-l-4 border-l-blue-500 shadow-sm flex justify-between items-center">
              <div className="overflow-hidden mr-2">
                <div className="text-sm font-bold truncate">{m.n}</div>
                <div className="text-[10px] text-slate-500 truncate">{m.c}</div>
              </div>
              <div className="font-bold text-blue-700 whitespace-nowrap">{m.p}</div>
            </div>
          ))}
        </div>

        {/* SELF CORNICHE */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest px-1">Self service</h3>
          {[
            { n: 'Self Corniche starter', c: '5 pièces salées froide. Eaux/softs', p: '25 €' },
            { n: 'Self Corniche Intermédiaire', c: '5 pièces salées froides 2 pièces sucrées', p: '30 €' },
            { n: 'Self Corniche ++', c: '5 pièces salées froides 2 pièces sucrées + Cocktail apéritif', p: '35 €' },
          ].map(m => (
            <div key={m.n} className="bg-white p-3 rounded-lg border-l-4 border-l-amber-500 shadow-sm flex justify-between items-center">
              <div className="overflow-hidden mr-2">
                <div className="text-sm font-bold truncate">{m.n}</div>
                <div className="text-[10px] text-slate-500 truncate">{m.c}</div>
              </div>
              <div className="font-bold text-amber-700 whitespace-nowrap">{m.p}</div>
            </div>
          ))}
        </div>

      </div>
    </section>

    {/* DISPOSITIONS & CAPACITÉS */}
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
        <Layout className="w-5 h-5 text-indigo-500" /> Dispositions & Capacités
      </h2>
      <div className="overflow-hidden rounded-xl border border-slate-100">
        <img src="/disposition.png" alt="Capacités" className="w-full h-auto object-cover" />
      </div>
    </section>

  </div>
)}

      {/* MODAL COMPLET (Version Scrollable & Ergonomique) */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4 sm:p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            
            {/* 1. HEADER (Toujours visible) */}
            <div className="flex justify-between items-center p-5 border-b border-slate-100 shrink-0">
               <h2 className="text-xl font-black text-slate-800">Détails du Dossier</h2>
               <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <XCircle className="w-5 h-5 text-slate-400 hover:text-slate-600"/>
               </button>
            </div>

            {/* 2. BODY (Zone scrollable) */}
            <div className="overflow-y-auto p-5 space-y-8">
                
                {/* SECTION 1 : CLIENT & CONTACTS */}
                <div className="space-y-4">
                   <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider border-b border-indigo-100 pb-2">1. Client & Contacts</h3>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {/* Recherche Client (prend toute la largeur) */}
                       <div className="relative md:col-span-2">
                           <Input 
                               placeholder="Client / Société" 
                               value={currentLead.nom_client || ''} 
                               onChange={e => handleClientSearch(e.target.value)} 
                               className="font-bold bg-slate-50 border-slate-200 h-10" 
                           />
                           {clientSuggestions.length > 0 && (
                               <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-lg shadow-xl z-[60] mt-1 py-1 max-h-48 overflow-y-auto">
                                   {clientSuggestions.map(s => (
                                       <button 
                                           key={s.id}
                                           className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 flex flex-col"
                                           onClick={() => {
                                               setCurrentLead({ ...currentLead, nom_client: s.nom_client, email: s.email, telephone: s.telephone });
                                               setClientSuggestions([]);
                                           }}
                                       >
                                           <span className="font-bold text-slate-800">{s.nom_client}</span>
                                           <span className="text-[10px] text-slate-500">{s.email || 'Pas d\'email'}</span>
                                       </button>
                                   ))}
                               </div>
                           )}
                       </div>
                       <Input placeholder="Email" value={currentLead.email || ''} onChange={e => setCurrentLead({...currentLead, email: e.target.value})} className="h-10" />
                       <Input placeholder="Téléphone" value={currentLead.telephone || ''} onChange={e => setCurrentLead({...currentLead, telephone: e.target.value})} className="h-10" />
                   </div>
                </div>

                {/* SECTION 2 : ÉVÉNEMENT & DATES */}
                <div className="space-y-4">
                   <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider border-b border-indigo-100 pb-2">2. L'événement</h3>
                   <div className="space-y-3">
                       <Input 
                           placeholder="Titre événement (Saisie libre ou tags)" 
                           value={currentLead.titre_demande || ''} 
                           onChange={e => setCurrentLead({...currentLead, titre_demande: e.target.value})} 
                           className="h-10 font-medium"
                       />
                       <div className="flex flex-wrap gap-2">
                           {['Séminaire', 'Séminaire résidentiel', 'Hébergement', 'Restauration', 'Journée d\'étude', 'Soirée Cocktail'].map(tag => (
                               <button
                                   key={tag}
                                   type="button"
                                   onClick={(e) => {
                                       e.preventDefault();
                                       const current = currentLead.titre_demande || '';
                                       if (current.includes(tag)) return;
                                       setCurrentLead({ ...currentLead, titre_demande: current ? `${current} + ${tag}` : tag });
                                   }}
                                   className="px-2.5 py-1.5 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200 rounded-md text-[10px] font-bold uppercase transition-colors"
                               >
                                   + {tag}
                               </button>
                           ))}
                       </div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-4 pt-2">
                       <div>
                           <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Date Événement</label>
                           <Input type="date" value={currentLead.date_evenement || ''} onChange={e => setCurrentLead({...currentLead, date_evenement: e.target.value})} className="h-10" />
                       </div>
                       <div>
                           <label className="text-[10px] font-bold text-orange-500 uppercase flex items-center gap-1.5 mb-1.5">
                               <Clock className="w-3.5 h-3.5" /> Prochaine Relance
                           </label>
                           <Input type="date" value={currentLead.date_relance || ''} onChange={e => setCurrentLead({...currentLead, date_relance: e.target.value})} className="border-orange-200 focus:ring-orange-500 h-10" />
                       </div>
                   </div>
                </div>

                {/* SECTION 3 : SALLES ET HORAIRES (Design original conservé) */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-2">
                            <Layout className="w-4 h-4 text-indigo-500" /> Planning Salles
                        </label>
                        <Button 
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setCurrentReservations([...currentReservations, { room_id: rooms[0]?.id, start_date: currentLead.date_evenement || '', start_time: '09:00', end_time: '18:00' }])}
                            className="h-7 text-xs font-bold text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                        >
                            + Ajouter une salle
                        </Button>
                    </div>
                    {currentReservations.length === 0 && (
                        <div className="text-center text-xs text-slate-400 py-2 italic">Aucune salle sélectionnée</div>
                    )}
                    {currentReservations.map((resa, index) => (
                        <div key={index} className="flex gap-2 items-center bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                            <select 
                                value={resa.room_id} 
                                onChange={(e) => { const newR = [...currentReservations]; newR[index].room_id = e.target.value; setCurrentReservations(newR); }}
                                className="flex-1 border-none text-xs font-bold focus:ring-0 p-1 outline-none cursor-pointer"
                            >
                                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                            <Input 
                               type="date" 
                               value={resa.start_date} 
                               onChange={(e) => { const newR = [...currentReservations]; newR[index].start_date = e.target.value; setCurrentReservations(newR); }} 
                               className="w-32 h-8 text-[11px] font-bold" 
                           />
                            <Input 
                               type="time" 
                               value={resa.start_time} 
                               onChange={(e) => { const newR = [...currentReservations]; newR[index].start_time = e.target.value; setCurrentReservations(newR); }} 
                               className="w-24 h-8 text-[11px] font-bold" 
                           />
                            <span className="text-slate-300 font-bold">-</span>
                            <Input 
                               type="time" 
                               value={resa.end_time} 
                               onChange={(e) => { const newR = [...currentReservations]; newR[index].end_time = e.target.value; setCurrentReservations(newR); }} 
                               className="w-24 h-8 text-[11px] font-bold" 
                           />
                            <button type="button" onClick={() => setCurrentReservations(currentReservations.filter((_, i) => i !== index))} className="text-red-400 hover:text-red-600 p-2 transition-colors rounded-md hover:bg-red-50"><Trash2 className="w-4 h-4"/></button>
                        </div>
                    ))}
                </div>

                {/* SECTION 4 : COMMERCIAL & FINANCE */}
                <div className="space-y-4">
                   <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider border-b border-indigo-100 pb-2">3. Commercial & Finance</h3>
                   
                   <div className="grid grid-cols-2 gap-4">
                       <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Statut Commercial</label>
                            <select 
                               className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white font-bold text-slate-700 h-10 outline-none"
                               value={currentLead.statut || 'Nouveau'}
                               onChange={e => setCurrentLead({...currentLead, statut: e.target.value as any})}
                           >
                               <option>Nouveau</option>
                               <option>Devis envoyé</option>
                               <option>Option</option>
                               <option>Confirmé</option>
                               <option>Refus</option>
                           </select>
                       </div>
                       <div>
                           <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Budget Estime (€)</label>
                           <Input type="number" value={currentLead.budget_estime || ''} onChange={e => setCurrentLead({...currentLead, budget_estime: parseFloat(e.target.value)})} className="h-10 font-bold text-indigo-600" />
                       </div>
                   </div>

                   <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                        <div className="flex justify-between items-center">
                            <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-2">
                                <Wallet className="w-4 h-4 text-emerald-500" /> Suivi Paiement
                            </label>
                            {(currentLead.budget_estime || 0) > 0 && (
                               <div className={`px-3 py-1 rounded-full text-xs font-black shadow-sm ${(currentLead.budget_estime || 0) - (currentLead.montant_paye || 0) <= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                   Reste à régler : {Math.max(0, (currentLead.budget_estime || 0) - (currentLead.montant_paye || 0)).toLocaleString()} €
                               </div>
                            )}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                           <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">État Facture</label>
                                <select 
                                   className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white font-medium h-10 outline-none"
                                   value={currentLead.etat_paiement || 'Attente acompte'}
                                   onChange={e => setCurrentLead({...currentLead, etat_paiement: e.target.value as any})}
                                >
                                   <option>Attente acompte</option>
                                   <option>Acompte reçu</option>
                                   <option>RGT/P</option>
                                   <option>Soldé</option>
                                   <option>Facture envoyée</option>
                                   <option>Finalisé</option>
                               </select>
                           </div>
                           <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Déjà réglé (Acompte)</label>
                                <div className="relative">
                                   <Input 
                                       type="number" 
                                       placeholder="0" 
                                       className="h-10 bg-white font-bold"
                                       value={currentLead.montant_paye || ''} 
                                       onChange={e => setCurrentLead({...currentLead, montant_paye: parseFloat(e.target.value)})} 
                                   />
                                   <span className="absolute right-3 top-2.5 text-sm font-bold text-slate-400">€</span>
                                </div>
                           </div>
                        </div>
                   </div>
                </div>

                {/* SECTION 5 : NOTES */}
                <div className="space-y-2">
                    <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider border-b border-indigo-100 pb-2">4. Notes Internes</h3>
                    <textarea 
                        className="w-full border border-slate-200 rounded-xl p-4 text-sm min-h-[100px] resize-y focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm" 
                        placeholder="Ajouter des notes, spécificités alimentaires, infos importantes..." 
                        value={currentLead.commentaires || ''} 
                        onChange={e => setCurrentLead({...currentLead, commentaires: e.target.value})} 
                    />
                </div>

            </div> {/* Fin du BODY scrollable */}

            {/* 3. FOOTER (Toujours visible en bas) */}
            <div className="p-5 border-t border-slate-100 bg-slate-50 rounded-b-2xl shrink-0 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowModal(false)} className="font-bold bg-white text-slate-600 hover:text-slate-800">
                  Annuler
              </Button>
              <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 shadow-md font-bold">
                  Enregistrer le dossier
              </Button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}