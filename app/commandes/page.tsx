'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function PageCommandes() {
  const [commandes, setCommandes] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [newCommande, setNewCommande] = useState({ fournisseur: '', urgence: false });
  const [selectedCommandeId, setSelectedCommandeId] = useState(null);
  const [showLigneModal, setShowLigneModal] = useState(false);
  const [newLigne, setNewLigne] = useState({ produit: '', quantite: 1, unite: '', commentaire: '' });
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    fetchCommandes();
    fetchLignes();
  }, []);

  async function fetchCommandes() {
    const { data, error } = await supabase.from('commandes').select('*').order('date_creation', { ascending: false });
    if (!error) setCommandes(data);
  }

  async function fetchLignes() {
    const { data, error } = await supabase.from('commandes_lignes').select('*');
    if (!error) setLignes(data);
  }

  async function confirmAndUpdateStatut(id, newStatut) {
    const emojis = {
      'commandée': '🛎️',
      'reçue': '📦'
    };
    const messages = {
      'commandée': "Tu confirmes que tu viens de commander cette pépite ? 😎",
      'reçue': "C’est arrivé ? Bien reçu ? 😏"
    };
    if (confirm(`${emojis[newStatut]} ${messages[newStatut]}`)) {
      await supabase.from('commandes').update({ statut: newStatut }).eq('id', id);
      fetchCommandes();
    }
  }

  async function createCommande() {
    const { error } = await supabase.from('commandes').insert({
      fournisseur: newCommande.fournisseur,
      urgence: newCommande.urgence,
      statut: 'en attente',
    });
    if (!error) {
      setShowModal(false);
      setNewCommande({ fournisseur: '', urgence: false });
      fetchCommandes();
    }
  }

  async function addLigne() {
    if (!selectedCommandeId) return;
    const { error } = await supabase.from('commandes_lignes').insert({
      ...newLigne,
      commande_id: selectedCommandeId,
    });
    if (!error) {
      setShowLigneModal(false);
      setNewLigne({ produit: '', quantite: 1, unite: '', commentaire: '' });
      fetchLignes();
    }
  }

  async function deleteLigne(id) {
    await supabase.from('commandes_lignes').delete().eq('id', id);
    fetchLignes();
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">🛒 Besoins d'un truc ?</h1>
        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow" onClick={() => setShowModal(true)}>➕ Nouvelle commande</Button>
      </div>

      <div className="flex justify-end items-center mb-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Afficher les commandes reçues
        </label>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {commandes.filter(c => showArchived || c.statut !== 'reçue').map(commande => (
          <div key={commande.id} className={`rounded-lg shadow p-4 w-full h-[300px] overflow-hidden relative flex flex-col justify-between transition-colors duration-200
            ${commande.statut === 'commandée' ? 'bg-green-100 border border-green-300' : commande.statut === 'reçue' ? 'bg-gray-200 border border-gray-300' : 'bg-yellow-100 border border-yellow-300'}`}>
            <div>
              <h2 className="font-bold text-lg truncate">{commande.fournisseur}</h2>
              {commande.urgence && <div className="text-red-600 text-sm">⚠️ Urgence</div>}
              <div className="text-xs text-gray-600 mb-2">Statut : {commande.statut}</div>
              <ul className="space-y-1 overflow-y-auto max-h-[160px] pr-2">
                {lignes.filter(l => l.commande_id === commande.id).map(ligne => (
                  <li key={ligne.id} className="text-sm flex justify-between items-center">
                    <div className="truncate">
                      <strong>{ligne.produit}</strong> - {ligne.quantite} {ligne.unite}
                      {ligne.commentaire && <span className="text-xs text-gray-500 ml-1">({ligne.commentaire})</span>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => deleteLigne(ligne.id)}>🗑️</Button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {commande.statut === 'en attente' && (
                <Button className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => confirmAndUpdateStatut(commande.id, 'commandée')}>✅ Commandée</Button>
              )}
              {commande.statut !== 'reçue' && (
                <Button className="text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => confirmAndUpdateStatut(commande.id, 'reçue')}>📦 Reçue</Button>
              )}
              {(commande.statut === 'en attente') && (
                <Button className="text-xs bg-blue-200 hover:bg-blue-300 text-blue-800" onClick={() => { setSelectedCommandeId(commande.id); setShowLigneModal(true); }}>➕ Produit</Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle commande</DialogTitle>
          </DialogHeader>
          <Input placeholder="Fournisseur" value={newCommande.fournisseur} onChange={(e) => setNewCommande({ ...newCommande, fournisseur: e.target.value })} className="mb-2" />
          <label className="flex items-center gap-2 mb-4">
            <input type="checkbox" checked={newCommande.urgence} onChange={(e) => setNewCommande({ ...newCommande, urgence: e.target.checked })} />
            Urgence
          </label>
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={createCommande}>Valider</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={showLigneModal} onOpenChange={setShowLigneModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un produit</DialogTitle>
          </DialogHeader>
          <Input placeholder="Produit" value={newLigne.produit} onChange={(e) => setNewLigne({ ...newLigne, produit: e.target.value })} className="mb-2" />
          <Input placeholder="Quantité" type="number" value={newLigne.quantite} onChange={(e) => setNewLigne({ ...newLigne, quantite: parseInt(e.target.value) })} className="mb-2" />
          <Input placeholder="Unité (ex: kg, boîte...)" value={newLigne.unite} onChange={(e) => setNewLigne({ ...newLigne, unite: e.target.value })} className="mb-2" />
          <Input placeholder="Commentaire (optionnel)" value={newLigne.commentaire} onChange={(e) => setNewLigne({ ...newLigne, commentaire: e.target.value })} className="mb-2" />
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={addLigne}>Ajouter</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}