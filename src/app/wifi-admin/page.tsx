"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Eye, EyeOff, ChevronUp, ChevronDown, Save, Plus, Trash2,
  ImagePlus, Loader2, Check, Wifi, Megaphone, X, Clock, Euro
} from "lucide-react";
import toast from "react-hot-toast";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TileConfig = Record<string, any>;

type Tile = {
  id: string;
  slug: string;
  emoji: string;
  title: string;
  tagline: string;
  image_url: string | null;
  visible: boolean;
  ordre: number;
  config: TileConfig;
};

type MenuItem = {
  id: string;
  date: string;
  categorie: "base" | "garniture" | "dessert";
  nom: string;
  actif: boolean;
  ordre: number;
};

type CurioItem = {
  id: string;
  nom: string;
  nom_en: string | null;
  emoji: string;
  image_url: string | null;
  gratuit: boolean;
  dispo: boolean;
  ordre: number;
  description: string | null;
  description_en: string | null;
  tags: string[];
  duree_heures: number;
  prix_reservation: number;
};

// Labels des champs config éditables par slug
const CONFIG_FIELDS: Record<string, { key: string; label: string; type?: "textarea" }[]> = {
  reception: [
    { key: "message", label: "Message affiché", type: "textarea" },
  ],
  pdj: [
    { key: "semaine", label: "Horaires Lun-Ven" },
    { key: "weekend", label: "Horaires Sam-Dim" },
    { key: "prix",    label: "Tarif" },
  ],
  checkout: [
    { key: "standard", label: "Départ standard" },
    { key: "late",     label: "Late check-out" },
    { key: "note",     label: "Note", type: "textarea" },
  ],
  plage: [
    { key: "description",  label: "Description", type: "textarea" },
    { key: "plage1_nom",   label: "Plage 1 — nom" },
    { key: "plage1_url",   label: "Plage 1 — lien Maps" },
    { key: "plage2_nom",   label: "Plage 2 — nom" },
    { key: "plage2_url",   label: "Plage 2 — lien Maps" },
    { key: "plage3_nom",   label: "Plage 3 — nom" },
    { key: "plage3_url",   label: "Plage 3 — lien Maps" },
  ],
  menu: [
    { key: "description", label: "Description courte", type: "textarea" },
  ],
  curiosites: [
    { key: "description", label: "Description courte", type: "textarea" },
    { key: "note_prix",   label: "Note tarif" },
  ],
  byca: [
    { key: "description", label: "Description", type: "textarea" },
  ],
};

// Champ par défaut pour les tuiles custom (slug non reconnu)
const DEFAULT_CONFIG_FIELD = [{ key: "texte", label: "Contenu", type: "textarea" as const }];


const CATEGORIES = [
  { key: "base",      label: "Bases",      emoji: "🍽️" },
  { key: "garniture", label: "Garnitures", emoji: "🥗" },
  { key: "dessert",   label: "Desserts",   emoji: "🍮" },
] as const;

