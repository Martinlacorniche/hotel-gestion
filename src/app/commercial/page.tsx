'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient'; 
import { useAuth } from '@/context/AuthContext';
import { format, isBefore, isToday, parseISO, getYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Search, PlusCircle, Phone, Mail, Clock, 
  Edit2, Trash2, XCircle, CalendarDays, ChevronDown, User, MessageSquareText, CreditCard, Wallet, Check 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// --- TYPES ---
interface Lead {
  id: string;
  created_at: string;
  nom_client: string;
  email?: string;
  telephone?: string;
  titre_demande: string;
  statut: 'Nouveau' | 'Devis envoyé' | 'En négo' | 'Gagné' | 'Perdu';
  etat_paiement?: 'À demander' | 'En attente réception' | 'À vérifier' | 'Facture envoyée' | 'OK';
  budget_estime?: number;
  montant_paye?: number; 
  date_relance?: string | null;
  date_evenement?: string | null;
  commentaires?: string;
  updated_at?: string;
  updated_by?: string;
  hotel_id?: string;
}

const STATUS_COLORS: Record<string, string> = {
  'Nouveau': 'bg-blue-500',
  'Devis envoyé': 'bg-amber-400',
  'En négo': 'bg-purple-500',
  'Gagné': 'bg-emerald-500',
  'Perdu': 'bg-red-500',
};

const PAYMENT_COLORS: Record<string, string> = {
  'À demander': 'bg-red-500',
  'En attente réception': 'bg-orange-400',
  'À vérifier': 'bg-amber-500',
  'Facture envoyée': 'bg-blue-400',
  'OK': 'bg-emerald-500',
};

export default function CommercialDashboard() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [filterStatut, setFilterStatut] = useState<string>('Tous');
  
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);     
  const [openPaymentId, setOpenPaymentId] = useState<string | null>(null); 
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [openFinanceId, setOpenFinanceId] = useState<string | null>(null); 

  const [tempFinance, setTempFinance] = useState({ budget: 0, paye: 0 });

  const [currentLead, setCurrentLead] = useState<Partial<Lead>>({
    statut: 'Nouveau',
    etat_paiement: 'À demander',
    budget_estime: 0,
    montant_paye: 0,
    date_relance: '',
    date_evenement: ''
  });

  const fetchLeads = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('suivi_commercial').select('*');
    if (!error && data) setLeads(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const getUpdateTrace = () => ({
    updated_at: new Date().toISOString(),
    updated_by: (user as any)?.name || 'Staff'
  });

  const handleQuickStatusChange = async (id: string, newStatut: string) => {
    setOpenMenuId(null);
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, statut: newStatut as any, ...trace } : l));
    await supabase.from('suivi_commercial').update({ statut: newStatut, ...trace }).eq('id', id);
    fetchLeads();
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
      date_relance: currentLead.date_relance === '' ? null : currentLead.date_relance,
      date_evenement: currentLead.date_evenement === '' ? null : currentLead.date_evenement,
      ...trace
    };

    if (currentLead.id) {
      const { error } = await supabase.from('suivi_commercial').update(payload).eq('id', currentLead.id);
      if (error) alert(error.message);
    } else {
      const { error } = await supabase.from('suivi_commercial').insert([{ ...payload, created_at: new Date().toISOString() }]);
      if (error) alert(error.message);
    }
    setShowModal(false);
    fetchLeads();
    setCurrentLead({ statut: 'Nouveau', etat_paiement: 'À demander', budget_estime: 0, montant_paye: 0, date_relance: '', date_evenement: '' });
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
      
      // LOGIQUE DES FILTRES REGROUPÉS
      let matchFilter = false;
      if (filterStatut === 'Tous') matchFilter = true;
      else if (filterStatut === 'Pipeline') matchFilter = ['Nouveau', 'Devis envoyé', 'En négo'].includes(l.statut);
      else matchFilter = l.statut === filterStatut;

      if (l.etat_paiement === 'OK') {
         const lastUpdate = l.updated_at ? parseISO(l.updated_at) : parseISO(l.created_at);
         if (!isToday(lastUpdate)) return false; 
      }
      return matchSearch && matchFilter;
    });

    return filtered.sort((a, b) => {
      const statusA = getRelanceStatus(a.date_relance, a.statut);
      const statusB = getRelanceStatus(b.date_relance, b.statut);
      const isUrgentA = statusA === 'late' || statusA === 'today';
      const isUrgentB = statusB === 'late' || statusB === 'today';
      if (isUrgentA && !isUrgentB) return -1;
      if (!isUrgentA && isUrgentB) return 1;
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
      return dateB - dateA;
    });
  }, [leads, searchTerm, filterStatut]);

  const stats = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const pipeline = leads.filter(l => !['Gagné', 'Perdu'].includes(l.statut)).reduce((acc, curr) => acc + (curr.budget_estime || 0), 0);
    const won = leads.filter(l => l.statut === 'Gagné' && getYear(parseISO(l.created_at)) === currentYear).reduce((acc, curr) => acc + (curr.budget_estime || 0), 0);
    const lost = leads.filter(l => l.statut === 'Perdu' && getYear(parseISO(l.created_at)) === currentYear).reduce((acc, curr) => acc + (curr.budget_estime || 0), 0);
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
      
      {/* HEADER & KPIS */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end mb-8 gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Suivi Commercial</h1>
          <p className="text-sm text-slate-500 mt-1">Actions prioritaires en haut de liste.</p>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 w-full xl:w-auto">
           <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
             <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">En retard</span>
             <span className="text-xl font-bold text-slate-800">{stats.lateCount}</span>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
             <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wider">À relancer</span>
             <span className="text-xl font-bold text-slate-800">{stats.todayCount}</span>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-blue-100 flex flex-col items-center justify-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
             <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Pipeline</span>
             <span className="text-lg font-bold text-slate-800">{stats.pipeline.toLocaleString()} €</span>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-emerald-100 flex flex-col items-center justify-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
             <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Gagné (An)</span>
             <span className="text-lg font-bold text-emerald-700">+{stats.won.toLocaleString()} €</span>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-red-50 flex flex-col items-center justify-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-1 h-full bg-red-400"></div>
             <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Perdu (An)</span>
             <span className="text-lg font-bold text-red-400">-{stats.lost.toLocaleString()} €</span>
          </div>
        </div>
      </div>

      {/* FILTRES REGROUPÉS */}
      <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
        <div className="flex gap-2 w-full md:w-auto">
            {['Tous', 'Pipeline', 'Gagné', 'Perdu'].map(st => (
                <button 
                    key={st}
                    onClick={(e) => { e.stopPropagation(); setFilterStatut(st); }}
                    className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${filterStatut === st ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                >
                    {st}
                </button>
            ))}
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input placeholder="Rechercher..." className="pl-9 bg-white rounded-full shadow-sm border-slate-200" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <Button 
                onClick={(e) => { e.stopPropagation(); setCurrentLead({ statut: 'Nouveau', etat_paiement: 'À demander', budget_estime: 0, montant_paye: 0, date_relance: '', date_evenement: '' }); setShowModal(true); }} 
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg shadow-indigo-200 px-6 whitespace-nowrap"
            >
                <PlusCircle className="mr-2 h-4 w-4" /> Nouveau
            </Button>
        </div>
      </div>

      {/* LISTE */}
      <div className="space-y-3 pb-20">
        {loading ? <div className="text-center py-10 text-slate-400">Chargement...</div> : sortedLeads.map((lead) => {
          const relanceStatus = getRelanceStatus(lead.date_relance, lead.statut);
          const isMenuOpen = openMenuId === lead.id;
          const isPaymentOpen = openPaymentId === lead.id;
          const isCommentOpen = openCommentId === lead.id;
          const isFinanceOpen = openFinanceId === lead.id;
          const hasComment = lead.commentaires && lead.commentaires.trim().length > 0;
          
          const budget = lead.budget_estime || 0;
          const paye = lead.montant_paye || 0;
          const reste = Math.max(0, budget - paye);
          const isPaid = budget > 0 && reste === 0;

          return (
            <div 
              key={lead.id} 
              className={`group bg-white border rounded-xl p-4 transition-all hover:shadow-md relative
                ${relanceStatus === 'late' ? 'border-l-4 border-l-red-500' : 
                  relanceStatus === 'today' ? 'border-l-4 border-l-orange-400' : 
                  'border-l-4 border-l-slate-200 border-slate-100'}
              `}
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                <div className="md:col-span-3 flex flex-col">
                    <span className="font-bold text-slate-800 text-base truncate">{lead.nom_client}</span>
                    <span className="text-sm font-medium text-slate-500 truncate">{lead.titre_demande}</span>
                    {lead.updated_by && (
                        <span className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {format(new Date(lead.updated_at || lead.created_at), 'dd/MM')} - {lead.updated_by}
                        </span>
                    )}
                </div>

                <div className="md:col-span-2 flex items-center md:justify-start">
                    {lead.date_evenement ? (
                        <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100 text-slate-600">
                            <CalendarDays className="w-3.5 h-3.5 text-indigo-500" />
                            <span className="text-xs font-bold">
                                {format(parseISO(lead.date_evenement), 'dd MMM yy', { locale: fr })}
                            </span>
                        </div>
                    ) : <span className="text-xs text-slate-300 italic px-2">--/--/--</span>}
                </div>

                 <div className="md:col-span-1 flex flex-col justify-center items-center relative">
                     <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            setTempFinance({ budget: lead.budget_estime || 0, paye: lead.montant_paye || 0 });
                            setOpenFinanceId(isFinanceOpen ? null : lead.id);
                            setOpenMenuId(null); setOpenPaymentId(null); setOpenCommentId(null);
                        }}
                        className="flex flex-col items-center hover:bg-slate-50 p-1.5 rounded-lg transition-colors cursor-pointer w-full"
                     >
                         {budget > 0 ? (
                             <>
                                <span className="font-bold text-slate-700 text-xs">{budget.toLocaleString()} €</span>
                                {isPaid ? (
                                    <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 rounded-full mt-0.5">Payé 100%</span>
                                ) : (
                                    paye > 0 ? (
                                        <span className="text-[10px] text-red-500 font-bold mt-0.5 whitespace-nowrap">
                                            Reste: {reste.toLocaleString()} €
                                        </span>
                                    ) : null
                                )}
                             </>
                         ) : <span className="text-slate-300">-</span>}
                     </button>

                     {isFinanceOpen && (
                        <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-xl p-3 animate-in fade-in zoom-in-95 duration-200 cursor-default" onClick={e => e.stopPropagation()}>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 uppercase">Budget</label>
                                    <div className="relative">
                                        <Input 
                                            type="number" className="h-7 text-xs pr-6" 
                                            value={tempFinance.budget || ''}
                                            onChange={(e) => setTempFinance({ ...tempFinance, budget: parseFloat(e.target.value) })}
                                        />
                                        <span className="absolute right-2 top-1.5 text-[10px] text-slate-400">€</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 uppercase">Déjà Payé</label>
                                    <div className="relative">
                                        <Input 
                                            type="number" className="h-7 text-xs pr-6 bg-slate-50 border-indigo-200" 
                                            autoFocus
                                            value={tempFinance.paye || ''}
                                            onChange={(e) => setTempFinance({ ...tempFinance, paye: parseFloat(e.target.value) })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') saveQuickFinance(lead.id); }}
                                        />
                                        <span className="absolute right-2 top-1.5 text-[10px] text-slate-400">€</span>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center pt-1">
                                    <span className={`text-[10px] font-bold ${tempFinance.budget - tempFinance.paye <= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                                        Reste: {Math.max(0, tempFinance.budget - tempFinance.paye)} €
                                    </span>
                                    <Button size="sm" className="h-6 w-6 p-0 rounded-full bg-indigo-600 hover:bg-indigo-700" onClick={() => saveQuickFinance(lead.id)}>
                                        <Check className="w-3 h-3 text-white" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                     )}
                </div>

                <div className="md:col-span-2 relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : lead.id); setOpenPaymentId(null); setOpenCommentId(null); setOpenFinanceId(null); }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:border-indigo-300 transition-colors shadow-sm w-full justify-between"
                    >
                        <div className="flex items-center gap-2 overflow-hidden">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[lead.statut] || 'bg-slate-300'}`} />
                            <span className="text-xs font-bold text-slate-700 uppercase tracking-tight truncate">{lead.statut}</span>
                        </div>
                        <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
                    </button>

                    {isMenuOpen && (
                        <div className="absolute z-50 top-full left-0 mt-2 w-48 bg-white border border-slate-100 rounded-xl shadow-xl p-1 animate-in fade-in zoom-in-95 duration-200">
                            {['Nouveau', 'Devis envoyé', 'En négo', 'Gagné', 'Perdu'].map((status) => (
                                <button
                                    key={status}
                                    onClick={(e) => { e.stopPropagation(); handleQuickStatusChange(lead.id, status); }}
                                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 hover:bg-slate-50 transition-colors text-slate-600"
                                >
                                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
                                    {status}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="md:col-span-2 relative">
                    {lead.statut === 'Gagné' ? (
                        <>
                            <button 
                                onClick={(e) => { e.stopPropagation(); setOpenPaymentId(isPaymentOpen ? null : lead.id); setOpenMenuId(null); setOpenCommentId(null); setOpenFinanceId(null); }}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-full border border-slate-100 bg-slate-50 hover:bg-white hover:border-indigo-300 transition-colors shadow-sm w-full"
                            >
                                <CreditCard className="w-3 h-3 text-slate-400" />
                                <span className="flex-1 text-left text-[10px] font-bold text-slate-600 uppercase truncate">
                                    {lead.etat_paiement || 'À demander'}
                                </span>
                                <div className={`w-2 h-2 rounded-full ${PAYMENT_COLORS[lead.etat_paiement || 'À demander']}`} />
                            </button>

                            {isPaymentOpen && (
                                <div className="absolute z-50 top-full left-0 mt-2 w-56 bg-white border border-slate-100 rounded-xl shadow-xl p-1 animate-in fade-in zoom-in-95 duration-200">
                                    {['À demander', 'En attente réception', 'À vérifier', 'Facture envoyée', 'OK'].map((payStatus) => (
                                        <button
                                            key={payStatus}
                                            onClick={(e) => { e.stopPropagation(); handleQuickPaymentChange(lead.id, payStatus); }}
                                            className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between hover:bg-slate-50 transition-colors text-slate-600"
                                        >
                                            {payStatus}
                                            <span className={`w-2 h-2 rounded-full ${PAYMENT_COLORS[payStatus]}`} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="h-8" />
                    )}
                </div>

                <div className="md:col-span-2 flex items-center justify-end gap-2">
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setOpenCommentId(isCommentOpen ? null : lead.id); setOpenMenuId(null); setOpenPaymentId(null); setOpenFinanceId(null); }}
                            className={`p-1.5 rounded-lg transition-colors ${hasComment ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100' : 'text-slate-300 hover:text-slate-500'}`}
                        >
                            <MessageSquareText className="w-4 h-4" fill={hasComment ? "currentColor" : "none"} />
                        </button>
                        
                        {isCommentOpen && hasComment && (
                            <div className="absolute z-50 bottom-full right-0 mb-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-3 animate-in fade-in zoom-in-95 duration-200">
                                <div className="text-xs font-bold text-slate-400 uppercase mb-2">Note</div>
                                <div className="text-sm text-slate-700 whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar">
                                    {lead.commentaires}
                                </div>
                            </div>
                        )}
                    </div>

                    {!['Gagné', 'Perdu'].includes(lead.statut) && lead.date_relance && (
                        <div className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-1 rounded-md ${
                            relanceStatus === 'late' ? 'bg-red-50 text-red-600' : 
                            relanceStatus === 'today' ? 'bg-orange-50 text-orange-600' : 'text-slate-400'
                        }`}>
                            <Clock className="w-3 h-3" />
                            {format(parseISO(lead.date_relance), 'dd/MM')}
                        </div>
                    )}
                    
                    <button onClick={(e) => { e.stopPropagation(); setCurrentLead(lead); setShowModal(true); }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                        <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL (Inchangée, avec Date Relance) */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-lg space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-2">
               <h2 className="text-lg font-bold text-slate-800">Détails Dossier</h2>
               <button onClick={() => setShowModal(false)}><XCircle className="w-5 h-5 text-slate-400 hover:text-slate-600"/></button>
            </div>

            <div className="space-y-3">
                 <Input placeholder="Client / Société" value={currentLead.nom_client || ''} onChange={e => setCurrentLead({...currentLead, nom_client: e.target.value})} className="font-bold bg-slate-50 border-slate-200" />
                 <Input placeholder="Titre événement" value={currentLead.titre_demande || ''} onChange={e => setCurrentLead({...currentLead, titre_demande: e.target.value})} />
                 
                 <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Date Événement</label>
                        <Input type="date" value={currentLead.date_evenement || ''} onChange={e => setCurrentLead({...currentLead, date_evenement: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-indigo-600 uppercase flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Prochaine Relance
                        </label>
                        <Input type="date" value={currentLead.date_relance || ''} onChange={e => setCurrentLead({...currentLead, date_relance: e.target.value})} className="border-indigo-100 focus:ring-indigo-500" />
                    </div>
                 </div>

                 <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Budget (€)</label>
                        <Input type="number" value={currentLead.budget_estime || ''} onChange={e => setCurrentLead({...currentLead, budget_estime: parseFloat(e.target.value)})} />
                    </div>
                    <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase">Statut Commercial</label>
                         <select 
                            className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-white h-10"
                            value={currentLead.statut || 'Nouveau'}
                            onChange={e => setCurrentLead({...currentLead, statut: e.target.value as any})}
                         >
                            <option>Nouveau</option>
                            <option>Devis envoyé</option>
                            <option>En négo</option>
                            <option>Gagné</option>
                            <option>Perdu</option>
                        </select>
                    </div>
                 </div>

                 <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-3">
                     <div className="flex justify-between items-center">
                         <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                             <Wallet className="w-3 h-3" /> Suivi Paiement
                         </label>
                         {(currentLead.budget_estime || 0) > 0 && (
                            <span className={`text-xs font-bold ${(currentLead.budget_estime || 0) - (currentLead.montant_paye || 0) <= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                Reste : {Math.max(0, (currentLead.budget_estime || 0) - (currentLead.montant_paye || 0)).toLocaleString()} €
                            </span>
                         )}
                     </div>
                     
                     <div className="grid grid-cols-2 gap-3">
                        <div>
                             <label className="text-[9px] text-slate-400 uppercase mb-1 block">État Facture</label>
                             <select 
                                className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-white"
                                value={currentLead.etat_paiement || 'À demander'}
                                onChange={e => setCurrentLead({...currentLead, etat_paiement: e.target.value as any})}
                             >
                                <option>À demander</option>
                                <option>En attente réception</option>
                                <option>À vérifier</option>
                                <option>Facture envoyée</option>
                                <option>OK</option>
                            </select>
                        </div>
                        <div>
                             <label className="text-[9px] text-slate-400 uppercase mb-1 block">Déjà réglé (Acompte)</label>
                             <div className="relative">
                                <Input 
                                    type="number" 
                                    placeholder="0" 
                                    className="h-8 bg-white"
                                    value={currentLead.montant_paye || ''} 
                                    onChange={e => setCurrentLead({...currentLead, montant_paye: parseFloat(e.target.value)})} 
                                />
                                <span className="absolute right-3 top-2 text-xs text-slate-400">€</span>
                             </div>
                        </div>
                     </div>
                 </div>

                 <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="Email" value={currentLead.email || ''} onChange={e => setCurrentLead({...currentLead, email: e.target.value})} />
                    <Input placeholder="Téléphone" value={currentLead.telephone || ''} onChange={e => setCurrentLead({...currentLead, telephone: e.target.value})} />
                 </div>
                 
                 <textarea className="w-full border border-slate-200 rounded-lg p-3 text-sm h-24 resize-none focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Notes & commentaires..." value={currentLead.commentaires || ''} onChange={e => setCurrentLead({...currentLead, commentaires: e.target.value})} />
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white w-full shadow-md">Enregistrer</Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}