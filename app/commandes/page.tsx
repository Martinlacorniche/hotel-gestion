"use client";

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import {
  ShoppingCart, Plus, AlertTriangle, CheckCircle, Clock,
  Package, Trash2, Edit2, ChevronRight, Filter, Search, Truck
} from 'lucide-react';

// --- TYPES ---
type Commande = {
  id: string;
  fournisseur: string;
  urgence: boolean;
  statut: 'en attente' | 'commandée' | 'reçue';
  hotel_id: string;
  date_creation: string;
};

type Ligne = {
  id: string;
  commande_id: string;
  produit: string;
  commentaire?: string;
};

export default function PageCommandes() {
  const { user } = useAuth();
  
  // --- GESTION HÔTEL ---
  const [hotels, setHotels] = useState<any[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>(() => {
    if (typeof window !== "undefined") return window.localStorage.getItem('selectedHotelId') || "";
    return "";
  });
  const hotelId = selectedHotelId || user?.hotel_id;

  // --- DATA ---
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  
  // --- UI STATES ---
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");

  // --- FORMULAIRE AJOUT RAPIDE ---
  const [quickAdd, setQuickAdd] = useState({ fournisseur: '', produit: '', urgence: false, commentaire: '' });

  useEffect(() => {
    supabase.from('hotels').select('id, nom').then(({ data }) => setHotels(data || []));
  }, []);

  useEffect(() => {
    if (selectedHotelId && typeof window !== "undefined") {
      window.localStorage.setItem('selectedHotelId', selectedHotelId);
    }
  }, [selectedHotelId]);

  useEffect(() => {
    if (hotelId) {
      fetchData();
    }
  }, [hotelId]);

  async function fetchData() {
    const { data: cmds } = await supabase.from('commandes').select('*').eq('hotel_id', hotelId).order('date_creation', { ascending: false });
    const { data: lgs } = await supabase.from('commandes_lignes').select('*');
    setCommandes(cmds || []);
    setLignes(lgs || []);
  }

  // --- LOGIQUE MÉTIER ---

  // 1. Ajouter un besoin (logique intelligente : cherche si commande existe déjà)
  async function handleAddNeed() {
    if (!quickAdd.fournisseur.trim() || !quickAdd.produit.trim()) return;

    // Chercher une commande "en attente" pour ce fournisseur
    let targetCommande = commandes.find(c => 
      c.fournisseur.toLowerCase() === quickAdd.fournisseur.toLowerCase() && 
      c.statut === 'en attente'
    );

    let targetId = targetCommande?.id;

    // Si pas de commande, on en crée une
    if (!targetCommande) {
      const { data: newCmd } = await supabase.from('commandes').insert({
        fournisseur: quickAdd.fournisseur,
        urgence: quickAdd.urgence,
        statut: 'en attente',
        hotel_id: hotelId,
      }).select().single();
      
      if (newCmd) {
        targetId = newCmd.id;
        setCommandes(prev => [newCmd, ...prev]);
      }
    } else if (quickAdd.urgence && !targetCommande.urgence) {
      // Si le nouveau besoin est urgent, on passe la commande en urgent
      await supabase.from('commandes').update({ urgence: true }).eq('id', targetId);
      setCommandes(prev => prev.map(c => c.id === targetId ? { ...c, urgence: true } : c));
    }

    if (targetId) {
      const { data: newLigne } = await supabase.from('commandes_lignes').insert({
        commande_id: targetId,
        produit: quickAdd.produit,
        commentaire: quickAdd.commentaire
      }).select().single();

      if (newLigne) setLignes(prev => [...prev, newLigne]);
    }

    setQuickAdd({ ...quickAdd, produit: '', commentaire: '' }); // On garde le fournisseur pour enchainer
  }

  async function updateStatut(id: string, newStatut: string) {
    await supabase.from('commandes').update({ statut: newStatut }).eq('id', id);
    setCommandes(prev => prev.map(c => c.id === id ? { ...c, statut: newStatut as any } : c));
  }

  async function deleteLigne(id: string) {
    await supabase.from('commandes_lignes').delete().eq('id', id);
    setLignes(prev => prev.filter(l => l.id !== id));
  }

  async function deleteCommande(id: string) {
    if (!confirm("Supprimer toute la commande ?")) return;
    await supabase.from('commandes').delete().eq('id', id); // Cascade delete normalement géré par Supabase, sinon ajouter delete lignes
    setCommandes(prev => prev.filter(c => c.id !== id));
    setLignes(prev => prev.filter(l => l.commande_id !== id));
  }

  // --- SECTIONS ---
  const sections = useMemo(() => {
    const filtered = commandes.filter(c => {
      if (!showArchived && c.statut === 'reçue') return false;
      if (search) {
        const matchFournisseur = c.fournisseur.toLowerCase().includes(search.toLowerCase());
        const matchProduit = lignes.some(l => l.commande_id === c.id && l.produit.toLowerCase().includes(search.toLowerCase()));
        return matchFournisseur || matchProduit;
      }
      return true;
    });

    return {
      attente: filtered.filter(c => c.statut === 'en attente'),
      commandee: filtered.filter(c => c.statut === 'commandée'),
      recue: filtered.filter(c => c.statut === 'reçue'),
    };
  }, [commandes, lignes, showArchived, search]);

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* --- SIDEBAR GAUCHE (Ajout Rapide) --- */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm">
        <div className="p-6 border-b border-slate-100">
            <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2 mb-4">
                <ShoppingCart className="w-6 h-6 text-indigo-600" /> Commandes
            </h1>
            
            {hotels.length > 1 && (
                <select 
                    className="w-full mb-4 bg-slate-50 border border-slate-200 text-xs font-bold py-2 px-3 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
                    value={selectedHotelId}
                    onChange={(e) => setSelectedHotelId(e.target.value)}
                >
                    {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
                </select>
            )}

            {/* Formulaire Ajout */}
            <div className="bg-indigo-50 rounded-2xl p-4 space-y-3 border border-indigo-100">
                <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Ajouter un besoin
                </h3>
                
                <div>
                    <label className="text-[10px] font-bold text-indigo-400 uppercase">Fournisseur</label>
                    <input 
                        className="w-full mt-1 px-3 py-2 rounded-lg border border-indigo-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Ex: Metro, Amazon..."
                        value={quickAdd.fournisseur}
                        onChange={e => setQuickAdd({...quickAdd, fournisseur: e.target.value})}
                    />
                </div>

                <div>
                    <label className="text-[10px] font-bold text-indigo-400 uppercase">Produit</label>
                    <input 
                        className="w-full mt-1 px-3 py-2 rounded-lg border border-indigo-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Ex: 500g Café grains"
                        value={quickAdd.produit}
                        onChange={e => setQuickAdd({...quickAdd, produit: e.target.value})}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddNeed()}
                    />
                </div>

                <div>
                    <label className="text-[10px] font-bold text-indigo-400 uppercase">Note (Optionnel)</label>
                    <input 
                        className="w-full mt-1 px-3 py-2 rounded-lg border border-indigo-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Réf, quantité..."
                        value={quickAdd.commentaire}
                        onChange={e => setQuickAdd({...quickAdd, commentaire: e.target.value})}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddNeed()}
                    />
                </div>

                <label className="flex items-center gap-2 cursor-pointer group">
                    <div className={`w-4 h-4 border rounded flex items-center justify-center transition-colors ${quickAdd.urgence ? 'bg-red-500 border-red-500' : 'bg-white border-indigo-200'}`}>
                        {quickAdd.urgence && <CheckCircle className="w-3 h-3 text-white" />}
                    </div>
                    <input type="checkbox" className="hidden" checked={quickAdd.urgence} onChange={e => setQuickAdd({...quickAdd, urgence: e.target.checked})} />
                    <span className={`text-xs font-bold ${quickAdd.urgence ? 'text-red-500' : 'text-slate-500'}`}>Marquer comme Urgent</span>
                </label>

                <Button onClick={handleAddNeed} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-200 transition-all active:scale-95">
                    Ajouter à la liste
                </Button>
            </div>
        </div>

        {/* Filtres Sidebar */}
        <div className="p-4 space-y-2">
            <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                    placeholder="Filtrer..." 
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                <input type="checkbox" className="rounded text-indigo-600" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                <span className="text-sm text-slate-600 font-medium">Voir l'historique (Reçues)</span>
            </label>
        </div>
      </div>

      {/* --- MAIN CONTENT (Board) --- */}
      <div className="flex-1 overflow-x-auto bg-slate-50/50 p-6">
         <div className="flex gap-6 h-full min-w-[1000px]">
            
            {/* COLONNE 1 : EN ATTENTE (Besoins) */}
            <div className="flex-1 flex flex-col min-w-[300px]">
                <div className="flex items-center justify-between mb-4 px-1">
                    <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span> Besoins
                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{sections.attente.length}</span>
                    </h2>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                    {sections.attente.map(cmd => (
                        <CommandeCard 
                            key={cmd.id} 
                            cmd={cmd} 
                            lignes={lignes.filter(l => l.commande_id === cmd.id)}
                            onDeleteLigne={deleteLigne}
                            onDeleteCmd={deleteCommande}
                            onNextStep={() => updateStatut(cmd.id, 'commandée')}
                            nextLabel="Commander"
                            color="blue"
                        />
                    ))}
                    {sections.attente.length === 0 && <EmptyState text="Aucun besoin en attente" />}
                </div>
            </div>

            {/* COLONNE 2 : COMMANDÉES */}
            <div className="flex-1 flex flex-col min-w-[300px]">
                <div className="flex items-center justify-between mb-4 px-1">
                    <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span> En cours
                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{sections.commandee.length}</span>
                    </h2>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                    {sections.commandee.map(cmd => (
                        <CommandeCard 
                            key={cmd.id} 
                            cmd={cmd} 
                            lignes={lignes.filter(l => l.commande_id === cmd.id)}
                            onDeleteLigne={deleteLigne}
                            onDeleteCmd={deleteCommande}
                            onNextStep={() => updateStatut(cmd.id, 'reçue')}
                            nextLabel="Réceptionner"
                            color="amber"
                            readOnlyLignes
                        />
                    ))}
                    {sections.commandee.length === 0 && <EmptyState text="Rien en commande" />}
                </div>
            </div>

            {/* COLONNE 3 : REÇUES */}
            <div className="flex-1 flex flex-col min-w-[300px]">
                <div className="flex items-center justify-between mb-4 px-1">
                    <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Reçues
                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{sections.recue.length}</span>
                    </h2>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                    {sections.recue.map(cmd => (
                        <CommandeCard 
                            key={cmd.id} 
                            cmd={cmd} 
                            lignes={lignes.filter(l => l.commande_id === cmd.id)}
                            onDeleteLigne={deleteLigne}
                            onDeleteCmd={deleteCommande}
                            color="emerald"
                            readOnlyLignes
                            isDone
                        />
                    ))}
                    {sections.recue.length === 0 && <EmptyState text="Historique vide" />}
                </div>
            </div>

         </div>
      </div>
    </div>
  );
}

