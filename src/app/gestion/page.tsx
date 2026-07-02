"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { ThemedBackground } from "@/components/ThemedBackground";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LineChart, RefreshCw, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { POSTES, posteLabel } from "@/lib/gestion";

const eur = (n: number) => (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = (n: number) => (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function monthOptions(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() - 1); }
  return out;
}
const fmtMonth = (m: string) => { try { return new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); } catch { return m; } };

type Ligne = { produit: string; produit_ref: string | null; quantite: number; unite: string | null; prix_unitaire: number; montant_ht: number; hors_poste: boolean; poste: string | null; gestion_achats?: { fournisseur?: string; date_facture?: string; poste?: string } };
type Achat = { id: string; fournisseur: string; poste: string; date_facture: string; mois_rattachement: string; total_ht: number; is_avoir: boolean; invoice_number: string | null };
type Revenu = { mois: string; poste: string; ca_ht: number; quantite: number | null };
type PrixRow = { produit_ref: string; prix_unitaire: number; unite: string | null; gestion_achats?: { date_facture?: string; fournisseur?: string } };

export default function GestionPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const months = useMemo(monthOptions, []);
  const [mois, setMois] = useState(months[0]);
  const [loading, setLoading] = useState(false);
  const [achats, setAchats] = useState<Achat[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [revenus, setRevenus] = useState<Revenu[]>([]);
  const [prix, setPrix] = useState<PrixRow[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [caDraft, setCaDraft] = useState<Record<string, { ca: string; qte: string }>>({});

  useEffect(() => { if (!isLoading && !user) router.push("/login"); }, [isLoading, user, router]);

  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token || "", []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const t = await token();
    const r = await fetch(`/api/gestion/data?mois=${mois}`, { headers: { Authorization: `Bearer ${t}` } });
    const j = await r.json();
    setLoading(false);
    if (!r.ok) { toast.error(j.error || "Erreur"); return; }
    setAchats(j.achats); setLignes(j.lignes); setRevenus(j.revenus); setPrix(j.prix);
    const draft: Record<string, { ca: string; qte: string }> = {};
    for (const p of POSTES) {
      const rv = (j.revenus as Revenu[]).find((x) => x.poste === p.id);
      draft[p.id] = { ca: rv?.ca_ht ? String(rv.ca_ht) : "", qte: rv?.quantite != null ? String(rv.quantite) : "" };
    }
    setCaDraft(draft);
  }, [mois, token]);

  useEffect(() => { if (isAdmin) loadData(); }, [isAdmin, loadData]);

  // Fenêtre d'extraction : du 1er du mois précédent à la fin du mois sélectionné
  // (capte les factures de fin de mois qui se rattachent au mois suivant).
  const extractWindow = () => {
    const [y, m] = mois.split("-").map(Number);
    const since = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;
    const until = new Date(y, m, 0); // dernier jour du mois
    return { since, until: `${y}-${String(m).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}` };
  };

  const runExtract = async () => {
    setExtracting(true); setProgress(null);
    const t = await token();
    const { since, until } = extractWindow();
    try {
      for (let guard = 0; guard < 200; guard++) {
        const r = await fetch("/api/gestion/extract", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
          body: JSON.stringify({ since, until }),
        });
        const j = await r.json();
        if (!r.ok) { toast.error(j.error || "Erreur extraction"); break; }
        setProgress({ done: j.matched - j.remaining, total: j.matched });
        if (j.remaining === 0) { toast.success("Extraction à jour ✓"); break; }
      }
    } finally {
      setExtracting(false);
      loadData();
    }
  };

  const saveRevenu = async (poste: string) => {
    const d = caDraft[poste]; const t = await token();
    const r = await fetch("/api/gestion/update", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: "revenu", mois, poste, ca_ht: parseFloat(d.ca) || 0, quantite: d.qte }),
    });
    if (r.ok) { toast.success("CA enregistré ✓"); loadData(); } else toast.error("Erreur");
  };

  const setRattachement = async (achat_id: string, m: string) => {
    const t = await token();
    const r = await fetch("/api/gestion/update", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: "mois", achat_id, mois_rattachement: m }),
    });
    if (r.ok) { toast.success("Rattachement changé ✓"); loadData(); } else toast.error("Erreur");
  };

  // ── Agrégats ────────────────────────────────────────────────────────────────
  const achatsByPoste = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of achats) m[a.poste] = (m[a.poste] || 0) + Number(a.total_ht);
    return m;
  }, [achats]);
  const revenuByPoste = useMemo(() => {
    const m: Record<string, Revenu> = {};
    for (const r of revenus) m[r.poste] = r;
    return m;
  }, [revenus]);

  // Conso par poste → produit (hors lignes hors_poste)
  const consoByPoste = useMemo(() => {
    const m: Record<string, Record<string, { qte: number; montant: number; unite: string }>> = {};
    for (const l of lignes) {
      if (l.hors_poste) continue;
      const poste = l.poste || l.gestion_achats?.poste || "autre";
      const ref = l.produit_ref || l.produit;
      (m[poste] ??= {});
      (m[poste][ref] ??= { qte: 0, montant: 0, unite: l.unite || "" });
      m[poste][ref].qte += Number(l.quantite);
      m[poste][ref].montant += Number(l.montant_ht);
    }
    return m;
  }, [lignes]);

  // Suivi de prix : par produit_ref, dernier prix vs précédent (dates distinctes)
  const prixEvol = useMemo(() => {
    const byRef: Record<string, { date: string; prix: number; fourn: string }[]> = {};
    for (const p of prix) {
      if (!p.produit_ref || !p.prix_unitaire) continue;
      (byRef[p.produit_ref] ??= []).push({ date: p.gestion_achats?.date_facture || "", prix: Number(p.prix_unitaire), fourn: p.gestion_achats?.fournisseur || "" });
    }
    const out: { ref: string; last: number; prev: number | null; delta: number | null; unite: string; fourn: string; points: number }[] = [];
    const refsThisMonth = new Set(lignes.filter((l) => !l.hors_poste).map((l) => l.produit_ref || l.produit));
    for (const [ref, arr] of Object.entries(byRef)) {
      if (!refsThisMonth.has(ref)) continue;
      arr.sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = arr[arr.length - 1];
      // prix précédent à une DATE différente
      const prev = [...arr].reverse().find((x) => x.date !== last.date && x.prix !== last.prix) || null;
      const delta = prev ? (last.prix - prev.prix) / prev.prix * 100 : null;
      const unite = (lignes.find((l) => (l.produit_ref || l.produit) === ref)?.unite) || "";
      out.push({ ref, last: last.prix, prev: prev?.prix ?? null, delta, unite, fourn: last.fourn, points: arr.length });
    }
    return out.sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999));
  }, [prix, lignes]);

  if (isLoading || !user) return null;
  if (!isAdmin) {
    return (
      <div className="min-h-screen"><ThemedBackground />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center text-slate-500">Cockpit gestion réservé aux administrateurs.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <ThemedBackground />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <PageHeader icon={LineChart} title="Gestion" subtitle="La Corniche · Achats, conso & prix (Pennylane)" iconClassName="bg-emerald-50 text-emerald-700" />

        {/* Barre : mois + extraction */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <select value={mois} onChange={(e) => setMois(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium capitalize">
            {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
          </select>
          <Button onClick={runExtract} disabled={extracting} className="h-10 bg-[#004e7c] hover:bg-[#003d61] text-white gap-2">
            {extracting ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {extracting ? (progress ? `Extraction ${progress.done}/${progress.total}…` : "Extraction…") : "Extraire les factures"}
          </Button>
        </div>

        {loading ? (
          <p className="text-center text-slate-400 py-10">Chargement…</p>
        ) : (
          <div className="space-y-8">
            {/* Ratios par poste */}
            <div className="grid sm:grid-cols-3 gap-4">
              {POSTES.map((p) => {
                const achat = achatsByPoste[p.id] || 0;
                const rv = revenuByPoste[p.id];
                const ca = rv ? Number(rv.ca_ht) : 0;
                const ratio = ca > 0 ? (achat / ca) * 100 : null;
                return (
                  <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{p.label}</p>
                    <div className="mt-2 flex items-end justify-between">
                      <div>
                        <p className="text-2xl font-bold text-slate-800 tabular-nums">{ratio != null ? `${ratio.toFixed(0)}%` : "—"}</p>
                        <p className="text-[11px] text-slate-400">achats ÷ CA</p>
                      </div>
                      <div className="text-right text-[12px] text-slate-500 leading-tight">
                        <p>Achats <span className="font-semibold text-slate-700">{eur(achat)}</span></p>
                        <p>CA <span className="font-semibold text-slate-700">{ca ? eur(ca) : "—"}</span></p>
                      </div>
                    </div>
                    {/* Saisie CA */}
                    <div className="mt-3 flex items-center gap-2">
                      <Input value={caDraft[p.id]?.ca ?? ""} onChange={(e) => setCaDraft((d) => ({ ...d, [p.id]: { ...d[p.id], ca: e.target.value } }))}
                        placeholder="CA HT du mois" className="h-8 text-sm" />
                      <Input value={caDraft[p.id]?.qte ?? ""} onChange={(e) => setCaDraft((d) => ({ ...d, [p.id]: { ...d[p.id], qte: e.target.value } }))}
                        placeholder="Qté" className="h-8 w-16 text-sm text-center" />
                      <Button size="sm" onClick={() => saveRevenu(p.id)} className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-white text-xs">OK</Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {achats.length === 0 && (
              <p className="text-center text-slate-400 py-6">Aucune facture pour {fmtMonth(mois)}. Lance l&apos;extraction 👆</p>
            )}

            {/* Suivi de prix */}
            {prixEvol.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">📈 Suivi de prix — pas se faire arnaquer</h3>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
                      <th className="text-left px-4 py-2 font-semibold">Produit</th>
                      <th className="text-right px-4 py-2 font-semibold">Prix actuel</th>
                      <th className="text-right px-4 py-2 font-semibold">Précédent</th>
                      <th className="text-right px-4 py-2 font-semibold">Évolution</th>
                      <th className="text-left px-4 py-2 font-semibold">Fournisseur</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {prixEvol.map((r) => (
                        <tr key={r.ref} className={r.delta != null && r.delta > 3 ? "bg-rose-50/40" : ""}>
                          <td className="px-4 py-2 text-slate-700">{r.ref} {r.unite && <span className="text-slate-400 text-[11px]">/{r.unite}</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{eur2(r.last)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-400">{r.prev != null ? eur2(r.prev) : "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.delta == null ? <span className="text-slate-300">—</span> : (
                              <span className={`inline-flex items-center gap-1 font-semibold ${r.delta > 0 ? "text-rose-600" : r.delta < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                                {r.delta > 0 ? <TrendingUp size={13} /> : r.delta < 0 ? <TrendingDown size={13} /> : null}
                                {r.delta > 0 ? "+" : ""}{r.delta.toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-slate-500 text-[12px]">{r.fourn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Conso par poste */}
            {POSTES.filter((p) => consoByPoste[p.id]).map((p) => (
              <section key={p.id}>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">🧺 Conso {p.label} — {eur(achatsByPoste[p.id] || 0)}</h3>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
                      <th className="text-left px-4 py-2 font-semibold">Produit</th>
                      <th className="text-right px-4 py-2 font-semibold">Quantité</th>
                      <th className="text-right px-4 py-2 font-semibold">Montant HT</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {Object.entries(consoByPoste[p.id]).sort((a, b) => b[1].montant - a[1].montant).map(([ref, v]) => (
                        <tr key={ref}>
                          <td className="px-4 py-2 text-slate-700">{ref}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-500">{v.qte.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} {v.unite}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{eur2(v.montant)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            {/* Factures + rattachement */}
            {achats.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">🧾 Factures rattachées à {fmtMonth(mois)}</h3>
                <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
                  {achats.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="font-medium text-slate-700">{a.fournisseur}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{posteLabel(a.poste)}</span>
                      {a.is_avoir && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">avoir</span>}
                      <span className="text-[12px] text-slate-400">{a.date_facture}</span>
                      <span className="ml-auto tabular-nums font-medium">{eur2(Number(a.total_ht))}</span>
                      <label className="text-[11px] text-slate-400">rattaché à</label>
                      <select value={a.mois_rattachement} onChange={(e) => setRattachement(a.id, e.target.value)}
                        className="h-8 rounded-md border border-slate-200 bg-white text-[12px] px-1.5">
                        {months.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
