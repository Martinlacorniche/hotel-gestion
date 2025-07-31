'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';

export default function TrousseauPage() {
  const { user } = useAuth();

  // Gestion multi-hôtels
  const [hotels, setHotels] = useState([]);
  const [selectedHotelId, setSelectedHotelId] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem('selectedHotelId') || '';
    }
    return '';
  });
  const [currentHotel, setCurrentHotel] = useState(null);

  useEffect(() => {
    if (selectedHotelId && typeof window !== "undefined") {
      window.localStorage.setItem('selectedHotelId', selectedHotelId);
    }
  }, [selectedHotelId]);

  // Données
  const [trousseau, setTrousseau] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [editingId, setEditingId] = useState(null);

  const [newEntry, setNewEntry] = useState({
    outil: '',
    identifiant: '',
    mot_de_passe: '',
    commentaire: '',
  });

  // Chargement hôtels
  useEffect(() => {
    supabase.from('hotels').select('id, nom').then(({ data }) => setHotels(data || []));
  }, []);

  // Hôtel courant
  useEffect(() => {
    if (selectedHotelId) {
      supabase.from('hotels').select('id, nom').eq('id', selectedHotelId).single()
        .then(({ data }) => setCurrentHotel(data));
    }
  }, [selectedHotelId]);

  // Charger trousseau
  useEffect(() => {
    if (!selectedHotelId) return;
    fetchTrousseau();
  }, [selectedHotelId]);

  async function fetchTrousseau() {
    const { data, error } = await supabase
      .from('trousseau')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .order('outil', { ascending: true });
    if (!error) setTrousseau(data || []);
  }

  async function createOrUpdateEntry() {
    setErrorMsg('');

    if (!newEntry.outil || !newEntry.identifiant || !newEntry.mot_de_passe) {
      setErrorMsg("Tous les champs sauf commentaire sont obligatoires.");
      return;
    }

    if (!editingId) {
      // Vérif doublon
      const { data: existing } = await supabase
        .from('trousseau')
        .select('id')
        .eq('hotel_id', selectedHotelId)
        .eq('outil', newEntry.outil)
        .eq('identifiant', newEntry.identifiant)
        .limit(1);

      if (existing && existing.length > 0) {
        setErrorMsg("Cet identifiant pour cet outil existe déjà.");
        return;
      }

      const { error } = await supabase.from('trousseau').insert({
        ...newEntry,
        hotel_id: selectedHotelId,
      });
      if (error) {
        setErrorMsg("Erreur lors de l'ajout.");
        return;
      }
    } else {
      // Edition
      const { error } = await supabase
        .from('trousseau')
        .update({
          outil: newEntry.outil,
          identifiant: newEntry.identifiant,
          mot_de_passe: newEntry.mot_de_passe,
          commentaire: newEntry.commentaire,
        })
        .eq('id', editingId);

      if (error) {
        setErrorMsg("Erreur lors de la mise à jour.");
        return;
      }
    }

    setShowModal(false);
    setEditingId(null);
    setNewEntry({ outil: '', identifiant: '', mot_de_passe: '', commentaire: '' });
    fetchTrousseau();
  }

  async function deleteEntry(id) {
    if (!confirm("Supprimer cette entrée ?")) return;
    await supabase.from('trousseau').delete().eq('id', id);
    fetchTrousseau();
  }

  function editEntry(entry) {
    setEditingId(entry.id);
    setNewEntry({
      outil: entry.outil,
      identifiant: entry.identifiant,
      mot_de_passe: entry.mot_de_passe,
      commentaire: entry.commentaire || '',
    });
    setShowModal(true);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
  }

  const filtered = trousseau.filter(item =>
    item.outil.toLowerCase().includes(search.toLowerCase()) ||
    item.identifiant.toLowerCase().includes(search.toLowerCase()) ||
    (item.commentaire && item.commentaire.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6">
      {/* Switch hôtel */}
      {hotels.length > 0 && (
        <div className="mb-6 flex items-center gap-2">
          <label htmlFor="select-hotel" className="font-semibold text-gray-700">Hôtel :</label>
          <select
            id="select-hotel"
            value={selectedHotelId}
            onChange={e => setSelectedHotelId(e.target.value)}
            className="border rounded px-3 py-2"
          >
            {hotels.map(h => (
              <option key={h.id} value={h.id}>{h.nom}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">🔑 Trousseau</h1>
        <Button
          className="bg-indigo-600 hover:bg-indigo-700 text-white shadow"
          onClick={() => {
            setEditingId(null);
            setNewEntry({ outil: '', identifiant: '', mot_de_passe: '', commentaire: '' });
            setShowModal(true);
          }}
        >
          ➕ Nouvelle entrée
        </Button>
      </div>

      <Input
        placeholder="🔍 Rechercher (outil, identifiant, commentaire)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
      />

      {/* Tableau des entrées */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="table-auto w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-3 py-2 text-left">Outil</th>
              <th className="border px-3 py-2 text-left">Identifiant</th>
              <th className="border px-3 py-2 text-left">Mot de passe</th>
              <th className="border px-3 py-2 text-left">Commentaire</th>
              <th className="border px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="border px-3 py-2">{item.outil}</td>
                <td className="border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{item.identifiant}</span>
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(item.identifiant)}>📋</Button>
                  </div>
                </td>
                <td className="border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{item.mot_de_passe}</span>
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(item.mot_de_passe)}>📋</Button>
                  </div>
                </td>
                <td className="border px-3 py-2">{item.commentaire}</td>
                <td className="border px-3 py-2 text-center">
                  <div className="flex gap-2 justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      className="hover:bg-blue-100 text-blue-600"
                      onClick={() => editEntry(item)}
                    >
                      ✏️
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="hover:bg-red-100 text-red-600"
                      onClick={() => deleteEntry(item.id)}
                    >
                      🗑️
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="5" className="text-center py-4 text-gray-500">
                  Aucune entrée trouvée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal ajout/édition */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Modifier entrée' : 'Nouvelle entrée'}</DialogTitle>
          </DialogHeader>
          {errorMsg && <p className="text-red-500 text-sm mb-2">{errorMsg}</p>}
          <Input placeholder="Outil" value={newEntry.outil} onChange={(e) => setNewEntry({ ...newEntry, outil: e.target.value })} className="mb-2" />
          <Input placeholder="Identifiant" value={newEntry.identifiant} onChange={(e) => setNewEntry({ ...newEntry, identifiant: e.target.value })} className="mb-2" />
          <Input placeholder="Mot de passe" value={newEntry.mot_de_passe} onChange={(e) => setNewEntry({ ...newEntry, mot_de_passe: e.target.value })} className="mb-2" />
          <Input placeholder="Commentaire (optionnel)" value={newEntry.commentaire} onChange={(e) => setNewEntry({ ...newEntry, commentaire: e.target.value })} className="mb-4" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowModal(false)}>Annuler</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={createOrUpdateEntry}>
              {editingId ? 'Mettre à jour' : 'Valider'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
