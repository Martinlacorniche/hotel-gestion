'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function PageCommandes() {
  const { user } = useAuth();
  const [selectedHotelId, setSelectedHotelId] = useState(() => {
    if (typeof window !== "undefined") {
      const fromStorage = window.localStorage.getItem('selectedHotelId');
      if (fromStorage) return fromStorage;
    }
    if (user && user.hotel_id) return user.hotel_id;
    return '';
  });

  useEffect(() => {
    if (selectedHotelId && typeof window !== "undefined") {
      window.localStorage.setItem('selectedHotelId', selectedHotelId);
    }
  }, [selectedHotelId]);

  const [hotels, setHotels] = useState<any[]>([]);
  const hotelId = selectedHotelId || user?.hotel_id;

  const [commandes, setCommandes] = useState<any[]>([]);
  const [lignes, setLignes] = useState<any[]>([]);
  const [newCommande, setNewCommande] = useState({ fournisseur: '', urgence: false });
  const [showArchived, setShowArchived] = useState(false);

  const [newLignes, setNewLignes] = useState<Record<string, { produit: string; commentaire: string }>>({});
  const [editingLigneId, setEditingLigneId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ produit: string; commentaire: string }>({ produit: '', commentaire: '' });

  const [editCommande, setEditCommande] = useState<any | null>(null);
  const [showEditCommande, setShowEditCommande] = useState(false);

  useEffect(() => {
    supabase.from('hotels').select('id, nom').then(({ data }) => setHotels(data || []));
  }, []);

  useEffect(() => {
    if (hotelId) {
      fetchCommandes();
      fetchLignes();
    }
  }, [hotelId]);

  async function fetchCommandes() {
    const { data } = await supabase.from('commandes').select('*').eq('hotel_id', hotelId).order('date_creation', { ascending: false });
    setCommandes(data || []);
  }

  async function fetchLignes() {
    const { data } = await supabase.from('commandes_lignes').select('*');
    setLignes(data || []);
  }

  async function confirmAndUpdateStatut(id: string, newStatut: string) {
    await supabase.from('commandes').update({ statut: newStatut }).eq('id', id);
    fetchCommandes();
  }

  async function createCommande() {
    if (!newCommande.fournisseur.trim()) return;
    await supabase.from('commandes').insert({
      fournisseur: newCommande.fournisseur,
      urgence: newCommande.urgence,
      statut: 'en attente',
      hotel_id: hotelId,
    });
    setNewCommande({ fournisseur: '', urgence: false });
    fetchCommandes();
  }

  async function addLigne(commandeId: string) {
    const ligne = newLignes[commandeId];
    if (!ligne || !ligne.produit.trim()) return;
    await supabase.from('commandes_lignes').insert({
      produit: ligne.produit,
      commentaire: ligne.commentaire,
      commande_id: commandeId,
    });
    setNewLignes((prev) => ({ ...prev, [commandeId]: { produit: '', commentaire: '' } }));
    fetchLignes();
  }

  async function deleteLigne(id: string) {
    await supabase.from('commandes_lignes').delete().eq('id', id);
    fetchLignes();
  }

  async function updateLigne(ligneId: string, data: { produit: string; commentaire: string }) {
    await supabase.from('commandes_lignes').update(data).eq('id', ligneId);
    setEditingLigneId(null);
    fetchLignes();
  }

  async function deleteCommande(id: string) {
    await supabase.from('commandes').delete().eq('id', id);
    fetchCommandes();
  }

  async function updateCommande(id: string, data: { fournisseur: string; urgence: boolean }) {
    await supabase.from('commandes').update(data).eq('id', id);
    setShowEditCommande(false);
    fetchCommandes();
  }

  const grouped = {
    attente: commandes.filter(c => c.statut === 'en attente'),
    commandee: commandes.filter(c => c.statut === 'commandée'),
    recue: commandes.filter(c => c.statut === 'reçue'),
  };

  return (
    <div className="p-6">
      {hotels.length > 0 && (
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          <label className="font-semibold text-gray-700">Hôtel :</label>
          {hotels.map(h => (
            <Button
              key={h.id}
              variant={h.id === selectedHotelId ? "default" : "outline"}
              className={h.id === selectedHotelId ? "bg-[#88C9B9] text-white" : ""}
              onClick={() => setSelectedHotelId(h.id)}
            >
              {h.nom}
            </Button>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">🛒 Commandes</h1>
        <div className="flex gap-2">
          <Input
            placeholder="Fournisseur"
            value={newCommande.fournisseur}
            onChange={(e) => setNewCommande({ ...newCommande, fournisseur: e.target.value })}
            className="w-48"
          />
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={newCommande.urgence}
              onChange={(e) => setNewCommande({ ...newCommande, urgence: e.target.checked })}
            />
            Urgence
          </label>
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={createCommande}>
            ➕ Ajouter
          </Button>
        </div>
      </div>

      <div className="flex justify-end mb-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Afficher les commandes reçues
        </label>
      </div>

      <Section
        title="⏳ En attente"
        color="bg-blue-50 border border-blue-200"
        commandes={grouped.attente}
        lignes={lignes}
        newLignes={newLignes}
        setNewLignes={setNewLignes}
        addLigne={addLigne}
        deleteLigne={deleteLigne}
        confirmAndUpdateStatut={confirmAndUpdateStatut}
        editingLigneId={editingLigneId}
        setEditingLigneId={setEditingLigneId}
        editValues={editValues}
        setEditValues={setEditValues}
        updateLigne={updateLigne}
        deleteCommande={deleteCommande}
        setEditCommande={setEditCommande}
        setShowEditCommande={setShowEditCommande}
      />

      <Section
        title="✅ Commandées"
        color="bg-indigo-50 border border-indigo-200"
        commandes={grouped.commandee}
        lignes={lignes}
        readOnly
        confirmAndUpdateStatut={confirmAndUpdateStatut}
        deleteCommande={deleteCommande}
        setEditCommande={setEditCommande}
        setShowEditCommande={setShowEditCommande}
      />

      {showArchived && (
        <Section
          title="📦 Reçues"
          color="bg-gray-100 border border-gray-200"
          commandes={grouped.recue}
          lignes={lignes}
          readOnly
          deleteCommande={deleteCommande}
          setEditCommande={setEditCommande}
          setShowEditCommande={setShowEditCommande}
        />
      )}

      {/* Dialog modifier commande */}
      <Dialog open={showEditCommande} onOpenChange={setShowEditCommande}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier commande</DialogTitle>
          </DialogHeader>
          {editCommande && (
            <>
              <Input
                placeholder="Fournisseur"
                value={editCommande.fournisseur}
                onChange={(e) => setEditCommande({ ...editCommande, fournisseur: e.target.value })}
                className="mb-2"
              />
              <label className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  checked={editCommande.urgence}
                  onChange={(e) => setEditCommande({ ...editCommande, urgence: e.target.checked })}
                />
                Urgence
              </label>
              <Button onClick={() => updateCommande(editCommande.id, { fournisseur: editCommande.fournisseur, urgence: editCommande.urgence })}>
                Sauvegarder
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- sous composant Section ---
function Section({
  title, color, commandes, lignes,
  newLignes, setNewLignes, addLigne,
  deleteLigne, confirmAndUpdateStatut,
  editingLigneId, setEditingLigneId, editValues, setEditValues, updateLigne,
  deleteCommande, setEditCommande, setShowEditCommande,
  readOnly = false
}: any) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div className="space-y-4">
        {commandes.map((commande: any) => (
          <div key={commande.id} className={`${color} border rounded-lg p-4 shadow`}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-lg">{commande.fournisseur}</h3>
              <div className="flex items-center gap-2">
                {commande.urgence && <span className="text-red-600 text-sm">⚠️ Urgence</span>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">⋮</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <Button variant="ghost" className="w-full justify-start text-red-600" onClick={() => deleteCommande(commande.id)}>
                      Supprimer commande
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" onClick={() => { setEditCommande(commande); setShowEditCommande(true); }}>
                      Modifier fournisseur / urgence
                    </Button>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex flex-col gap-1 mb-2">
              {lignes.filter(l => l.commande_id === commande.id).map(ligne => (
                <div key={ligne.id} className="flex justify-between items-center text-sm">
                  {editingLigneId === ligne.id ? (
                    <div className="flex gap-2 w-full">
                      <Input
                        value={editValues.produit}
                        onChange={(e) => setEditValues({ ...editValues, produit: e.target.value })}
                      />
                      <Input
                        value={editValues.commentaire}
                        onChange={(e) => setEditValues({ ...editValues, commentaire: e.target.value })}
                      />
                      <Button size="sm" onClick={() => updateLigne(ligne.id, editValues)}>💾</Button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <strong>{ligne.produit}</strong>
                        {ligne.commentaire && <span className="text-xs text-gray-500 ml-1">({ligne.commentaire})</span>}
                      </div>
                      {!readOnly && (
                        <div className="flex gap-2">
                          {commande.statut === 'en attente' && (
                            <Button size="sm" variant="ghost" onClick={() => { setEditingLigneId(ligne.id); setEditValues({ produit: ligne.produit, commentaire: ligne.commentaire }); }}>✏️</Button>
                          )}
                          {commande.statut === 'en attente' && (
                            <Button size="sm" variant="ghost" onClick={() => deleteLigne(ligne.id)}>🗑️</Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {!readOnly && commande.statut === 'en attente' && (
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="Produit"
                  value={newLignes[commande.id]?.produit || ''}
                  onChange={(e) => setNewLignes((prev: any) => ({
                    ...prev,
                    [commande.id]: { ...prev[commande.id], produit: e.target.value }
                  }))}
                />
                <Input
                  placeholder="Commentaire"
                  value={newLignes[commande.id]?.commentaire || ''}
                  onChange={(e) => setNewLignes((prev: any) => ({
                    ...prev,
                    [commande.id]: { ...prev[commande.id], commentaire: e.target.value }
                  }))}
                />
                <Button onClick={() => addLigne(commande.id)}>➕</Button>
              </div>
            )}

            <div className="flex gap-2">
              {commande.statut === 'en attente' && (
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => confirmAndUpdateStatut(commande.id, 'commandée')}>Marquer commandée</Button>
              )}
              {commande.statut !== 'reçue' && (
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => confirmAndUpdateStatut(commande.id, 'reçue')}>Marquer reçue</Button>
              )}
            </div>
          </div>
        ))}
        {commandes.length === 0 && <p className="text-sm text-gray-500">Aucune commande</p>}
      </div>
    </div>
  );
}
