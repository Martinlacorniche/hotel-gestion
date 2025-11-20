"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { 
  Search, Plus, NotebookText, Phone, Mail, MapPin, Trash2, Edit2, 
  Save, ChevronLeft, User
} from 'lucide-react';

// --- TYPES ---
type RepertoireEntry = { 
  id: string; 
  qui_quoi: string; 
  contact: string; 
  commentaire?: string; 
  hotel_id: string 
};

export default function RepertoirePage() {
  const { user } = useAuth();

  // --- ÉTATS GLOBAUX ---
  const [hotels, setHotels] = useState<any[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>(() => {
    if (typeof window !== "undefined") return window.localStorage.getItem("selectedHotelId") || "";
    return "";
  });
  const [currentHotel, setCurrentHotel] = useState<any | null>(null);
  const [entries, setEntries] = useState<RepertoireEntry[]>([]);
  const [search, setSearch] = useState("");
  
  // --- ÉTATS SÉLECTION / ÉDITION ---
  const [selectedEntry, setSelectedEntry] = useState<RepertoireEntry | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ qui_quoi: "", contact: "", commentaire: "" });

  // --- EFFETS ---
  useEffect(() => {
    const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : "";
    document.title = `Répertoire${hotelName}`;
  }, [currentHotel]);

  useEffect(() => {
    if (selectedHotelId && typeof window !== "undefined") {
      window.localStorage.setItem("selectedHotelId", selectedHotelId);
    }
  }, [selectedHotelId]);

  useEffect(() => {
    supabase.from("hotels").select("id, nom").then(({ data }) => {
        setHotels(data || []);
        if(!selectedHotelId && data && data.length > 0) setSelectedHotelId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (selectedHotelId) {
      supabase.from("hotels").select("id, nom").eq("id", selectedHotelId).single().then(({ data }) => setCurrentHotel(data));
      fetchEntries();
    }
  }, [selectedHotelId]);

  // --- FONCTIONS ---

  async function fetchEntries() {
    const { data } = await supabase
      .from("repertoire")
      .select("*")
      .eq("hotel_id", selectedHotelId)
      .order("qui_quoi", { ascending: true });
    setEntries(data || []);
  }

  function handleSelect(entry: RepertoireEntry) {
      setSelectedEntry(entry);
      setForm({ 
          qui_quoi: entry.qui_quoi, 
          contact: entry.contact, 
          commentaire: entry.commentaire || "" 
      });
      setIsEditing(false);
  }

  function handleCreate() {
      setSelectedEntry(null);
      setForm({ qui_quoi: "", contact: "", commentaire: "" });
      setIsEditing(true);
  }

  async function saveEntry() {
    if (!form.qui_quoi.trim() || !form.contact.trim()) {
        alert("Nom et contact obligatoires");
        return;
    }
    
    let newId = selectedEntry?.id;

    if (!selectedEntry) {
      // Création
      const { data, error } = await supabase.from("repertoire").insert({
        ...form,
        hotel_id: selectedHotelId,
      }).select().single();
      if(data) newId = data.id;
    } else {
      // Mise à jour
      await supabase.from("repertoire").update({
        ...form
      }).eq("id", selectedEntry.id);
    }
    
    await fetchEntries();
    if (newId) {
        const { data } = await supabase.from("repertoire").select("*").eq("id", newId).single();
        if(data) setSelectedEntry(data);
    }
    setIsEditing(false);
  }

  async function deleteEntry() {
    if (!selectedEntry) return;
    if (!confirm("Supprimer ce contact ?")) return;
    await supabase.from("repertoire").delete().eq("id", selectedEntry.id);
    fetchEntries();
    setSelectedEntry(null);
    setIsEditing(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      e =>
        e.qui_quoi.toLowerCase().includes(q) ||
        e.contact.toLowerCase().includes(q) ||
        (e.commentaire && e.commentaire.toLowerCase().includes(q))
    );
  }, [search, entries]);

  // Détection simple du type de contact (Email, Tel, ou Autre)
  const getContactIcon = (contact: string) => {
      if (contact.includes('@')) return <Mail className="w-4 h-4" />;
      if (/[0-9]{2}.[0-9]{2}/.test(contact) || contact.startsWith('+')) return <Phone className="w-4 h-4" />;
      return <MapPin className="w-4 h-4" />;
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* --- SIDEBAR GAUCHE (Liste) --- */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm">
         
         {/* Header Sidebar */}
         <div className="p-4 border-b border-slate-100 space-y-4">
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                        <NotebookText className="w-6 h-6 text-indigo-600" /> Répertoire
                    </h1>
                    <button onClick={handleCreate} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition" title="Nouveau contact">
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
                {hotels.length > 1 && (
                    <select 
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold py-2 px-3 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
                        value={selectedHotelId}
                        onChange={(e) => { setSelectedHotelId(e.target.value); setSelectedEntry(null); setIsEditing(false); }}
                    >
                        {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
                    </select>
                )}
            </div>

            <div className="relative group">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all" 
                    placeholder="Rechercher un contact..." 
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>
         </div>

         {/* Liste Scrollable */}
         <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.length === 0 && <div className="text-center text-xs text-slate-400 py-8 italic">Aucun contact trouvé.</div>}
            
            {filtered.map(entry => (
                <div 
                    key={entry.id}
                    onClick={() => handleSelect(entry)}
                    className={`
                        group p-3 rounded-xl cursor-pointer transition-all border border-transparent flex items-center gap-3
                        ${selectedEntry?.id === entry.id 
                            ? 'bg-indigo-50 border-indigo-100 text-indigo-900 shadow-sm' 
                            : 'hover:bg-slate-50 text-slate-700 hover:border-slate-100'
                        }
                    `}
                >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${selectedEntry?.id === entry.id ? 'bg-indigo-200 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                        {entry.qui_quoi.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                        <h3 className="font-bold text-sm truncate">{entry.qui_quoi}</h3>
                        <p className="text-xs text-slate-400 truncate mt-0.5 flex items-center gap-1">
                            {getContactIcon(entry.contact)} {entry.contact}
                        </p>
                    </div>
                </div>
            ))}
         </div>
      </div>

      {/* --- MAIN CONTENT (Fiche Contact) --- */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 relative items-center justify-center p-6">
          
          {(selectedEntry || isEditing) ? (
              <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-300">
                  
                  {/* Header Card */}
                  <div className="bg-slate-50 p-6 border-b border-slate-100 flex justify-between items-start">
                      <div className="flex items-center gap-4">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-2xl font-bold shadow-lg">
                              {isEditing ? <User className="w-8 h-8" /> : selectedEntry?.qui_quoi.substring(0, 1).toUpperCase()}
                          </div>
                          <div>
                              {isEditing ? (
                                  <div className="space-y-2">
                                      <input 
                                          className="text-xl font-bold text-slate-900 placeholder:text-slate-300 outline-none bg-transparent w-full border-b border-slate-300 focus:border-indigo-500 pb-1 transition-colors"
                                          placeholder="Nom / Qui / Quoi"
                                          value={form.qui_quoi}
                                          onChange={(e) => setForm({ ...form, qui_quoi: e.target.value })}
                                          autoFocus
                                      />
                                      <input 
                                          className="text-sm font-medium text-slate-600 placeholder:text-slate-300 outline-none bg-transparent w-full border-b border-slate-300 focus:border-indigo-500 pb-1 transition-colors"
                                          placeholder="Contact (Tél, Email, Adresse...)"
                                          value={form.contact}
                                          onChange={(e) => setForm({ ...form, contact: e.target.value })}
                                      />
                                  </div>
                              ) : (
                                  <>
                                      <h2 className="text-2xl font-extrabold text-slate-900">{selectedEntry?.qui_quoi}</h2>
                                      <p className="text-sm text-slate-500 font-medium mt-1 flex items-center gap-1.5">
                                          {selectedEntry && getContactIcon(selectedEntry.contact)}
                                          {selectedEntry?.contact}
                                      </p>
                                  </>
                              )}
                          </div>
                      </div>

                      {/* Actions Toolbar */}
                      <div className="flex gap-2">
                          {isEditing ? (
                              <>
                                  <button onClick={() => { if(selectedEntry) { setIsEditing(false); setForm({qui_quoi: selectedEntry.qui_quoi, contact: selectedEntry.contact, commentaire: selectedEntry.commentaire || ""}); } else { setSelectedEntry(null); setIsEditing(false); } }} className="p-2 text-slate-400 hover:bg-slate-200 rounded-lg transition">
                                      <ChevronLeft className="w-5 h-5" />
                                  </button>
                                  <button onClick={saveEntry} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md transition transform active:scale-95">
                                      <Save className="w-5 h-5" />
                                  </button>
                              </>
                          ) : (
                              <>
                                  <button onClick={deleteEntry} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                                      <Trash2 className="w-5 h-5" />
                                  </button>
                                  <button onClick={() => { setForm({ qui_quoi: selectedEntry!.qui_quoi, contact: selectedEntry!.contact, commentaire: selectedEntry!.commentaire || "" }); setIsEditing(true); }} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                                      <Edit2 className="w-5 h-5" />
                                  </button>
                              </>
                          )}
                      </div>
                  </div>

                  {/* Body Card */}
                  <div className="p-8">
                      <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Notes / Commentaires</label>
                      {isEditing ? (
                          <textarea 
                              className="w-full h-32 resize-none outline-none text-sm text-slate-700 leading-relaxed placeholder:text-slate-300 bg-slate-50 p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-100 transition-all"
                              placeholder="Informations complémentaires..."
                              value={form.commentaire}
                              onChange={(e) => setForm({ ...form, commentaire: e.target.value })}
                          />
                      ) : (
                          <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 p-4 rounded-xl border border-slate-100 min-h-[100px]">
                              {selectedEntry?.commentaire || <span className="italic text-slate-400">Aucune note disponible.</span>}
                          </div>
                      )}
                  </div>

                  {/* Footer Actions Rapides (Lecture seule) */}
                  {!isEditing && selectedEntry && (
                      <div className="bg-slate-50 p-4 border-t border-slate-100 flex gap-4 justify-center">
                           {selectedEntry.contact.includes('@') && (
                               <a href={`mailto:${selectedEntry.contact}`} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-600 transition shadow-sm">
                                   <Mail className="w-4 h-4" /> Envoyer Email
                               </a>
                           )}
                           {(/[0-9]{2}/.test(selectedEntry.contact) || selectedEntry.contact.startsWith('+')) && (
                               <a href={`tel:${selectedEntry.contact}`} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:border-green-300 hover:text-green-600 transition shadow-sm">
                                   <Phone className="w-4 h-4" /> Appeler
                               </a>
                           )}
                      </div>
                  )}
              </div>
          ) : (
              // EMPTY STATE
              <div className="flex flex-col items-center justify-center text-slate-300">
                  <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                      <User className="w-10 h-10 text-slate-300" />
                  </div>
                  <p className="text-lg font-medium text-slate-400">Sélectionnez un contact</p>
                  <p className="text-sm">ou créez-en un nouveau</p>
              </div>
          )}
      </div>
    </div>
  );
}