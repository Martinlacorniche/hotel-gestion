'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient'; 
import { useAuth } from '@/context/AuthContext';
import { format, isBefore, isToday, parseISO, getYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Search, PlusCircle, Clock, 
  Edit2, Trash2, Layout, XCircle, CalendarDays, ChevronDown,
  MessageSquareText, Wallet, Check,
  FileText
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

// --- CONSTANTES ---
const STATUS_COLORS: Record<string, string> = {
  'Nouveau':      'bg-blue-500',
  'Devis envoyé': 'bg-amber-400',
  'Option':       'bg-purple-500',
  'Confirmé':     'bg-emerald-500',
  'Refus':        'bg-red-500',
};

const STATUS_BG: Record<string, string> = {
  'Nouveau':      'bg-blue-50 text-blue-700 border-blue-200',
  'Devis envoyé': 'bg-amber-50 text-amber-700 border-amber-200',
  'Option':       'bg-purple-50 text-purple-700 border-purple-200',
  'Confirmé':     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Refus':        'bg-red-50 text-red-600 border-red-200',
};

const PAYMENT_COLORS: Record<string, string> = {
  'Attente acompte': 'bg-red-500',
  'Acompte reçu':    'bg-amber-500',
  'RGT/P':           'bg-orange-400',
  'Soldé':           'bg-blue-400',
  'Facture envoyée': 'bg-purple-400',
  'Finalisé':        'bg-emerald-500',
};

const PAYMENT_BG: Record<string, string> = {
  'Attente acompte': 'bg-red-50 text-red-600 border-red-200',
  'Acompte reçu':    'bg-amber-50 text-amber-700 border-amber-200',
  'RGT/P':           'bg-orange-50 text-orange-600 border-orange-200',
  'Soldé':           'bg-blue-50 text-blue-600 border-blue-200',
  'Facture envoyée': 'bg-purple-50 text-purple-600 border-purple-200',
  'Finalisé':        'bg-emerald-50 text-emerald-700 border-emerald-200',
};

// --- NOTHING OS : COULEURS & PILLS ---
const NT_STATUS_COLOR: Record<string, string> = {
  'Nouveau':      '#3b82f6',
  'Devis envoyé': '#f59e0b',
  'Option':       '#8b5cf6',
  'Confirmé':     '#10b981',
  'Refus':        '#ef4444',
};

const NT_PAYMENT_COLOR: Record<string, string> = {
  'Attente acompte': '#ff3b30',
  'Acompte reçu':    '#f59e0b',
  'RGT/P':           '#ff9f0a',
  'Soldé':           '#3b82f6',
  'Facture envoyée': '#8b5cf6',
  'Finalisé':        '#10b981',
};

function CommentTooltip({ text }: { text: string }) {
  return (
    <div className="relative inline-flex ml-auto group/tip" onClick={(e) => e.stopPropagation()}>
      <MessageSquareText className="w-4 h-4 text-gray-300 hover:text-gray-800 transition-colors cursor-help" />
      
      {/* Bulle alignée à droite (right-0) */}
      <div className="pointer-events-none absolute bottom-full right-0 mb-2.5 w-64 p-3.5 bg-white border border-gray-200 text-gray-700 text-[11px] leading-relaxed rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] opacity-0 group-hover/tip:opacity-100 transition-all duration-200 z-[100] whitespace-pre-wrap">
        <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2 border-b border-gray-100 pb-1.5">
          Notes internes
        </div>
        {text}
        
        {/* Flèche vers le bas décalée sur la droite */}
        <div className="absolute -bottom-[6px] right-2 w-3 h-3 bg-white border-b border-r border-gray-200 rotate-45" />
      </div>
    </div>
  );
}

function NtStatusPill({ statut }: { statut: string }) {
  const color = NT_STATUS_COLOR[statut] || '#888';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg"
      style={{ color, border: `1px solid ${color}30`, background: `${color}12` }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {statut}
    </span>
  );
}

function NtPaymentPill({ etat }: { etat: string }) {
  const color = NT_PAYMENT_COLOR[etat] || '#888';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg"
      style={{ color, border: `1px solid ${color}30`, background: `${color}12` }}
    >
      {etat}
    </span>
  );
}

