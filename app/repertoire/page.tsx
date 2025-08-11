'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';

export default function RepertoirePage() {
  const { user } = useAuth();

  const [hotels, setHotels] = useState([]);
  const [selectedHotelId, setSelectedHotelId] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem('selectedHotelId') || '';
    }
    return '';
  });
  const [currentHotel, setCurrentHotel] = useState(null);

  useEffect(() => {
  const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : '';
  document.title = `Répertoire${hotelName}`; // adapte “Planning” -> “Parking”, “Commandes”, ...
}, [currentHotel]);


  useEffect(() => {
    if (selectedHotelId && typeof window !== "undefined") {
      window.localStorage.setItem('selectedHotelId', selectedHotelId);
    }
  }, [selectedHotelId]);

  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [editingId, setEditingId] = useState(null);

  const [newEntry, setNewEntry] = useState({
    qui_quoi: '',
    contact: '',
    commentaire: '',
  });

  useEffect(() => {
    supabase.from('hotels').select('id, nom').then(({ data }) => setHotels(data || []));
  }, []);

  useEffect(() => {
    if (selectedHotelId) {
      supabase.from('hotels').select('id, nom').eq('id', selectedHotelId).single()
        .then(({ data }) => setCurrentHotel(data));
    }
  }, [selectedHotelId]);

  useEffect(() => {
    if (!selectedHotelId) return;
    fetchEntries();
  }, [selectedHotelId]);

  async function fetchEntries() {
    const { data, error } = await supabase
      .from('repertoire')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .order('qui_quoi', { ascending: true });
    if (!error) setEntries(data || []);
  }

  async function createOrUpdateEntry() {
    setErrorMsg('');

    if (!newEntry.qui_quoi || !newEntry.contact) {
      setErrorMsg("Les champs Qui/Quoi et Contact sont obligatoires.");
      return;
    }

    if (!editingId) {
      const { error } = await supabase.from('repertoire').insert({
        ...newEntry,
        hotel_id: selectedHotelId,
      });
      if (error) {
        setErrorMsg("Erreur lors de l'ajout.");
        return;
      }
    } else {
      const { error } = await supabase
        .from('repertoire')
        .update({
          qui_quoi: newEntry.qui_quoi,
          contact: newEntry.contact,
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
    setNewEntry({ qui_quoi: '', contact: '', commentaire: '' });
    fetchEntries();
  }

  async function deleteEntry(id) {
    if (!confirm("Supprimer cette entrée ?")) return;
    await supabase.from('repertoire').delete().eq('id', id);
    fetchEntries();
  }

  function editEntry(entry) {
    setEditingId(entry.id);
    setNewEntry({
      qui_quoi: entry.qui_quoi,
      contact: entry.contact,
      commentaire: entry.commentaire || '',
    });
    setShowModal(true);
  }

  const filtered = entries.filter(item =>
    item.qui_quoi.toLowerCase().includes(search.toLowerCase()) ||
    item.contact.toLowerCase().includes(search.toLowerCase()) ||
    (item.commentaire && item.commentaire.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6">
      {hotels.length > 0 && (
        <div className="mb-6 flex items-center gap-2">
  <label htmlFor="select-hotel" className="font-semibold text-gray-700"> Hôtel :</label>
  <div className="flex gap-2 flex-wrap">
  {hotels.map(h => (
    <button
      key={h.id}
      onClick={() => setSelectedHotelId(h.id)}
      className={`px-4 py-2 rounded-lg shadow font-semibold border transition ${
        h.id === selectedHotelId
          ? 'bg-[#88C9B9] text-white border-[#88C9B9]'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {h.nom}
    </button>
  ))}
</div>

</div>

      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">📖 Répertoire</h1>
        <Button
          className="bg-indigo-500 hover:bg-indigo-600 text-white"
          onClick={() => {
            setEditingId(null);
            setNewEntry({ qui_quoi: '', contact: '', commentaire: '' });
            setShowModal(true);
          }}
        >
          ➕  Ajouter
        </Button>
      </div>

      <Input
        placeholder="🔍 Rechercher (nom, contact, commentaire)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
      />

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="table-auto w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-3 py-2 text-left">Qui/Quoi</th>
              <th className="border px-3 py-2 text-left">Contact</th>
              <th className="border px-3 py-2 text-left">Commentaire</th>
              <th className="border px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="border px-3 py-2">{item.qui_quoi}</td>
                <td className="border px-3 py-2">{item.contact}</td>
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
                <td colSpan="4" className="text-center py-4 text-gray-500">
                  Aucune entrée trouvée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Modifier entrée' : 'Nouvelle entrée'}</DialogTitle>
          </DialogHeader>
          {errorMsg && <p className="text-red-500 text-sm mb-2">{errorMsg}</p>}
          <Input placeholder="Qui/Quoi" value={newEntry.qui_quoi} onChange={(e) => setNewEntry({ ...newEntry, qui_quoi: e.target.value })} className="mb-2" />
          <Input placeholder="Contact" value={newEntry.contact} onChange={(e) => setNewEntry({ ...newEntry, contact: e.target.value })} className="mb-2" />
          <Input placeholder="Commentaire (optionnel)" value={newEntry.commentaire} onChange={(e) => setNewEntry({ ...newEntry, commentaire: e.target.value })} className="mb-4" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowModal(false)}>Annuler</Button>
            <Button className="bg-indigo-500 hover:bg-indigo-600 text-white" onClick={createOrUpdateEntry}>
              {editingId ? 'Mettre à jour' : 'Valider'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
