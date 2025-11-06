'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { format, isAfter, isBefore, parseISO, isWithinInterval } from 'date-fns';
import { fr } from 'date-fns/locale';



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
  date_debut: string; // 'YYYY-MM-DD'
  date_fin: string;   // 'YYYY-MM-DD'
  date_paiement: string | null; // 'YYYY-MM-DD' | null
  prix: string | null; // stocké en texte côté input, converti côté SQL
  commentaire: string | null;
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

  // Sélection client → charger sa carte fidélité + abonnement
  const selectClient = async (client: Client) => {
    setSelectedClient(client);

    // Carte fidélité
    const { data } = await supabase
      .from('fidelite')
      .select('index_case,date_validation')
      .eq('client_id', client.id)
      .order('index_case');
    if (data) {
      const filled = Array(10).fill(null) as (string | null)[];
      data.forEach((d: any) => {
        filled[d.index_case - 1] = d.date_validation;
      });
      setCarte(filled);
    }

    // Abonnement (1 enregistrement par client)
    const { data: abo, error: aboErr } = await supabase
      .from('abonnements')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle();

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
      await supabase
        .from('fidelite')
        .delete()
        .eq('client_id', selectedClient.id)
        .eq('index_case', i + 1);
      newCarte[i] = null;
    } else {
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('fidelite').upsert({
        client_id: selectedClient.id,
        index_case: i + 1,
        date_validation: today,
      });
      newCarte[i] = today;
      await supabase
        .from('clients')
        .update({ total_passages: (selectedClient.total_passages || 0) + 1 })
        .eq('id', selectedClient.id);
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

  // Enregistrer/Mettre à jour l'abonnement (upsert sur clé primaire client_id)
  const saveAbonnement = async () => {
    if (!selectedClient) return;

    if (!abonnement) {
      return;
    }

    if (!abonnement.date_debut || !abonnement.date_fin) {
      alert('Merci de renseigner les dates "Du" et "Au".');
      return;
    }

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

    if (error) {
      console.error(error);
      alert("Impossible d'enregistrer l'abonnement");
      return;
    }
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
            <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="space-y-1 overflow-y-auto flex-1 pr-1">
              {filteredClients.map((c) => (
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
                <Button variant="outline" onClick={() => setSelectedClient(null)}>⬅</Button>
              </div>

              {/* Header client */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold">
                      {selectedClient.nom} {selectedClient.prenom}
                    </h2>
                    {/* Badge abonnement */}
                    {(() => {
                      if (!abonnementActif || !abonnement) return null;
                      const today = new Date();
                      const deb = abonnement.date_debut ? new Date(abonnement.date_debut) : null;
                      const fin = abonnement.date_fin ? new Date(abonnement.date_fin) : null;
                      const isActive = deb && fin && today >= deb && today <= fin;
                      const isExpired = fin && today > fin;
                      if (isActive)
                        return <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 border border-green-300">Abonnement actif</span>;
                      if (isExpired)
                        return <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-300">Abonnement expiré</span>;
                      return null;
                    })()}
                  </div>

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
                      if (!confirm('Supprimer ce client ?')) return;
                      await supabase.from('clients').delete().eq('id', selectedClient.id);
                      setClients(clients.filter((c) => c.id !== selectedClient.id));
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
  {date ? format(new Date(date), 'dd/MM/yyyy', { locale: fr }) : ''}
</span>

                          </>
                        ) : (
                          <span className="text-sm text-gray-400">{i + 1}</span>
                        )}
                      </div>
                    ))}
                  </div>

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

              {/* ABONNEMENT */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Abonnement</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={abonnementActif}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAbonnement({
                            client_id: selectedClient.id,
                            date_debut: '',
                            date_fin: '',
                            date_paiement: null,
                            prix: null,
                            commentaire: null,
                          });
                          setAboEdit(true);
                        } else {
                          setAbonnement(null);
                          setAboEdit(false);
                        }
                      }}
                    />
                    Activer
                  </label>
                </div>

                {abonnementActif && abonnement && (
                  <>
                    {/* MODE LECTURE */}
                    {!aboEdit && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div className="text-sm">
  <span className="text-gray-500">Du</span>
  <div className="font-medium">
    {abonnement.date_debut ? format(new Date(abonnement.date_debut), 'dd/MM/yyyy', { locale: fr }) : '-'}
  </div>
</div>

<div className="text-sm">
  <span className="text-gray-500">Au</span>
  <div className="font-medium">
    {abonnement.date_fin ? format(new Date(abonnement.date_fin), 'dd/MM/yyyy', { locale: fr }) : '-'}
  </div>
</div>

<div className="text-sm">
  <span className="text-gray-500">Payé le</span>
  <div className="font-medium">
    {abonnement.date_paiement ? format(new Date(abonnement.date_paiement), 'dd/MM/yyyy', { locale: fr }) : '-'}
  </div>
</div>

                          <div className="text-sm"><span className="text-gray-500">Prix</span><div className="font-medium">{abonnement.prix ? `${abonnement.prix} €` : '-'}</div></div>
                        </div>
                        {abonnement.commentaire && (
                          <div className="text-sm"><span className="text-gray-500">Commentaire</span><div className="font-medium whitespace-pre-line">{abonnement.commentaire}</div></div>
                        )}
                        <div className="flex items-center gap-2">
                          <Button variant="outline" onClick={() => setAboEdit(true)}>Modifier</Button>
                          <Button variant="outline" onClick={deleteAbonnement}>Supprimer</Button>
                        </div>
                      </div>
                    )}

                    {/* MODE ÉDITION */}
                    {aboEdit && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div className="flex flex-col">
                            <label className="text-xs text-gray-600 mb-1">Du</label>
                            <Input
                              type="date"
                              className="h-9"
                              value={abonnement.date_debut}
                              onChange={(e) => setAbonnement({ ...abonnement, date_debut: e.target.value })}
                            />
                          </div>
                          <div className="flex flex-col">
                            <label className="text-xs text-gray-600 mb-1">Au</label>
                            <Input
                              type="date"
                              className="h-9"
                              value={abonnement.date_fin}
                              onChange={(e) => setAbonnement({ ...abonnement, date_fin: e.target.value })}
                            />
                          </div>
                          <div className="flex flex-col">
                            <label className="text-xs text-gray-600 mb-1">Payé le</label>
                            <Input
                              type="date"
                              className="h-9"
                              value={abonnement.date_paiement || ''}
                              onChange={(e) => setAbonnement({ ...abonnement, date_paiement: e.target.value || null })}
                            />
                          </div>
                          <div className="flex flex-col">
                            <label className="text-xs text-gray-600 mb-1">Prix</label>
                            <Input
                              type="number"
                              inputMode="decimal"
                              placeholder="€"
                              className="h-9"
                              value={abonnement.prix || ''}
                              onChange={(e) => setAbonnement({ ...abonnement, prix: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-600 mb-1">Commentaire</label>
                          <textarea
                            rows={3}
                            className="w-full border rounded px-2 py-1"
                            value={abonnement.commentaire || ''}
                            onChange={(e) => setAbonnement({ ...abonnement, commentaire: e.target.value })}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button onClick={saveAbonnement} disabled={savingAbo}>
                            {savingAbo ? 'Enregistrement…' : 'Enregistrer'}
                          </Button>
                          <Button variant="outline" onClick={() => selectedClient && selectClient(selectedClient)}>Annuler</Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
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
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

                    return (
                      <div
                        key={c.id}
                        className="p-3 border rounded-lg flex items-center gap-3 cursor-pointer hover:bg-gray-50"
                        onClick={() => selectClient(c)}
                      >
                        <div className="text-2xl w-10 text-center">{medal}</div>

                        <div className="flex-1">
                          <div className="font-bold">
                            {c.nom} {c.prenom}
                          </div>
                          <div className="w-full bg-gray-200 h-2 rounded mt-1">
                            <div className="bg-indigo-500 h-2 rounded" style={{ width: `${percent}%` }} />
                          </div>
                        </div>

                        <div className="text-sm text-gray-600 min-w-[50px] text-right">{c.total_passages} ✨</div>
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
            <h2 className="text-xl font-bold">{editMode ? 'Modifier client' : 'Nouveau client'}</h2>

            <Input placeholder="Nom" value={newClient.nom} onChange={(e) => setNewClient({ ...newClient, nom: e.target.value })} />
            <Input placeholder="Prénom" value={newClient.prenom} onChange={(e) => setNewClient({ ...newClient, prenom: e.target.value })} />
            <Input placeholder="Société" value={newClient.societe} onChange={(e) => setNewClient({ ...newClient, societe: e.target.value })} />
            <Input placeholder="Email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />

            <textarea
              placeholder="Commentaire"
              rows={3}
              className="w-full border rounded px-2 py-1"
              value={newClient.commentaire}
              onChange={(e) => setNewClient({ ...newClient, commentaire: e.target.value })}
            />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowClientModal(false)}>Annuler</Button>
              <Button
                onClick={async () => {
                  if (editMode && selectedClient) {
                    const { data, error } = await supabase
                      .from('clients')
                      .update(newClient)
                      .eq('id', selectedClient.id)
                      .select()
                      .single();
                    if (!error && data) {
                      setClients(clients.map((c) => (c.id === (data as any).id ? (data as any) : c)));
                      setSelectedClient(data as any);
                    }
                  } else {
                    const { data, error } = await supabase
                      .from('clients')
                      .insert([{ ...newClient, total_passages: 0 }])
                      .select()
                      .single();
                    if (!error && data) setClients([...clients, data as any]);
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
