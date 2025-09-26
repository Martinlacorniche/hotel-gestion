'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';


interface Client {
  id: string;
  nom: string;
  prenom: string;
  societe: string | null;
  email: string | null;
  total_passages: number;
}

export default function FidelitePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClient, setNewClient] = useState({
  nom: '',
  prenom: '',
  societe: '',
  email: '',
  commentaire: ''
});

  const [carte, setCarte] = useState<(string | null)[]>(Array(10).fill(null)); // dates validées
  const [editMode, setEditMode] = useState(false);


  // Charger clients
  useEffect(() => {
    const fetchClients = async () => {
      const { data, error } = await supabase.from('clients').select('*').order('nom');
      if (!error && data) setClients(data);
    };
    fetchClients();
  }, []);

  // Sélection client → charger sa carte fidélité
  const selectClient = async (client: Client) => {
    setSelectedClient(client);
    const { data } = await supabase
      .from('fidelite')
      .select('index_case,date_validation')
      .eq('client_id', client.id)
      .order('index_case');
    if (data) {
      const filled = Array(10).fill(null);
      data.forEach((d) => {
        filled[d.index_case - 1] = d.date_validation;
      });
      setCarte(filled);
    }
  };

  // Toggle case
  const toggleCase = async (i: number) => {
    if (!selectedClient) return;
    const already = carte[i];
    let newCarte = [...carte];
    if (already) {
      // reset la case
      await supabase.from('fidelite').delete().eq('client_id', selectedClient.id).eq('index_case', i + 1);
      newCarte[i] = null;
    } else {
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('fidelite').upsert({
        client_id: selectedClient.id,
        index_case: i + 1,
        date_validation: today,
      });
      newCarte[i] = today;
      // compteur long terme
      await supabase.from('clients').update({
        total_passages: (selectedClient.total_passages || 0) + 1,
      }).eq('id', selectedClient.id);
      setSelectedClient({ ...selectedClient, total_passages: (selectedClient.total_passages || 0) + 1 });
    }
    setCarte(newCarte);
  };

  // Reset carte quand cowork offert validé
  const resetCarte = async () => {
    if (!selectedClient) return;
    await supabase.from('fidelite').delete().eq('client_id', selectedClient.id);
    setCarte(Array(10).fill(null));
  };

  const filteredClients = clients
  .filter(c =>
    `${c.nom} ${c.prenom}`.toLowerCase().includes(search.toLowerCase())
  )
  .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));


  return (
    <div className="p-4">
      {/* Barre de titre */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Fidélité</h1>
        <Button onClick={() => setShowClientModal(true)}>➕ Nouveau client</Button>
      </div>

      <div className="grid grid-cols-[250px_1fr] gap-4 h-[calc(100vh-100px)]">

        {/* Colonne gauche */}
        <Card className="h-full overflow-y-auto">

          <CardContent className="p-4 space-y-2 h-full flex flex-col">
            <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="space-y-1 overflow-y-auto flex-1 pr-1">
              {filteredClients.map(c => (
                <div
                  key={c.id}
                  className={`cursor-pointer p-2 rounded ${selectedClient?.id === c.id ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
                  onClick={() => selectClient(c)}
                >
                  {c.nom} {c.prenom}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Zone droite */}
{selectedClient ? (
  <Card className="h-full overflow-y-auto">
    <CardContent className="p-6 space-y-6">
      {/* Bouton retour */}
      <div>
        <Button variant="outline" onClick={() => setSelectedClient(null)}>
          ⬅ 
        </Button>
      </div>
      {/* Header client */}
      <div className="flex items-center justify-between">
  <div>
    <h2 className="text-xl font-bold">
      {selectedClient.nom} {selectedClient.prenom}
    </h2>

    <div className="flex items-center gap-2 text-gray-600">
      <span>{selectedClient.societe}</span>
      {selectedClient.societe && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(selectedClient.societe || '');
            
          }}
        >
          📋
        </Button>
      )}
    </div>

    <div className="flex items-center gap-2 text-gray-600">
      <span>{selectedClient.email}</span>
      {selectedClient.email && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(selectedClient.email || '');
            
          }}
        >
          📋
        </Button>
      )}
      

    </div>
    {selectedClient.commentaire && (
  <p className="mt-2 text-sm text-gray-700 italic">{selectedClient.commentaire}</p>
)}
  </div>

  {/* Supprimer + Modifier */}
  <div className="flex gap-2">
    <Button
      variant="outline"
      onClick={() => {
        setNewClient({
  nom: selectedClient.nom,
  prenom: selectedClient.prenom,
  societe: selectedClient.societe || '',
  email: selectedClient.email || '',
  commentaire: selectedClient.commentaire || '',
});

        setEditMode(true);
        setShowClientModal(true);
      }}
    >
      ✏️ 
    </Button>
    <Button
      variant="destructive"
      onClick={async () => {
        if (!confirm("Supprimer ce client ?")) return;
        await supabase.from('clients').delete().eq('id', selectedClient.id);
        setClients(clients.filter(c => c.id !== selectedClient.id));
        setSelectedClient(null);
      }}
    >
      🗑️ 
    </Button>
  </div>
</div>


      {/* Carte fidélité */}
<div className="flex justify-center">
  <div className="w-[420px] bg-blue-100 rounded-xl shadow-lg p-6 text-center">
    <h3 className="text-xl font-bold mb-1">CARTE DE FIDÉLITÉ</h3>
    <p className="text-sm text-red-600 mb-4">Dès 10 passages : 1 cowork offert</p>

    {/* Cases en 2 rangées */}
    <div className="grid grid-cols-5 gap-3 mb-2">
      {carte.map((date, i) => (
        <div
          key={i}
          className="w-14 h-14 bg-white border-2 border-gray-300 rounded flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400"
          onClick={() => toggleCase(i)}
        >
          {date ? (
            <>
              <span className="text-lg">✅</span>
              <span className="text-[9px] text-gray-600">
  {date ? format(new Date(date), 'dd-MM-yy', { locale: fr }) : ''}
</span>

            </>
          ) : (
            <span className="text-sm text-gray-400">{i + 1}</span>
          )}
        </div>
      ))}
    </div>

    {/* cowork offert */}
    {carte.every(Boolean) && (
      <div className="mt-4">
        <p className="font-semibold text-green-700">🎉 Prochain cowork offert !</p>
        <Button onClick={resetCarte} className="mt-2">Valider cowork offert</Button>
      </div>
    )}
  </div>
</div>



      {/* Total passages */}
      <div className="text-sm text-gray-700">
        Total passages : <span className="font-bold">{selectedClient.total_passages}</span>
      </div>
    </CardContent>
  </Card>
) : (
  // --- AFFICHAGE TOP 10 ---
 <Card className="h-full overflow-y-auto flex">
  <CardContent className="flex flex-col items-center justify-center w-full max-w-lg mx-auto">
    <h2 className="text-2xl font-bold text-center mb-2">🏆 Les Best !</h2>
    <p className="text-sm text-gray-600 text-center mb-4">Classés par nombre de passages</p>

    <div className="space-y-3">
      {clients
        .sort((a, b) => b.total_passages - a.total_passages)
        .slice(0, 10)
        .map((c, i, arr) => {
          const max = arr[0]?.total_passages || 1;
          const percent = Math.round((c.total_passages / max) * 100);
          const medal =
            i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

          return (
            <div
              key={c.id}
              className="p-3 border rounded-lg flex items-center gap-3 cursor-pointer hover:bg-gray-50"
              onClick={() => selectClient(c)}
            >
              <div className="text-2xl w-10 text-center">{medal}</div>

              <div className="flex-1">
                <div className="font-bold">{c.nom} {c.prenom}</div>
                <div className="w-full bg-gray-200 h-2 rounded mt-1">
                  <div
                    className="bg-indigo-500 h-2 rounded"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              <div className="text-sm text-gray-600 min-w-[50px] text-right">
                {c.total_passages} ✨
              </div>
            </div>
          );
        })}
    </div>
  </CardContent>
</Card>

)}


      </div>

      {/* Modal création client */}
     {showClientModal && (
  <div className="fixed inset-0 flex items-center justify-center bg-black/50">
    <div className="bg-white p-6 rounded-lg w-full max-w-md space-y-3">
      <h2 className="text-xl font-bold">
        {editMode ? 'Modifier client' : 'Nouveau client'}
      </h2>

      <Input
        placeholder="Nom"
        value={newClient.nom}
        onChange={e => setNewClient({ ...newClient, nom: e.target.value })}
      />
      <Input
        placeholder="Prénom"
        value={newClient.prenom}
        onChange={e => setNewClient({ ...newClient, prenom: e.target.value })}
      />
      <Input
        placeholder="Société"
        value={newClient.societe}
        onChange={e => setNewClient({ ...newClient, societe: e.target.value })}
      />
      <Input
        placeholder="Email"
        value={newClient.email}
        onChange={e => setNewClient({ ...newClient, email: e.target.value })}
      />

      {/* Commentaire */}
      <textarea
  placeholder="Commentaire"
  rows={3}
  className="w-full border rounded px-2 py-1"
  value={newClient.commentaire}
  onChange={e => setNewClient({ ...newClient, commentaire: e.target.value })}
/>


      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setShowClientModal(false)}>Annuler</Button>
        <Button
          onClick={async () => {
            if (editMode && selectedClient) {
              // update
              const { data, error } = await supabase
                .from('clients')
                .update(newClient)
                .eq('id', selectedClient.id)
                .select()
                .single();
              if (!error && data) {
                setClients(clients.map(c => c.id === data.id ? data : c));
                setSelectedClient(data);
              }
            } else {
              // insert
              const { data, error } = await supabase
                .from('clients')
                .insert([{ ...newClient, total_passages: 0 }])
                .select()
                .single();
              if (!error && data) setClients([...clients, data]);
            }
            setShowClientModal(false);
            setEditMode(false);
            setNewClient({ nom: '', prenom: '', societe: '', email: '', commentaire: '' });
          }}
        >
          {editMode ? 'Enregistrer' : 'Créer'}
        </Button>
      </div>
    </div>
  </div>
)}

    </div>
  );
}
