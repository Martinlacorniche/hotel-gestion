"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";

export default function ProcessPage() {
  const { user } = useAuth();

  // Sélecteur hôtel
  const [hotels, setHotels] = useState<any[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem("selectedHotelId") || "";
    }
    return "";
  });
  const [currentHotel, setCurrentHotel] = useState<any | null>(null);

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
    supabase.from("hotels").select("id, nom").then(({ data }) => setHotels(data || []));
  }, []);

  useEffect(() => {
    if (selectedHotelId) {
      supabase
        .from("hotels")
        .select("id, nom")
        .eq("id", selectedHotelId)
        .single()
        .then(({ data }) => setCurrentHotel(data));
    }
  }, [selectedHotelId]);

  // Data
  type Process = { id: string; title: string; body: string; hotel_id: string };
  const [processes, setProcesses] = useState<Process[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "" });

  useEffect(() => {
    if (!selectedHotelId) return;
    fetchProcesses();
  }, [selectedHotelId]);

  async function fetchProcesses() {
    const { data } = await supabase
      .from("processes")
      .select("*")
      .eq("hotel_id", selectedHotelId)
      .order("title", { ascending: true });
    setProcesses(data || []);
  }

  function openCreate() {
    setEditingId(null);
    setForm({ title: "", body: "" });
    setModalOpen(true);
  }
  function openEdit(p: Process) {
    setEditingId(p.id);
    setForm({ title: p.title, body: p.body });
    setModalOpen(true);
  }

  async function saveProcess() {
    if (!form.title.trim() || !form.body.trim()) return;
    if (!editingId) {
      await supabase.from("processes").insert({
        title: form.title.trim(),
        body: form.body,
        hotel_id: selectedHotelId,
      });
    } else {
      await supabase.from("processes").update({
        title: form.title.trim(),
        body: form.body,
      }).eq("id", editingId);
    }
    setModalOpen(false);
    fetchProcesses();
  }

 // --- Fonction suppression mise à jour ---
async function deleteProcess(id: string) {
  if (!confirm("Supprimer ce process ?")) return;
  await supabase.from("processes").delete().eq("id", id);
  fetchProcesses();
  // ✅ Fermeture modal + reset
  setModalOpen(false);
  setEditingId(null);
  setForm({ title: "", body: "" });
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
    <div className="p-6">
      {/* Sélecteur hôtel */}
      {hotels.length > 0 && (
        <div className="mb-6 flex items-center gap-2">
          <label className="font-semibold text-gray-700">Hôtel :</label>
          <div className="flex gap-2 flex-wrap">
            {hotels.map(h => (
              <button
                key={h.id}
                onClick={() => setSelectedHotelId(h.id)}
                className={`px-4 py-2 rounded-lg shadow font-semibold border transition ${
                  h.id === selectedHotelId
                    ? "bg-[#88C9B9] text-white border-[#88C9B9]"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {h.nom}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">📚 Process</h1>
        <Button
          className="bg-indigo-600 hover:bg-indigo-700 text-white shadow"
          onClick={openCreate}
        >
          ➕ Nouveau process
        </Button>
      </div>

      {/* Recherche */}
      <div className="relative mb-6">
        <Input
          placeholder=" Rechercher un process..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
        <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
      </div>

      {/* Bulles */}
      {filtered.length === 0 ? (
        <p className="text-gray-500 italic">Aucun process pour cet hôtel.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
  {filtered.map(p => (
    <button
      key={p.id}
      onClick={() => openEdit(p)}
      className="px-5 py-2 rounded-2xl bg-white/60 backdrop-blur-md border border-gray-200 shadow-sm
                 hover:shadow-lg hover:bg-indigo-50 hover:border-indigo-300
                 transition-all duration-200 transform hover:scale-105
                 text-sm font-medium text-gray-800 max-w-xs truncate"
    >
      {p.title}
    </button>
          ))}
        </div>
      )}

      {/* Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Modifier le process" : "Nouveau process"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Nom du process"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
            <textarea
              placeholder="Description détaillée"
              className="w-full min-h-[240px] border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={form.body}
              onChange={e => setForm({ ...form, body: e.target.value })}
            />
            <div className="flex justify-between pt-4">
              {editingId ? (
                <Button
                  variant="outline"
                  className="text-red-600 border-red-300 hover:bg-red-50"
                  onClick={() => deleteProcess(editingId)}
                >
                  🗑️ Supprimer
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setModalOpen(false)}>
                  Annuler
                </Button>
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={saveProcess}
                >
                  {editingId ? "Mettre à jour" : "Valider"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
