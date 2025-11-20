"use client";

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { 
  Search, Plus, Key, Globe, Copy, Eye, EyeOff, 
  Trash2, Edit2, Shield, Check, Save, Lock, User 
} from 'lucide-react';

// --- TYPES ---
type TrousseauEntry = {
  id: string;
  outil: string;
  identifiant: string;
  mot_de_passe: string;
  commentaire?: string;
  url?: string;
  hotel_id: string;
};

export default function TrousseauPage() {
  const { user } = useAuth();

  // --- ÉTATS GLOBAUX ---
  const [hotels, setHotels] = useState<any[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>(() => {
    if (typeof window !== "undefined") return window.localStorage.getItem("selectedHotelId") || "";
    return "";
  });
  const [currentHotel, setCurrentHotel] = useState<any | null>(null);
  const [entries, setEntries] = useState<TrousseauEntry[]>([]);
  const [search, setSearch] = useState("");

  // --- ÉTATS UI ---
  const [selectedEntry, setSelectedEntry] = useState<TrousseauEntry | null>(null);
  const [showPassword, setShowPassword] = useState(false); // Masquer/Afficher MDP
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // --- ÉTATS MODAL / ÉDITION ---
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState({
    outil: '', identifiant: '', mot_de_passe: '', commentaire: '', url: ''
  });
  const [errorMsg, setErrorMsg] = useState('');

  // --- EFFETS ---
  useEffect(() => {
    const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : '';
    document.title = `Trousseau${hotelName}`;
  }, [currentHotel]);

  useEffect(() => {
    if (selectedHotelId && typeof window !== "undefined") {
      window.localStorage.setItem('selectedHotelId', selectedHotelId);
    }
  }, [selectedHotelId]);

  useEffect(() => {
    supabase.from('hotels').select('id, nom').then(({ data }) => {
        setHotels(data || []);
        if(!selectedHotelId && data && data.length > 0) setSelectedHotelId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (selectedHotelId) {
      supabase.from('hotels').select('id, nom').eq('id', selectedHotelId).single().then(({ data }) => setCurrentHotel(data));
      fetchTrousseau();
    }
  }, [selectedHotelId]);

  // --- LOGIQUE ---

  async function fetchTrousseau() {
    const { data } = await supabase
      .from('trousseau')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .order('outil', { ascending: true });
    setEntries(data || []);
  }

  function handleSelect(entry: TrousseauEntry) {
      setSelectedEntry(entry);
      setShowPassword(false); // Reset sécurité au changement
  }

  function handleCreate() {
      setEditingId(null);
      setNewEntry({ outil: '', identifiant: '', mot_de_passe: '', commentaire: '', url: '' });
      setErrorMsg('');
      setShowModal(true);
  }

  function handleEdit(entry: TrousseauEntry) {
      setEditingId(entry.id);
      setNewEntry({
        outil: entry.outil,
        identifiant: entry.identifiant,
        mot_de_passe: entry.mot_de_passe,
        commentaire: entry.commentaire || '',
        url: entry.url || '',
      });
      setErrorMsg('');
      setShowModal(true);
  }

  async function deleteEntry(id: string) {
      if (!confirm("Supprimer cette entrée ?")) return;
      await supabase.from('trousseau').delete().eq('id', id);
      fetchTrousseau();
      if (selectedEntry?.id === id) setSelectedEntry(null);
  }

  function copyToClipboard(text: string, fieldId: string) {
      navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 1500);
  }

  function normalizeUrl(u: string) {
    const s = (u || '').trim();
    if (!s) return null;
    const hasScheme = /^https?:\/\//i.test(s);
    return hasScheme ? s : `https://${s}`;
  }

  async function createOrUpdateEntry() {
    setErrorMsg('');
    if (!newEntry.outil || !newEntry.identifiant || !newEntry.mot_de_passe) {
      setErrorMsg("Champs obligatoires manquants.");
      return;
    }

    const payload = {
        outil: newEntry.outil,
        identifiant: newEntry.identifiant,
        mot_de_passe: newEntry.mot_de_passe,
        commentaire: newEntry.commentaire,
        url: normalizeUrl(newEntry.url),
        hotel_id: selectedHotelId,
    };

    if (!editingId) {
      // Vérif doublon
      const { data: existing } = await supabase.from('trousseau').select('id').eq('hotel_id', selectedHotelId).eq('outil', newEntry.outil).eq('identifiant', newEntry.identifiant).limit(1);
      if (existing && existing.length > 0) { setErrorMsg("Cet outil/identifiant existe déjà."); return; }
      
      const { data, error } = await supabase.from('trousseau').insert(payload).select().single();
      if (error) { setErrorMsg("Erreur ajout."); return; }
      if (data) { setEntries([...entries, data]); setSelectedEntry(data); }
    } else {
      const { data, error } = await supabase.from('trousseau').update(payload).eq('id', editingId).select().single();
      if (error) { setErrorMsg("Erreur mise à jour."); return; }
      if (data) { 
          setEntries(entries.map(e => e.id === editingId ? data : e));
          setSelectedEntry(data);
      }
    }
    setShowModal(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.outil.toLowerCase().includes(q) ||
      e.identifiant.toLowerCase().includes(q) ||
      (e.commentaire && e.commentaire.toLowerCase().includes(q))
    );
  }, [search, entries]);

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* --- SIDEBAR (Liste) --- */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm">
         
         {/* Header Sidebar */}
         <div className="p-4 border-b border-slate-100 space-y-4">
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                        <Key className="w-6 h-6 text-indigo-600" /> Trousseau
                    </h1>
                    <button onClick={handleCreate} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition" title="Nouvelle clé">
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
                {hotels.length > 1 && (
                    <select 
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold py-2 px-3 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
                        value={selectedHotelId}
                        onChange={(e) => { setSelectedHotelId(e.target.value); setSelectedEntry(null); }}
                    >
                        {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
                    </select>
                )}
            </div>

            <div className="relative group">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all" 
                    placeholder="Rechercher un outil..." 
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>
         </div>

         {/* Liste Scrollable */}
         <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.length === 0 && <div className="text-center text-xs text-slate-400 py-8 italic">Aucun identifiant trouvé.</div>}
            
            {filtered.map(entry => (
                <div 
                    key={entry.id}
                    onClick={() => handleSelect(entry)}
                    className={`
                        group p-3 rounded-xl cursor-pointer transition-all border border-transparent flex items-center gap-3
                        ${selectedEntry?.id === entry.id 
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
                            : 'hover:bg-slate-50 text-slate-700 hover:border-slate-100'
                        }
                    `}
                >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${selectedEntry?.id === entry.id ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-600'}`}>
                        {entry.outil.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                        <h3 className="font-bold text-sm truncate">{entry.outil}</h3>
                        <p className={`text-xs truncate mt-0.5 ${selectedEntry?.id === entry.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                            {entry.identifiant}
                        </p>
                    </div>
                </div>
            ))}
         </div>
      </div>

      {/* --- MAIN CONTENT (Détails) --- */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 relative items-center justify-center p-6">
          
          {selectedEntry ? (
              <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
                  
                  {/* Header Card */}
                  <div className="bg-slate-900 p-6 flex justify-between items-start relative overflow-hidden">
                      {/* Background Pattern */}
                      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-20 -mr-10 -mt-10"></div>
                      
                      <div className="flex items-center gap-4 relative z-10">
                          <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center text-2xl font-bold text-white border border-white/10 shadow-inner">
                              {selectedEntry.outil.substring(0, 1).toUpperCase()}
                          </div>
                          <div>
                              <h2 className="text-2xl font-extrabold text-white">{selectedEntry.outil}</h2>
                              {selectedEntry.url && (
                                  <a href={selectedEntry.url} target="_blank" rel="noopener noreferrer" className="text-indigo-300 text-xs font-medium hover:text-white flex items-center gap-1 mt-1 transition-colors">
                                      <Globe className="w-3 h-3" /> Ouvrir le lien
                                  </a>
                              )}
                          </div>
                      </div>

                      <div className="flex gap-2 relative z-10">
                          <button onClick={() => handleEdit(selectedEntry)} className="p-2 bg-white/10 text-white hover:bg-white/20 rounded-lg transition backdrop-blur-md">
                              <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteEntry(selectedEntry.id)} className="p-2 bg-white/10 text-red-300 hover:bg-red-500/20 hover:text-red-200 rounded-lg transition backdrop-blur-md">
                              <Trash2 className="w-4 h-4" />
                          </button>
                      </div>
                  </div>

                  {/* Body Card */}
                  <div className="p-8 space-y-6">
                      
                      {/* IDENTIFIANT */}
                      <div>
                          <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1"><User className="w-3 h-3"/> Identifiant</label>
                          <div className="flex gap-2">
                              <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono text-sm text-slate-700 font-medium break-all">
                                  {selectedEntry.identifiant}
                              </div>
                              <button 
                                  onClick={() => copyToClipboard(selectedEntry.identifiant, 'id')} 
                                  className={`px-4 rounded-xl font-bold text-sm transition-all border flex items-center justify-center gap-2 w-24 ${copiedField === 'id' ? 'bg-green-50 border-green-200 text-green-600' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'}`}
                              >
                                  {copiedField === 'id' ? <Check className="w-4 h-4"/> : <Copy className="w-4 h-4"/>}
                                  {copiedField === 'id' ? 'Copié' : 'Copier'}
                              </button>
                          </div>
                      </div>

                      {/* MOT DE PASSE */}
                      <div>
                          <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1"><Lock className="w-3 h-3"/> Mot de passe</label>
                          <div className="flex gap-2">
                              <div className="relative flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono text-sm text-slate-700 font-medium overflow-hidden flex items-center">
                                  {showPassword ? selectedEntry.mot_de_passe : '••••••••••••••••'}
                                  <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 text-slate-400 hover:text-indigo-600 transition">
                                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                              </div>
                              <button 
                                  onClick={() => copyToClipboard(selectedEntry.mot_de_passe, 'pwd')} 
                                  className={`px-4 rounded-xl font-bold text-sm transition-all border flex items-center justify-center gap-2 w-24 ${copiedField === 'pwd' ? 'bg-green-50 border-green-200 text-green-600' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'}`}
                              >
                                  {copiedField === 'pwd' ? <Check className="w-4 h-4"/> : <Copy className="w-4 h-4"/>}
                                  {copiedField === 'pwd' ? 'Copié' : 'Copier'}
                              </button>
                          </div>
                      </div>

                      {/* NOTES */}
                      {selectedEntry.commentaire && (
                          <div className="pt-4 border-t border-slate-100">
                              <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Notes</label>
                              <p className="text-sm text-slate-600 italic leading-relaxed bg-amber-50 p-3 rounded-xl border border-amber-100">
                                  {selectedEntry.commentaire}
                              </p>
                          </div>
                      )}
                  </div>
              </div>
          ) : (
              // EMPTY STATE
              <div className="flex flex-col items-center justify-center text-slate-300">
                  <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-pulse">
                      <Shield className="w-10 h-10 text-slate-300" />
                  </div>
                  <p className="text-lg font-medium text-slate-400">Sélectionnez une clé</p>
                  <p className="text-sm">ou ajoutez-en une nouvelle</p>
              </div>
          )}
      </div>

      {/* MODAL ADD/EDIT */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-3xl w-full max-w-md space-y-5 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-slate-800">{editingId ? 'Modifier' : 'Nouvelle entrée'}</h2>
            {errorMsg && <div className="bg-red-50 text-red-500 text-xs p-3 rounded-lg font-bold">{errorMsg}</div>}
            
            <div className="space-y-3">
                <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 font-bold" placeholder="Nom de l'outil (ex: Booking)" value={newEntry.outil} onChange={(e) => setNewEntry({ ...newEntry, outil: e.target.value })} />
                <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Identifiant" value={newEntry.identifiant} onChange={(e) => setNewEntry({ ...newEntry, identifiant: e.target.value })} />
                <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Mot de passe" value={newEntry.mot_de_passe} onChange={(e) => setNewEntry({ ...newEntry, mot_de_passe: e.target.value })} />
                <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Lien URL (optionnel)" value={newEntry.url} onChange={(e) => setNewEntry({ ...newEntry, url: e.target.value })} />
                <textarea className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm" placeholder="Commentaire..." rows={2} value={newEntry.commentaire} onChange={(e) => setNewEntry({ ...newEntry, commentaire: e.target.value })} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button className="px-5 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-50 transition" onClick={() => setShowModal(false)}>Annuler</button>
              <button className="px-5 py-3 rounded-xl bg-indigo-600 text-white font-bold shadow-lg hover:bg-indigo-700 transition" onClick={createOrUpdateEntry}>
                {editingId ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}