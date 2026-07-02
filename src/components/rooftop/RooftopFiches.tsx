"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { confirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Save, Plus, Trash2, Loader2, Check, ChevronUp, ChevronDown, Eye, EyeOff, Euro, Utensils,
  IceCreamCone, Pencil,
} from "lucide-react";
import toast from "react-hot-toast";

// ─────────────────────────────────────────────────────────────
// FICHES TECHNIQUES ROOFTOP — éditables (Supabase rooftop_fiches / rooftop_marges).
// Composition + montage pour aider le service, coûts + marges pour le pilotage.
// Données sensibles → lecture authentifiée uniquement (voir migration 54).
// ─────────────────────────────────────────────────────────────

type Ingredient = { label: string; qty: string; note: string };
type Categorie = "assiette" | "dessert";
type Fiche = {
  id: string;
  categorie: Categorie;
  nom: string;
  sous_titre: string;
  cout: string; // édité en texte, converti en numeric à la sauvegarde
  ingredients: Ingredient[];
  montage: string[];
  actif: boolean;
  ordre: number;
};

const GROUPES: { key: Categorie; label: string }[] = [
  { key: "assiette", label: "🍽️ Assiettes" },
  { key: "dessert", label: "🍨 Desserts" },
];

const coutToStr = (n: number | null): string =>
  n == null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const strToCout = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// ── Éditeur des fiches (assiettes + desserts) ────────────────────────────────
