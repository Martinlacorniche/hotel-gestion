"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { 
  Search, Plus, FileText, ChevronLeft, Trash2, Save, Edit2, BookOpen 
} from 'lucide-react';

// --- TYPES ---
type Process = { id: string; title: string; body: string; hotel_id: string };

export default function ProcessPage() {
  const { user } = useAuth();

  // --- ÉTATS GLOBAUX ---
  const [hotels, setHotels] = useState<any[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>(() => {
    if (typeof window !== "undefined") return window.localStorage.getItem("selectedHotelId") || "";
    return "";
  });
  const [currentHotel, setCurrentHotel] = useState<any | null>(null);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [search, setSearch] = useState("");
  
  // --- ÉTATS ÉDITION / SÉLECTION ---
  const [selectedProcess, setSelectedProcess] = useState<Process | null>(null);
  const [isEditing, setIsEditing] = useState(false); // Mode lecture vs écriture
  const [form, setForm] = useState({ title: "", body: "" });

  // --- EFFETS ---
  useEffect(() => {
    const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : "";
    document.title = `Process${hotelName}`;
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
      fetchProcesses();
    }
  }, [selectedHotelId]);

  // --- FONCTIONS ---

  async function fetchProcesses() {
    const { data } = await supabase
      .from("processes")
      .select("*")
      .eq("hotel_id", selectedHotelId)
      .order("title", { ascending: true });
    setProcesses(data || []);
  }

  function handleSelect(p: Process) {
      setSelectedProcess(p);
      setForm({ title: p.title, body: p.body });
      setIsEditing(false);
  }

  function handleCreate() {
      setSelectedProcess(null);
      setForm({ title: "", body: "" });
      setIsEditing(true);
  }

  async function saveProcess() {
    if (!form.title.trim() || !form.body.trim()) return;
    
    let newId = selectedProcess?.id;

    if (!selectedProcess) {
      // Création
      const { data, error } = await supabase.from("processes").insert({
        title: form.title.trim(),
        body: form.body,
        hotel_id: selectedHotelId,
      }).select().single();
      if(data) newId = data.id;
    } else {
      // Mise à jour
      await supabase.from("processes").update({
        title: form.title.trim(),
        body: form.body,
      }).eq("id", selectedProcess.id);
    }
    
    await fetchProcesses();
    // Si c'était une création, on le sélectionne
    if (newId) {
        const { data } = await supabase.from("processes").select("*").eq("id", newId).single();
        if(data) setSelectedProcess(data);
    }
    setIsEditing(false);
  }

  async function deleteProcess() {
    if (!selectedProcess) return;
    if (!confirm("Supprimer définitivement ce process ?")) return;
    await supabase.from("processes").delete().eq("id", selectedProcess.id);
    fetchProcesses();
    setSelectedProcess(null);
    setIsEditing(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return processes;
    return processes.filter(
      p =>
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q)
    );
  }, [search, processes]);

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* --- SIDEBAR GAUCHE (Liste) --- */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm">
         
         {/* Header Sidebar */}
         <div className="p-4 border-b border-slate-100 space-y-4">
            {/* Titre + Selecteur Hôtel (si plusieurs) */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                        <BookOpen className="w-6 h-6 text-indigo-600" /> Process
                    </h1>
                    <button onClick={handleCreate} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition" title="Nouveau process">
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
                {hotels.length > 1 && (
                    <select 
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold py-2 px-3 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
                        value={selectedHotelId}
                        onChange={(e) => { setSelectedHotelId(e.target.value); setSelectedProcess(null); setIsEditing(false); }}
                    >
                        {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
                    </select>
                )}
            </div>

            {/* Recherche */}
            <div className="relative group">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all" 
                    placeholder="Chercher un process..." 
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>
         </div>

         {/* Liste Scrollable */}
         <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.length === 0 && <div className="text-center text-xs text-slate-400 py-8 italic">Aucun process trouvé.</div>}
            
            {filtered.map(p => (
                <div 
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    className={`
                        group p-3 rounded-xl cursor-pointer transition-all border border-transparent
                        ${selectedProcess?.id === p.id 
                            ? 'bg-indigo-50 border-indigo-100 text-indigo-900' 
                            : 'hover:bg-slate-50 text-slate-700 hover:border-slate-100'
                        }
                    `}
                >
                    <div className="flex items-start gap-3">
                        <FileText className={`w-5 h-5 mt-0.5 shrink-0 ${selectedProcess?.id === p.id ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-500'}`} />
                        <div className="overflow-hidden">
                            <h3 className={`font-bold text-sm truncate ${selectedProcess?.id === p.id ? 'text-indigo-700' : 'text-slate-800'}`}>{p.title}</h3>
                            <p className="text-xs text-slate-400 truncate mt-0.5">{p.body.substring(0, 50)}...</p>
                        </div>
                    </div>
                </div>
            ))}
         </div>
      </div>

      {/* --- MAIN CONTENT (Éditeur / Lecteur) --- */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 relative">
          
          {(selectedProcess || isEditing) ? (
              <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full bg-white shadow-xl shadow-slate-200/50 my-0 md:my-6 md:rounded-2xl border-x md:border border-slate-200 overflow-hidden">
                  
                  {/* Toolbar Header */}
                  <div className="h-16 border-b border-slate-100 flex items-center justify-between px-6 shrink-0 bg-white">
                      <div className="flex items-center gap-4">
                          {/* Retour Mobile */}
                          <button onClick={() => { setSelectedProcess(null); setIsEditing(false); }} className="md:hidden p-2 -ml-2 text-slate-400">
                              <ChevronLeft className="w-6 h-6" />
                          </button>
                          
                          {isEditing ? (
                              <input 
                                  className="text-lg font-bold text-slate-900 placeholder:text-slate-300 outline-none bg-transparent w-full min-w-[200px]"
                                  placeholder="Titre du process..."
                                  value={form.title}
                                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                                  autoFocus
                              />
                          ) : (
                              <h2 className="text-xl font-bold text-slate-900 truncate max-w-md">{selectedProcess?.title}</h2>
                          )}
                      </div>

                      <div className="flex items-center gap-2">
                          {isEditing ? (
                              <>
                                  <button onClick={() => { if(selectedProcess) { setIsEditing(false); setForm({title: selectedProcess.title, body: selectedProcess.body}); } else { setSelectedProcess(null); setIsEditing(false); } }} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-lg transition">
                                      Annuler
                                  </button>
                                  <button onClick={saveProcess} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-md shadow-indigo-200 transition transform active:scale-95">
                                      <Save className="w-4 h-4" /> Enregistrer
                                  </button>
                              </>
                          ) : (
                              <>
                                  <button onClick={deleteProcess} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Supprimer">
                                      <Trash2 className="w-5 h-5" />
                                  </button>
                                  <button onClick={() => { setForm({ title: selectedProcess!.title, body: selectedProcess!.body }); setIsEditing(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition">
                                      <Edit2 className="w-4 h-4" /> Modifier
                                  </button>
                              </>
                          )}
                      </div>
                  </div>

                  {/* Content Body */}
                  <div className="flex-1 overflow-y-auto p-6 md:p-10">
                      {isEditing ? (
                          <textarea 
                              className="w-full h-full resize-none outline-none text-base text-slate-700 leading-relaxed placeholder:text-slate-300 bg-transparent"
                              placeholder="Écrivez votre procédure ici..."
                              value={form.body}
                              onChange={(e) => setForm({ ...form, body: e.target.value })}
                          />
                      ) : (
                          <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap">
                              {selectedProcess?.body}
                          </div>
                      )}
                  </div>
              </div>
          ) : (
              // EMPTY STATE
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                  <BookOpen className="w-24 h-24 mb-4 opacity-20" />
                  <p className="text-lg font-medium">Sélectionnez ou créez un process</p>
              </div>
          )}
      </div>
    </div>
  );
}