// ─────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────
export default function WifiAdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-[#004e7c] flex items-center justify-center">
            <Wifi size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-900 text-lg">Page WiFi</h1>
            <p className="text-xs text-slate-400">Gestion du portail clients</p>
          </div>
        </div>

        <Tabs defaultValue="tuiles">
          <TabsList className="w-full mb-6">
            <TabsTrigger value="tuiles"     className="flex-1">Tuiles</TabsTrigger>
            <TabsTrigger value="menu"       className="flex-1">Menu</TabsTrigger>
            <TabsTrigger value="curiosites" className="flex-1">Curiosités</TabsTrigger>
            <TabsTrigger value="annonce"    className="flex-1">Annonce</TabsTrigger>
          </TabsList>

          <TabsContent value="tuiles"><TilesTab /></TabsContent>
          <TabsContent value="menu"><MenuTab /></TabsContent>
          <TabsContent value="curiosites"><CuriositesTab /></TabsContent>
          <TabsContent value="annonce"><AnnonceTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB TUILES
// ─────────────────────────────────────────────────────────────
function TilesTab() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("wifi_tiles").select("*").order("ordre").then(({ data }) => {
      if (data) setTiles(data);
    });
  }, []);

  const update = (id: string, patch: Partial<Tile>) =>
    setTiles(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));

  const updateConfig = (id: string, key: string, value: string) =>
    setTiles(prev => prev.map(t => t.id === id ? { ...t, config: { ...t.config, [key]: value } } : t));

  const toggleVisible = async (tile: Tile) => {
    const newVal = !tile.visible;
    update(tile.id, { visible: newVal });
    await supabase.from("wifi_tiles").update({ visible: newVal }).eq("id", tile.id);
    toast.success(newVal ? "Tuile affichée" : "Tuile masquée");
  };

  const move = async (tile: Tile, dir: -1 | 1) => {
    const sorted = [...tiles].sort((a, b) => a.ordre - b.ordre);
    const idx = sorted.findIndex(t => t.id === tile.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[swapIdx];
    const newTiles = tiles.map(t => {
      if (t.id === a.id) return { ...t, ordre: b.ordre };
      if (t.id === b.id) return { ...t, ordre: a.ordre };
      return t;
    });
    setTiles(newTiles);
    await Promise.all([
      supabase.from("wifi_tiles").update({ ordre: b.ordre }).eq("id", a.id),
      supabase.from("wifi_tiles").update({ ordre: a.ordre }).eq("id", b.id),
    ]);
  };

  const deleteTile = async (id: string) => {
    await supabase.from("wifi_tiles").delete().eq("id", id);
    setTiles(prev => prev.filter(t => t.id !== id));
    setConfirmDelete(null);
    toast.success("Tuile supprimée");
  };

  const saveTile = async (tile: Tile) => {
    setSaving(tile.id);
    const { error } = await supabase.from("wifi_tiles").update({
      emoji: tile.emoji,
      title: tile.title,
      tagline: tile.tagline,
      config: tile.config,
      updated_at: new Date().toISOString(),
    }).eq("id", tile.id);
    setSaving(null);
    if (error) toast.error("Erreur lors de la sauvegarde");
    else toast.success("Sauvegardé ✓");
  };

  const uploadImage = async (tile: Tile, file: File) => {
    setUploading(tile.id);
    const ext = file.name.split(".").pop();
    const path = `tiles/${tile.slug}.${ext}`;
    const { error: upErr } = await supabase.storage.from("wifi-images").upload(path, file, { upsert: true });
    if (upErr) { toast.error("Erreur upload"); setUploading(null); return; }
    const { data: { publicUrl } } = supabase.storage.from("wifi-images").getPublicUrl(path);
    await supabase.from("wifi_tiles").update({ image_url: publicUrl }).eq("id", tile.id);
    update(tile.id, { image_url: publicUrl });
    setUploading(null);
    toast.success("Photo mise à jour ✓");
  };

  const sorted = [...tiles].sort((a, b) => a.ordre - b.ordre);

  return (
    <div className="space-y-2">
      {sorted.map((tile, idx) => {
        const isOpen = openSlug === tile.slug;
        const fields = CONFIG_FIELDS[tile.slug] ?? DEFAULT_CONFIG_FIELD;
        return (
          <div key={tile.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Ligne principale */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition select-none"
              onClick={() => setOpenSlug(isOpen ? null : tile.slug)}
            >
              {/* Ordre */}
              <div className="flex flex-col gap-0.5" onClick={e => e.stopPropagation()}>
                <button onClick={() => move(tile, -1)} disabled={idx === 0} className="text-slate-300 hover:text-slate-600 disabled:opacity-20">
                  <ChevronUp size={14} />
                </button>
                <button onClick={() => move(tile, 1)} disabled={idx === sorted.length - 1} className="text-slate-300 hover:text-slate-600 disabled:opacity-20">
                  <ChevronDown size={14} />
                </button>
              </div>

              <span className="text-xl w-7 shrink-0">{tile.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-slate-900 truncate">{tile.title}</p>
                <p className="text-xs text-slate-400 truncate">{tile.tagline}</p>
              </div>

              {/* Toggle visible */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleVisible(tile); }}
                className={`p-1.5 rounded-lg transition ${tile.visible ? "text-[#004e7c] bg-blue-50" : "text-slate-300 bg-slate-100"}`}
              >
                {tile.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>

            {/* Panneau d'édition */}
            {isOpen && (
              <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50/50">

                {/* Emoji / Titre / Tagline */}
                <div className="grid grid-cols-[56px_1fr_1fr] gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Emoji</label>
                    <Input value={tile.emoji} onChange={e => update(tile.id, { emoji: e.target.value })} className="text-center text-lg h-10" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Titre</label>
                    <Input value={tile.title} onChange={e => update(tile.id, { title: e.target.value })} className="h-10" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Sous-titre</label>
                    <Input value={tile.tagline ?? ""} onChange={e => update(tile.id, { tagline: e.target.value })} className="h-10" />
                  </div>
                </div>

                {/* Champs config */}
                {fields.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400">Contenu</p>
                    {fields.map(f => (
                      <div key={f.key}>
                        <label className="text-xs text-slate-500 block mb-1">{f.label}</label>
                        {f.type === "textarea" ? (
                          <textarea
                            value={tile.config[f.key] ?? ""}
                            onChange={e => updateConfig(tile.id, f.key, e.target.value)}
                            rows={3}
                            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#004e7c]/20 resize-none"
                          />
                        ) : (
                          <Input value={tile.config[f.key] ?? ""} onChange={e => updateConfig(tile.id, f.key, e.target.value)} className="h-9" />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Photo */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">Photo de fond</p>
                  <div className="flex items-center gap-3">
                    {tile.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={tile.image_url} alt="" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                    )}
                    <UploadButton
                      loading={uploading === tile.id}
                      onFile={file => uploadImage(tile, file)}
                      label={tile.image_url ? "Remplacer" : "Ajouter une photo"}
                    />
                    {tile.image_url && (
                      <button
                        onClick={async () => {
                          await supabase.from("wifi_tiles").update({ image_url: null }).eq("id", tile.id);
                          update(tile.id, { image_url: null });
                          toast.success("Photo supprimée");
                        }}
                        className="text-xs text-slate-400 hover:text-red-500 transition"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>

                {/* Bouton save */}
                <div className="flex items-center justify-between pt-1">
                  {confirmDelete === tile.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-500">Confirmer la suppression ?</span>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)} className="h-7 px-2 text-xs">Annuler</Button>
                      <Button size="sm" onClick={() => deleteTile(tile.id)} className="h-7 px-2 text-xs bg-red-500 hover:bg-red-600 text-white">Supprimer</Button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(tile.id)} className="text-xs text-slate-300 hover:text-red-400 transition flex items-center gap-1">
                      <Trash2 size={13} /> Supprimer
                    </button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => saveTile(tile)}
                    disabled={saving === tile.id}
                    className="bg-[#004e7c] hover:bg-[#003d61] text-white gap-2"
                  >
                    {saving === tile.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Enregistrer
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Ajouter une tuile ── */}
      <AddTileForm onAdd={tile => setTiles(prev => [...prev, tile])} nextOrdre={sorted.length} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Formulaire ajout de tuile
// ─────────────────────────────────────────────────────────────
function AddTileForm({ onAdd, nextOrdre }: { onAdd: (t: Tile) => void; nextOrdre: number }) {
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState("");
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const slug = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const { data, error } = await supabase.from("wifi_tiles").insert({
      slug: `custom-${slug}-${Date.now()}`,
      emoji: emoji || "✨",
      title: title.trim(),
      tagline: tagline.trim(),
      visible: true,
      ordre: nextOrdre,
      config: {},
    }).select().single();
    setSaving(false);
    if (error) { toast.error("Erreur"); return; }
    onAdd(data);
    setEmoji(""); setTitle(""); setTagline(""); setOpen(false);
    toast.success("Tuile ajoutée ✓");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-400 hover:text-slate-600 hover:border-slate-400 transition"
      >
        <Plus size={15} /> Ajouter une tuile
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Nouvelle tuile</p>
      <div className="grid grid-cols-[56px_1fr_1fr] gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Emoji</label>
          <Input placeholder="✨" value={emoji} onChange={e => setEmoji(e.target.value)} className="text-center text-lg h-10" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Titre</label>
          <Input placeholder="Ma tuile" value={title} onChange={e => setTitle(e.target.value)} className="h-10" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Sous-titre</label>
          <Input placeholder="Info courte" value={tagline} onChange={e => setTagline(e.target.value)} className="h-10" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
        <Button size="sm" onClick={submit} disabled={saving || !title.trim()} className="bg-[#004e7c] hover:bg-[#003d61] text-white gap-2">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Créer
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB MENU
// ─────────────────────────────────────────────────────────────
function MenuTab() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [newNom, setNewNom] = useState<Record<string, string>>({ base: "", garniture: "", dessert: "" });
  const [prixPlat, setPrixPlat] = useState("");
  const [prixDessert, setPrixDessert] = useState("");
  const [prixMenu, setPrixMenu] = useState("");
  const [savingPrix, setSavingPrix] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("wifi_menu").select("*").order("ordre")
      .then(({ data }) => { if (data) setItems(data); });
    supabase.from("wifi_tiles").select("config").eq("slug", "menu").single()
      .then(({ data }) => {
        if (data?.config) {
          setPrixPlat(data.config.prix_plat ?? "");
          setPrixDessert(data.config.prix_dessert ?? "");
          setPrixMenu(data.config.prix_menu ?? "");
        }
      });
  }, []);

  const savePrix = async () => {
    setSavingPrix(true);
    const { data: current } = await supabase.from("wifi_tiles").select("config").eq("slug", "menu").single();
    await supabase.from("wifi_tiles").update({
      config: { ...(current?.config ?? {}), prix_plat: prixPlat, prix_dessert: prixDessert, prix_menu: prixMenu }
    }).eq("slug", "menu");
    setSavingPrix(false);
    toast.success("Prix enregistrés ✓");
  };

  const toggleActif = async (item: MenuItem) => {
    const val = !item.actif;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, actif: val } : i));
    await supabase.from("wifi_menu").update({ actif: val }).eq("id", item.id);
  };

  const deleteItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await supabase.from("wifi_menu").delete().eq("id", id);
  };

  const addItem = async (categorie: "base" | "garniture") => {
    const nom = newNom[categorie].trim();
    if (!nom) return;
    setSaving(true);
    const ordre = items.filter(i => i.categorie === categorie).length;
    const { data, error } = await supabase.from("wifi_menu")
      .insert({ categorie, nom, actif: true, ordre })
      .select().single();
    setSaving(false);
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, data]);
    setNewNom(prev => ({ ...prev, [categorie]: "" }));
    toast.success("Option ajoutée ✓");
  };

  return (
    <div className="space-y-3">

      {/* En-tête date + prix */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 space-y-3">
        <p className="text-xs text-slate-400">
          Menu du <strong className="text-slate-700">
            {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </strong>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Plat seul", value: prixPlat, set: setPrixPlat },
            { label: "Dessert",   value: prixDessert, set: setPrixDessert },
            { label: "Menu complet", value: prixMenu, set: setPrixMenu },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">{label}</label>
              <Input placeholder="ex: 12 €" value={value} onChange={e => set(e.target.value)} className="h-8 text-sm" />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={savePrix} disabled={savingPrix} className="h-8 px-4 bg-[#004e7c] hover:bg-[#003d61] text-white gap-2">
            {savingPrix ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Enregistrer les prix
          </Button>
        </div>
      </div>

      {CATEGORIES.map(({ key, label, emoji }) => {
        const opts = items.filter(i => i.categorie === key);
        return (
          <div key={key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <span>{emoji}</span>
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
              <span className="ml-auto text-xs text-slate-300">{opts.length} option{opts.length > 1 ? "s" : ""}</span>
            </div>

            <ul className="divide-y divide-slate-50">
              {opts.map(item => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button onClick={() => toggleActif(item)} className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition border ${item.actif ? "bg-[#004e7c] border-[#004e7c]" : "border-slate-300"}`}>
                    {item.actif && <Check size={10} className="text-white" />}
                  </button>
                  <span className={`text-sm flex-1 ${item.actif ? "text-slate-700" : "text-slate-300 line-through"}`}>{item.nom}</span>
                  <button onClick={() => deleteItem(item.id)} className="text-slate-200 hover:text-red-400 transition">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
              <Input
                placeholder={`Ajouter une option…`}
                value={newNom[key]}
                onChange={e => setNewNom(prev => ({ ...prev, [key]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addItem(key as "base" | "garniture")}
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={() => addItem(key as "base" | "garniture")} disabled={saving || !newNom[key].trim()} className="h-8 px-3 bg-[#004e7c] hover:bg-[#003d61] text-white">
                <Plus size={14} />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB CURIOSITÉS
// ─────────────────────────────────────────────────────────────
type EditState = {
  nom: string; nom_en: string; emoji: string;
  description: string; description_en: string;
  tags: string[]; tagInput: string;
  duree_heures: number; prix_reservation: number; dispo: boolean;
};

async function translate(text: string): Promise<string> {
  if (!text.trim()) return "";
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  return data.result ?? "";
}

const EMPTY_EDIT: EditState = {
  nom: "", nom_en: "", emoji: "",
  description: "", description_en: "",
  tags: [], tagInput: "",
  duree_heures: 24, prix_reservation: 10, dispo: true,
};

function CuriositesTab() {
  const [items, setItems] = useState<CurioItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [newNom, setNewNom] = useState("");
  const [newEmoji, setNewEmoji] = useState("");
  const [addingSaving, setAddingSaving] = useState(false);

  useEffect(() => {
    supabase.from("wifi_curiosites").select("*").order("ordre").then(({ data }) => {
      if (data) setItems(data);
    });
  }, []);

  const openEdit = (item: CurioItem) => {
    if (openId === item.id) { setOpenId(null); return; }
    setOpenId(item.id);
    setEdit({
      nom: item.nom, nom_en: item.nom_en ?? "",
      emoji: item.emoji ?? "",
      description: item.description ?? "", description_en: item.description_en ?? "",
      tags: item.tags ?? [], tagInput: "",
      duree_heures: item.duree_heures ?? 24,
      prix_reservation: item.prix_reservation ?? 10,
      dispo: item.dispo,
    });
  };

  const addTag = () => {
    const t = edit.tagInput.trim();
    if (!t || edit.tags.includes(t)) { setEdit(e => ({ ...e, tagInput: "" })); return; }
    setEdit(e => ({ ...e, tags: [...e.tags, t], tagInput: "" }));
  };

  const removeTag = (tag: string) => setEdit(e => ({ ...e, tags: e.tags.filter(t => t !== tag) }));

  const saveItem = async (id: string) => {
    setSaving(id);
    const nom = edit.nom.trim();
    const description = edit.description.trim() || null;
    const [nom_en, description_en] = await Promise.all([
      translate(nom),
      description ? translate(description) : Promise.resolve(null),
    ]);
    const payload = {
      nom, nom_en: nom_en || null,
      emoji: edit.emoji || "📦",
      description,
      description_en: description_en || null,
      tags: edit.tags,
      duree_heures: edit.duree_heures,
      prix_reservation: edit.prix_reservation,
      dispo: edit.dispo,
    };
    await supabase.from("wifi_curiosites").update(payload).eq("id", id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...payload } : i));
    setSaving(null);
    setOpenId(null);
    toast.success("Modifié ✓");
  };

  const deleteItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await supabase.from("wifi_curiosites").delete().eq("id", id);
    toast.success("Supprimé");
  };

  const addItem = async () => {
    const nom = newNom.trim();
    if (!nom) return;
    setAddingSaving(true);
    const { data, error } = await supabase.from("wifi_curiosites")
      .insert({ nom, emoji: newEmoji || "📦", gratuit: true, dispo: true, ordre: items.length, tags: [], duree_heures: 24, prix_reservation: 10 })
      .select().single();
    setAddingSaving(false);
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, data]);
    setNewNom(""); setNewEmoji("");
    toast.success("Objet ajouté ✓");
  };

  const uploadImage = async (item: CurioItem, file: File) => {
    setUploading(item.id);
    const ext = file.name.split(".").pop();
    const path = `curiosites/${item.id}.${ext}`;
    const { error } = await supabase.storage.from("wifi-images").upload(path, file, { upsert: true });
    if (error) { toast.error(`Erreur: ${error.message}`); setUploading(null); return; }
    const { data: { publicUrl } } = supabase.storage.from("wifi-images").getPublicUrl(path);
    await supabase.from("wifi_curiosites").update({ image_url: publicUrl }).eq("id", item.id);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, image_url: publicUrl } : i));
    setUploading(null);
    toast.success("Photo mise à jour ✓");
  };

  return (
    <div className="space-y-2">
      {items.map(item => {
        const isOpen = openId === item.id;
        return (
          <div key={item.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Ligne principale */}
            <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50 transition select-none" onClick={() => openEdit(item)}>
              <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-xl shrink-0 overflow-hidden">
                {item.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                  : item.emoji ?? "📦"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-slate-900 truncate">{item.nom}</p>
                {item.nom_en && <p className="text-xs text-slate-400 truncate italic">{item.nom_en}</p>}
                {(item.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(item.tags ?? []).slice(0, 3).map(t => (
                      <span key={t} className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${item.dispo ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                  {item.dispo ? "Dispo" : "Indispo"}
                </span>
                <UploadButton loading={uploading === item.id} onFile={file => uploadImage(item, file)} icon />
                <button onClick={() => deleteItem(item.id)} className="p-1.5 text-slate-200 hover:text-red-400 transition rounded-lg">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {/* Panel édition */}
            {isOpen && (
              <div className="border-t border-slate-100 px-4 py-4 bg-slate-50 space-y-3">
                {/* Emoji + Noms */}
                <div className="grid grid-cols-[48px_1fr_1fr] gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Emoji</label>
                    <Input value={edit.emoji} onChange={e => setEdit(s => ({ ...s, emoji: e.target.value }))} className="text-center text-lg h-9 bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Nom FR</label>
                    <Input value={edit.nom} onChange={e => setEdit(s => ({ ...s, nom: e.target.value }))} className="h-9 bg-white" />
                  </div>
                </div>

                {/* Descriptions */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Description FR</label>
                    <textarea value={edit.description} onChange={e => setEdit(s => ({ ...s, description: e.target.value }))} rows={3} placeholder="Décrivez l'objet en 2-3 lignes…" className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#004e7c]/20 resize-none" />
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Tags</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {edit.tags.map(t => (
                      <span key={t} className="inline-flex items-center gap-1 text-xs bg-[#004e7c]/10 text-[#004e7c] rounded-full px-2.5 py-0.5">
                        {t}
                        <button onClick={() => removeTag(t)}><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={edit.tagInput}
                      onChange={e => setEdit(s => ({ ...s, tagInput: e.target.value }))}
                      onKeyDown={e => (e.key === "Enter" || e.key === ",") && (e.preventDefault(), addTag())}
                      placeholder="Tech, Waterproof, Détente… + Entrée"
                      className="h-8 text-sm bg-white flex-1"
                    />
                    <Button size="sm" variant="ghost" onClick={addTag} className="h-8 px-3"><Plus size={13} /></Button>
                  </div>
                </div>

                {/* Durée + Prix */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1 flex items-center gap-1"><Clock size={10} /> Durée max (heures)</label>
                    <Input type="number" value={edit.duree_heures} onChange={e => setEdit(s => ({ ...s, duree_heures: parseInt(e.target.value) || 0 }))} className="h-9 bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1 flex items-center gap-1"><Euro size={10} /> Prix réservation (€)</label>
                    <Input type="number" value={edit.prix_reservation} onChange={e => setEdit(s => ({ ...s, prix_reservation: parseFloat(e.target.value) || 0 }))} className="h-9 bg-white" />
                  </div>
                </div>

                {/* Dispo toggle */}
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-slate-700">Disponible</span>
                  <button
                    onClick={() => setEdit(s => ({ ...s, dispo: !s.dispo }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${edit.dispo ? "bg-[#004e7c]" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${edit.dispo ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>Annuler</Button>
                  <Button size="sm" onClick={() => saveItem(item.id)} disabled={saving === item.id || !edit.nom.trim()} className="bg-[#004e7c] hover:bg-[#003d61] text-white gap-1.5">
                    {saving === item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Enregistrer
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Ajouter un objet */}
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-3">
        <p className="text-xs text-slate-400 mb-2 uppercase tracking-widest">Ajouter un objet</p>
        <div className="flex gap-2">
          <Input placeholder="📦" value={newEmoji} onChange={e => setNewEmoji(e.target.value)} className="w-14 text-center h-9" />
          <Input placeholder="Nom de l'objet" value={newNom} onChange={e => setNewNom(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} className="h-9 flex-1" />
          <Button size="sm" onClick={addItem} disabled={!newNom.trim() || addingSaving} className="h-9 px-3 bg-[#004e7c] hover:bg-[#003d61] text-white">
            {addingSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB ANNONCE
// ─────────────────────────────────────────────────────────────
function AnnonceTab() {
  const [message, setMessage] = useState("");
  const [type, setType] = useState<"info" | "urgent">("info");
  const [active, setActive] = useState(false);
  const [tileId, setTileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("wifi_tiles").select("*").eq("slug", "annonce").single().then(({ data }) => {
      if (data) {
        setTileId(data.id);
        setMessage(data.config?.message ?? "");
        setType(data.config?.type ?? "info");
        setActive(data.visible ?? false);
      }
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const payload = { slug: "annonce", emoji: "📢", title: "Annonce", tagline: "", visible: active, ordre: 999, config: { message, type } };
    if (tileId) {
      await supabase.from("wifi_tiles").update(payload).eq("id", tileId);
    } else {
      const { data } = await supabase.from("wifi_tiles").insert(payload).select().single();
      if (data) setTileId(data.id);
    }
    setSaving(false);
    toast.success(active ? "Annonce publiée ✓" : "Annonce désactivée ✓");
  };

  return (
    <div className="space-y-4">
      {/* Statut */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone size={16} className="text-slate-500" />
            <span className="text-sm font-medium text-slate-800">Bandeau d&apos;annonce</span>
          </div>
          <button
            onClick={() => setActive(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${active ? "bg-[#004e7c]" : "bg-slate-200"}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${active ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        {active && (
          <p className="text-xs text-emerald-600 mt-2 font-medium">● Affiché sur le portail WiFi</p>
        )}
        {!active && (
          <p className="text-xs text-slate-400 mt-2">Désactivé — pas visible par les clients</p>
        )}
      </div>

      {/* Type */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">Type de message</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setType("info")}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${type === "info" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
          >
            <span>ℹ️</span> Information
          </button>
          <button
            onClick={() => setType("urgent")}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${type === "urgent" ? "border-red-300 bg-red-50 text-red-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
          >
            <span>⚠️</span> Urgent
          </button>
        </div>
      </div>

      {/* Message */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">Message</p>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={4}
          placeholder="Ex : L'ascenseur est momentanément hors service. Nous nous en excusons."
          className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#004e7c]/20"
        />
      </div>

      {/* Prévisualisation */}
      {message.trim() && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2.5 ${type === "urgent" ? "bg-red-50 border-red-200 text-red-700" : "bg-blue-50 border-blue-200 text-blue-700"}`}>
          <span className="text-base shrink-0">{type === "urgent" ? "⚠️" : "ℹ️"}</span>
          <p className="leading-relaxed">{message}</p>
        </div>
      )}

      <Button onClick={save} disabled={saving || !message.trim()} className="w-full bg-[#004e7c] hover:bg-[#003d61] text-white gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Enregistrer
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Upload button helper
// ─────────────────────────────────────────────────────────────
function UploadButton({ loading, onFile, label, icon }: { loading: boolean; onFile: (f: File) => void; label?: string; icon?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <button
        onClick={() => ref.current?.click()}
        disabled={loading}
        className={`flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition disabled:opacity-50 ${icon ? "p-1.5" : ""}`}
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
        {!icon && (label ?? "Photo")}
      </button>
    </>
  );
}
