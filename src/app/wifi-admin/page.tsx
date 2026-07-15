"use client";

export const dynamic = "force-dynamic";

import React, { createContext, useContext, Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ThemedBackground } from "@/components/ThemedBackground";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Eye, EyeOff, ChevronUp, ChevronDown,
  Save, Plus, Trash2, ImagePlus, Loader2, Check, Wifi, Megaphone,
  X, Clock, Euro
} from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "@/components/PageHeader";
import { useSelectedHotel } from "@/context/SelectedHotelContext";
import { translate, TranslateBtn, BarTab } from "@/components/rooftop/RooftopEditors";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const CORNICHE_ID = "f9d59e56-9a2f-433e-bcf4-f9753f105f32";
const VOILES_ID   = "ded6e6fb-ff3c-4fa8-ad07-403ee316be53";

// ─────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────
const HotelCtx = createContext<string>(CORNICHE_ID);
function useHotelId() { return useContext(HotelCtx); }

// Textarea qui grandit avec son contenu — fini le scroll interne qui coupe le texte.
function AutoTextarea({ className = "", value, ...props }: React.ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [value]);
  return <textarea ref={ref} value={value} className={`resize-none overflow-hidden min-h-[76px] ${className}`} {...props} />;
}

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
  nom_en: string | null;
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
type ConfigField = { key: string; label: string; type?: "textarea"; translate?: true };
const CONFIG_FIELDS: Record<string, ConfigField[]> = {
  reception: [
    { key: "message", label: "Message affiché", type: "textarea", translate: true },
  ],
  pdj: [
    { key: "semaine", label: "Horaires Lun-Ven", translate: true },
    { key: "weekend", label: "Horaires Sam-Dim", translate: true },
    { key: "prix",    label: "Tarif" },
  ],
  checkin: [
    { key: "heure", label: "Heure d'arrivée standard", translate: true },
    { key: "note",  label: "Note", type: "textarea", translate: true },
  ],
  checkout: [
    { key: "standard", label: "Départ standard", translate: true },
    { key: "note",     label: "Note", type: "textarea", translate: true },
  ],
  plage: [
    { key: "description",  label: "Description", type: "textarea", translate: true },
    { key: "plage1_nom",   label: "Plage 1 — nom" },
    { key: "plage1_url",   label: "Plage 1 — lien Maps" },
    { key: "plage2_nom",   label: "Plage 2 — nom" },
    { key: "plage2_url",   label: "Plage 2 — lien Maps" },
    { key: "plage3_nom",   label: "Plage 3 — nom" },
    { key: "plage3_url",   label: "Plage 3 — lien Maps" },
  ],
  menu: [
    { key: "description", label: "Description courte", type: "textarea", translate: true },
  ],
  curiosites: [
    { key: "description", label: "Description courte", type: "textarea", translate: true },
  ],
  byca: [
    { key: "description", label: "Description", type: "textarea", translate: true },
  ],
  bar: [
    { key: "description", label: "Description courte", type: "textarea", translate: true },
  ],
  rooftop: [
    { key: "description", label: "Description courte", type: "textarea", translate: true },
  ],
  urgences: [
    { key: "message",    label: "Message principal", type: "textarea", translate: true },
    { key: "telephone",  label: "Téléphone réception" },
  ],
  regles: [
    { key: "texte", label: "Règles de la maison", type: "textarea", translate: true },
  ],
};

const DEFAULT_CONFIG_FIELD: ConfigField[] = [{ key: "texte", label: "Contenu", type: "textarea", translate: true }];

function getConfigFields(slug: string, isVoiles: boolean): ConfigField[] {
  if (slug === "pdj" && isVoiles) {
    return [
      { key: "horaires", label: "Horaires (tous les jours)", translate: true },
      { key: "prix",     label: "Tarif" },
    ];
  }
  return CONFIG_FIELDS[slug] ?? DEFAULT_CONFIG_FIELD;
}

const CATEGORIES = [
  { key: "base",      label: "Bases",      emoji: "🍽️" },
  { key: "garniture", label: "Garnitures", emoji: "🥗" },
  { key: "dessert",   label: "Desserts",   emoji: "🍮" },
] as const;

// ─────────────────────────────────────────────────────────────
// PAGE (entry point with Suspense)
// ─────────────────────────────────────────────────────────────
export default function WifiAdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <WifiAdminContent />
    </Suspense>
  );
}