// --- COMPOSANTS ---

function CommandeCard({ cmd, lignes, onDeleteLigne, onDeleteCmd, onNextStep, nextLabel, color, readOnlyLignes, isDone }: any) {
    const colorClasses: any = {
        blue: 'border-l-blue-500 bg-white',
        amber: 'border-l-amber-500 bg-amber-50/30',
        emerald: 'border-l-emerald-500 bg-emerald-50/30 opacity-80 hover:opacity-100'
    };

    return (
        <div className={`group relative p-4 rounded-xl shadow-sm border border-slate-100 border-l-[4px] transition-all hover:shadow-md ${colorClasses[color]}`}>
            
            {/* Header Carte */}
            <div className="flex justify-between items-start mb-3">
                <div>
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                        {cmd.fournisseur}
                        {cmd.urgence && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full border border-red-200 font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> URGENT</span>}
                    </h3>
                    <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3"/> Créé le {new Date(cmd.date_creation).toLocaleDateString()}
                    </span>
                </div>
                <button onClick={() => onDeleteCmd(cmd.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4"/>
                </button>
            </div>

            {/* Liste Produits */}
            <div className="space-y-1.5 mb-4">
                {lignes.map((l: any) => (
                    <div key={l.id} className="flex justify-between items-start text-sm group/ligne">
                        <div className="leading-tight">
                            <span className="font-medium text-slate-700 block">• {l.produit}</span>
                            {l.commentaire && <span className="text-xs text-slate-400 italic">{l.commentaire}</span>}
                        </div>
                        {!readOnlyLignes && (
                            <button onClick={() => onDeleteLigne(l.id)} className="text-slate-300 hover:text-red-400 opacity-0 group-hover/ligne:opacity-100 transition-opacity">
                                <Trash2 className="w-3 h-3"/>
                            </button>
                        )}
                    </div>
                ))}
                {lignes.length === 0 && <div className="text-xs text-slate-400 italic">Vide</div>}
            </div>

            {/* Footer Actions */}
            {!isDone && onNextStep && (
                <div className="pt-3 border-t border-slate-100 flex justify-end">
                    <button onClick={onNextStep} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm transition-transform active:scale-95 ${color === 'blue' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                        {nextLabel} <ChevronRight className="w-3 h-3"/>
                    </button>
                </div>
            )}
        </div>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-10 text-slate-300 border-2 border-dashed border-slate-200 rounded-2xl">
            <Package className="w-8 h-8 mb-2 opacity-50" />
            <span className="text-sm font-medium">{text}</span>
        </div>
    )
}