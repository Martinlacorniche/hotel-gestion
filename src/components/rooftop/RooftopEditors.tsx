"use client";

// Éditeurs Rooftop partagés (carte plats+boissons, blacklist). Extraits de
// wifi-admin pour être réutilisés par le module interne /rooftop.
// Chaque éditeur reçoit `hotelId` en prop (plus de dépendance à un contexte).

import { useEffect, useState } from "react";
import { tvaTypeForCategorie } from "@/lib/rooftopTva";
import { supabase } from "@/lib/supabaseClient";
import { confirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Eye, EyeOff, ChevronUp, ChevronDown, Save, Plus, Trash2, Loader2, Check, Sparkles,
  Copy, ExternalLink,
} from "lucide-react";
import toast from "react-hot-toast";

export const CORNICHE_ID = "f9d59e56-9a2f-433e-bcf4-f9753f105f32";
export const VOILES_ID = "ded6e6fb-ff3c-4fa8-ad07-403ee316be53";

export type BarItem = {
  id: string;
  categorie: string;
  nom: string;
  nom_en: string | null;
  description: string | null;
  description_en: string | null;
  prix: string;
  actif: boolean;
  ordre: number;
  quantite: number | null;
  local: boolean;
};

export type PlatItem = {
  id: string;
  section: "sale" | "sucre";
  nom: string;
  nom_en: string | null;
  description: string | null;
  description_en: string | null;
  options: string | null;
  options_en: string | null;
  marque: string | null;
  prix: string | null;
  vege: boolean;
  photo_url: string | null;
  actif: boolean;
  ordre: number;
};

export type BlacklistItem = {
  id: string;
  email: string | null;
  nom: string | null;
  motif: string | null;
  created_at: string;
};

export const DEFAULT_BAR_CATEGORIES = ["Softs", "Bières", "Vins", "Cocktails", "Chauds"];