function WifiAdminContent() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedHotelId, setSelectedHotelId } = useSelectedHotel();
  const qsHotelId = searchParams?.get("hotel_id");
  // Source de vérité : le contexte global (piloté par la sidebar). On accepte
  // encore un ?hotel_id= en deep-link, qu'on synchronise dans le contexte.
  const hotelId = qsHotelId || selectedHotelId || CORNICHE_ID;
  const isVoiles = hotelId === VOILES_ID;

  useEffect(() => {
    if (qsHotelId && qsHotelId !== selectedHotelId) setSelectedHotelId(qsHotelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qsHotelId]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  if (authLoading || !user) return null;

  return (
    <HotelCtx.Provider value={hotelId}>
      <div className="min-h-screen">
        <ThemedBackground />
        <div className="max-w-5xl mx-auto px-4 py-8">
          <PageHeader
            icon={Wifi}
            title="Gestion de l'interface WiFi"
            subtitle={`${isVoiles ? "Les Voiles" : "BW+ La Corniche"} · Portail clients`}
            iconClassName="bg-sky-50 text-sky-700"
          />

          {isVoiles ? (
            /* Voiles : tout sur une page, sans onglets */
            <div className="space-y-8">
              <AnnonceTab />
              <section>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-slate-700">Tuiles du portail</h2>
                  <span className="text-xs text-slate-400">— ce que voit le client après l&apos;annonce</span>
                </div>
                <TilesTab />
              </section>
            </div>
          ) : (
            <Tabs defaultValue="tuiles">
              <TabsList className="w-full mb-6">
                <TabsTrigger value="tuiles"     className="flex-1">Tuiles</TabsTrigger>
                <TabsTrigger value="menu"       className="flex-1">Menu</TabsTrigger>
                <TabsTrigger value="bar"        className="flex-1">Bar</TabsTrigger>
                <TabsTrigger value="curiosites" className="flex-1">Curiosités</TabsTrigger>
                <TabsTrigger value="annonce"    className="flex-1">Annonce</TabsTrigger>
              </TabsList>

              <TabsContent value="tuiles"><TilesTab /></TabsContent>
              <TabsContent value="menu"><MenuTab /></TabsContent>
              <TabsContent value="bar"><BarTab hotelId={hotelId} /></TabsContent>
              <TabsContent value="curiosites"><CuriositesTab /></TabsContent>
              <TabsContent value="annonce"><AnnonceTab /></TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </HotelCtx.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB TUILES
// ─────────────────────────────────────────────────────────────
function TilesTab() {
  const hotelId = useHotelId();
  const isVoiles = hotelId === VOILES_ID;
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("wifi_tiles").select("*").eq("hotel_id", hotelId).order("ordre").then(({ data }) => {
      if (data) setTiles(data.filter((t: Tile) => t.slug !== "annonce"));
    });
  }, [hotelId]);

  const update = (id: string, patch: Partial<Tile>) =>
    setTiles(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));

  const updateConfig = (id: string, key: string, value: string) =>
    setTiles(prev => prev.map(t => t.id === id ? { ...t, config: { ...t.config, [key]: value } } : t));

  const updateEnConfig = (id: string, key: string, value: string) =>
    setTiles(prev => prev.map(t => {
      if (t.id !== id) return t;
      const en: Record<string, string> = { ...(t.config?.en ?? {}) };
      if (value) en[key] = value;
      else delete en[key];
      const nextConfig = { ...t.config };
      if (Object.keys(en).length > 0) nextConfig.en = en;
      else delete nextConfig.en;
      return { ...t, config: nextConfig };
    }));

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

    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const reordered = sorted.map((t, i) => ({ ...t, ordre: i }));
    const byId = new Map(reordered.map(t => [t.id, t.ordre]));
    setTiles(prev => prev.map(t => byId.has(t.id) ? { ...t, ordre: byId.get(t.id)! } : t));
    await Promise.all(reordered.map(t =>
      supabase.from("wifi_tiles").update({ ordre: t.ordre }).eq("id", t.id)
    ));
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
    if (upErr) { toast.error(`Erreur upload : ${upErr.message}`); setUploading(null); return; }
    const { data: { publicUrl } } = supabase.storage.from("wifi-images").getPublicUrl(path);
    await supabase.from("wifi_tiles").update({ image_url: publicUrl }).eq("id", tile.id);
    update(tile.id, { image_url: publicUrl });
    setUploading(null);
    toast.success("Photo mise à jour ✓");
  };

  const sorted = [...tiles].sort((a, b) => a.ordre - b.ordre);

  return (
    <div className="grid md:grid-cols-2 gap-3 items-start">
      {sorted.map((tile, idx) => {
        const isOpen = openSlug === tile.slug;
        const fields = getConfigFields(tile.slug, isVoiles);
        return (
          <div key={tile.id} className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${isOpen ? 'md:col-span-2' : ''}`}>
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition select-none"
              onClick={() => setOpenSlug(isOpen ? null : tile.slug)}
            >
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

              <button
                onClick={(e) => { e.stopPropagation(); toggleVisible(tile); }}
                className={`p-1.5 rounded-lg transition ${tile.visible ? "text-[var(--brand)] bg-[var(--brand-bg)]" : "text-slate-300 bg-slate-100"}`}
              >
                {tile.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>

            {isOpen && (
              <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50/50">
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

                <div className="grid grid-cols-[56px_1fr_1fr] gap-2">
                  <div />
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-slate-400">Titre EN</label>
                      <TranslateBtn source={tile.title} onResult={v => updateEnConfig(tile.id, "title", v)} />
                    </div>
                    <Input
                      value={tile.config?.en?.title ?? ""}
                      onChange={e => updateEnConfig(tile.id, "title", e.target.value)}
                      placeholder={tile.title}
                      className="h-10"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-slate-400">Sous-titre EN</label>
                      <TranslateBtn source={tile.tagline ?? ""} onResult={v => updateEnConfig(tile.id, "tagline", v)} />
                    </div>
                    <Input
                      value={tile.config?.en?.tagline ?? ""}
                      onChange={e => updateEnConfig(tile.id, "tagline", e.target.value)}
                      placeholder={tile.tagline ?? ""}
                      className="h-10"
                    />
                  </div>
                </div>

                {fields.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400">Contenu</p>
                    {fields.map(f => (
                      <div key={f.key}>
                        <label className="text-xs text-slate-500 block mb-1">{f.label}</label>
                        {f.type === "textarea" ? (
                          <AutoTextarea
                            value={tile.config[f.key] ?? ""}
                            onChange={e => updateConfig(tile.id, f.key, e.target.value)}
                            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20"
                          />
                        ) : (
                          <Input value={tile.config[f.key] ?? ""} onChange={e => updateConfig(tile.id, f.key, e.target.value)} className="h-9" />
                        )}
                        {f.translate && (
                          <div className="mt-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <label className="text-[10px] text-slate-400">EN</label>
                              <TranslateBtn source={tile.config[f.key] ?? ""} onResult={v => updateEnConfig(tile.id, f.key, v)} />
                            </div>
                            {f.type === "textarea" ? (
                              <AutoTextarea
                                value={tile.config?.en?.[f.key] ?? ""}
                                onChange={e => updateEnConfig(tile.id, f.key, e.target.value)}
                                placeholder={tile.config[f.key] ?? ""}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20"
                              />
                            ) : (
                              <Input
                                value={tile.config?.en?.[f.key] ?? ""}
                                onChange={e => updateEnConfig(tile.id, f.key, e.target.value)}
                                placeholder={tile.config[f.key] ?? ""}
                                className="h-9"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

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
                    variant="brand"
                    onClick={() => saveTile(tile)}
                    disabled={saving === tile.id}
                    className="gap-2"
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

      <div className="md:col-span-2">
        <AddTileForm onAdd={tile => setTiles(prev => [...prev, tile])} nextOrdre={sorted.length} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Formulaire ajout de tuile
// ─────────────────────────────────────────────────────────────
function AddTileForm({ onAdd, nextOrdre }: { onAdd: (t: Tile) => void; nextOrdre: number }) {
  const hotelId = useHotelId();
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
      hotel_id: hotelId,
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
        <Button size="sm" variant="brand" onClick={submit} disabled={saving || !title.trim()} className="gap-2">
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
  const hotelId = useHotelId();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [itemDrafts, setItemDrafts] = useState<Record<string, { nom: string; nom_en: string }>>({});
  const [newNom, setNewNom] = useState<Record<string, string>>({ base: "", garniture: "", dessert: "" });
  const [prixPlat, setPrixPlat] = useState("");
  const [prixDessert, setPrixDessert] = useState("");
  const [prixMenu, setPrixMenu] = useState("");
  const [savingPrix, setSavingPrix] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("wifi_menu").select("*").eq("hotel_id", hotelId).order("ordre")
      .then(({ data }) => {
        if (data) {
          setItems(data);
          const drafts: Record<string, { nom: string; nom_en: string }> = {};
          data.forEach((i: MenuItem) => { drafts[i.id] = { nom: i.nom, nom_en: i.nom_en ?? "" }; });
          setItemDrafts(drafts);
        }
      });
    supabase.from("wifi_tiles").select("config").eq("slug", "menu").eq("hotel_id", hotelId).single()
      .then(({ data }) => {
        if (data?.config) {
          setPrixPlat(data.config.prix_plat ?? "");
          setPrixDessert(data.config.prix_dessert ?? "");
          setPrixMenu(data.config.prix_menu ?? "");
        }
      });
  }, [hotelId]);

  const patchItem = (id: string, field: "nom" | "nom_en", value: string) =>
    setItemDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? { nom: "", nom_en: "" }), [field]: value } }));

  const saveItemField = async (id: string, field: "nom" | "nom_en") => {
    const draft = itemDrafts[id];
    if (!draft) return;
    const value = draft[field].trim();
    const payload = field === "nom_en" ? { nom_en: value || null } : { nom: value };
    const { error } = await supabase.from("wifi_menu").update(payload).eq("id", id);
    if (error) { toast.error("Erreur sauvegarde"); return; }
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...payload } : i));
  };

  const savePrix = async () => {
    setSavingPrix(true);
    const { data: current } = await supabase.from("wifi_tiles").select("config").eq("slug", "menu").eq("hotel_id", hotelId).single();
    await supabase.from("wifi_tiles").update({
      config: { ...(current?.config ?? {}), prix_plat: prixPlat, prix_dessert: prixDessert, prix_menu: prixMenu }
    }).eq("slug", "menu").eq("hotel_id", hotelId);
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
      .insert({ categorie, nom, actif: true, ordre, hotel_id: hotelId })
      .select().single();
    setSaving(false);
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, data]);
    setItemDrafts(prev => ({ ...prev, [data.id]: { nom: data.nom, nom_en: "" } }));
    setNewNom(prev => ({ ...prev, [categorie]: "" }));
    toast.success("Option ajoutée ✓");
  };

  return (
    <div className="space-y-3">
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
          <Button size="sm" onClick={savePrix} disabled={savingPrix} className="h-8 px-4 bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white gap-2">
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
              {opts.map(item => {
                const d = itemDrafts[item.id] ?? { nom: item.nom, nom_en: item.nom_en ?? "" };
                return (
                  <li key={item.id} className="px-4 py-2.5 space-y-1">
                    <div className="flex items-center gap-3">
                      <button onClick={() => toggleActif(item)} className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition border ${item.actif ? "bg-[var(--brand)] border-[var(--brand)]" : "border-slate-300"}`}>
                        {item.actif && <Check size={10} className="text-white" />}
                      </button>
                      <Input
                        value={d.nom}
                        onChange={e => patchItem(item.id, "nom", e.target.value)}
                        onBlur={() => saveItemField(item.id, "nom")}
                        className={`h-7 text-sm flex-1 ${item.actif ? "" : "line-through text-slate-300"}`}
                      />
                      <button onClick={() => deleteItem(item.id)} className="text-slate-200 hover:text-red-400 transition shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 ml-7">
                      <Input
                        value={d.nom_en}
                        onChange={e => patchItem(item.id, "nom_en", e.target.value)}
                        onBlur={() => saveItemField(item.id, "nom_en")}
                        placeholder="Nom EN"
                        className="h-7 text-sm italic text-slate-500"
                      />
                      <TranslateBtn
                        source={d.nom}
                        onResult={v => { patchItem(item.id, "nom_en", v); supabase.from("wifi_menu").update({ nom_en: v }).eq("id", item.id).then(() => setItems(prev => prev.map(i => i.id === item.id ? { ...i, nom_en: v } : i))); }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
              <Input
                placeholder={`Ajouter une option…`}
                value={newNom[key]}
                onChange={e => setNewNom(prev => ({ ...prev, [key]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addItem(key as "base" | "garniture")}
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={() => addItem(key as "base" | "garniture")} disabled={saving || !newNom[key].trim()} className="h-8 px-3 bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white">
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
// TAB BAR / ROOFTOP
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// TAB CURIOSITÉS (BW uniquement)
// ─────────────────────────────────────────────────────────────
type EditState = {
  nom: string; nom_en: string; emoji: string;
  description: string; description_en: string;
  tags: string[]; tagInput: string;
  duree_heures: number; prix_reservation: number; dispo: boolean;
};

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

  const moveItem = async (item: CurioItem, dir: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.ordre - b.ordre);
    const idx = sorted.findIndex(i => i.id === item.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const reordered = sorted.map((i, n) => ({ ...i, ordre: n }));
    const byId = new Map(reordered.map(i => [i.id, i.ordre]));
    setItems(prev => prev.map(i => byId.has(i.id) ? { ...i, ordre: byId.get(i.id)! } : i));
    await Promise.all(reordered.map(i =>
      supabase.from("wifi_curiosites").update({ ordre: i.ordre }).eq("id", i.id)
    ));
  };

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
    const nomEnManual = edit.nom_en.trim();
    const descEnManual = edit.description_en.trim();
    const [nom_en, description_en] = await Promise.all([
      nomEnManual ? Promise.resolve(nomEnManual) : translate(nom),
      !description
        ? Promise.resolve(null)
        : (descEnManual ? Promise.resolve(descEnManual) : translate(description)),
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
      {[...items].sort((a, b) => a.ordre - b.ordre).map((item, idx, sorted) => {
        const isOpen = openId === item.id;
        return (
          <div key={item.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50 transition select-none" onClick={() => openEdit(item)}>
              <div className="flex flex-col gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => moveItem(item, -1)} disabled={idx === 0} className="text-slate-300 hover:text-slate-600 disabled:opacity-20"><ChevronUp size={14} /></button>
                <button onClick={() => moveItem(item, 1)} disabled={idx === sorted.length - 1} className="text-slate-300 hover:text-slate-600 disabled:opacity-20"><ChevronDown size={14} /></button>
              </div>
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

            {isOpen && (
              <div className="border-t border-slate-100 px-4 py-4 bg-slate-50 space-y-3">
                <div className="grid grid-cols-[48px_1fr_1fr] gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Emoji</label>
                    <Input value={edit.emoji} onChange={e => setEdit(s => ({ ...s, emoji: e.target.value }))} className="text-center text-lg h-9 bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Nom FR</label>
                    <Input value={edit.nom} onChange={e => setEdit(s => ({ ...s, nom: e.target.value }))} className="h-9 bg-white" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-slate-400">Nom EN</label>
                      <TranslateBtn source={edit.nom} onResult={v => setEdit(s => ({ ...s, nom_en: v }))} />
                    </div>
                    <Input
                      value={edit.nom_en}
                      onChange={e => setEdit(s => ({ ...s, nom_en: e.target.value }))}
                      placeholder="Laisser vide = auto-traduit"
                      className="h-9 bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Description FR</label>
                    <AutoTextarea value={edit.description} onChange={e => setEdit(s => ({ ...s, description: e.target.value }))} placeholder="Décrivez l'objet en 2-3 lignes…" className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_20%,transparent)]" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-slate-400">Description EN</label>
                      <TranslateBtn source={edit.description} onResult={v => setEdit(s => ({ ...s, description_en: v }))} />
                    </div>
                    <AutoTextarea
                      value={edit.description_en}
                      onChange={e => setEdit(s => ({ ...s, description_en: e.target.value }))}
                      placeholder="Laisser vide = auto-traduit"
                      className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_20%,transparent)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">Tags</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {edit.tags.map(t => (
                      <span key={t} className="inline-flex items-center gap-1 text-xs bg-[color-mix(in_srgb,var(--brand)_10%,transparent)] text-[var(--brand)] rounded-full px-2.5 py-0.5">
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

                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-slate-700">Disponible</span>
                  <button
                    onClick={() => setEdit(s => ({ ...s, dispo: !s.dispo }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${edit.dispo ? "bg-[var(--brand)]" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${edit.dispo ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>Annuler</Button>
                  <Button size="sm" onClick={() => saveItem(item.id)} disabled={saving === item.id || !edit.nom.trim()} className="bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white gap-1.5">
                    {saving === item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Enregistrer
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-3">
        <p className="text-xs text-slate-400 mb-2 uppercase tracking-widest">Ajouter un objet</p>
        <div className="flex gap-2">
          <Input placeholder="📦" value={newEmoji} onChange={e => setNewEmoji(e.target.value)} className="w-14 text-center h-9" />
          <Input placeholder="Nom de l'objet" value={newNom} onChange={e => setNewNom(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} className="h-9 flex-1" />
          <Button size="sm" onClick={addItem} disabled={!newNom.trim() || addingSaving} className="h-9 px-3 bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white">
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
  const hotelId = useHotelId();
  const [message, setMessage] = useState("");
  const [messageEn, setMessageEn] = useState("");
  const [type, setType] = useState<"info" | "urgent">("info");
  const [active, setActive] = useState(false);
  const [tileId, setTileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("wifi_tiles").select("*").eq("slug", "annonce").eq("hotel_id", hotelId).single().then(({ data }) => {
      if (data) {
        setTileId(data.id);
        setMessage(data.config?.message ?? "");
        setMessageEn(data.config?.en?.message ?? "");
        setType(data.config?.type ?? "info");
        setActive(data.visible ?? false);
      }
    });
  }, [hotelId]);

  const save = async () => {
    setSaving(true);
    const config: TileConfig = { message, type };
    if (messageEn.trim()) config.en = { message: messageEn.trim() };
    const payload = { slug: "annonce", emoji: "📢", title: "Annonce", tagline: "", visible: active, ordre: 999, config, hotel_id: hotelId };
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
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* En-tête : titre + switch actif/inactif */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--brand-bg)] text-[var(--brand)]">
            <Megaphone size={17} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Bandeau d&apos;annonce</p>
            <p className={`text-xs mt-0.5 ${active ? "text-emerald-600 font-medium" : "text-slate-400"}`}>
              {active ? "● Affiché en haut du portail client" : "Désactivé — pas visible par les clients"}
            </p>
          </div>
        </div>
        <button
          onClick={() => setActive(v => !v)}
          aria-label={active ? "Désactiver l'annonce" : "Activer l'annonce"}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${active ? "bg-[var(--brand)]" : "bg-slate-200"}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${active ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Type de message — pills inline */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Ton :</span>
          {([
            { k: "info" as const, emoji: "ℹ️", label: "Information", on: "border-blue-300 bg-blue-50 text-blue-700" },
            { k: "urgent" as const, emoji: "⚠️", label: "Urgent", on: "border-red-300 bg-red-50 text-red-600" },
          ]).map(o => (
            <button key={o.k} onClick={() => setType(o.k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${type === o.k ? o.on : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
              <span>{o.emoji}</span> {o.label}
            </button>
          ))}
        </div>

        {/* Aperçu WYSIWYG : le bandeau exactement comme le client le verra */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">Aperçu du bandeau</p>
          {message.trim() ? (
            <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2.5 ${type === "urgent" ? "bg-red-50 border-red-200 text-red-700" : "bg-blue-50 border-blue-200 text-blue-700"}`}>
              <span className="text-base shrink-0">{type === "urgent" ? "⚠️" : "ℹ️"}</span>
              <p className="leading-relaxed whitespace-pre-wrap">{message}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400 italic">
              Le bandeau apparaîtra ici dès que tu écris un message.
            </div>
          )}
        </div>

        {/* Message FR / EN côte à côte */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1.5">Message (FR)</p>
            <AutoTextarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Ex : L'ascenseur est momentanément hors service. Nous nous en excusons."
              className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-widest text-slate-400">Message (EN)</p>
              <TranslateBtn source={message} onResult={setMessageEn} />
            </div>
            <AutoTextarea
              value={messageEn}
              onChange={e => setMessageEn(e.target.value)}
              placeholder={message || "Ex: The elevator is temporarily out of service. We apologize."}
              className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="brand" onClick={save} disabled={saving || !message.trim()} className="gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {active ? "Publier l'annonce" : "Enregistrer"}
          </Button>
        </div>
      </div>
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
