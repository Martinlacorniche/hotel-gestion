"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabaseClient";
import { ThemedBackground } from "@/components/ThemedBackground";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useHotelScope } from "@/hooks/useHotelScope";
import {
  Search, Plus, ChevronLeft, Trash2, Save, Edit2, FileText, NotebookText,
  Key, BookOpen, Phone, Mail, MapPin, User, Globe, Copy, Eye, EyeOff,
  Check, Lock, Shield,
} from "lucide-react";

// --- TYPES ---
type Process = { id: string; title: string; body: string; hotel_id: string };
type Contact = { id: string; qui_quoi: string; contact: string; commentaire?: string; hotel_id: string };
type Trousseau = {
  id: string; outil: string; identifiant: string; mot_de_passe: string;
  commentaire?: string; url?: string; hotel_id: string;
};

type Kind = "process" | "contact" | "identifiant";
type Selected =
  | { kind: "process"; data: Process }
  | { kind: "contact"; data: Contact }
  | { kind: "identifiant"; data: Trousseau };

// Métadonnées d'affichage par catégorie (icône, libellé, couleurs de la pastille).
const KIND_META: Record<Kind, { label: string; Icon: typeof FileText; text: string; bg: string }> = {
  process: { label: "Process", Icon: FileText, text: "text-slate-600", bg: "bg-slate-100" },
  contact: { label: "Contact", Icon: NotebookText, text: "text-blue-600", bg: "bg-blue-50" },
  identifiant: { label: "Identifiant", Icon: Key, text: "text-cyan-700", bg: "bg-cyan-50" },
};

type TabKey = "tout" | Kind;
const TABS: { key: TabKey; label: string }[] = [
  { key: "tout", label: "Tout" },
  { key: "process", label: "Process" },
  { key: "contact", label: "Contacts" },
  { key: "identifiant", label: "Identifiants" },
];

// Ligne normalisée pour la liste unifiée + la recherche globale.
type Row = { kind: Kind; id: string; title: string; subtitle: string; hay: string; sel: Selected };