export function BarTab({ hotelId }: { hotelId: string }) {
  const isVoiles = hotelId === VOILES_ID;
  const barSlug = isVoiles ? "rooftop" : "bar";

  const [items, setItems] = useState<BarItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { nom: string; nom_en: string; description: string; description_en: string; prix: string; quantite: string }>>({});
  const [categories, setCategories] = useState<string[]>(DEFAULT_BAR_CATEGORIES);
  const [catEn, setCatEn] = useState<Record<string, string>>({});
  const [catPrix, setCatPrix] = useState<Record<string, string>>({});
  const [catTva, setCatTva] = useState<Record<string, string>>({}); // cat → 'soft' | 'alcool' (TVA)
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [barTileId, setBarTileId] = useState<string | null>(null);
  const [barConfig, setBarConfig] = useState<Record<string, unknown>>({});
  const [newNom, setNewNom] = useState<Record<string, string>>({});
  const [newCat, setNewCat] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editingCatVal, setEditingCatVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("wifi_bar").select("*").eq("hotel_id", hotelId).order("ordre"),
      supabase.from("wifi_tiles").select("id, config").eq("slug", barSlug).eq("hotel_id", hotelId).single(),
    ]).then(([{ data: barData }, { data: tileData }]) => {
      if (barData) {
        setItems(barData);
        const init: typeof drafts = {};
        barData.forEach((i: BarItem) => {
          init[i.id] = {
            nom: i.nom,
            nom_en: i.nom_en ?? "",
            description: i.description ?? "",
            description_en: i.description_en ?? "",
            prix: i.prix,
            quantite: i.quantite != null ? String(i.quantite) : "",
          };
        });
        setDrafts(init);
        const dbCats = [...new Set(barData.map((i: BarItem) => i.categorie))];
        if (tileData?.config?.categories_ordre) {
          setCategories([...new Set([...(tileData.config.categories_ordre as string[]), ...dbCats])]);
        } else {
          setCategories(prev => [...new Set([...prev, ...dbCats])]);
        }
      }
      if (tileData) {
        setBarTileId(tileData.id);
        setBarConfig(tileData.config ?? {});
        if (tileData.config?.categories_masquees) {
          setHiddenCats(new Set(tileData.config.categories_masquees as string[]));
        }
        const enCats = tileData.config?.en?.categories as Record<string, string> | undefined;
        if (enCats) setCatEn(enCats);
        const prixCats = tileData.config?.categories_prix as Record<string, string> | undefined;
        if (prixCats) setCatPrix(prixCats);
        const tvaCats = tileData.config?.categories_tva as Record<string, string> | undefined;
        if (tvaCats) setCatTva(tvaCats);
      }
    });
  }, [hotelId, barSlug]);

  const persistConfig = async (patch: Record<string, unknown>) => {
    if (!barTileId) return;
    const next = { ...barConfig, ...patch };
    setBarConfig(next);
    await supabase.from("wifi_tiles").update({ config: next }).eq("id", barTileId);
  };

  const persistCatsOrdre = async (cats: string[]) => persistConfig({ categories_ordre: cats });

  const persistCatEn = async (next: Record<string, string>) => {
    const en = { ...(barConfig.en as Record<string, unknown> ?? {}), categories: next };
    await persistConfig({ en });
  };

  const setCatEnValue = (cat: string, value: string) => {
    const next = { ...catEn };
    if (value.trim()) next[cat] = value.trim();
    else delete next[cat];
    setCatEn(next);
    persistCatEn(next);
  };

  // Prix par CATÉGORIE (pas par article) — stocké dans la config de la tuile.
  const persistCatPrix = async (next: Record<string, string>) => persistConfig({ categories_prix: next });

  const setCatPrixValue = (cat: string, value: string) => {
    const next = { ...catPrix };
    if (value.trim()) next[cat] = value.trim();
    else delete next[cat];
    setCatPrix(next);
    persistCatPrix(next);
  };

  // Type de TVA par CATÉGORIE (soft 10% / alcool 10-20%) — pilote la facturation POS.
  const persistCatTva = async (next: Record<string, string>) => persistConfig({ categories_tva: next });

  const setCatTvaValue = (cat: string, type: "soft" | "alcool") => {
    const next = { ...catTva, [cat]: type };
    setCatTva(next);
    persistCatTva(next);
  };

  const toggleHiddenCat = async (cat: string) => {
    const next = new Set(hiddenCats);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setHiddenCats(next);
    await persistConfig({ categories_masquees: [...next] });
  };

  const moveCategory = async (idx: number, dir: -1 | 1) => {
    const next = [...categories];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setCategories(next);
    await persistCatsOrdre(next);
  };

  const patch = (id: string, field: string, value: string) => {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setDirty(prev => new Set(prev).add(id));
  };

  const toggleActif = async (item: BarItem) => {
    const val = !item.actif;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, actif: val } : i));
    await supabase.from("wifi_bar").update({ actif: val }).eq("id", item.id);
  };

  const toggleLocal = async (item: BarItem) => {
    const val = !item.local;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, local: val } : i));
    await supabase.from("wifi_bar").update({ local: val }).eq("id", item.id);
  };

  const deleteItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
    await supabase.from("wifi_bar").delete().eq("id", id);
    toast.success("Article supprimé");
  };

  const saveAll = async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    let hasError = false;
    await Promise.all([...dirty].map(async id => {
      const d = drafts[id];
      if (!d) return;
      const nom = (d.nom ?? "").trim();
      const nom_en = (d.nom_en ?? "").trim() || null;
      const description = (d.description ?? "").trim() || null;
      const description_en = (d.description_en ?? "").trim() || null;
      const prix = (d.prix ?? "").trim();
      const quantite = !(d.quantite ?? "").trim() ? null : parseInt(d.quantite, 10);
      const { error } = await supabase.from("wifi_bar")
        .update({ nom, nom_en, description, description_en, prix, quantite })
        .eq("id", id);
      if (error) { toast.error(error.message ?? JSON.stringify(error)); hasError = true; return; }
      setItems(prev => prev.map(i => i.id === id ? { ...i, nom, nom_en, description, description_en, prix, quantite } : i));
    }));
    setDirty(new Set());
    setSaving(false);
    if (hasError) toast.error("Erreur lors de la sauvegarde — vérifiez la console");
    else toast.success("Sauvegardé ✓");
  };

  const addItem = async (categorie: string) => {
    const nom = (newNom[categorie] ?? "").trim();
    if (!nom) return;
    setAdding(true);
    const ordre = items.filter(i => i.categorie === categorie).length;
    // Prix géré par catégorie désormais → prix article vide.
    const { data, error } = await supabase.from("wifi_bar")
      .insert({ categorie, nom, prix: "", actif: true, ordre, quantite: null, local: false, description: null, hotel_id: hotelId })
      .select().single();
    setAdding(false);
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, data]);
    setDrafts(prev => ({ ...prev, [data.id]: { nom: data.nom, nom_en: "", description: "", description_en: "", prix: data.prix ?? "", quantite: "" } }));
    setNewNom(prev => ({ ...prev, [categorie]: "" }));
    toast.success("Article ajouté ✓");
  };

  const addCategorie = () => {
    const cat = newCat.trim();
    if (!cat || categories.includes(cat)) return;
    const next = [...categories, cat];
    setCategories(next);
    setNewCat("");
    persistCatsOrdre(next);
  };

  const deleteCategorie = async (cat: string) => {
    const hasItems = items.some(i => i.categorie === cat);
    if (hasItems) {
      if (!(await confirmDialog(`La catégorie "${cat}" contient des articles. Supprimer quand même (les articles seront aussi supprimés) ?`))) return;
      const ids = items.filter(i => i.categorie === cat).map(i => i.id);
      await supabase.from("wifi_bar").delete().in("id", ids);
      setItems(prev => prev.filter(i => i.categorie !== cat));
      setDrafts(prev => {
        const n = { ...prev };
        ids.forEach(id => delete n[id]);
        return n;
      });
    }
    const next = categories.filter(c => c !== cat);
    setCategories(next);
    await persistCatsOrdre(next);
    if (catEn[cat]) {
      const nextEn = { ...catEn };
      delete nextEn[cat];
      setCatEn(nextEn);
      await persistCatEn(nextEn);
    }
    if (catPrix[cat]) {
      const nextPrix = { ...catPrix };
      delete nextPrix[cat];
      setCatPrix(nextPrix);
      await persistCatPrix(nextPrix);
    }
    if (catTva[cat]) {
      const nextTva = { ...catTva };
      delete nextTva[cat];
      setCatTva(nextTva);
      await persistCatTva(nextTva);
    }
    toast.success(`Catégorie "${cat}" supprimée`);
  };

  const startRenameCat = (cat: string) => {
    setEditingCat(cat);
    setEditingCatVal(cat);
  };

  const confirmRenameCat = async (oldCat: string) => {
    const newName = editingCatVal.trim();
    if (!newName || newName === oldCat) { setEditingCat(null); return; }
    if (categories.includes(newName)) { toast.error("Ce nom existe déjà"); return; }
    const ids = items.filter(i => i.categorie === oldCat).map(i => i.id);
    if (ids.length > 0) {
      await supabase.from("wifi_bar").update({ categorie: newName }).in("id", ids);
    }
    setItems(prev => prev.map(i => i.categorie === oldCat ? { ...i, categorie: newName } : i));
    const next = categories.map(c => c === oldCat ? newName : c);
    setCategories(next);
    if (hiddenCats.has(oldCat)) {
      const nextHidden = new Set(hiddenCats);
      nextHidden.delete(oldCat);
      nextHidden.add(newName);
      setHiddenCats(nextHidden);
      await persistConfig({ categories_ordre: next, categories_masquees: [...nextHidden] });
    } else {
      await persistCatsOrdre(next);
    }
    if (catEn[oldCat]) {
      const nextEn = { ...catEn };
      nextEn[newName] = nextEn[oldCat];
      delete nextEn[oldCat];
      setCatEn(nextEn);
      await persistCatEn(nextEn);
    }
    if (catPrix[oldCat]) {
      const nextPrix = { ...catPrix };
      nextPrix[newName] = nextPrix[oldCat];
      delete nextPrix[oldCat];
      setCatPrix(nextPrix);
      await persistCatPrix(nextPrix);
    }
    if (catTva[oldCat]) {
      const nextTva = { ...catTva };
      nextTva[newName] = nextTva[oldCat];
      delete nextTva[oldCat];
      setCatTva(nextTva);
      await persistCatTva(nextTva);
    }
    setEditingCat(null);
    toast.success("Catégorie renommée ✓");
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          onClick={saveAll}
          disabled={saving || dirty.size === 0}
          className="bg-[#004e7c] hover:bg-[#003d61] text-white gap-2"
          size="sm"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty.size > 0 ? `Enregistrer (${dirty.size})` : "Enregistrer"}
        </Button>
      </div>

      {categories.map((cat, idx) => {
        const opts = items.filter(i => i.categorie === cat);
        const isHidden = hiddenCats.has(cat);
        return (
          <div key={cat} className={`bg-white rounded-xl border overflow-hidden ${isHidden ? "border-slate-100 opacity-60" : "border-slate-200"}`}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveCategory(idx, -1)} disabled={idx === 0} className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-20"><ChevronUp size={13} /></button>
                <button onClick={() => moveCategory(idx, 1)} disabled={idx === categories.length - 1} className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-20"><ChevronDown size={13} /></button>
              </div>
              {editingCat === cat ? (
                <input
                  autoFocus
                  value={editingCatVal}
                  onChange={e => setEditingCatVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") confirmRenameCat(cat); if (e.key === "Escape") setEditingCat(null); }}
                  onBlur={() => confirmRenameCat(cat)}
                  className="text-xs font-semibold uppercase tracking-widest bg-white border border-slate-300 rounded px-1.5 py-0.5 w-32 focus:outline-none focus:border-[#004e7c]"
                />
              ) : (
                <span className={`text-xs font-semibold uppercase tracking-widest ${isHidden ? "text-slate-300" : "text-slate-500"}`}>{cat}</span>
              )}
              <button onClick={() => startRenameCat(cat)} className="text-slate-300 hover:text-slate-500 transition p-1" title="Renommer">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button onClick={() => deleteCategorie(cat)} className="text-slate-300 hover:text-red-400 transition p-1" title="Supprimer la catégorie">
                <Trash2 size={12} />
              </button>
              <div className="flex items-center gap-1 ml-3" title="Prix unique pour toute la catégorie">
                <span className="text-[10px] font-medium text-[#004e7c]">Prix cat.</span>
                <Input
                  value={catPrix[cat] ?? ""}
                  onChange={e => setCatPrix(prev => ({ ...prev, [cat]: e.target.value }))}
                  onBlur={e => setCatPrixValue(cat, e.target.value)}
                  placeholder="€"
                  className="h-10 w-20 text-sm text-center tabular-nums"
                />
              </div>
              {/* TVA de la catégorie (facturation POS) — soft 10% / alcool 10-20% */}
              <div className="flex items-center rounded-md border border-slate-200 overflow-hidden shrink-0" title="TVA appliquée à la facture : Soft = 10%, Alcool = 50% à 10% + 50% à 20%">
                <span className="px-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50 border-r border-slate-200">TVA</span>
                {(["soft", "alcool"] as const).map(t => {
                  const on = tvaTypeForCategorie(cat, catTva) === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCatTvaValue(cat, t)}
                      className={`px-3 h-10 text-xs font-semibold whitespace-nowrap transition ${
                        on
                          ? (t === "alcool" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white")
                          : "bg-white text-slate-400 hover:bg-slate-50"}`}>
                      {t === "soft" ? "Soft" : "Alcool"}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1">
                <Input
                  value={catEn[cat] ?? ""}
                  onChange={e => setCatEn(prev => ({ ...prev, [cat]: e.target.value }))}
                  onBlur={e => setCatEnValue(cat, e.target.value)}
                  placeholder="EN"
                  className="h-10 w-28 text-sm uppercase tracking-wider"
                />
                <TranslateBtn source={cat} onResult={v => setCatEnValue(cat, v)} />
              </div>
              <button
                onClick={() => toggleHiddenCat(cat)}
                className={`ml-auto p-1.5 rounded-lg transition ${isHidden ? "text-slate-300 bg-slate-100" : "text-[#004e7c] bg-blue-50"}`}
              >
                {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            <ul className="divide-y divide-slate-50">
              {opts.map(item => {
                const d = drafts[item.id] ?? { nom: item.nom, nom_en: "", description: "", description_en: "", prix: item.prix, quantite: "" };
                return (
                  <li key={item.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleActif(item)}
                        className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition border ${item.actif ? "bg-[#004e7c] border-[#004e7c]" : "border-slate-300"}`}
                      >
                        {item.actif && <Check size={18} className="text-white" />}
                      </button>
                      <Input value={d.nom} onChange={e => patch(item.id, "nom", e.target.value)} className="h-11 text-sm flex-1" />
                      <Input value={d.quantite} onChange={e => patch(item.id, "quantite", e.target.value)} className="h-11 w-14 text-sm text-center tabular-nums" placeholder="cl" type="number" min="0" />
                      <button
                        onClick={() => toggleLocal(item)}
                        title="Produit local"
                        className={`text-sm px-2.5 py-2 rounded-md border transition shrink-0 ${item.local ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "border-slate-200 text-slate-300 hover:text-slate-400"}`}
                      >
                        🌿
                      </button>
                      {dirty.has(item.id) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                      <button onClick={() => deleteItem(item.id)} className="p-2 -m-1 text-slate-300 hover:text-red-400 transition shrink-0">
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <button onClick={() => toggleExpanded(item.id)} className="ml-6 inline-flex items-center gap-1 py-2 text-sm font-medium text-slate-400 hover:text-[#004e7c] transition">
                      {expanded.has(item.id) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {expanded.has(item.id) ? "Masquer les détails" : "Détails (traductions, description)"}
                    </button>

                    {expanded.has(item.id) && (
                      <div className="ml-6 space-y-1.5 pt-1">
                        <div className="flex items-center gap-2">
                          <Input value={d.nom_en} onChange={e => patch(item.id, "nom_en", e.target.value)} className="h-11 text-sm italic text-slate-500" placeholder="Nom EN" />
                          <TranslateBtn source={d.nom} onResult={v => patch(item.id, "nom_en", v)} />
                        </div>
                        <Input value={d.description} onChange={e => patch(item.id, "description", e.target.value)} className="h-11 text-sm text-slate-400" placeholder="Description (facultatif)" />
                        <div className="flex items-center gap-2">
                          <Input value={d.description_en} onChange={e => patch(item.id, "description_en", e.target.value)} className="h-11 text-sm italic text-slate-400" placeholder="Description EN (facultatif)" />
                          <TranslateBtn source={d.description} onResult={v => patch(item.id, "description_en", v)} />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
              <Input placeholder="Nom de l'article" value={newNom[cat] ?? ""} onChange={e => setNewNom(prev => ({ ...prev, [cat]: e.target.value }))} onKeyDown={e => e.key === "Enter" && addItem(cat)} className="h-11 text-sm flex-1" />
              <Button size="sm" onClick={() => addItem(cat)} disabled={adding || !newNom[cat]?.trim()} className="h-11 px-4 bg-[#004e7c] hover:bg-[#003d61] text-white">
                <Plus size={14} />
              </Button>
            </div>
          </div>
        );
      })}

      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">Nouvelle catégorie</p>
        <div className="flex gap-2">
          <Input placeholder="Ex: Cocktails sans alcool" value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === "Enter" && addCategorie()} className="h-11 text-sm" />
          <Button size="sm" onClick={addCategorie} disabled={!newCat.trim() || categories.includes(newCat.trim())} className="h-11 px-4 bg-[#004e7c] hover:bg-[#003d61] text-white">
            <Plus size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB CARTE ROOFTOP (Voiles) — tout au même endroit :
// gauche = la bouffe (rooftop_plats), droite = les boissons (wifi_bar).
// ─────────────────────────────────────────────────────────────
// Lien public de la carte du rooftop, à envoyer facilement au client depuis la réception.
const ROOFTOP_CARTE_URL = "https://sitehtbm.netlify.app/rooftop-les-voiles";

export function CarteLienPublic() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-700">🔗 Carte en ligne · à envoyer au client</p>
        <a
          href={ROOFTOP_CARTE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-xs text-sky-600 hover:underline"
        >
          {ROOFTOP_CARTE_URL}
        </a>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(ROOFTOP_CARTE_URL);
            toast.success("Lien de la carte copié");
          }}
        >
          <Copy className="mr-1 h-4 w-4" /> Copier le lien
        </Button>
        <a href={ROOFTOP_CARTE_URL} target="_blank" rel="noopener noreferrer">
          <Button size="sm">
            <ExternalLink className="mr-1 h-4 w-4" /> Ouvrir
          </Button>
        </a>
      </div>
    </div>
  );
}

export function RooftopCarteTab({ hotelId }: { hotelId: string }) {
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <span>🍽️</span> La bouffe <span className="text-slate-300 font-normal">· à picorer</span>
        </h3>
        <PlatsTab hotelId={hotelId} />
      </section>
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <span>🥂</span> Les boissons <span className="text-slate-300 font-normal">· c’est le prix</span>
        </h3>
        <BarTab hotelId={hotelId} />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB PLATS — carte food du Rooftop (Voiles). Concept eat & drink :
// deux sections fixes (Salé / Sucré), à picorer avec sa boisson.
// ─────────────────────────────────────────────────────────────
export const PLAT_SECTIONS: { key: "sale" | "sucre"; label: string }[] = [
  { key: "sale",  label: "🍽️ Salé" },
  { key: "sucre", label: "🍨 Sucré" },
];

export type PlatDraft = {
  nom: string; nom_en: string;
  description: string; description_en: string;
  options: string; options_en: string;
  marque: string; prix: string; photo_url: string;
};

export function PlatsTab({ hotelId }: { hotelId: string }) {
  const [items, setItems] = useState<PlatItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PlatDraft>>({});
  const [newNom, setNewNom] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const draftOf = (i: PlatItem): PlatDraft => ({
    nom: i.nom, nom_en: i.nom_en ?? "",
    description: i.description ?? "", description_en: i.description_en ?? "",
    options: i.options ?? "", options_en: i.options_en ?? "",
    marque: i.marque ?? "", prix: i.prix ?? "", photo_url: i.photo_url ?? "",
  });

  useEffect(() => {
    supabase.from("rooftop_plats").select("*").eq("hotel_id", hotelId).order("ordre")
      .then(({ data }) => {
        if (!data) return;
        setItems(data);
        const init: Record<string, PlatDraft> = {};
        data.forEach((i: PlatItem) => { init[i.id] = draftOf(i); });
        setDrafts(init);
      });
  }, [hotelId]);

  const patch = (id: string, field: keyof PlatDraft, value: string) => {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setDirty(prev => new Set(prev).add(id));
  };

  const toggleActif = async (item: PlatItem) => {
    const val = !item.actif;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, actif: val } : i));
    await supabase.from("rooftop_plats").update({ actif: val }).eq("id", item.id);
  };

  const toggleVege = async (item: PlatItem) => {
    const val = !item.vege;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, vege: val } : i));
    await supabase.from("rooftop_plats").update({ vege: val }).eq("id", item.id);
  };

  const deleteItem = async (id: string) => {
    if (!(await confirmDialog("Supprimer ce plat ?"))) return;
    setItems(prev => prev.filter(i => i.id !== id));
    setDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
    await supabase.from("rooftop_plats").delete().eq("id", id);
    toast.success("Plat supprimé");
  };

  const moveItem = async (section: "sale" | "sucre", idx: number, dir: -1 | 1) => {
    const list = items.filter(i => i.section === section).sort((a, b) => a.ordre - b.ordre);
    const swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    const a = list[idx], b = list[swap];
    setItems(prev => prev.map(i =>
      i.id === a.id ? { ...i, ordre: b.ordre } : i.id === b.id ? { ...i, ordre: a.ordre } : i));
    await Promise.all([
      supabase.from("rooftop_plats").update({ ordre: b.ordre }).eq("id", a.id),
      supabase.from("rooftop_plats").update({ ordre: a.ordre }).eq("id", b.id),
    ]);
  };

  const saveAll = async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    let hasError = false;
    await Promise.all([...dirty].map(async id => {
      const d = drafts[id];
      if (!d) return;
      const payload = {
        nom: d.nom.trim(),
        nom_en: d.nom_en.trim() || null,
        description: d.description.trim() || null,
        description_en: d.description_en.trim() || null,
        options: d.options.trim() || null,
        options_en: d.options_en.trim() || null,
        marque: d.marque.trim() || null,
        prix: d.prix.trim() || null,
        photo_url: d.photo_url.trim() || null,
      };
      const { error } = await supabase.from("rooftop_plats").update(payload).eq("id", id);
      if (error) { toast.error(error.message ?? JSON.stringify(error)); hasError = true; return; }
      setItems(prev => prev.map(i => i.id === id ? { ...i, ...payload } : i));
    }));
    setDirty(new Set());
    setSaving(false);
    if (hasError) toast.error("Erreur lors de la sauvegarde");
    else toast.success("Sauvegardé ✓");
  };

  const addItem = async (section: "sale" | "sucre") => {
    const nom = (newNom[section] ?? "").trim();
    if (!nom) return;
    setAdding(true);
    const ordre = items.filter(i => i.section === section).length;
    const { data, error } = await supabase.from("rooftop_plats")
      .insert({ hotel_id: hotelId, section, nom, actif: true, vege: false, ordre })
      .select().single();
    setAdding(false);
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, data]);
    setDrafts(prev => ({ ...prev, [data.id]: draftOf(data) }));
    setNewNom(prev => ({ ...prev, [section]: "" }));
    toast.success("Plat ajouté ✓");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400 leading-snug">
          🍸 Concept <span className="font-semibold text-slate-500">eat&nbsp;&&nbsp;drink</span> —
          chaque boisson s’accompagne d’une assiette à picorer.
        </p>
        <Button
          onClick={saveAll}
          disabled={saving || dirty.size === 0}
          className="bg-[#004e7c] hover:bg-[#003d61] text-white gap-2 shrink-0"
          size="sm"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty.size > 0 ? `Enregistrer (${dirty.size})` : "Enregistrer"}
        </Button>
      </div>

      {PLAT_SECTIONS.map(({ key, label }) => {
        const list = items.filter(i => i.section === key).sort((a, b) => a.ordre - b.ordre);
        return (
          <div key={key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
            </div>

            <ul className="divide-y divide-slate-50">
              {list.map((item, idx) => {
                const d = drafts[item.id] ?? draftOf(item);
                return (
                  <li key={item.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveItem(key, idx, -1)} disabled={idx === 0} className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-20"><ChevronUp size={13} /></button>
                        <button onClick={() => moveItem(key, idx, 1)} disabled={idx === list.length - 1} className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-20"><ChevronDown size={13} /></button>
                      </div>
                      <button
                        onClick={() => toggleActif(item)}
                        title={item.actif ? "Visible" : "Masqué"}
                        className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition border ${item.actif ? "bg-[#004e7c] border-[#004e7c]" : "border-slate-300"}`}
                      >
                        {item.actif && <Check size={18} className="text-white" />}
                      </button>
                      <Input value={d.nom} onChange={e => patch(item.id, "nom", e.target.value)} className="h-11 text-sm flex-1" placeholder="Nom du plat" />
                      <Input value={d.prix} onChange={e => patch(item.id, "prix", e.target.value)} className="h-11 w-20 text-sm text-center tabular-nums" placeholder="Prix" />
                      <button
                        onClick={() => toggleVege(item)}
                        title="Végétarien"
                        className={`text-sm px-2.5 py-2 rounded-md border transition shrink-0 ${item.vege ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "border-slate-200 text-slate-300 hover:text-slate-400"}`}
                      >
                        🌱
                      </button>
                      {dirty.has(item.id) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                      <button onClick={() => deleteItem(item.id)} className="p-2 -m-1 text-slate-300 hover:text-red-400 transition shrink-0">
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Description : reste visible, c'est le texte qui vend */}
                    <div className="flex items-start gap-2 ml-6">
                      <textarea value={d.description} onChange={e => patch(item.id, "description", e.target.value)} rows={2} className="flex-1 text-sm rounded-md border border-slate-200 px-2 py-1 focus:outline-none focus:border-[#004e7c] resize-none" placeholder="Description qui donne envie…" />
                      <TranslateBtn source={d.description} onResult={v => patch(item.id, "description_en", v)} />
                    </div>

                    {/* Détails secondaires repliés : traductions, options, marque, photo */}
                    <button onClick={() => toggleExpanded(item.id)} className="ml-6 inline-flex items-center gap-1 py-2 text-sm font-medium text-slate-400 hover:text-[#004e7c] transition">
                      {expanded.has(item.id) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {expanded.has(item.id) ? "Masquer les détails" : "Détails (traductions, options, marque, photo)"}
                    </button>

                    {expanded.has(item.id) && (
                      <div className="ml-6 space-y-1.5 pt-1">
                        <div className="flex items-center gap-2">
                          <Input value={d.nom_en} onChange={e => patch(item.id, "nom_en", e.target.value)} className="h-11 text-sm italic text-slate-500" placeholder="Nom EN" />
                          <TranslateBtn source={d.nom} onResult={v => patch(item.id, "nom_en", v)} />
                        </div>
                        <Input value={d.description_en} onChange={e => patch(item.id, "description_en", e.target.value)} className="h-11 text-sm italic text-slate-500" placeholder="Description EN" />
                        <div className="flex items-center gap-2">
                          <Input value={d.options} onChange={e => patch(item.id, "options", e.target.value)} className="h-11 text-sm flex-1" placeholder="Options (ex. Sauce au choix : Barbecue ou Mayonnaise)" />
                          <TranslateBtn source={d.options} onResult={v => patch(item.id, "options_en", v)} />
                        </div>
                        <div className="flex items-center gap-2">
                          <Input value={d.marque} onChange={e => patch(item.id, "marque", e.target.value)} className="h-11 text-sm w-44" placeholder="Marque / artisan" />
                          <Input value={d.photo_url} onChange={e => patch(item.id, "photo_url", e.target.value)} className="h-11 text-sm flex-1" placeholder="URL photo (optionnel)" />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
              <Input placeholder="Nouveau plat…" value={newNom[key] ?? ""} onChange={e => setNewNom(prev => ({ ...prev, [key]: e.target.value }))} onKeyDown={e => e.key === "Enter" && addItem(key)} className="h-11 text-sm flex-1" />
              <Button size="sm" onClick={() => addItem(key)} disabled={adding || !newNom[key]?.trim()} className="h-11 px-4 bg-[#004e7c] hover:bg-[#003d61] text-white">
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
// TAB BLACKLIST (Voiles) — clients ayant posé un lapin. Bloque la résa
// EN LIGNE du Rooftop (match email OU nom). Le contrôle réel est côté DB
// (fonction is_rooftop_blacklisted + trigger sur rooftop_reservations).
// ─────────────────────────────────────────────────────────────
export function BlacklistTab({ hotelId }: { hotelId: string }) {
  const [items, setItems] = useState<BlacklistItem[]>([]);
  const [email, setEmail] = useState("");
  const [nom, setNom] = useState("");
  const [motif, setMotif] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.from("rooftop_blacklist").select("*").eq("hotel_id", hotelId)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setItems(data); });
  }, [hotelId]);

  const add = async () => {
    const e = email.trim(), n = nom.trim(), m = motif.trim();
    if (!e && !n) { toast.error("Renseignez au moins un email ou un nom"); return; }
    setAdding(true);
    const { data, error } = await supabase.from("rooftop_blacklist")
      .insert({ hotel_id: hotelId, email: e || null, nom: n || null, motif: m || null })
      .select().single();
    setAdding(false);
    if (error) { toast.error(error.message ?? "Erreur"); return; }
    setItems(prev => [data, ...prev]);
    setEmail(""); setNom(""); setMotif("");
    toast.success("Ajouté à la blacklist");
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog("Retirer cette personne de la blacklist ?"))) return;
    setItems(prev => prev.filter(i => i.id !== id));
    await supabase.from("rooftop_blacklist").delete().eq("id", id);
    toast.success("Retiré de la blacklist");
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-500 leading-snug">
        🚫 Un client a posé un lapin&nbsp;? Ajoutez son <span className="font-medium">email</span> et/ou son
        <span className="font-medium"> nom (et prénom)</span>. Il ne pourra plus réserver en ligne&nbsp;: le
        formulaire l’invitera à appeler l’établissement.
      </p>

      {/* Ajout */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <div className="grid sm:grid-cols-2 gap-2">
          <Input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="h-9 text-sm" />
          <Input placeholder="Nom et prénom" value={nom} onChange={e => setNom(e.target.value)} className="h-9 text-sm" />
        </div>
        <div className="flex gap-2">
          <Input placeholder="Motif (optionnel — ex. no-show 12/07)" value={motif} onChange={e => setMotif(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} className="h-9 text-sm flex-1" />
          <Button size="sm" onClick={add} disabled={adding || (!email.trim() && !nom.trim())} className="h-9 px-3 bg-[#004e7c] hover:bg-[#003d61] text-white">
            <Plus size={14} /> Ajouter
          </Button>
        </div>
      </div>

      {/* Liste */}
      {items.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-6">Aucune personne blacklistée.</p>
      ) : (
        <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
          {items.map(it => (
            <li key={it.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 truncate">
                  {it.nom || <span className="text-slate-400 italic">sans nom</span>}
                  {it.email && <span className="text-slate-400"> · {it.email}</span>}
                </p>
                {it.motif && <p className="text-[12px] text-slate-400 italic truncate">{it.motif}</p>}
              </div>
              <button onClick={() => remove(it.id)} className="p-2 -m-1 text-slate-300 hover:text-red-400 transition shrink-0" title="Retirer">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function translate(text: string): Promise<string> {
  if (!text.trim()) return "";
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  return data.result ?? "";
}

export function TranslateBtn({ source, onResult }: { source: string; onResult: (s: string) => void }) {
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (!source.trim() || loading) return;
    setLoading(true);
    try {
      const out = await translate(source);
      if (out) onResult(out);
      else toast.error("Traduction vide");
    } catch {
      toast.error("Erreur de traduction");
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={loading || !source.trim()}
      title="Auto-traduire depuis le FR"
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#004e7c] hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed rounded-md px-1.5 py-0.5 border border-slate-200 transition"
    >
      {loading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
      <span>Auto</span>
    </button>
  );
}

