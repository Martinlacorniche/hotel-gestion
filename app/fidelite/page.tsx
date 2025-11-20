'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Search, User, Briefcase, Mail, Plus, Trophy, Calendar, 
  CreditCard, MessageSquare, Trash2, Edit2, ChevronLeft, 
  Check, Star, Crown, AlertCircle, Save, Stamp
} from 'lucide-react';

// --- TYPES ---
interface Client {
  id: string;
  nom: string;
  prenom: string;
  societe: string | null;
  email: string | null;
  total_passages: number;
  commentaire?: string | null;
}

interface Abonnement {
  client_id: string;
  date_debut: string;
  date_fin: string;
  date_paiement: string | null;
  prix: string | null;
  commentaire: string | null;
}

export default function FidelitePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClient, setNewClient] = useState({
    nom: '', prenom: '', societe: '', email: '', commentaire: ''
  });

  const [carte, setCarte] = useState<(string | null)[]>(Array(10).fill(null)); 
  const [editMode, setEditMode] = useState(false);

  // SECTION ABONNEMENT
  const [abonnement, setAbonnement] = useState<Abonnement | null>(null);
  const [aboEdit, setAboEdit] = useState(false);
  const [savingAbo, setSavingAbo] = useState(false);
  const abonnementActif = Boolean(abonnement);

  // Charger clients
  useEffect(() => {
    const fetchClients = async () => {
      const { data, error } = await supabase.from('clients').select('*').order('nom');
      if (!error && data) setClients(data as Client[]);
    };
    fetchClients();
  }, []);

  // Sélection client
  const selectClient = async (client: Client) => {
    setSelectedClient(client);
    // Carte fidélité
    const { data } = await supabase.from('fidelite').select('index_case,date_validation').eq('client_id', client.id).order('index_case');
    if (data) {
      const filled = Array(10).fill(null) as (string | null)[];
      data.forEach((d: any) => { filled[d.index_case - 1] = d.date_validation; });
      setCarte(filled);
    }
    // Abonnement
    const { data: abo, error: aboErr } = await supabase.from('abonnements').select('*').eq('client_id', client.id).maybeSingle();
    if (!aboErr && abo) {
      setAbonnement({
        client_id: client.id,
        date_debut: abo.date_debut ?? '',
        date_fin: abo.date_fin ?? '',
        date_paiement: abo.date_paiement ?? null,
        prix: abo.prix ? String(abo.prix) : null,
        commentaire: abo.commentaire ?? null,
      });
      setAboEdit(false);
    } else {
      setAbonnement(null);
      setAboEdit(false);
    }
  };

  // Toggle case
  const toggleCase = async (i: number) => {
    if (!selectedClient) return;
    const already = carte[i];
    const newCarte = [...carte];
    if (already) {
      await supabase.from('fidelite').delete().eq('client_id', selectedClient.id).eq('index_case', i + 1);
      newCarte[i] = null;
    } else {
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('fidelite').upsert({ client_id: selectedClient.id, index_case: i + 1, date_validation: today });
      newCarte[i] = today;
      await supabase.from('clients').update({ total_passages: (selectedClient.total_passages || 0) + 1 }).eq('id', selectedClient.id);
      setSelectedClient({ ...selectedClient, total_passages: (selectedClient.total_passages || 0) + 1 });
    }
    setCarte(newCarte);
  };

  // Reset carte
  const resetCarte = async () => {
    if (!selectedClient) return;
    await supabase.from('fidelite').delete().eq('client_id', selectedClient.id);
    setCarte(Array(10).fill(null));
  };

  // Save Abonnement
  const saveAbonnement = async () => {
    if (!selectedClient || !abonnement) return;
    if (!abonnement.date_debut || !abonnement.date_fin) { alert('Merci de renseigner les dates "Du" et "Au".'); return; }
    setSavingAbo(true);
    const payload = {
      client_id: selectedClient.id,
      date_debut: abonnement.date_debut,
      date_fin: abonnement.date_fin,
      date_paiement: abonnement.date_paiement || null,
      prix: abonnement.prix ? Number(abonnement.prix) : null,
      commentaire: abonnement.commentaire || null,
      updated_at: new Date().toISOString(),
    } as any;
    const { error } = await supabase.from('abonnements').upsert(payload);
    setSavingAbo(false);
    if (error) { alert("Impossible d'enregistrer l'abonnement"); return; }
    setAboEdit(false);
  };

  const deleteAbonnement = async () => {
    if (!selectedClient) return;
    if (!confirm('Supprimer les infos abonnement pour ce client ?')) return;
    await supabase.from('abonnements').delete().eq('client_id', selectedClient.id);
    setAbonnement(null);
    setAboEdit(false);
  };

  const filteredClients = clients
    .filter((c) => `${c.nom} ${c.prenom}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));

  return (
    <div className="flex h-screen bg-slate-50 font-sans overflow-hidden text-slate-900">
      
      {/* --- SIDEBAR (Liste Clients) --- */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm">
        {/* Header Sidebar */}
        <div className="p-4 border-b border-slate-100">
            <h1 className="text-xl font-extrabold text-slate-800 mb-4 flex items-center gap-2">
               <Crown className="w-6 h-6 text-indigo-600" /> Fidélité
            </h1>
            <div className="relative group">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 outline-none transition-all" 
                    placeholder="Rechercher..." 
                    value={search} 
                    onChange={(e) => setSearch(e.target.value)} 
                />
            </div>
        </div>

        {/* Liste Scrollable */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button 
                onClick={() => setShowClientModal(true)}
                className="w-full flex items-center justify-center gap-2 p-3 mb-2 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 font-bold hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
            >
                <Plus className="w-4 h-4" /> Nouveau Client
            </button>
            
            {filteredClients.map((c) => (
                <div
                    key={c.id}
                    onClick={() => selectClient(c)}
                    className={`
                        group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all
                        ${selectedClient?.id === c.id 
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
                            : 'hover:bg-slate-50 text-slate-700'
                        }
                    `}
                >
                    <div className="flex flex-col">
                        <span className="font-bold text-sm">{c.nom} {c.prenom}</span>
                        {c.societe && <span className={`text-xs truncate max-w-[180px] ${selectedClient?.id === c.id ? 'text-indigo-200' : 'text-slate-400'}`}>{c.societe}</span>}
                    </div>
                    {selectedClient?.id === c.id && <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>}
                </div>
            ))}
        </div>
      </div>

      {/* --- MAIN CONTENT --- */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">
         
         <div className="flex-1 overflow-y-auto p-4 md:p-8">
            {selectedClient ? (
                <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4 duration-300">
                    
                    {/* BOUTON RETOUR AU TOP 10 */}
                    <button 
                        onClick={() => setSelectedClient(null)} 
                        className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold transition-colors mb-2"
                    >
                        <ChevronLeft className="w-5 h-5" /> Retour au Top 10
                    </button>

                    {/* Header Fiche Client */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                        <div className="flex items-center gap-4">
                             <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600 flex items-center justify-center text-2xl font-extrabold shadow-inner">
                                 {selectedClient.prenom[0]}{selectedClient.nom[0]}
                             </div>
                             <div>
                                 <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                                     {selectedClient.prenom} {selectedClient.nom}
                                 </h2>
                                 <div className="flex flex-wrap gap-2 mt-1">
                                     {selectedClient.societe && (
                                         <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">
                                             <Briefcase className="w-3 h-3" /> {selectedClient.societe}
                                         </span>
                                     )}
                                     {selectedClient.email && (
                                         <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">
                                             <Mail className="w-3 h-3" /> {selectedClient.email}
                                         </span>
                                     )}
                                     <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-bold border border-amber-100">
                                         <Star className="w-3 h-3" /> {selectedClient.total_passages} passages
                                     </span>
                                 </div>
                             </div>
                        </div>
                        
                        <div className="flex gap-2">
                            <button onClick={() => { 
                                setNewClient({ nom: selectedClient.nom, prenom: selectedClient.prenom, societe: selectedClient.societe || '', email: selectedClient.email || '', commentaire: selectedClient.commentaire || '' });
                                setEditMode(true); setShowClientModal(true); 
                            }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition">
                                <Edit2 className="w-5 h-5" />
                            </button>
                            <button onClick={async () => { if (confirm('Supprimer ce client ?')) { await supabase.from('clients').delete().eq('id', selectedClient.id); setClients(clients.filter((c) => c.id !== selectedClient.id)); setSelectedClient(null); } }} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition">
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* CARTE DE FIDÉLITÉ STYLE "KRAFT" */}
                    <div className="flex justify-center py-4">
                        <div className="relative w-full max-w-md aspect-[1.6/1] bg-[#F3EFE0] rounded-2xl shadow-2xl border border-[#D8D0B8] flex flex-col overflow-hidden">
                            {/* Texture Papier (optionnel, simulé par la couleur) */}
                            
                            {/* Header Carte */}
                            <div className="p-5 border-b-2 border-dashed border-[#D8D0B8] flex justify-between items-end">
                                <div>
                                    <h3 className="font-black text-slate-800 uppercase tracking-widest text-lg">Fidélité</h3>
                                    <p className="text-[#8A8475] text-xs font-mono uppercase">Coworking Pass</p>
                                </div>
                                <div className="text-right">
                                    <span className="block text-xs text-[#8A8475] font-bold">10 passages</span>
                                    <span className="block text-xs text-indigo-600 font-bold">= 1 OFFERT</span>
                                </div>
                            </div>

                            {/* Grille Tampons */}
                            <div className="flex-1 p-6 grid grid-cols-5 gap-4 items-center justify-items-center">
                                {carte.map((date, i) => (
                                    <div
                                        key={i}
                                        onClick={() => toggleCase(i)}
                                        className={`
                                            w-12 h-12 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all duration-200
                                            ${date 
                                                ? 'border-indigo-600 bg-indigo-50/50 rotate-[-12deg]' 
                                                : 'border-dashed border-[#D8D0B8] hover:border-indigo-300'
                                            }
                                        `}
                                    >
                                        {date ? (
                                            <div className="flex flex-col items-center justify-center w-full h-full gap-0.5">
                                                {/* Icone Tampon */}
                                                <Stamp className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-800 opacity-90" strokeWidth={2.5} />
                                                {/* Date du tampon */}
                                                <span className="text-[8px] sm:text-[9px] text-indigo-900 font-black font-mono rotate-1 leading-none">
                                                    {format(new Date(date), 'dd/MM')}
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="text-[#D8D0B8] font-bold text-sm">{i + 1}</span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Footer Carte (Cadeau) */}
                            {carte.every(Boolean) && (
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10 animate-in fade-in duration-300">
                                    <div className="bg-white p-6 rounded-2xl shadow-2xl text-center transform scale-110">
                                        <div className="text-4xl mb-2">🎁</div>
                                        <h3 className="text-xl font-extrabold text-slate-800 mb-1">Félicitations !</h3>
                                        <p className="text-slate-500 text-sm mb-4">Le prochain passage est offert.</p>
                                        <button onClick={resetCarte} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-full font-bold shadow-lg transition">
                                            Utiliser le cadeau
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ABONNEMENT */}
                    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
                         <div className="flex items-center justify-between mb-6">
                             <div className="flex items-center gap-3">
                                 <div className={`p-2 rounded-xl ${abonnementActif ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-400'}`}>
                                     <CreditCard className="w-5 h-5" />
                                 </div>
                                 <div>
                                     <h3 className="font-bold text-slate-800">Abonnement</h3>
                                     <p className="text-xs text-slate-500">Gestion mensuelle</p>
                                 </div>
                             </div>
                             <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={abonnementActif} onChange={(e) => {
                                    if (e.target.checked) {
                                        setAbonnement({ client_id: selectedClient.id, date_debut: '', date_fin: '', date_paiement: null, prix: null, commentaire: null });
                                        setAboEdit(true);
                                    } else {
                                        setAbonnement(null); setAboEdit(false);
                                    }
                                }} />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                             </label>
                         </div>

                         {abonnementActif && abonnement && (
                             <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 animate-in slide-in-from-top-2">
                                 {/* MODE LECTURE */}
                                 {!aboEdit ? (
                                     <div className="space-y-4">
                                         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                             <div><span className="text-xs font-bold text-slate-400 uppercase">Début</span><div className="font-bold text-slate-800">{abonnement.date_debut ? format(new Date(abonnement.date_debut), 'dd MMM yyyy', {locale:fr}) : '-'}</div></div>
                                             <div><span className="text-xs font-bold text-slate-400 uppercase">Fin</span><div className="font-bold text-slate-800">{abonnement.date_fin ? format(new Date(abonnement.date_fin), 'dd MMM yyyy', {locale:fr}) : '-'}</div></div>
                                             <div><span className="text-xs font-bold text-slate-400 uppercase">Payé le</span><div className={`font-bold ${abonnement.date_paiement ? 'text-green-600' : 'text-red-400'}`}>{abonnement.date_paiement ? format(new Date(abonnement.date_paiement), 'dd MMM', {locale:fr}) : 'Non payé'}</div></div>
                                             <div><span className="text-xs font-bold text-slate-400 uppercase">Prix</span><div className="font-bold text-slate-800">{abonnement.prix ? `${abonnement.prix} €` : '-'}</div></div>
                                         </div>
                                         {abonnement.commentaire && (
                                             <div className="bg-white p-3 rounded-xl border border-slate-200 text-sm text-slate-600 italic flex gap-2">
                                                 <MessageSquare className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
                                                 {abonnement.commentaire}
                                             </div>
                                         )}
                                         <div className="flex gap-3 pt-2">
                                             <button onClick={() => setAboEdit(true)} className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"><Edit2 className="w-3 h-3"/> Modifier</button>
                                             <button onClick={deleteAbonnement} className="text-xs font-bold text-red-500 hover:underline flex items-center gap-1"><Trash2 className="w-3 h-3"/> Supprimer</button>
                                         </div>
                                     </div>
                                 ) : (
                                     /* MODE ÉDITION */
                                     <div className="space-y-4">
                                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                             <div><label className="text-xs font-bold text-slate-500 uppercase">Du</label><input type="date" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" value={abonnement.date_debut} onChange={(e) => setAbonnement({ ...abonnement, date_debut: e.target.value })} /></div>
                                             <div><label className="text-xs font-bold text-slate-500 uppercase">Au</label><input type="date" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" value={abonnement.date_fin} onChange={(e) => setAbonnement({ ...abonnement, date_fin: e.target.value })} /></div>
                                             <div><label className="text-xs font-bold text-slate-500 uppercase">Paiement</label><input type="date" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" value={abonnement.date_paiement || ''} onChange={(e) => setAbonnement({ ...abonnement, date_paiement: e.target.value || null })} /></div>
                                             <div><label className="text-xs font-bold text-slate-500 uppercase">Prix (€)</label><input type="number" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" value={abonnement.prix || ''} onChange={(e) => setAbonnement({ ...abonnement, prix: e.target.value })} /></div>
                                         </div>
                                         <div><label className="text-xs font-bold text-slate-500 uppercase">Note</label><textarea className="w-full border rounded-lg px-3 py-2 text-sm bg-white resize-none" rows={2} value={abonnement.commentaire || ''} onChange={(e) => setAbonnement({ ...abonnement, commentaire: e.target.value })} /></div>
                                         <div className="flex gap-2 justify-end">
                                             <button onClick={() => { selectClient(selectedClient); /* Reset */ }} className="px-4 py-2 rounded-lg text-slate-500 font-bold hover:bg-white transition text-sm">Annuler</button>
                                             <button onClick={saveAbonnement} disabled={savingAbo} className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition text-sm shadow-md">{savingAbo ? '...' : 'Enregistrer'}</button>
                                         </div>
                                     </div>
                                 )}
                             </div>
                         )}
                    </div>

                </div>
            ) : (
                // --- DASHBOARD / TOP 10 ---
                <div className="h-full flex flex-col items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8 w-full max-w-2xl max-h-full flex flex-col">
                        <div className="text-center mb-6 shrink-0">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50 text-amber-500 mb-4 ring-4 ring-amber-50/50">
                                <Trophy className="w-8 h-8" />
                            </div>
                            <h2 className="text-3xl font-extrabold text-slate-800">Les Champions</h2>
                            <p className="text-slate-500">Top 10 des clients fidèles</p>
                        </div>

                        {/* LISTE TOP 10 SCROLLABLE */}
                        <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar">
                            {clients
                                .sort((a, b) => b.total_passages - a.total_passages)
                                .slice(0, 10) // Remis à 10 !
                                .map((c, i, arr) => {
                                    const max = arr[0]?.total_passages || 1;
                                    const percent = Math.round((c.total_passages / max) * 100);
                                    const medalColor = i === 0 ? 'bg-amber-100 text-amber-700 border-amber-200' : i === 1 ? 'bg-slate-100 text-slate-700 border-slate-200' : i === 2 ? 'bg-orange-100 text-orange-800 border-orange-200' : 'bg-white text-slate-500 border-transparent';
                                    
                                    return (
                                        <div key={c.id} onClick={() => selectClient(c)} className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-all">
                                            <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-bold border ${medalColor}`}>
                                                {i + 1}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-end mb-1">
                                                    <span className="font-bold text-slate-800 group-hover:text-indigo-600 transition">{c.nom} {c.prenom}</span>
                                                    <span className="text-xs font-bold text-slate-400">{c.total_passages} passages</span>
                                                </div>
                                                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${percent}%` }}></div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            }
                        </div>
                    </div>
                </div>
            )}
         </div>
      </div>

      {/* MODAL CLIENT */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-3xl w-full max-w-md space-y-5 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h2 className="text-2xl font-bold text-slate-800">{editMode ? 'Modifier client' : 'Nouveau client'}</h2>
            
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Nom" value={newClient.nom} onChange={(e) => setNewClient({ ...newClient, nom: e.target.value })} />
                    <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Prénom" value={newClient.prenom} onChange={(e) => setNewClient({ ...newClient, prenom: e.target.value })} />
                </div>
                <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Société" value={newClient.societe} onChange={(e) => setNewClient({ ...newClient, societe: e.target.value })} />
                <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />
                <textarea className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 resize-none" placeholder="Note..." rows={3} value={newClient.commentaire} onChange={(e) => setNewClient({ ...newClient, commentaire: e.target.value })} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button className="px-5 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-50 transition" onClick={() => { setShowClientModal(false); setEditMode(false); }}>Annuler</button>
              <button className="px-5 py-3 rounded-xl bg-indigo-600 text-white font-bold shadow-lg hover:bg-indigo-700 transition"
                onClick={async () => {
                  if (editMode && selectedClient) {
                    const { data, error } = await supabase.from('clients').update(newClient).eq('id', selectedClient.id).select().single();
                    if (!error && data) { setClients(clients.map((c) => (c.id === (data as any).id ? (data as any) : c))); setSelectedClient(data as any); }
                  } else {
                    const { data, error } = await supabase.from('clients').insert([{ ...newClient, total_passages: 0 }]).select().single();
                    if (!error && data) setClients([...clients, data as any]);
                  }
                  setShowClientModal(false); setEditMode(false); setNewClient({ nom: '', prenom: '', societe: '', email: '', commentaire: '' });
                }}
              >
                {editMode ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}