function FichesEditor({ hotelId, showCosts }: { hotelId: string; showCosts: boolean }) {
  const [items, setItems] = useState<Fiche[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [newNom, setNewNom] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.from("rooftop_fiches").select("*").eq("hotel_id", hotelId).order("ordre")
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { setLoadError(true); return; }
        setItems(((data as unknown[]) || []).map(mapRow));
      });
  }, [hotelId]);

  function mapRow(r: unknown): Fiche {
    const o = r as Record<string, unknown>;
    return {
      id: o.id as string,
      categorie: (o.categorie as Categorie) ?? "assiette",
      nom: (o.nom as string) ?? "",
      sous_titre: (o.sous_titre as string) ?? "",
      cout: coutToStr((o.cout as number | null) ?? null),
      ingredients: Array.isArray(o.ingredients) ? (o.ingredients as Ingredient[]) : [],
      montage: Array.isArray(o.montage) ? (o.montage as string[]) : [],
      actif: (o.actif as boolean) ?? true,
      ordre: (o.ordre as number) ?? 0,
    };
  }

  const markDirty = (id: string) => setDirty(prev => new Set(prev).add(id));
  const update = (id: string, patch: Partial<Fiche>) => {
    setItems(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));
    markDirty(id);
  };
  const setIngredients = (id: string, ings: Ingredient[]) => update(id, { ingredients: ings });
  const setMontage = (id: string, steps: string[]) => update(id, { montage: steps });

  const toggleActif = async (f: Fiche) => {
    const val = !f.actif;
    setItems(prev => prev.map(x => (x.id === f.id ? { ...x, actif: val } : x)));
    await supabase.from("rooftop_fiches").update({ actif: val }).eq("id", f.id);
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog("Supprimer cette fiche ?"))) return;
    setItems(prev => prev.filter(f => f.id !== id));
    setDirty(prev => { const n = new Set(prev); n.delete(id); return n; });
    await supabase.from("rooftop_fiches").delete().eq("id", id);
    toast.success("Fiche supprimée");
  };

  const move = async (cat: Categorie, idx: number, dir: -1 | 1) => {
    const list = items.filter(i => i.categorie === cat).sort((a, b) => a.ordre - b.ordre);
    const swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    const a = list[idx], b = list[swap];
    setItems(prev => prev.map(i =>
      i.id === a.id ? { ...i, ordre: b.ordre } : i.id === b.id ? { ...i, ordre: a.ordre } : i));
    await Promise.all([
      supabase.from("rooftop_fiches").update({ ordre: b.ordre }).eq("id", a.id),
      supabase.from("rooftop_fiches").update({ ordre: a.ordre }).eq("id", b.id),
    ]);
  };

  const add = async (cat: Categorie) => {
    const nom = (newNom[cat] ?? "").trim();
    if (!nom) return;
    setAdding(true);
    const ordre = items.filter(i => i.categorie === cat).length;
    const { data, error } = await supabase.from("rooftop_fiches")
      .insert({ hotel_id: hotelId, categorie: cat, nom, ordre, ingredients: [], montage: [] })
      .select().single();
    setAdding(false);
    if (error) { toast.error(error.message ?? "Erreur"); return; }
    setItems(prev => [...prev, mapRow(data)]);
    setNewNom(prev => ({ ...prev, [cat]: "" }));
    toast.success("Fiche ajoutée ✓");
  };

  const saveAll = async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    let hasError = false;
    await Promise.all([...dirty].map(async id => {
      const f = items.find(x => x.id === id);
      if (!f) return;
      const payload = {
        nom: f.nom.trim(),
        sous_titre: f.sous_titre.trim() || null,
        cout: strToCout(f.cout),
        ingredients: f.ingredients.filter(i => i.label.trim() || i.qty.trim() || i.note.trim()),
        montage: f.montage.map(s => s.trim()).filter(Boolean),
      };
      const { error } = await supabase.from("rooftop_fiches").update(payload).eq("id", id);
      if (error) { toast.error(error.message ?? "Erreur"); hasError = true; }
    }));
    setDirty(new Set());
    setSaving(false);
    if (!hasError) toast.success("Sauvegardé ✓");
  };

  if (loading) return <p className="py-8 text-center text-sm text-slate-400">Chargement…</p>;
  if (loadError) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[14px] text-amber-800">
      Table <code className="font-mono">rooftop_fiches</code> introuvable. Lancez la migration{" "}
      <code className="font-mono">db/migrations/54_rooftop_fiches.sql</code> dans le SQL editor Supabase.
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={saveAll} disabled={saving || dirty.size === 0}
          size="sm" className="gap-2 bg-[#004e7c] text-white hover:bg-[#003d61]">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty.size > 0 ? `Enregistrer (${dirty.size})` : "Enregistrer"}
        </Button>
      </div>

      {GROUPES.map(({ key, label }) => {
        const list = items.filter(i => i.categorie === key).sort((a, b) => a.ordre - b.ordre);
        return (
          <div key={key} className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>

            {list.map((f, idx) => (
              <div key={f.id} className={`rounded-2xl border bg-white shadow-sm ${f.actif ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                {/* En-tête éditable */}
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => move(key, idx, -1)} disabled={idx === 0} className="text-slate-300 hover:text-slate-600 disabled:opacity-20"><ChevronUp size={14} /></button>
                    <button onClick={() => move(key, idx, 1)} disabled={idx === list.length - 1} className="text-slate-300 hover:text-slate-600 disabled:opacity-20"><ChevronDown size={14} /></button>
                  </div>
                  <button onClick={() => toggleActif(f)} title={f.actif ? "Visible" : "Masquée"}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${f.actif ? "border-[#004e7c] bg-[#004e7c]" : "border-slate-300"}`}>
                    {f.actif && <Check size={11} className="text-white" />}
                  </button>
                  <Input value={f.nom} onChange={e => update(f.id, { nom: e.target.value })}
                    className="h-9 flex-1 text-[15px] font-semibold" placeholder="Nom de la fiche" />
                  {showCosts && (
                    <div className="flex items-center gap-1">
                      <Input value={f.cout} onChange={e => update(f.id, { cout: e.target.value })}
                        className="h-9 w-20 text-center text-sm tabular-nums" placeholder="Coût" />
                      <span className="text-[13px] text-slate-400">€</span>
                    </div>
                  )}
                  {dirty.has(f.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
                  <button onClick={() => remove(f.id)} className="shrink-0 text-slate-200 transition hover:text-red-400"><Trash2 size={15} /></button>
                </div>

                <div className="space-y-4 px-4 py-4">
                  <Input value={f.sous_titre} onChange={e => update(f.id, { sous_titre: e.target.value })}
                    className="h-8 text-[13px] text-slate-500" placeholder="Sous-titre (facultatif)" />

                  {/* Composition */}
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Composition</p>
                    <div className="space-y-1.5">
                      {f.ingredients.map((ing, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <Input value={ing.label} placeholder="Ingrédient"
                            onChange={e => setIngredients(f.id, f.ingredients.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                            className="h-9 flex-1 text-[14px]" />
                          <Input value={ing.qty} placeholder="Qté"
                            onChange={e => setIngredients(f.id, f.ingredients.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                            className="h-9 w-24 text-center text-[14px] tabular-nums" />
                          <Input value={ing.note} placeholder="Note"
                            onChange={e => setIngredients(f.id, f.ingredients.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                            className="h-9 w-32 text-[13px] italic text-slate-500" />
                          <button onClick={() => setIngredients(f.id, f.ingredients.filter((_, j) => j !== i))}
                            className="shrink-0 text-slate-200 transition hover:text-red-400"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setIngredients(f.id, [...f.ingredients, { label: "", qty: "", note: "" }])}
                      className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#004e7c] hover:underline">
                      <Plus size={13} /> Ajouter un ingrédient
                    </button>
                  </div>

                  {/* Montage */}
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Montage</p>
                    <div className="space-y-1.5">
                      {f.montage.map((step, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#004e7c]/10 text-[11px] font-bold text-[#004e7c]">{i + 1}</span>
                          <Input value={step} placeholder={`Étape ${i + 1}`}
                            onChange={e => setMontage(f.id, f.montage.map((s, j) => j === i ? e.target.value : s))}
                            className="h-9 flex-1 text-[14px]" />
                          <button onClick={() => setMontage(f.id, f.montage.filter((_, j) => j !== i))}
                            className="shrink-0 text-slate-200 transition hover:text-red-400"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setMontage(f.id, [...f.montage, ""])}
                      className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#004e7c] hover:underline">
                      <Plus size={13} /> Ajouter une étape
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Ajout d'une fiche */}
            <div className="flex gap-2">
              <Input placeholder="Nouvelle fiche…" value={newNom[key] ?? ""}
                onChange={e => setNewNom(prev => ({ ...prev, [key]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && add(key)}
                className="h-9 flex-1 text-sm" />
              <Button size="sm" onClick={() => add(key)} disabled={adding || !newNom[key]?.trim()}
                className="h-9 bg-[#004e7c] px-3 text-white hover:bg-[#003d61]"><Plus size={14} /></Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Éditeur de la grille de marges ───────────────────────────────────────────
type Marge = { id: string; categorie: string; prix: string; marge_min: string; marge_max: string; ordre: number };

function MargesEditor({ hotelId }: { hotelId: string }) {
  const [items, setItems] = useState<Marge[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.from("rooftop_marges").select("*").eq("hotel_id", hotelId).order("ordre")
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { setLoadError(true); return; }
        setItems(((data as Marge[]) || []).map(m => ({
          id: m.id, categorie: m.categorie ?? "", prix: m.prix ?? "",
          marge_min: m.marge_min ?? "", marge_max: m.marge_max ?? "", ordre: m.ordre ?? 0,
        })));
      });
  }, [hotelId]);

  const update = (id: string, patch: Partial<Marge>) => {
    setItems(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
    setDirty(prev => new Set(prev).add(id));
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog("Supprimer cette ligne ?"))) return;
    setItems(prev => prev.filter(m => m.id !== id));
    await supabase.from("rooftop_marges").delete().eq("id", id);
  };

  const add = async () => {
    setAdding(true);
    const { data, error } = await supabase.from("rooftop_marges")
      .insert({ hotel_id: hotelId, categorie: "Nouvelle catégorie", ordre: items.length })
      .select().single();
    setAdding(false);
    if (error) { toast.error(error.message ?? "Erreur"); return; }
    const m = data as Marge;
    setItems(prev => [...prev, { id: m.id, categorie: m.categorie ?? "", prix: "", marge_min: "", marge_max: "", ordre: m.ordre ?? 0 }]);
  };

  const saveAll = async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    let hasError = false;
    await Promise.all([...dirty].map(async id => {
      const m = items.find(x => x.id === id);
      if (!m) return;
      const { error } = await supabase.from("rooftop_marges").update({
        categorie: m.categorie.trim(),
        prix: m.prix.trim() || null,
        marge_min: m.marge_min.trim() || null,
        marge_max: m.marge_max.trim() || null,
      }).eq("id", id);
      if (error) { toast.error(error.message ?? "Erreur"); hasError = true; }
    }));
    setDirty(new Set());
    setSaving(false);
    if (!hasError) toast.success("Sauvegardé ✓");
  };

  if (loading) return <p className="py-4 text-center text-sm text-slate-400">Chargement…</p>;
  if (loadError) return (
    <p className="text-[13px] text-amber-700">
      Table <code className="font-mono">rooftop_marges</code> introuvable — lancez la migration 54.
    </p>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-slate-500">
          Prix TTC tout compris (assiette au choix incluse). Marge € par ticket : mini = assiette la plus chère · maxi = la moins chère.
        </p>
        <Button onClick={saveAll} disabled={saving || dirty.size === 0}
          size="sm" className="shrink-0 gap-2 bg-[#8a6d33] text-white hover:bg-[#6f571f]">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty.size > 0 ? `Enregistrer (${dirty.size})` : "Enregistrer"}
        </Button>
      </div>

      {/* En-têtes (desktop) */}
      <div className="hidden px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a6d33] sm:grid sm:grid-cols-[1fr_5rem_6rem_6rem_1.5rem] sm:gap-2">
        <span>Catégorie boisson</span><span className="text-center">Prix TTC</span>
        <span className="text-center">Marge mini</span><span className="text-center">Marge maxi</span><span />
      </div>

      {items.map(m => (
        <div key={m.id} className="grid grid-cols-2 gap-2 rounded-xl border border-[#C6A972]/30 bg-white p-3 sm:grid-cols-[1fr_5rem_6rem_6rem_1.5rem] sm:items-center sm:border-0 sm:bg-transparent sm:p-1">
          <Input value={m.categorie} onChange={e => update(m.id, { categorie: e.target.value })}
            className="col-span-2 h-9 text-[14px] font-medium sm:col-span-1" placeholder="Catégorie" />
          <Input value={m.prix} onChange={e => update(m.id, { prix: e.target.value })}
            className="h-9 text-center text-[15px] font-bold tabular-nums" placeholder="Prix" />
          <Input value={m.marge_min} onChange={e => update(m.id, { marge_min: e.target.value })}
            className="h-9 text-center text-[14px] tabular-nums" placeholder="Mini" />
          <Input value={m.marge_max} onChange={e => update(m.id, { marge_max: e.target.value })}
            className="h-9 text-center text-[14px] tabular-nums text-emerald-700" placeholder="Maxi" />
          <button onClick={() => remove(m.id)} className="justify-self-end text-slate-200 transition hover:text-red-400"><Trash2 size={15} /></button>
        </div>
      ))}

      <Button size="sm" variant="outline" onClick={add} disabled={adding} className="gap-1">
        <Plus size={14} /> Ajouter une catégorie
      </Button>
    </div>
  );
}

// ── Vue LECTURE (par défaut) — lisible pour le service, alimentée par la base ──
const ACCENTS = ["bg-amber-50 text-amber-700", "bg-rose-50 text-rose-700", "bg-emerald-50 text-emerald-700", "bg-sky-50 text-sky-700", "bg-violet-50 text-violet-700"];

function FichesRead({ hotelId, showMarges }: { hotelId: string; showMarges: boolean }) {
  const [fiches, setFiches] = useState<Fiche[]>([]);
  const [marges, setMarges] = useState<Marge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("rooftop_fiches").select("*").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("rooftop_marges").select("*").eq("hotel_id", hotelId).order("ordre"),
    ]).then(([f, m]) => {
      setLoading(false);
      if (f.error || m.error) { setLoadError(true); return; }
      setFiches(((f.data as unknown[]) || []).map(r => {
        const o = r as Record<string, unknown>;
        return {
          id: o.id as string, categorie: (o.categorie as Categorie) ?? "assiette",
          nom: (o.nom as string) ?? "", sous_titre: (o.sous_titre as string) ?? "",
          cout: coutToStr((o.cout as number | null) ?? null),
          ingredients: Array.isArray(o.ingredients) ? (o.ingredients as Ingredient[]) : [],
          montage: Array.isArray(o.montage) ? (o.montage as string[]) : [],
          actif: true, ordre: (o.ordre as number) ?? 0,
        } as Fiche;
      }));
      setMarges((m.data as Marge[]) || []);
    });
  }, [hotelId]);

  if (loading) return <p className="py-8 text-center text-sm text-slate-400">Chargement…</p>;
  if (loadError) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[14px] text-amber-800">
      Données introuvables — lancez la migration <code className="font-mono">db/migrations/54_rooftop_fiches.sql</code> dans Supabase.
    </div>
  );

  const assiettes = fiches.filter(f => f.categorie === "assiette");
  const desserts = fiches.filter(f => f.categorie === "dessert");

  return (
    <div className="space-y-6">
      {/* Assiettes */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {assiettes.map((f, i) => (
          <div key={f.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ACCENTS[i % ACCENTS.length]}`}>
                <Utensils size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[17px] font-bold leading-tight text-slate-800">{f.nom}</h3>
                {f.sous_titre && <p className="truncate text-[13px] text-slate-500">{f.sous_titre}</p>}
              </div>
              {showMarges && f.cout && (
                <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[13px] font-semibold tabular-nums text-slate-600">{f.cout} €</span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-4 px-5 py-4">
              {f.ingredients.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Composition</p>
                  <ul className="space-y-1.5">
                    {f.ingredients.map((ing, j) => (
                      <li key={j} className="flex items-baseline justify-between gap-3 text-[15px]">
                        <span className="text-slate-700">
                          {ing.label}
                          {ing.note && <span className="ml-1 text-[13px] italic text-slate-400">· {ing.note}</span>}
                        </span>
                        {ing.qty && <span className="shrink-0 font-semibold tabular-nums text-slate-900">{ing.qty}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {f.montage.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Montage</p>
                  <ol className="space-y-1.5">
                    {f.montage.map((step, j) => (
                      <li key={j} className="flex gap-2.5 text-[15px] leading-snug text-slate-600">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#004e7c]/10 text-[11px] font-bold text-[#004e7c]">{j + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desserts */}
      {desserts.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><IceCreamCone size={18} /></span>
            <h3 className="text-[16px] font-bold text-slate-800">Desserts</h3>
          </div>
          <ul className="divide-y divide-slate-50">
            {desserts.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-[15px] font-medium text-slate-800">{d.nom}</p>
                  {d.sous_titre && <p className="text-[13px] text-slate-400">{d.sous_titre}</p>}
                </div>
                {showMarges && d.cout && (
                  <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[13px] font-semibold tabular-nums text-slate-600">{d.cout} €</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Marges */}
      {showMarges && marges.length > 0 && (
        <div className="rounded-2xl border border-[#C6A972]/40 bg-[#faf7f0] p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C6A972]/15 text-[#8a6d33]"><Euro size={18} /></span>
            <h3 className="text-[16px] font-bold text-slate-800">Prix &amp; marges par catégorie</h3>
          </div>
          <p className="mb-4 text-[13px] text-slate-500">Prix TTC tout compris (assiette au choix incluse). Marge € par ticket : mini = assiette la plus chère · maxi = la moins chère.</p>
          <div className="hidden overflow-hidden rounded-xl border border-[#C6A972]/30 sm:block">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="bg-[#C6A972]/10 text-left text-[12px] font-semibold uppercase tracking-wider text-[#8a6d33]">
                  <th className="px-4 py-2.5">Catégorie</th><th className="px-4 py-2.5 text-right">Prix TTC</th>
                  <th className="px-4 py-2.5 text-right">Marge mini</th><th className="px-4 py-2.5 text-right">Marge maxi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C6A972]/15 bg-white/60">
                {marges.map(t => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 font-medium text-slate-700">{t.categorie}</td>
                    <td className="px-4 py-3 text-right text-[17px] font-bold tabular-nums text-slate-900">{t.prix}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-600">{t.marge_min}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">{t.marge_max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2.5 sm:hidden">
            {marges.map(t => (
              <div key={t.id} className="rounded-xl border border-[#C6A972]/30 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">{t.categorie}</span>
                  <span className="text-[18px] font-bold tabular-nums text-slate-900">{t.prix}</span>
                </div>
                <p className="mt-2 text-[13px] text-slate-500">Marge <b className="tabular-nums text-slate-700">{t.marge_min}</b> → <b className="tabular-nums text-emerald-700">{t.marge_max}</b></p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Onglet Fiches ────────────────────────────────────────────────────────────
export function FichesTab({ hotelId }: { hotelId: string }) {
  const [editMode, setEditMode] = useState(false);
  const [showMarges, setShowMarges] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-start gap-2.5">
          <Utensils size={18} className="mt-0.5 shrink-0 text-[#004e7c]" />
          <div>
            <p className="text-[15px] font-semibold text-slate-800">Fiches techniques · concept eat &amp; drink</p>
            <p className="text-[13px] text-slate-500">Composition &amp; montage pour le service. 1 boisson + 1 assiette au choix.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowMarges(v => !v)}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-[14px] font-semibold transition active:scale-[0.97] ${
              showMarges ? "border-[#C6A972] bg-[#C6A972]/10 text-[#8a6d33]" : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}>
            {showMarges ? <EyeOff size={16} /> : <Eye size={16} />}
            <span className="hidden sm:inline">{showMarges ? "Masquer les marges" : "Afficher les marges"}</span>
          </button>
          <button type="button" onClick={() => setEditMode(v => !v)}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-[14px] font-semibold transition active:scale-[0.97] ${
              editMode ? "border-[#004e7c] bg-[#004e7c] text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}>
            {editMode ? <Check size={16} /> : <Pencil size={16} />}
            {editMode ? "Terminer" : "Mode édition"}
          </button>
        </div>
      </div>

      {editMode ? (
        <>
          <FichesEditor hotelId={hotelId} showCosts={showMarges} />
          {showMarges && (
            <div className="rounded-2xl border border-[#C6A972]/40 bg-[#faf7f0] p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C6A972]/15 text-[#8a6d33]"><Euro size={18} /></span>
                <h3 className="text-[16px] font-bold text-slate-800">Prix &amp; marges par catégorie</h3>
              </div>
              <MargesEditor hotelId={hotelId} />
            </div>
          )}
        </>
      ) : (
        <FichesRead hotelId={hotelId} showMarges={showMarges} />
      )}
    </div>
  );
}