export default function InfosPage() {
  const { hotels, selectedHotelId, setSelectedHotelId, currentHotel } = useHotelScope();

  // --- DONNÉES ---
  const [processes, setProcesses] = useState<Process[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [keys, setKeys] = useState<Trousseau[]>([]);

  // --- NAVIGATION LISTE ---
  const [tab, setTab] = useState<TabKey>("tout");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  // --- ÉDITION INLINE (process & contacts) ---
  // composing = on crée une nouvelle entrée de ce type ; mode = vue/édition d'une entrée existante.
  const [composing, setComposing] = useState<"process" | "contact" | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [pForm, setPForm] = useState({ title: "", body: "" });
  const [cForm, setCForm] = useState({ qui_quoi: "", contact: "", commentaire: "" });

  // --- IDENTIFIANTS (détail + modal) ---
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [keyForm, setKeyForm] = useState({ outil: "", identifiant: "", mot_de_passe: "", commentaire: "", url: "" });
  const [keyError, setKeyError] = useState("");

  // --- EFFETS ---
  useEffect(() => {
    const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : "";
    document.title = `Infos${hotelName}`;
  }, [currentHotel]);

  useEffect(() => {
    if (selectedHotelId) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHotelId]);

  function resetSelection() {
    setSelected(null);
    setComposing(null);
    setMode("view");
  }

  async function fetchAll() {
    const [p, c, k] = await Promise.all([
      supabase.from("processes").select("*").eq("hotel_id", selectedHotelId).order("title", { ascending: true }),
      supabase.from("repertoire").select("*").eq("hotel_id", selectedHotelId).order("qui_quoi", { ascending: true }),
      supabase.from("trousseau").select("*").eq("hotel_id", selectedHotelId).order("outil", { ascending: true }),
    ]);
    setProcesses(p.data || []);
    setContacts(c.data || []);
    setKeys(k.data || []);
  }

  // --- LISTE UNIFIÉE + RECHERCHE ---
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (tab === "tout" || tab === "process") {
      for (const p of processes)
        out.push({ kind: "process", id: p.id, title: p.title, subtitle: p.body.slice(0, 60),
          hay: `${p.title} ${p.body}`.toLowerCase(), sel: { kind: "process", data: p } });
    }
    if (tab === "tout" || tab === "contact") {
      for (const c of contacts)
        out.push({ kind: "contact", id: c.id, title: c.qui_quoi, subtitle: c.contact,
          hay: `${c.qui_quoi} ${c.contact} ${c.commentaire || ""}`.toLowerCase(), sel: { kind: "contact", data: c } });
    }
    if (tab === "tout" || tab === "identifiant") {
      for (const k of keys)
        out.push({ kind: "identifiant", id: k.id, title: k.outil, subtitle: k.identifiant,
          hay: `${k.outil} ${k.identifiant} ${k.commentaire || ""}`.toLowerCase(), sel: { kind: "identifiant", data: k } });
    }
    const q = search.trim().toLowerCase();
    const filtered = q ? out.filter((r) => r.hay.includes(q)) : out;
    return filtered.sort((a, b) => a.title.localeCompare(b.title));
  }, [processes, contacts, keys, tab, search]);

  const isSelected = (r: Row) => selected?.kind === r.kind && selected.data.id === r.id;

  // --- SÉLECTION ---
  function selectRow(r: Row) {
    setComposing(null);
    setMode("view");
    setSelected(r.sel);
    if (r.kind === "process") setPForm({ title: r.sel.kind === "process" ? r.sel.data.title : "", body: r.sel.kind === "process" ? r.sel.data.body : "" });
    if (r.kind === "contact" && r.sel.kind === "contact")
      setCForm({ qui_quoi: r.sel.data.qui_quoi, contact: r.sel.data.contact, commentaire: r.sel.data.commentaire || "" });
    if (r.kind === "identifiant") setShowPassword(false);
  }

  // --- CRÉATION ---
  function startCreate(kind: Kind) {
    setShowCreateMenu(false);
    setSelected(null);
    if (kind === "process") { setComposing("process"); setPForm({ title: "", body: "" }); setMode("edit"); }
    if (kind === "contact") { setComposing("contact"); setCForm({ qui_quoi: "", contact: "", commentaire: "" }); setMode("edit"); }
    if (kind === "identifiant") {
      setComposing(null);
      setEditingKeyId(null);
      setKeyForm({ outil: "", identifiant: "", mot_de_passe: "", commentaire: "", url: "" });
      setKeyError("");
      setShowKeyModal(true);
    }
  }

  // --- PROCESS : save / delete ---
  async function saveProcess() {
    if (!pForm.title.trim() || !pForm.body.trim()) return;
    if (composing === "process") {
      const { data } = await supabase.from("processes")
        .insert({ title: pForm.title.trim(), body: pForm.body, hotel_id: selectedHotelId }).select().single();
      if (data) { setSelected({ kind: "process", data }); setComposing(null); }
    } else if (selected?.kind === "process") {
      const { data } = await supabase.from("processes")
        .update({ title: pForm.title.trim(), body: pForm.body }).eq("id", selected.data.id).select().single();
      if (data) setSelected({ kind: "process", data });
    }
    setMode("view");
    fetchAll();
  }

  async function deleteProcess() {
    if (selected?.kind !== "process") return;
    if (!(await confirmDialog("Supprimer définitivement ce process ?"))) return;
    await supabase.from("processes").delete().eq("id", selected.data.id);
    resetSelection();
    fetchAll();
  }

  // --- CONTACT : save / delete ---
  async function saveContact() {
    if (!cForm.qui_quoi.trim() || !cForm.contact.trim()) { toast.error("Nom et contact obligatoires"); return; }
    if (composing === "contact") {
      const { data } = await supabase.from("repertoire").insert({ ...cForm, hotel_id: selectedHotelId }).select().single();
      if (data) { setSelected({ kind: "contact", data }); setComposing(null); }
    } else if (selected?.kind === "contact") {
      const { data } = await supabase.from("repertoire").update({ ...cForm }).eq("id", selected.data.id).select().single();
      if (data) setSelected({ kind: "contact", data });
    }
    setMode("view");
    fetchAll();
  }

  async function deleteContact() {
    if (selected?.kind !== "contact") return;
    if (!(await confirmDialog("Supprimer ce contact ?"))) return;
    await supabase.from("repertoire").delete().eq("id", selected.data.id);
    resetSelection();
    fetchAll();
  }

  // --- IDENTIFIANT : save / delete / utils ---
  function copyToClipboard(text: string, fieldId: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 1500);
  }
  function normalizeUrl(u: string) {
    const s = (u || "").trim();
    if (!s) return null;
    return /^https?:\/\//i.test(s) ? s : `https://${s}`;
  }
  function editKey(k: Trousseau) {
    setEditingKeyId(k.id);
    setKeyForm({ outil: k.outil, identifiant: k.identifiant, mot_de_passe: k.mot_de_passe, commentaire: k.commentaire || "", url: k.url || "" });
    setKeyError("");
    setShowKeyModal(true);
  }
  async function saveKey() {
    setKeyError("");
    if (!keyForm.outil || !keyForm.identifiant || !keyForm.mot_de_passe) { setKeyError("Champs obligatoires manquants."); return; }
    const payload = {
      outil: keyForm.outil, identifiant: keyForm.identifiant, mot_de_passe: keyForm.mot_de_passe,
      commentaire: keyForm.commentaire, url: normalizeUrl(keyForm.url), hotel_id: selectedHotelId,
    };
    if (!editingKeyId) {
      const { data: existing } = await supabase.from("trousseau").select("id")
        .eq("hotel_id", selectedHotelId).eq("outil", keyForm.outil).eq("identifiant", keyForm.identifiant).limit(1);
      if (existing && existing.length > 0) { setKeyError("Cet outil/identifiant existe déjà."); return; }
      const { data, error } = await supabase.from("trousseau").insert(payload).select().single();
      if (error) { setKeyError("Erreur ajout."); return; }
      if (data) setSelected({ kind: "identifiant", data });
    } else {
      const { data, error } = await supabase.from("trousseau").update(payload).eq("id", editingKeyId).select().single();
      if (error) { setKeyError("Erreur mise à jour."); return; }
      if (data) setSelected({ kind: "identifiant", data });
    }
    setShowKeyModal(false);
    fetchAll();
  }
  async function deleteKey(id: string) {
    if (!(await confirmDialog("Supprimer cette entrée ?"))) return;
    await supabase.from("trousseau").delete().eq("id", id);
    if (selected?.kind === "identifiant" && selected.data.id === id) resetSelection();
    fetchAll();
  }

  const getContactIcon = (contact: string) => {
    if (contact.includes("@")) return <Mail className="w-4 h-4" />;
    if (/[0-9]{2}.[0-9]{2}/.test(contact) || contact.startsWith("+")) return <Phone className="w-4 h-4" />;
    return <MapPin className="w-4 h-4" />;
  };

  const showEditor = composing !== null || (selected !== null && mode === "edit");
  const hasMain = selected !== null || composing !== null;

  return (
    <div className="flex h-screen font-sans text-slate-900 overflow-hidden">
      <ThemedBackground />

      {/* --- SIDEBAR GAUCHE --- */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm">
        <div className="p-4 border-b border-slate-100 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2 relative">
              <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                <BookOpen className="w-6 h-6 text-[var(--brand)]" /> Infos
              </h1>
              <button onClick={() => setShowCreateMenu((v) => !v)} className="p-2 bg-indigo-50 text-[var(--brand)] rounded-lg hover:bg-indigo-100 transition" title="Ajouter">
                <Plus className="w-5 h-5" />
              </button>
              {showCreateMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowCreateMenu(false)} />
                  <div className="absolute right-0 top-10 z-40 w-44 bg-white rounded-xl shadow-xl border border-slate-100 p-1.5 animate-in fade-in zoom-in duration-150">
                    {(["process", "contact", "identifiant"] as Kind[]).map((k) => {
                      const M = KIND_META[k];
                      return (
                        <button key={k} onClick={() => startCreate(k)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${M.bg} ${M.text}`}><M.Icon className="w-4 h-4" /></span>
                          {M.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Recherche globale */}
          <div className="relative group">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
            <input
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)] focus:bg-white outline-none transition-all"
              placeholder="Rechercher (process, contacts, identifiants)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Onglets catégories */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition ${tab === t.key ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {rows.length === 0 && <div className="text-center text-xs text-slate-400 py-8 italic">Aucun résultat.</div>}
          {rows.map((r) => {
            const M = KIND_META[r.kind];
            const active = isSelected(r);
            return (
              <div
                key={`${r.kind}-${r.id}`}
                onClick={() => selectRow(r)}
                className={`group p-3 rounded-xl cursor-pointer transition-all border border-transparent flex items-center gap-3 ${active ? "bg-indigo-50 border-indigo-100" : "hover:bg-slate-50 hover:border-slate-100"}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${M.bg} ${M.text}`}>
                  <M.Icon className="w-5 h-5" />
                </div>
                <div className="overflow-hidden flex-1">
                  <h3 className={`font-bold text-sm truncate ${active ? "text-indigo-800" : "text-slate-800"}`}>{r.title}</h3>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{r.subtitle}</p>
                </div>
                {tab === "tout" && (
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${M.bg} ${M.text} shrink-0`}>{M.label}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* --- MAIN --- */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 relative">
        {!hasMain ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
            <BookOpen className="w-24 h-24 mb-4 opacity-20" />
            <p className="text-lg font-medium">Sélectionnez ou créez une fiche</p>
            <p className="text-sm text-slate-400">Process · Contacts · Identifiants au même endroit</p>
          </div>
        ) : (composing === "process" || selected?.kind === "process") ? (
          /* ====== PROCESS ====== */
          <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full bg-white shadow-xl shadow-slate-200/50 my-0 md:my-6 md:rounded-2xl border-x md:border border-slate-200 overflow-hidden">
            <div className="h-16 border-b border-slate-100 flex items-center justify-between px-6 shrink-0 bg-white">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <button onClick={resetSelection} className="md:hidden p-2 -ml-2 text-slate-400"><ChevronLeft className="w-6 h-6" /></button>
                {showEditor ? (
                  <input className="text-lg font-bold text-slate-900 placeholder:text-slate-300 outline-none bg-transparent w-full" placeholder="Titre du process…" value={pForm.title} onChange={(e) => setPForm({ ...pForm, title: e.target.value })} autoFocus />
                ) : (
                  <h2 className="text-xl font-bold text-slate-900 truncate">{selected?.kind === "process" && selected.data.title}</h2>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {showEditor ? (
                  <>
                    <button onClick={() => { if (composing) resetSelection(); else { setMode("view"); if (selected?.kind === "process") setPForm({ title: selected.data.title, body: selected.data.body }); } }} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-lg transition">Annuler</button>
                    <button onClick={saveProcess} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white btn-brand hover:bg-indigo-700 rounded-lg shadow-md shadow-slate-300/40 transition active:scale-95"><Save className="w-4 h-4" /> Enregistrer</button>
                  </>
                ) : (
                  <>
                    <button onClick={deleteProcess} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Supprimer"><Trash2 className="w-5 h-5" /></button>
                    <button onClick={() => { if (selected?.kind === "process") { setPForm({ title: selected.data.title, body: selected.data.body }); setMode("edit"); } }} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-[var(--brand)] bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"><Edit2 className="w-4 h-4" /> Modifier</button>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-10">
              {showEditor ? (
                <textarea className="w-full h-full resize-none outline-none text-base text-slate-700 leading-relaxed placeholder:text-slate-300 bg-transparent" placeholder="Écrivez votre procédure ici…" value={pForm.body} onChange={(e) => setPForm({ ...pForm, body: e.target.value })} />
              ) : (
                <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap">{selected?.kind === "process" && selected.data.body}</div>
              )}
            </div>
          </div>
        ) : (composing === "contact" || selected?.kind === "contact") ? (
          /* ====== CONTACT ====== */
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-300">
              <div className="bg-slate-50 p-6 border-b border-slate-100 flex justify-between items-start">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-2xl font-bold shadow-lg shrink-0">
                    {showEditor ? <User className="w-8 h-8" /> : (selected?.kind === "contact" && selected.data.qui_quoi.substring(0, 1).toUpperCase())}
                  </div>
                  <div className="flex-1 min-w-0">
                    {showEditor ? (
                      <div className="space-y-2">
                        <input className="text-xl font-bold text-slate-900 placeholder:text-slate-300 outline-none bg-transparent w-full border-b border-slate-300 focus:border-indigo-500 pb-1 transition-colors" placeholder="Nom / Qui / Quoi" value={cForm.qui_quoi} onChange={(e) => setCForm({ ...cForm, qui_quoi: e.target.value })} autoFocus />
                        <input className="text-sm font-medium text-slate-600 placeholder:text-slate-300 outline-none bg-transparent w-full border-b border-slate-300 focus:border-indigo-500 pb-1 transition-colors" placeholder="Contact (Tél, Email, Adresse…)" value={cForm.contact} onChange={(e) => setCForm({ ...cForm, contact: e.target.value })} />
                      </div>
                    ) : selected?.kind === "contact" ? (
                      <>
                        <h2 className="text-2xl font-extrabold text-slate-900 truncate">{selected.data.qui_quoi}</h2>
                        <p className="text-sm text-slate-500 font-medium mt-1 flex items-center gap-1.5">{getContactIcon(selected.data.contact)}{selected.data.contact}</p>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {showEditor ? (
                    <>
                      <button onClick={() => { if (composing) resetSelection(); else { setMode("view"); if (selected?.kind === "contact") setCForm({ qui_quoi: selected.data.qui_quoi, contact: selected.data.contact, commentaire: selected.data.commentaire || "" }); } }} className="p-2 text-slate-400 hover:bg-slate-200 rounded-lg transition"><ChevronLeft className="w-5 h-5" /></button>
                      <button onClick={saveContact} className="p-2 btn-brand text-white rounded-lg hover:bg-indigo-700 shadow-md transition active:scale-95"><Save className="w-5 h-5" /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={deleteContact} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-5 h-5" /></button>
                      <button onClick={() => { if (selected?.kind === "contact") { setCForm({ qui_quoi: selected.data.qui_quoi, contact: selected.data.contact, commentaire: selected.data.commentaire || "" }); setMode("edit"); } }} className="p-2 text-[var(--brand)] hover:bg-indigo-50 rounded-lg transition"><Edit2 className="w-5 h-5" /></button>
                    </>
                  )}
                </div>
              </div>
              <div className="p-8">
                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Notes / Commentaires</label>
                {showEditor ? (
                  <textarea className="w-full h-32 resize-none outline-none text-sm text-slate-700 leading-relaxed placeholder:text-slate-300 bg-slate-50 p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="Informations complémentaires…" value={cForm.commentaire} onChange={(e) => setCForm({ ...cForm, commentaire: e.target.value })} />
                ) : (
                  <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 p-4 rounded-xl border border-slate-100 min-h-[100px]">{(selected?.kind === "contact" && selected.data.commentaire) || <span className="italic text-slate-400">Aucune note disponible.</span>}</div>
                )}
              </div>
              {!showEditor && selected?.kind === "contact" && (
                <div className="bg-slate-50 p-4 border-t border-slate-100 flex gap-4 justify-center">
                  {selected.data.contact.includes("@") && (
                    <a href={`mailto:${selected.data.contact}`} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:border-indigo-300 hover:text-[var(--brand)] transition shadow-sm"><Mail className="w-4 h-4" /> Envoyer Email</a>
                  )}
                  {(/[0-9]{2}/.test(selected.data.contact) || selected.data.contact.startsWith("+")) && (
                    <a href={`tel:${selected.data.contact}`} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:border-green-300 hover:text-green-600 transition shadow-sm"><Phone className="w-4 h-4" /> Appeler</a>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : selected?.kind === "identifiant" ? (
          /* ====== IDENTIFIANT ====== */
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="bg-slate-900 p-6 flex justify-between items-start relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-20 -mr-10 -mt-10" />
                <div className="flex items-center gap-4 relative z-10 min-w-0">
                  <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center text-2xl font-bold text-white border border-white/10 shadow-inner shrink-0">{selected.data.outil.substring(0, 1).toUpperCase()}</div>
                  <div className="min-w-0">
                    <h2 className="text-2xl font-extrabold text-white truncate">{selected.data.outil}</h2>
                    {selected.data.url && (
                      <a href={selected.data.url} target="_blank" rel="noopener noreferrer" className="text-indigo-300 text-xs font-medium hover:text-white flex items-center gap-1 mt-1 transition-colors"><Globe className="w-3 h-3" /> Ouvrir le lien</a>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 relative z-10 shrink-0">
                  <button onClick={() => editKey(selected.data)} className="p-2 bg-white/10 text-white hover:bg-white/20 rounded-lg transition backdrop-blur-md"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => deleteKey(selected.data.id)} className="p-2 bg-white/10 text-red-300 hover:bg-red-500/20 hover:text-red-200 rounded-lg transition backdrop-blur-md"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="p-8 space-y-6">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1"><User className="w-3 h-3" /> Identifiant</label>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono text-sm text-slate-700 font-medium break-all">{selected.data.identifiant}</div>
                    <button onClick={() => copyToClipboard(selected.data.identifiant, "id")} className={`px-4 rounded-xl font-bold text-sm transition-all border flex items-center justify-center gap-2 w-24 ${copiedField === "id" ? "bg-green-50 border-green-200 text-green-600" : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-[var(--brand)]"}`}>{copiedField === "id" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copiedField === "id" ? "Copié" : "Copier"}</button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1"><Lock className="w-3 h-3" /> Mot de passe</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono text-sm text-slate-700 font-medium overflow-hidden flex items-center">
                      {showPassword ? selected.data.mot_de_passe : "••••••••••••••••"}
                      <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 text-slate-400 hover:text-[var(--brand)] transition">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                    <button onClick={() => copyToClipboard(selected.data.mot_de_passe, "pwd")} className={`px-4 rounded-xl font-bold text-sm transition-all border flex items-center justify-center gap-2 w-24 ${copiedField === "pwd" ? "bg-green-50 border-green-200 text-green-600" : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-[var(--brand)]"}`}>{copiedField === "pwd" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copiedField === "pwd" ? "Copié" : "Copier"}</button>
                  </div>
                </div>
                {selected.data.commentaire && (
                  <div className="pt-4 border-t border-slate-100">
                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Notes</label>
                    <p className="text-sm text-slate-600 italic leading-relaxed bg-amber-50 p-3 rounded-xl border border-amber-100">{selected.data.commentaire}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
            <Shield className="w-24 h-24 mb-4 opacity-20" />
          </div>
        )}
      </div>

      {/* MODAL IDENTIFIANT (création / édition) */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-3xl w-full max-w-md space-y-5 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-slate-800">{editingKeyId ? "Modifier l'identifiant" : "Nouvel identifiant"}</h2>
            {keyError && <div className="bg-red-50 text-red-500 text-xs p-3 rounded-lg font-bold">{keyError}</div>}
            <div className="space-y-3">
              <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-[var(--brand)] font-bold" placeholder="Nom de l'outil (ex: Booking)" value={keyForm.outil} onChange={(e) => setKeyForm({ ...keyForm, outil: e.target.value })} />
              <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-[var(--brand)] text-sm" placeholder="Identifiant" value={keyForm.identifiant} onChange={(e) => setKeyForm({ ...keyForm, identifiant: e.target.value })} />
              <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-[var(--brand)] text-sm" placeholder="Mot de passe" value={keyForm.mot_de_passe} onChange={(e) => setKeyForm({ ...keyForm, mot_de_passe: e.target.value })} />
              <input className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-[var(--brand)] text-sm" placeholder="Lien URL (optionnel)" value={keyForm.url} onChange={(e) => setKeyForm({ ...keyForm, url: e.target.value })} />
              <textarea className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-[var(--brand)] resize-none text-sm" placeholder="Commentaire…" rows={2} value={keyForm.commentaire} onChange={(e) => setKeyForm({ ...keyForm, commentaire: e.target.value })} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button className="px-5 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-50 transition" onClick={() => setShowKeyModal(false)}>Annuler</button>
              <button className="px-5 py-3 rounded-xl btn-brand text-white font-bold shadow-lg hover:bg-indigo-700 transition" onClick={saveKey}>{editingKeyId ? "Enregistrer" : "Créer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