// --- COMPOSANT PRINCIPAL ---
export default function CommercialDashboard() {
  const { user } = useAuth();

  // États
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
  const [currentLead, setCurrentLead] = useState<Partial<Lead>>({
    statut: 'Nouveau',
    etat_paiement: 'Attente acompte',
    budget_estime: 0,
    montant_paye: 0,
    date_relance: '',
    date_evenement: ''
  });
  const [currentReservations, setCurrentReservations] = useState<any[]>([]);

  // --- HELPERS ---
  const getRelanceStatus = (dateStr?: string | null, statut?: string, etatPaiement?: string | null) => {
    if (['Gagné', 'Perdu', 'Refus'].includes(statut || '')) return 'done';
    if (statut === 'Confirmé' && etatPaiement === 'Soldé') return 'done';
    if (!dateStr) return 'none';
    const date = parseISO(dateStr);
    if (isBefore(date, new Date()) && !isToday(date)) return 'late';
    if (isToday(date)) return 'today';
    return 'future';
  };

  const getUpdateTrace = () => ({
    updated_at: new Date().toISOString(),
    updated_by: (user as any)?.name || 'Staff'
  });

  // --- FETCH ---
  const fetchLeads = async () => {
    if (!selectedHotelId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('suivi_commercial')
      .select('*')
      .eq('hotel_id', selectedHotelId);
    if (!error && data) setLeads(data);
    setLoading(false);
  };

  const fetchPlanning = async () => {
    if (!selectedHotelId) return;
    const { data: roomsList } = await supabase
      .from('seminar_rooms')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .order('name');
    if (roomsList) setRooms(roomsList);

    const start = format(viewDate, 'yyyy-MM-dd');
    const end = format(new Date(viewDate.getTime() + 6 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    // Fetch reservations that overlap the week: started before end AND ends after start
    const { data: events } = await supabase
      .from('view_planning_seminaires')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .lte('start_date', end)
      .gte('end_date', start);
    if (events) setPlanningData(events);
  };

  // --- EFFECTS ---
  useEffect(() => {
    const initHotels = async () => {
      const { data, error } = await supabase.from('hotels').select('id, nom').order('nom');
      if (!error && data) {
        setHotels(data);
        const saved = localStorage.getItem('selectedHotelId');
        if (saved && data.find(h => h.id === saved)) {
          setSelectedHotelId(saved);
        } else if (data.length > 0) {
          setSelectedHotelId(data[0].id);
        }
      }
    };
    initHotels();
  }, []);

  useEffect(() => {
    if (selectedHotelId) {
      localStorage.setItem('selectedHotelId', selectedHotelId);
      fetchLeads();
      fetchPlanning();
    }
  }, [selectedHotelId, viewDate]);

  // --- MODAL ---
  const openLeadModal = async (lead?: Partial<Lead>, defaultDate?: string, defaultRoomName?: string) => {
    if (lead && lead.id) {
      setCurrentLead(lead);
      const { data } = await supabase.from('seminar_reservations').select('*').eq('lead_id', lead.id);
      if (data) setCurrentReservations(data);
    } else {
      setCurrentLead({ statut: 'Nouveau', etat_paiement: 'Attente acompte', budget_estime: 0, montant_paye: 0, date_relance: '', date_evenement: defaultDate || '' });
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

  // --- HANDLERS ---
  const handleClientSearch = (input: string) => {
    setCurrentLead({ ...currentLead, nom_client: input });
    if (input.length > 2) {
      const matches = leads.filter(l => l.nom_client.toLowerCase().includes(input.toLowerCase()));
      const uniqueMatches = matches.filter((v, i, a) => a.findIndex(t => t.nom_client === v.nom_client) === i);
      setClientSuggestions(uniqueMatches);
    } else {
      setClientSuggestions([]);
    }
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

  const handleSave = async () => {
    if (!currentLead.nom_client || !currentLead.titre_demande) return alert('Nom et Titre obligatoires');
    const trace = getUpdateTrace();
    const payload = {
      ...currentLead,
      hotel_id: selectedHotelId,
      date_relance: currentLead.date_relance === '' ? null : currentLead.date_relance,
      date_evenement: currentLead.date_evenement === '' ? null : currentLead.date_evenement,
      ...trace
    };
    let leadId = currentLead.id;
    if (leadId) {
      const { error } = await supabase.from('suivi_commercial').update(payload).eq('id', leadId);
      if (error) return alert(error.message);
    } else {
      const { data, error } = await supabase.from('suivi_commercial').insert([{ ...payload, created_at: new Date().toISOString() }]).select().single();
      if (error) return alert(error.message);
      leadId = data.id;
    }
    if (leadId) {
      await supabase.from('seminar_reservations').delete().eq('lead_id', leadId);
      if (currentReservations.length > 0) {
        const resasToInsert = currentReservations.map(r => ({
          lead_id: leadId,
          room_id: r.room_id,
          start_date: r.start_date || currentLead.date_evenement,
          end_date: r.start_date || currentLead.date_evenement,
          start_time: r.start_time || null,
          end_time: r.end_time || null,
          status: currentLead.statut === 'Confirmé' ? 'reserved' : 'option'
        }));
        await supabase.from('seminar_reservations').insert(resasToInsert);
      }
    }
    setShowModal(false);
    fetchLeads();
    fetchPlanning();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce dossier ?')) return;
    await supabase.from('suivi_commercial').delete().eq('id', id);
    setLeads(prev => prev.filter(l => l.id !== id));
  };

  const handleGlobalClick = () => {
    // plus de dropdowns inline
  };

  // --- COMPUTED ---
  const sortedLeads = useMemo(() => {
    const filtered = leads.filter(l => {
      const matchSearch = (
        l.nom_client.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.titre_demande.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.email && l.email.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const eventDate = l.date_evenement ? new Date(l.date_evenement).getTime() : Infinity;
      const isPast = eventDate < now.getTime();
      let matchFilter = false;
      if (filterStatut === 'Tous') matchFilter = true;
      else if (filterStatut === 'Pipeline') matchFilter = ['Nouveau', 'Devis envoyé', 'Option'].includes(l.statut);
      else if (filterStatut === 'Confirmé') matchFilter = l.statut === 'Confirmé' && !isPast;
      else if (filterStatut === 'Terminées') matchFilter = isPast;
      else if (filterStatut === 'Refus') matchFilter = l.statut === 'Refus';
      else if (filterStatut === 'Débiteurs') {
        const budget = l.budget_estime || 0;
        const paye = l.montant_paye || 0;
        matchFilter = isPast && l.statut !== 'Refus' && (budget - paye > 0);
      }
      return matchSearch && matchFilter;
    });

    return filtered.sort((a, b) => {
      const statusA = getRelanceStatus(a.date_relance, a.statut, a.etat_paiement);
      const statusB = getRelanceStatus(b.date_relance, b.statut, b.etat_paiement);
      const isUrgentA = statusA === 'late' || statusA === 'today';
      const isUrgentB = statusB === 'late' || statusB === 'today';
      if (isUrgentA && !isUrgentB) return -1;
      if (!isUrgentA && isUrgentB) return 1;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const timeA = a.date_evenement ? new Date(a.date_evenement).getTime() : Infinity;
      const timeB = b.date_evenement ? new Date(b.date_evenement).getTime() : Infinity;
      const isPastA = timeA < now.getTime();
      const isPastB = timeB < now.getTime();
      if (isPastA && !isPastB) return 1;
      if (!isPastA && isPastB) return -1;
      if (timeA !== timeB) return isPastA ? timeB - timeA : timeA - timeB;
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
    const lateCount = leads.filter(l => getRelanceStatus(l.date_relance, l.statut, l.etat_paiement) === 'late').length;
    const todayCount = leads.filter(l => getRelanceStatus(l.date_relance, l.statut, l.etat_paiement) === 'today').length;
    return { pipeline, won, lost, lateCount, todayCount };
  }, [leads]);

  // Dossiers urgents pour la colonne À traiter
  const urgentLeads = leads
    .filter(l => ['late', 'today'].includes(getRelanceStatus(l.date_relance, l.statut, l.etat_paiement)))
    .sort((a, b) => {
      const ra = getRelanceStatus(a.date_relance, a.statut, a.etat_paiement);
      const rb = getRelanceStatus(b.date_relance, b.statut, b.etat_paiement);
      if (ra === 'late' && rb !== 'late') return -1;
      if (ra !== 'late' && rb === 'late') return 1;
      return 0;
    });

  // Prochains événements pour l'Agenda
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcomingLeads = leads
    .filter(l => l.date_evenement && new Date(l.date_evenement) >= today && l.statut !== 'Refus')
    .sort((a, b) => new Date(a.date_evenement!).getTime() - new Date(b.date_evenement!).getTime())
    .slice(0, 7);

  // --- RENDER ---
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        .dm { font-family: 'Share Tech Mono', 'Courier New', monospace; letter-spacing: 0.02em; }
        .nt-card { background: #ffffff; border: 1px solid #ececec; }
        .nt-card:hover { border-color: #d0d0d0; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
        .nt-input { background: #f7f7f7 !important; border-color: #e8e8e8 !important; color: #111 !important; }
        .nt-input::placeholder { color: #bbb !important; }
        .nt-input:focus { border-color: #aaa !important; box-shadow: none !important; background: #fff !important; }
        .nt-select { background: #f7f7f7; border: 1px solid #e8e8e8; color: #111; border-radius: 10px; }
        .nt-select option { background: #fff; }
        .accent-red   { color: #e53935; }
        .accent-amber { color: #e67e00; }
        .accent-green { color: #1aaa5a; }
        .sep-line { background: #f0f0f0; }
      `}</style>

      <div className="min-h-screen p-4 md:p-8 font-sans" style={{backgroundColor: '#f5f5f5', color: '#111'}} onClick={handleGlobalClick}>

        {/* ═══════════════════════════════════════
            HEADER
        ═══════════════════════════════════════ */}
        <div className="mb-8">

          {/* Ligne haute */}
          <div className="flex items-start justify-between mb-6 flex-wrap gap-6">

            <select
              value={selectedHotelId}
              onChange={(e) => setSelectedHotelId(e.target.value)}
              className="nt-select px-4 py-2 text-sm font-black outline-none cursor-pointer"
            >
              {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
            </select>

            {/* KPIs dot matrix */}
            {activeTab === 'pipeline' && (
              <div className="flex items-end gap-8 flex-wrap">

                {stats.lateCount > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>En retard</p>
                    <p className="dm text-4xl font-bold leading-none accent-red">{String(stats.lateCount).padStart(2,'0')}</p>
                  </div>
                )}
                {stats.todayCount > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Aujourd'hui</p>
                    <p className="dm text-4xl font-bold leading-none accent-amber">{String(stats.todayCount).padStart(2,'0')}</p>
                  </div>
                )}

                {(stats.lateCount > 0 || stats.todayCount > 0) && (
                  <div className="self-stretch w-px sep-line" />
                )}

                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Pipeline</p>
                  <p className="dm text-2xl font-bold leading-none" style={{color: '#555'}}>{stats.pipeline.toLocaleString()}<span className="text-base ml-1" style={{color: '#bbb'}}>€</span></p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Gagné</p>
                  <p className="dm text-2xl font-bold leading-none accent-green">+{stats.won.toLocaleString()}<span className="text-base ml-1" style={{color: '#1aaa5a80'}}>€</span></p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Perdu</p>
                  <p className="dm text-2xl font-bold leading-none" style={{color: '#e5393580'}}>−{stats.lost.toLocaleString()}<span className="text-base ml-1" style={{color: '#e5393540'}}>€</span></p>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0 border-b border-gray-200">
            {['pipeline', 'planning', 'tarifs'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className="pb-3 pr-8 text-sm font-black transition-all whitespace-nowrap border-b-2 -mb-px tracking-wide"
                style={{
                  color: activeTab === tab ? '#111' : '#bbb',
                  borderBottomColor: activeTab === tab ? '#111' : 'transparent',
                }}
              >
                {tab === 'pipeline' ? 'Suivi Commercial' : tab === 'planning' ? 'Planning Salles' : 'Offres & Tarifs'}
              </button>
            ))}
          </div>
        </div>


        {/* ═══════════════════════════════════════
            1. PLANNING
        ═══════════════════════════════════════ */}
        {activeTab === 'planning' && (() => {
          // Couleurs par statut
          const PLANNING_STYLE: Record<string, {bg:string,border:string,color:string,badge:string}> = {
            'Confirmé':     { bg:'#ecfdf5', border:'#6ee7b7', color:'#065f46', badge:'#10b981' },
            'Option':       { bg:'#fffbeb', border:'#fcd34d', color:'#92400e', badge:'#f59e0b' },
            'Devis envoyé': { bg:'#eff6ff', border:'#93c5fd', color:'#1e40af', badge:'#3b82f6' },
            'Nouveau':      { bg:'#f5f3ff', border:'#c4b5fd', color:'#4c1d95', badge:'#8b5cf6' },
            'Gagné':        { bg:'#f0fdf4', border:'#86efac', color:'#14532d', badge:'#22c55e' },
          };
          const getPStyle = (s: string) => PLANNING_STYLE[s] ?? {bg:'#f9fafb',border:'#e5e7eb',color:'#6b7280',badge:'#9ca3af'};

          // 7 jours de la semaine
          const WEEK = [...Array(7)].map((_,i) => {
            const d = new Date(viewDate.getTime() + i * 24*60*60*1000);
            return { d, str: format(d,'yyyy-MM-dd'), tod: isToday(d) };
          });

          // Numéro de semaine ISO
          const weekNum = (() => {
            const d = new Date(viewDate); d.setHours(0,0,0,0);
            d.setDate(d.getDate() + 3 - (d.getDay()+6)%7);
            const w1 = new Date(d.getFullYear(),0,4);
            return 1 + Math.round(((d.getTime()-w1.getTime())/86400000 - 3 + (w1.getDay()+6)%7)/7);
          })();

          const COLS = '160px repeat(7, minmax(130px, 1fr))';

          return (
            <div className="rounded-2xl overflow-hidden mb-10 bg-white" style={{border:'1px solid #e8e8e8'}}>

              {/* ── Header ── */}
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-[0.15em]" style={{color:'#111'}}>
                    Disponibilités Salles
                    <span className="ml-3 text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-400 tracking-widest">S{weekNum}</span>
                  </h2>
                  <p className="dm text-[11px] mt-1" style={{color:'#aaa'}}>
                    {format(viewDate,'MMMM yyyy',{locale:fr}).toUpperCase()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input type="date" value={format(viewDate,'yyyy-MM-dd')} onChange={(e)=>setViewDate(new Date(e.target.value))} className="nt-select px-3 py-2 text-[11px] font-black outline-none cursor-pointer" />
                  <div className="flex gap-1 p-1 rounded-xl bg-gray-100 border border-gray-200">
                    <Button variant="ghost" size="sm" onClick={()=>setViewDate(new Date(viewDate.getTime()-7*24*60*60*1000))} className="h-8 w-8 p-0 hover:bg-white text-gray-400 hover:text-gray-900">
                      <ChevronDown className="w-4 h-4 rotate-90" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={()=>setViewDate(new Date())} className="h-8 text-[10px] font-black uppercase px-3 hover:bg-white text-gray-400 hover:text-gray-900 tracking-wider">
                      Auj.
                    </Button>
                    <Button variant="ghost" size="sm" onClick={()=>setViewDate(new Date(viewDate.getTime()+7*24*60*60*1000))} className="h-8 w-8 p-0 hover:bg-white text-gray-400 hover:text-gray-900">
                      <ChevronDown className="w-4 h-4 -rotate-90" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── Grid ── */}
              <div className="overflow-x-auto">
                <div style={{minWidth:'1070px'}}>

                  {/* En-têtes jours */}
                  <div className="border-b border-gray-100" style={{display:'grid',gridTemplateColumns:COLS}}>
                    <div className="p-4 border-r border-gray-100 sticky left-0 bg-white z-20 text-[9px] font-black uppercase tracking-widest text-gray-300 flex items-end pb-4">Salles</div>
                    {WEEK.map(({d,str,tod})=>(
                      <div key={str} className="p-4 text-center border-r border-gray-100 last:border-r-0"
                        style={{background:tod?'#f0f4ff':'transparent'}}>
                        <div className="text-[9px] font-black uppercase tracking-widest mb-1" style={{color:tod?'#3b5bdb':'#bbb'}}>{format(d,'EEE',{locale:fr})}</div>
                        <div className="dm text-xl font-bold" style={{color:tod?'#3b5bdb':'#888'}}>{format(d,'dd')}</div>
                        {tod && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mx-auto mt-1" />}
                      </div>
                    ))}
                  </div>

                  {/* Lignes salles */}
                  {rooms.map(room=>{
                    const roomEvents = planningData.filter(r=>
                      r.room_name === room.name &&
                      r.start_date <= WEEK[6].str &&
                      (r.end_date ?? r.start_date) >= WEEK[0].str
                    );

                    return (
                      <div key={room.id} className="border-b border-gray-100 last:border-b-0 group"
                        style={{display:'grid',gridTemplateColumns:COLS,minHeight:'88px'}}>

                        {/* Label salle — sticky */}
                        <div className="p-4 border-r border-gray-100 sticky left-0 bg-white z-10 flex flex-col justify-center">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor:room.color||'#ccc'}} />
                            <span className="text-xs font-black truncate" style={{color:'#555'}}>{room.name}</span>
                          </div>
                          <div className="text-[9px] mt-0.5 font-bold tracking-wider" style={{color:'#bbb'}}>{room.capacity}p · {room.surface}m²</div>
                        </div>

                        {/* Zone 7 jours — CSS grid pur */}
                        <div style={{
                          gridColumn:'span 7',
                          position:'relative',
                          display:'grid',
                          gridTemplateColumns:'repeat(7,1fr)',
                          gridAutoRows:'auto',
                          gap:0,
                        }}>

                          {/* Fond : séparateurs colonnes + highlight aujourd'hui — pointer-events:none */}
                          <div style={{position:'absolute',inset:0,display:'grid',gridTemplateColumns:'repeat(7,1fr)',pointerEvents:'none',zIndex:0}}>
                            {WEEK.map(({str,tod},ci)=>(
                              <div key={str} style={{
                                background:tod?'#f8f9ff':'transparent',
                                borderRight:ci<6?'1px solid #f3f4f6':'none',
                              }} />
                            ))}
                          </div>

                          {/* Événements — gridRow:1, span réel */}
                          {roomEvents.map(res=>{
                            const endDate = res.end_date ?? res.start_date;
                            const clL = res.start_date < WEEK[0].str;
                            const clR = endDate > WEEK[6].str;
                            const si = clL ? 0 : WEEK.findIndex(w=>w.str===res.start_date);
                            const ei = clR ? 6 : WEEK.findIndex(w=>w.str===endDate);
                            const multiDay = res.start_date !== endDate;
                            const st = getPStyle(res.display_status);
                            return (
                              <div key={res.reservation_id}
                                onClick={()=>window.open(`/devis?leadId=${res.lead_id}`,'_blank')}
                                style={{
                                  gridColumn:`${si+1} / ${ei+2}`,
                                  gridRow:1,
                                  position:'relative',
                                  zIndex:2,
                                  margin:`5px ${clR?0:4}px 5px ${clL?0:4}px`,
                                  background:st.bg,
                                  border:`1.5px solid ${st.border}`,
                                  borderLeft: clL ? 'none' : `1.5px solid ${st.border}`,
                                  borderRight: clR ? 'none' : `1.5px solid ${st.border}`,
                                  color:st.color,
                                  borderRadius:`${clL?3:10}px ${clR?3:10}px ${clR?3:10}px ${clL?3:10}px`,
                                  cursor:'pointer',
                                }}
                                className="p-2 text-[10px] font-bold leading-tight transition-all hover:opacity-75">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:st.badge}} />
                                  <span className="text-[8px] font-black uppercase tracking-widest opacity-60">{res.display_status}</span>
                                  {clL && <span className="text-[8px] opacity-40 ml-0.5">←</span>}
                                  {multiDay && !clR && <span className="ml-auto text-[8px] opacity-40">→ {endDate.substring(8)}</span>}
                                  {clR && <span className="ml-auto text-[8px] opacity-40">→</span>}
                                </div>
                                <div className="font-black truncate">{res.nom_client}</div>
                                <div className="truncate opacity-50 italic text-[9px]">{res.titre_demande||'—'}</div>
                                {(res.start_time||res.end_time) && (
                                  <div className="dm text-[9px] mt-1 opacity-60">{res.start_time?.substring(0,5)} – {res.end_time?.substring(0,5)}</div>
                                )}
                              </div>
                            );
                          })}

                          {/* Boutons + par jour libre — gridRow:2, visibles au hover de la ligne */}
                          {WEEK.map(({str},ci)=>{
                            const busy = roomEvents.some(r=>r.start_date<=str&&(r.end_date??r.start_date)>=str);
                            return (
                              <button key={str}
                                onClick={(e)=>{e.stopPropagation();openLeadModal(undefined,str,room.name);}}
                                style={{gridColumn:ci+1,gridRow:2,zIndex:1,margin:'0 3px 4px 3px'}}
                                className={`h-8 flex items-center justify-center transition-opacity rounded-xl border border-dashed border-gray-200 hover:bg-gray-50 hover:border-gray-300 ${busy?'opacity-0 pointer-events-none':'opacity-0 group-hover:opacity-100'}`}>
                                <PlusCircle className="w-3.5 h-3.5 text-gray-300" />
                              </button>
                            );
                          })}

                        </div>
                      </div>
                    );
                  })}

                </div>
              </div>
            </div>
          );
        })()}

{/* ═══════════════════════════════════════
            2. PIPELINE
        ═══════════════════════════════════════ */}
        {activeTab === 'pipeline' && (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
              <div className="flex gap-px p-1 rounded-xl bg-white border border-gray-200 shadow-sm">
                {['Pipeline', 'Confirmé', 'Terminées', 'Débiteurs', 'Refus', 'Tous'].map(st => (
                  <button key={st} onClick={(e) => { e.stopPropagation(); setFilterStatut(st); }}
                    className="px-3.5 py-1.5 rounded-lg text-[11px] font-black transition-all whitespace-nowrap tracking-wide"
                    style={{
                      background: filterStatut === st ? (st === 'Débiteurs' ? '#e53935' : '#111') : 'transparent',
                      color: filterStatut === st ? '#fff' : '#999',
                    }}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-300" />
                  <input placeholder="Rechercher..." className="nt-input pl-9 text-sm h-9 w-52 rounded-xl outline-none border" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <button onClick={(e) => { e.stopPropagation(); openLeadModal(); }}
                  className="flex items-center gap-1.5 px-5 h-9 rounded-xl text-xs font-black tracking-wide transition-all hover:bg-gray-800"
                  style={{background: '#111', color: '#fff'}}>
                  <PlusCircle className="h-3.5 w-3.5" /> Nouveau
                </button>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-24 dm text-[11px] tracking-[0.4em] uppercase text-gray-300">Chargement…</div>
            ) : (
              <div className="grid pb-24" style={{gridTemplateColumns: '5fr 7fr', gap: '1.5rem', alignItems: 'start'}}>

                {/* ══ GAUCHE — À TRAITER ══ */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between mb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">À traiter</span>
                      {urgentLeads.length > 0 && <span className="dm text-sm font-bold accent-red">{urgentLeads.length}</span>}
                    </div>
                    {urgentLeads.length === 0 && <span className="text-[9px] font-black tracking-wider accent-green">✓ À jour</span>}
                  </div>

                  {urgentLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl py-16 gap-4 bg-white border border-dashed border-gray-200">
                      <Check className="w-5 h-5 text-emerald-400" />
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-300">Rien à traiter</p>
                    </div>
                  ) : (
                    urgentLeads
                      .filter(l => l.nom_client.toLowerCase().includes(searchTerm.toLowerCase()) || l.titre_demande.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(lead => {
                        const rs = getRelanceStatus(lead.date_relance, lead.statut, lead.etat_paiement);
                        const isLate = rs === 'late';
                        const budget = lead.budget_estime || 0;
                        const paye = lead.montant_paye || 0;
                        const reste = Math.max(0, budget - paye);
                        const accentColor = isLate ? '#e53935' : '#e67e00';
                        return (
                          <div key={lead.id} onClick={() => openLeadModal(lead)}
                            className="group relative nt-card rounded-2xl transition-all duration-200 cursor-pointer"
                            style={{borderLeft: `3px solid ${accentColor}`}}
                          >
                            <div className="pl-4 pr-4 pt-4 pb-3.5">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <p className="font-black text-[14px] leading-snug tracking-tight text-gray-900">{lead.nom_client}</p>
                                <span className="shrink-0 dm text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-md"
                                  style={{color: accentColor, background: `${accentColor}14`}}>
                                  {isLate ? 'RETARD' : 'AUJ.'}
                                </span>
                              </div>
                              <p className="text-[11px] mb-3 leading-relaxed truncate text-gray-400">{lead.titre_demande}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                {lead.date_evenement && (
                                  <span className="dm text-[10px] font-bold px-2.5 py-1 rounded-lg text-gray-500 bg-gray-50 border border-gray-100">
                                    {format(parseISO(lead.date_evenement), 'dd MMM yy', { locale: fr }).toUpperCase()}
                                  </span>
                                )}
                                <NtStatusPill statut={lead.statut} />
                                {lead.commentaires?.trim() && <CommentTooltip text={lead.commentaires} />}
                              </div>
                              {lead.date_relance && (
                                <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-black" style={{color: accentColor}}>
                                  <Clock className="w-3 h-3 shrink-0" />
                                  <span className="dm">Relance · {format(parseISO(lead.date_relance), 'dd MMM yy', { locale: fr }).toUpperCase()}</span>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-1.5 px-4 pb-3 -mt-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); window.open(`/devis?leadId=${lead.id}`, '_blank'); }}
                                className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-600 hover:text-white transition-all"
                                title="Générer / Voir le devis"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openLeadModal(lead); }}
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-all"
                                title="Modifier"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Hover panel */}
                            <div className="overflow-hidden max-h-0 group-hover:max-h-24 transition-all duration-300 ease-in-out">
                              <div className="mx-3 mb-3 px-4 py-3 rounded-xl flex items-center gap-5 flex-wrap bg-gray-50 border border-gray-100">
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Gaétan</span>
                                  <select value={lead.besoin_gaetan ?? 'Pas besoin'} onChange={(e) => { e.stopPropagation(); handleGaetanChange(lead.id, e.target.value); }} onClick={(e) => e.stopPropagation()} className="nt-select h-6 rounded-lg px-2 text-[9px] font-bold focus:outline-none cursor-pointer">
                                    <option>Pas besoin</option><option>À valider</option><option>Validé</option><option>Pas dispo</option>
                                  </select>
                                </div>
                                <div className="w-px h-4 bg-gray-200 shrink-0" />
                                <div className="flex items-center gap-4">
                                  {[{l:'Budget',v:`${budget.toLocaleString()} €`,c:'#555'},{l:'Réglé',v:`${paye.toLocaleString()} €`,c:'#1aaa5a'},{l:'Solde',v:reste>0?`− ${reste.toLocaleString()} €`:'✓ Soldé',c:reste>0?'#e53935':'#1aaa5a'}].map(k=>(
                                    <div key={k.l}>
                                      <p className="text-[8px] font-black uppercase tracking-widest mb-0.5 text-gray-400">{k.l}</p>
                                      <p className="dm text-sm font-bold" style={{color:k.c}}>{k.v}</p>
                                    </div>
                                  ))}
                                </div>
                                <p className="ml-auto text-[8px] font-medium text-gray-300 hidden lg:block whitespace-nowrap">
                                  {lead.updated_by ?? '—'} · {format(parseISO(lead.updated_at ?? lead.created_at), 'dd/MM', { locale: fr })}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>

                {/* ══ DROITE — DOSSIERS ══ */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between mb-4">
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">
                      {filterStatut === 'Pipeline' ? 'Agenda' : filterStatut}
                    </span>
                    <span className="dm text-[11px] font-bold text-gray-300">{String(sortedLeads.length).padStart(2,'0')}</span>
                  </div>

                  {sortedLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl py-16 gap-4 bg-white border border-dashed border-gray-200">
                      <PlusCircle className="w-5 h-5 text-gray-300" />
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-300">Aucun dossier</p>
                      <button onClick={() => openLeadModal()} className="text-[10px] font-black underline underline-offset-2 text-gray-400 hover:text-gray-900 transition-colors">Créer un dossier</button>
                    </div>
                  ) : (
                    sortedLeads.map((lead, i, arr) => {
                      const rs = getRelanceStatus(lead.date_relance, lead.statut, lead.etat_paiement);
                      const isUrgent = rs === 'late' || rs === 'today';
                      const budget = lead.budget_estime || 0;
                      const paye = lead.montant_paye || 0;
                      const reste = Math.max(0, budget - paye);
                      const currentMonth = lead.date_evenement ? format(parseISO(lead.date_evenement), 'MMMM yyyy', { locale: fr }) : null;
                      const prevMonth = i > 0 && arr[i-1].date_evenement ? format(parseISO(arr[i-1].date_evenement!), 'MMMM yyyy', { locale: fr }) : null;
                      const showSep = currentMonth && currentMonth !== prevMonth;

                      return (
                        <div key={lead.id}>
                          {showSep && (
                            <div className="flex items-center gap-4 py-3 px-0.5">
                              <span className="dm text-[10px] font-bold uppercase tracking-[0.2em] text-gray-300">{currentMonth}</span>
                              <div className="flex-1 h-px bg-gray-100" />
                            </div>
                          )}

                          <div onClick={() => openLeadModal(lead)}
                           className="group relative nt-card rounded-2xl transition-all duration-200 cursor-pointer"
                            style={{borderLeft: `3px solid ${NT_STATUS_COLOR[lead.statut]}`}}
                          >
                            <div className="pl-4 pr-4 pt-4 pb-3.5 flex gap-4 items-start">

                              {/* Mini cal dot matrix */}
                              {lead.date_evenement ? (
                                <div className="flex flex-col items-center shrink-0 min-w-[38px]" style={{gap: '0px'}}>
                                  <span className="dm text-[8px] font-bold uppercase tracking-widest text-gray-400 leading-none">
                                    {format(parseISO(lead.date_evenement), 'MMM', { locale: fr })}
                                  </span>
                                  <span className="dm font-bold leading-none" style={{fontSize: '26px', color: '#111', letterSpacing: '-0.02em'}}>
                                    {format(parseISO(lead.date_evenement), 'dd')}
                                  </span>
                                  <span className="dm text-[8px] font-bold text-gray-300 leading-none">
                                    {format(parseISO(lead.date_evenement), 'yyyy')}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center shrink-0 min-w-[38px] h-[52px]">
                                  <span className="dm text-xl font-bold text-gray-200">—</span>
                                </div>
                              )}

                              {/* Séparateur */}
                              <div className="w-px self-stretch mx-1 shrink-0 bg-gray-100" />

                              {/* Contenu */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start gap-2 mb-0.5">
                                  <p className="font-black text-[14px] leading-snug tracking-tight flex-1 min-w-0 truncate text-gray-900">{lead.nom_client}</p>
                                  {isUrgent && (
                                    <span className="dm text-[9px] font-bold shrink-0 px-2 py-0.5 rounded-md"
                                      style={{color: rs==='late'?'#e53935':'#e67e00', background: rs==='late'?'#e5393514':'#e67e0014'}}>
                                      {rs === 'late' ? 'RETARD' : 'AUJ.'}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] mb-3 leading-relaxed truncate text-gray-400">{lead.titre_demande}</p>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <NtStatusPill statut={lead.statut} />
                                  {lead.statut === 'Confirmé' && lead.etat_paiement && <NtPaymentPill etat={lead.etat_paiement} />}
                                  {lead.commentaires?.trim() && <CommentTooltip text={lead.commentaires} />}
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-1.5 px-4 pb-3 -mt-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); window.open(`/devis?leadId=${lead.id}`, '_blank'); }}
                                className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-600 hover:text-white transition-all"
                                title="Générer / Voir le devis"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openLeadModal(lead); }}
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-all"
                                title="Modifier"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }}
                                className="p-1.5 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all"
                                title="Supprimer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Hover panel */}
                            <div className="overflow-hidden max-h-0 group-hover:max-h-24 transition-all duration-300 ease-in-out">
                              <div className="mx-3 mb-3 px-4 py-3 rounded-xl flex items-center gap-5 flex-wrap bg-gray-50 border border-gray-100">
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Gaétan</span>
                                  <select value={lead.besoin_gaetan ?? 'Pas besoin'} onChange={(e) => { e.stopPropagation(); handleGaetanChange(lead.id, e.target.value); }} onClick={(e) => e.stopPropagation()} className="nt-select h-6 rounded-lg px-2 text-[9px] font-bold focus:outline-none cursor-pointer">
                                    <option>Pas besoin</option><option>À valider</option><option>Validé</option><option>Pas dispo</option>
                                  </select>
                                </div>
                                <div className="w-px h-4 bg-gray-200 shrink-0" />
                                <div className="flex items-center gap-4">
                                  {[{l:'Budget',v:`${budget.toLocaleString()} €`,c:'#555'},{l:'Réglé',v:`${paye.toLocaleString()} €`,c:'#1aaa5a'},{l:'Solde',v:reste>0?`− ${reste.toLocaleString()} €`:'✓ Soldé',c:reste>0?'#e53935':'#1aaa5a'}].map(k=>(
                                    <div key={k.l}>
                                      <p className="text-[8px] font-black uppercase tracking-widest mb-0.5 text-gray-400">{k.l}</p>
                                      <p className="dm text-sm font-bold" style={{color:k.c}}>{k.v}</p>
                                    </div>
                                  ))}
                                  {lead.date_relance && (
                                    <>
                                      <div className="w-px h-4 bg-gray-200 shrink-0" />
                                      <div>
                                        <p className="text-[8px] font-black uppercase tracking-widest mb-0.5 text-gray-400">Relance</p>
                                        <p className="dm text-sm font-bold" style={{color: rs==='late'?'#e53935':rs==='today'?'#e67e00':'#555'}}>
                                          {format(parseISO(lead.date_relance), 'dd MMM yy', { locale: fr }).toUpperCase()}
                                        </p>
                                      </div>
                                    </>
                                  )}
                                </div>
                                <p className="ml-auto text-[8px] font-medium text-gray-300 hidden lg:block whitespace-nowrap">
                                  {lead.updated_by ?? '—'} · {format(parseISO(lead.updated_at ?? lead.created_at), 'dd/MM', { locale: fr })}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

              </div>
            )}
          </>
        )}


        {/* ═══════════════════════════════════════
            3. TARIFS
        ═══════════════════════════════════════ */}
        {activeTab === 'tarifs' && (
          <div className="space-y-8">
            <section>
              <h2 className="text-[9px] font-black uppercase tracking-[0.25em] mb-5 flex items-center gap-3 text-gray-400">
                <CalendarDays className="w-4 h-4" /> Location Salles TTC
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { n: 'Telo Segreto',   d: '57m² · 30/40 pers.', p: '239 € / 359 €' },
                  { n: 'Telo Maritimo',  d: '50m² · 30 pers.',    p: '359 €' },
                  { n: 'Telo Intimo',    d: '18m² · 5 pers.',     p: '80 € / 160 €' },
                  { n: 'Patio Tropical', d: '100m² · 60 pers.',   p: 'Événementiel' },
                ].map(s => (
                  <div key={s.n} className="nt-card p-4 rounded-2xl">
                    <div className="font-black text-sm mb-1 text-gray-900">{s.n}</div>
                    <div className="text-[10px] mb-3 text-gray-400">{s.d}</div>
                    <div className="dm font-bold text-sm text-gray-500">{s.p}</div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-[9px] font-black uppercase tracking-[0.25em] mb-5 flex items-center gap-3 text-gray-400">
                <MessageSquareText className="w-4 h-4" /> Restauration TTC — With Gaétan
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {[
                  { title: 'Menus à table', accent: '#1aaa5a', items: [
                    { n: 'Menu Starter',     c: '2 temps · sans alcool',              p: '29 €' },
                    { n: 'Menu Confort',     c: '3 temps · sans alcool',              p: '41 €' },
                    { n: 'Menu Privilège',   c: '3 temps · cocktail signature',       p: '50 €' },
                    { n: 'Menu Privilège++', c: '3 temps · cocktail · mises en bouche', p: '55 €' },
                  ]},
                  { title: 'Cocktails dinatoires', accent: '#3b5bdb', items: [
                    { n: 'Cocktail starter',   c: '5 salés · eaux / café',           p: '29 €' },
                    { n: 'Cocktail starter++', c: '5 salés · cocktail s.a.',         p: '35 €' },
                    { n: 'Cocktail confort',   c: '5 salés · 3 sucrés',              p: '44 €' },
                    { n: 'Cocktail privilège', c: '5 salés · 3 sucrés · animation',  p: '50 €' },
                    { n: 'Cocktail prestige',  c: '5 salés · 13 sucrés · animation', p: '60 €' },
                  ]},
                  { title: 'Self service', accent: '#e67e00', items: [
                    { n: 'Self starter',       c: '5 salés froids · eaux',           p: '25 €' },
                    { n: 'Self intermédiaire', c: '5 salés · 2 sucrés',              p: '30 €' },
                    { n: 'Self ++',            c: '5 salés · 2 sucrés · apéritif',   p: '35 €' },
                  ]},
                ].map(cat => (
                  <div key={cat.title} className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-3 px-1 text-gray-400">{cat.title}</p>
                    {cat.items.map(m => (
                      <div key={m.n} className="nt-card p-3 rounded-xl flex justify-between items-center" style={{borderLeft: `3px solid ${cat.accent}40`}}>
                        <div className="overflow-hidden mr-3">
                          <div className="text-sm font-black truncate text-gray-900">{m.n}</div>
                          <div className="text-[10px] truncate text-gray-400">{m.c}</div>
                        </div>
                        <div className="dm font-bold text-sm whitespace-nowrap" style={{color: cat.accent}}>{m.p}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className="nt-card p-6 rounded-2xl">
              <h2 className="text-[9px] font-black uppercase tracking-[0.25em] mb-4 flex items-center gap-3 text-gray-400">
                <Layout className="w-4 h-4" /> Dispositions & Capacités
              </h2>
              <div className="overflow-hidden rounded-xl border border-gray-100">
                <img src="/disposition.png" alt="Capacités" className="w-full h-auto object-cover" />
              </div>
            </section>
          </div>
        )}


        {/* ═══════════════════════════════════════
            MODAL
        ═══════════════════════════════════════ */}
        {showModal && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 sm:p-6" style={{background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)'}}>
            <div className="w-full max-w-2xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden bg-white" style={{border: '1px solid #e8e8e8', boxShadow: '0 24px 80px rgba(0,0,0,0.12)'}}>

              <div className="flex justify-between items-center p-5 shrink-0 border-b border-gray-100">
                <h2 className="text-base font-black tracking-tight text-gray-900">
                  {currentLead.id ? 'Modifier le dossier' : 'Nouveau dossier'}
                </h2>
                <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                  <XCircle className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="overflow-y-auto p-5 space-y-7">

                {/* 1. Client */}
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">01 · Client & Contacts</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="relative md:col-span-2">
                      <input placeholder="Client / Société" value={currentLead.nom_client || ''} onChange={e => handleClientSearch(e.target.value)} className="nt-input w-full h-10 rounded-xl px-4 font-black border outline-none" />
                      {clientSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 w-full bg-white rounded-xl shadow-xl z-[60] mt-1 py-1 max-h-48 overflow-y-auto border border-gray-100">
                          {clientSuggestions.map(s => (
                            <button key={s.id} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex flex-col transition-colors"
                              onClick={() => { setCurrentLead({ ...currentLead, nom_client: s.nom_client, email: s.email, telephone: s.telephone }); setClientSuggestions([]); }}>
                              <span className="font-black text-gray-900">{s.nom_client}</span>
                              <span className="text-[10px] text-gray-400">{s.email || "Pas d'email"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input placeholder="Email" value={currentLead.email || ''} onChange={e => setCurrentLead({...currentLead, email: e.target.value})} className="nt-input h-10 rounded-xl px-4 border outline-none" />
                    <input placeholder="Téléphone" value={currentLead.telephone || ''} onChange={e => setCurrentLead({...currentLead, telephone: e.target.value})} className="nt-input h-10 rounded-xl px-4 border outline-none" />
                  </div>
                </div>

                {/* 2. Événement */}
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">02 · L'événement</p>
                  <input placeholder="Titre de l'événement" value={currentLead.titre_demande || ''} onChange={e => setCurrentLead({...currentLead, titre_demande: e.target.value})} className="nt-input w-full h-10 rounded-xl px-4 border outline-none" />
                  <div className="flex flex-wrap gap-2">
                    {["Séminaire", "Séminaire résidentiel", "Hébergement", "Restauration", "Journée d'étude", "Soirée Cocktail"].map(tag => (
                      <button key={tag} type="button"
                        onClick={() => { const c = currentLead.titre_demande || ''; if (!c.includes(tag)) setCurrentLead({ ...currentLead, titre_demande: c ? `${c} + ${tag}` : tag }); }}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-100">
                        + {tag}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Date Événement</label>
                      <input type="date" value={currentLead.date_evenement || ''} onChange={e => setCurrentLead({...currentLead, date_evenement: e.target.value})} className="nt-input w-full h-10 rounded-xl px-4 border outline-none" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2" style={{color: '#e67e00'}}>Prochaine Relance</label>
                      <input type="date" value={currentLead.date_relance || ''} onChange={e => setCurrentLead({...currentLead, date_relance: e.target.value})} className="nt-input w-full h-10 rounded-xl px-4 border outline-none" />
                    </div>
                  </div>
                </div>

                {/* 3. Salles */}
                <div className="space-y-3 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                  <div className="flex justify-between items-center">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Planning Salles</p>
                    <button type="button" onClick={() => setCurrentReservations([...currentReservations, { room_id: rooms[0]?.id, start_date: currentLead.date_evenement || '', start_time: '09:00', end_time: '18:00' }])}
                      className="text-[10px] font-black text-gray-400 hover:text-gray-900 transition-colors">
                      + Ajouter une salle
                    </button>
                  </div>
                  {currentReservations.length === 0 && <p className="text-center text-[11px] py-2 text-gray-300">Aucune salle sélectionnée</p>}
                  {currentReservations.map((resa, index) => (
                    <div key={index} className="flex gap-2 items-center p-2.5 rounded-xl bg-white border border-gray-100">
                      <select value={resa.room_id} onChange={(e) => { const newR = [...currentReservations]; newR[index].room_id = e.target.value; setCurrentReservations(newR); }} className="nt-select flex-1 text-xs font-bold p-1 rounded-lg outline-none">
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <input type="date" value={resa.start_date} onChange={(e) => { const newR = [...currentReservations]; newR[index].start_date = e.target.value; setCurrentReservations(newR); }} className="nt-input w-32 h-8 rounded-lg px-2 text-[11px] font-bold border outline-none" />
                      <input type="time" value={resa.start_time} onChange={(e) => { const newR = [...currentReservations]; newR[index].start_time = e.target.value; setCurrentReservations(newR); }} className="nt-input w-24 h-8 rounded-lg px-2 text-[11px] font-bold border outline-none" />
                      <span className="text-gray-300 font-bold">–</span>
                      <input type="time" value={resa.end_time} onChange={(e) => { const newR = [...currentReservations]; newR[index].end_time = e.target.value; setCurrentReservations(newR); }} className="nt-input w-24 h-8 rounded-lg px-2 text-[11px] font-bold border outline-none" />
                      <button type="button" onClick={() => setCurrentReservations(currentReservations.filter((_, i) => i !== index))} className="p-2 rounded-lg hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* 4. Commercial & Finance */}
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">03 · Commercial & Finance</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Statut</label>
                      <select className="nt-select w-full rounded-xl px-3 py-2 text-sm font-bold h-10 outline-none" value={currentLead.statut || 'Nouveau'} onChange={e => setCurrentLead({...currentLead, statut: e.target.value as any})}>
                        <option>Nouveau</option><option>Devis envoyé</option><option>Option</option><option>Confirmé</option><option>Refus</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Budget estimé (€)</label>
                      <input type="number" value={currentLead.budget_estime || ''} onChange={e => setCurrentLead({...currentLead, budget_estime: parseFloat(e.target.value)})} className="nt-input w-full h-10 rounded-xl px-4 font-bold border outline-none" />
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 space-y-3">
                    <div className="flex justify-between items-center">
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Suivi Paiement</p>
                      {(currentLead.budget_estime || 0) > 0 && (
                        <span className="dm text-[11px] font-bold" style={{color: (currentLead.budget_estime||0)-(currentLead.montant_paye||0) <= 0 ? '#1aaa5a' : '#e53935'}}>
                          Reste : {Math.max(0, (currentLead.budget_estime||0)-(currentLead.montant_paye||0)).toLocaleString()} €
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">État Facture</label>
                        <select className="nt-select w-full rounded-xl px-3 py-2 text-sm font-medium h-10 outline-none" value={currentLead.etat_paiement || 'Attente acompte'} onChange={e => setCurrentLead({...currentLead, etat_paiement: e.target.value as any})}>
                          <option>Attente acompte</option><option>Acompte reçu</option><option>RGT/P</option><option>Soldé</option><option>Facture envoyée</option><option>Finalisé</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Déjà réglé (€)</label>
                        <input type="number" placeholder="0" className="nt-input w-full h-10 rounded-xl px-4 font-bold border outline-none" value={currentLead.montant_paye || ''} onChange={e => setCurrentLead({...currentLead, montant_paye: parseFloat(e.target.value)})} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Notes */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">04 · Notes Internes</p>
                  <textarea className="nt-input w-full rounded-xl p-4 text-sm min-h-[90px] resize-y border outline-none"
                    placeholder="Notes, spécificités, infos importantes..."
                    value={currentLead.commentaires || ''} onChange={e => setCurrentLead({...currentLead, commentaires: e.target.value})} />
                </div>
              </div>

              <div className="p-5 flex justify-end gap-3 shrink-0 border-t border-gray-100 bg-gray-50">
                <button onClick={() => setShowModal(false)} className="px-5 h-10 rounded-xl text-sm font-black text-gray-500 hover:text-gray-900 bg-white border border-gray-200 transition-all">
                  Annuler
                </button>
                <button onClick={handleSave} className="px-8 h-10 rounded-xl text-sm font-black bg-gray-900 text-white hover:bg-gray-800 transition-all">
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}