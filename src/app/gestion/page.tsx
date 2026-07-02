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
import { LineChart, RefreshCw, TrendingUp, TrendingDown, Loader2, ChevronDown, Trash2, Search } from "lucide-react";
import toast from "react-hot-toast";
import { POSTES } from "@/lib/gestion";

const eur = (n: number) => (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = (n: number) => (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const fdate = (s?: string) => { try { return s ? new Date(`${s}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""; } catch { return s || ""; } };

function monthOptions(): string[] {
  const out: string[] = []; const d = new Date();
  for (let i = 0; i < 12; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() - 1); }
  return out;
}
const fmtMonth = (m: string) => { try { return new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); } catch { return m; } };

type Ligne = { id: string; achat_id: string; produit: string; produit_ref: string | null; quantite: number; unite: string | null; prix_unitaire: number; montant_ht: number; hors_poste: boolean; poste: string | null; gestion_achats?: { fournisseur?: string; date_facture?: string; poste?: string } };
type Achat = { id: string; fournisseur: string; poste: string; date_facture: string; mois_rattachement: string; total_ht: number; is_avoir: boolean; invoice_number: string | null };
type Revenu = { mois: string; poste: string; ca_ht: number; quantite: number | null };
type PrixRow = { produit_ref: string; prix_unitaire: number; unite: string | null; gestion_achats?: { date_facture?: string; fournisseur?: string } };

export default function GestionPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const months = useMemo(monthOptions, []);
  const [mois, setMois] = useState(months[0]);
  const [extractPoste, setExtractPoste] = useState("");
  const [loading, setLoading] = useState(false);
  const [achats, setAchats] = useState<Achat[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [revenus, setRevenus] = useState<Revenu[]>([]);
  const [prix, setPrix] = useState<PrixRow[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [caDraft, setCaDraft] = useState<Record<string, { ca: string; qte: string }>>({});
  const [openFacture, setOpenFacture] = useState<string | null>(null);

  // Explorateur prix annuel
  const [prixRefs, setPrixRefs] = useState<string[]>([]);
  const [prixSel, setPrixSel] = useState("");
  const [prixHist, setPrixHist] = useState<{ date: string; prix: number; unite: string; fournisseur: string }[]>([]);

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
    for (const p of POSTES) { const rv = (j.revenus as Revenu[]).find((x) => x.poste === p.id); draft[p.id] = { ca: rv?.ca_ht ? String(rv.ca_ht) : "", qte: rv?.quantite != null ? String(rv.quantite) : "" }; }
    setCaDraft(draft);
  }, [mois, token]);

  useEffect(() => { if (isAdmin) loadData(); }, [isAdmin, loadData]);

  // Liste des produits pour l'explorateur (une fois).
  useEffect(() => {
    if (!isAdmin) return;
    (async () => { const t = await token(); const r = await fetch(`/api/gestion/prix`, { headers: { Authorization: `Bearer ${t}` } }); const j = await r.json(); if (r.ok) setPrixRefs(j.refs || []); })();
  }, [isAdmin, token, achats.length]);

  const loadPrixHist = async (ref: string) => {
    setPrixSel(ref); setPrixHist([]);
    if (!ref) return;
    const t = await token();
    const r = await fetch(`/api/gestion/prix?ref=${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${t}` } });
    const j = await r.json(); if (r.ok) setPrixHist(j.history || []);
  };

  const extractWindow = () => {
    const [y, m] = mois.split("-").map(Number);
    const since = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;
    const last = new Date(y, m, 0);
    return { since, until: `${y}-${String(m).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}` };
  };

  const runExtract = async () => {
    setExtracting(true); setProgress(null);
    const t = await token(); const { since, until } = extractWindow();
    try {
      for (let guard = 0; guard < 200; guard++) {
        const r = await fetch("/api/gestion/extract", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ since, until, poste: extractPoste || undefined }) });
        const j = await r.json();
        if (!r.ok) { toast.error(j.error || "Erreur extraction"); break; }
        setProgress({ done: j.matched - j.remaining, total: j.matched });
        if (j.remaining === 0) { toast.success("Extraction à jour ✓"); break; }
      }
    } finally { setExtracting(false); loadData(); }
  };

  const post = async (payload: Record<string, unknown>, okMsg?: string) => {
    const t = await token();
    const r = await fetch("/api/gestion/update", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
    if (r.ok) { if (okMsg) toast.success(okMsg); loadData(); } else { const j = await r.json().catch(() => ({})); toast.error(j.error || "Erreur"); }
    return r.ok;
  };
  const saveRevenu = (poste: string) => post({ action: "revenu", mois, poste, ca_ht: parseFloat(caDraft[poste]?.ca) || 0, quantite: caDraft[poste]?.qte }, "CA enregistré ✓");
  const setRattachement = (achat_id: string, m: string) => post({ action: "mois", achat_id, mois_rattachement: m }, "Rattachement changé ✓");
  const deleteLigne = async (id: string) => { if (await post({ action: "ligne_delete", id })) toast.success("Ligne supprimée"); };
  const patchLigne = (id: string, patch: Record<string, unknown>) => post({ action: "ligne_patch", id, ...patch });

  // ── Agrégats ──
  const achatsByPoste = useMemo(() => { const m: Record<string, number> = {}; for (const a of achats) m[a.poste] = (m[a.poste] || 0) + Number(a.total_ht); return m; }, [achats]);
  const revenuByPoste = useMemo(() => { const m: Record<string, Revenu> = {}; for (const r of revenus) m[r.poste] = r; return m; }, [revenus]);
  const lignesByAchat = useMemo(() => { const m: Record<string, Ligne[]> = {}; for (const l of lignes) (m[l.achat_id] ??= []).push(l); return m; }, [lignes]);
  const achatsByPosteList = useMemo(() => { const m: Record<string, Achat[]> = {}; for (const a of achats) (m[a.poste] ??= []).push(a); return m; }, [achats]);

  const consoByPoste = useMemo(() => {
    const m: Record<string, Record<string, { qte: number; montant: number; unite: string }>> = {};
    for (const l of lignes) { if (l.hors_poste) continue; const poste = l.poste || l.gestion_achats?.poste || "autre"; const ref = l.produit_ref || l.produit; (m[poste] ??= {}); (m[poste][ref] ??= { qte: 0, montant: 0, unite: l.unite || "" }); m[poste][ref].qte += Number(l.quantite); m[poste][ref].montant += Number(l.montant_ht); }
    return m;
  }, [lignes]);

  const prixEvol = useMemo(() => {
    const byRef: Record<string, { date: string; prix: number; fourn: string }[]> = {};
    for (const p of prix) { if (!p.produit_ref || !p.prix_unitaire) continue; (byRef[p.produit_ref] ??= []).push({ date: p.gestion_achats?.date_facture || "", prix: Number(p.prix_unitaire), fourn: p.gestion_achats?.fournisseur || "" }); }
    const out: { ref: string; last: number; lastDate: string; prev: number | null; prevDate: string | null; delta: number | null; unite: string; fourn: string }[] = [];
    const refsThisMonth = new Set(lignes.filter((l) => !l.hors_poste).map((l) => l.produit_ref || l.produit));
    for (const [ref, arr] of Object.entries(byRef)) {
      if (!refsThisMonth.has(ref)) continue;
      arr.sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = arr[arr.length - 1];
      const prev = [...arr].reverse().find((x) => x.date !== last.date && x.prix !== last.prix) || null;
      const delta = prev ? (last.prix - prev.prix) / prev.prix * 100 : null;
      const unite = lignes.find((l) => (l.produit_ref || l.produit) === ref)?.unite || "";
      out.push({ ref, last: last.prix, lastDate: last.date, prev: prev?.prix ?? null, prevDate: prev?.date ?? null, delta, unite, fourn: last.fourn });
    }
    return out.sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999));
  }, [prix, lignes]);

  if (isLoading || !user) return null;
  if (!isAdmin) return <div className="min-h-screen"><ThemedBackground /><div className="max-w-2xl mx-auto px-4 py-20 text-center text-slate-500">Cockpit gestion réservé aux administrateurs.</div></div>;

  return (
    <div className="min-h-screen">
      <ThemedBackground />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <PageHeader icon={LineChart} title="Gestion" subtitle="La Corniche · Achats HT, conso & prix (Pennylane)" iconClassName="bg-emerald-50 text-emerald-700" />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <select value={mois} onChange={(e) => setMois(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium capitalize">
            {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <select value={extractPoste} onChange={(e) => setExtractPoste(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
              <option value="">Tous les pôles</option>
              {POSTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <Button onClick={runExtract} disabled={extracting} className="h-10 bg-[#004e7c] hover:bg-[#003d61] text-white gap-2">
              {extracting ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {extracting ? (progress ? `Extraction ${progress.done}/${progress.total}…` : "Extraction…") : "Extraire"}
            </Button>
          </div>
        </div>

        {loading ? <p className="text-center text-slate-400 py-10">Chargement…</p> : (
          <div className="space-y-8">
            {/* Ratios + saisie CA */}
            <div className="grid sm:grid-cols-3 gap-4">
              {POSTES.map((p) => {
                const achat = achatsByPoste[p.id] || 0; const rv = revenuByPoste[p.id]; const ca = rv ? Number(rv.ca_ht) : 0; const ratio = ca > 0 ? (achat / ca) * 100 : null;
                return (
                  <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{p.label}</p>
                    <div className="mt-2 flex items-end justify-between">
                      <div><p className="text-2xl font-bold text-slate-800 tabular-nums">{ratio != null ? `${ratio.toFixed(0)}%` : "—"}</p><p className="text-[11px] text-slate-400">achats ÷ CA (HT)</p></div>
                      <div className="text-right text-[12px] text-slate-500 leading-tight"><p>Achats <span className="font-semibold text-slate-700">{eur(achat)}</span></p><p>CA <span className="font-semibold text-slate-700">{ca ? eur(ca) : "—"}</span></p></div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Input value={caDraft[p.id]?.ca ?? ""} onChange={(e) => setCaDraft((d) => ({ ...d, [p.id]: { ...d[p.id], ca: e.target.value } }))} placeholder="CA HT du mois" className="h-8 text-sm" />
                      <Input value={caDraft[p.id]?.qte ?? ""} onChange={(e) => setCaDraft((d) => ({ ...d, [p.id]: { ...d[p.id], qte: e.target.value } }))} placeholder="Qté" className="h-8 w-16 text-sm text-center" />
                      <Button size="sm" onClick={() => saveRevenu(p.id)} className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-white text-xs">OK</Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {achats.length === 0 && <p className="text-center text-slate-400 py-6">Aucune facture pour {fmtMonth(mois)}. Lance l&apos;extraction 👆</p>}

            {/* Explorateur prix annuel */}
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Search size={15} /> Suivi de prix — un produit sur l&apos;année</h3>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <select value={prixSel} onChange={(e) => loadPrixHist(e.target.value)} className="h-9 w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 text-sm">
                  <option value="">Choisir un produit…</option>
                  {prixRefs.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {prixSel && (prixHist.length === 0 ? <p className="mt-3 text-sm text-slate-400">Aucun historique.</p> : (
                  <div className="mt-3">
                    <PriceSpark points={prixHist} />
                    <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 text-[13px]">
                      {prixHist.map((h, i) => { const prev = prixHist[i - 1]; const d = prev ? (h.prix - prev.prix) / prev.prix * 100 : null; return (
                        <li key={i} className="flex items-center gap-2 py-0.5">
                          <span className="text-slate-400 tabular-nums w-16">{fdate(h.date)}</span>
                          <span className="font-medium tabular-nums">{eur2(h.prix)}{h.unite && <span className="text-slate-400">/{h.unite}</span>}</span>
                          {d != null && <span className={`text-[11px] font-semibold ${d > 0 ? "text-rose-600" : d < 0 ? "text-emerald-600" : "text-slate-400"}`}>{d > 0 ? "+" : ""}{d.toFixed(1)}%</span>}
                          <span className="ml-auto text-[11px] text-slate-400 truncate">{h.fournisseur}</span>
                        </li> ); })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* Évolution de prix (mois courant) — avec dates */}
            {prixEvol.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">📈 Hausses & baisses (produits du mois)</h3>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="text-left px-4 py-2 font-semibold">Produit</th><th className="text-right px-4 py-2 font-semibold">Prix actuel</th><th className="text-right px-4 py-2 font-semibold">Précédent</th><th className="text-right px-4 py-2 font-semibold">Évolution</th><th className="text-left px-4 py-2 font-semibold">Fournisseur</th></tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {prixEvol.map((r) => (
                        <tr key={r.ref} className={r.delta != null && r.delta > 3 ? "bg-rose-50/40" : ""}>
                          <td className="px-4 py-2 text-slate-700">{r.ref} {r.unite && <span className="text-slate-400 text-[11px]">/{r.unite}</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{eur2(r.last)}<div className="text-[10px] text-slate-400 font-normal">{fdate(r.lastDate)}</div></td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-400">{r.prev != null ? <>{eur2(r.prev)}<div className="text-[10px]">{fdate(r.prevDate || "")}</div></> : "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.delta == null ? <span className="text-slate-300">—</span> : <span className={`inline-flex items-center gap-1 font-semibold ${r.delta > 0 ? "text-rose-600" : r.delta < 0 ? "text-emerald-600" : "text-slate-400"}`}>{r.delta > 0 ? <TrendingUp size={13} /> : r.delta < 0 ? <TrendingDown size={13} /> : null}{r.delta > 0 ? "+" : ""}{r.delta.toFixed(1)}%</span>}</td>
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
                  <table className="w-full text-sm"><thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="text-left px-4 py-2 font-semibold">Produit</th><th className="text-right px-4 py-2 font-semibold">Quantité</th><th className="text-right px-4 py-2 font-semibold">Montant HT</th></tr></thead>
                    <tbody className="divide-y divide-slate-50">{Object.entries(consoByPoste[p.id]).sort((a, b) => b[1].montant - a[1].montant).map(([ref, v]) => (<tr key={ref}><td className="px-4 py-2 text-slate-700">{ref}</td><td className="px-4 py-2 text-right tabular-nums text-slate-500">{v.qte.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} {v.unite}</td><td className="px-4 py-2 text-right tabular-nums font-medium">{eur2(v.montant)}</td></tr>))}</tbody>
                  </table>
                </div>
              </section>
            ))}

            {/* Factures groupées par pôle, repliables, avec édition de lignes */}
            {achats.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">🧾 Factures rattachées à {fmtMonth(mois)}</h3>
                <div className="space-y-4">
                  {POSTES.filter((p) => achatsByPosteList[p.id]?.length).map((p) => {
                    const list = achatsByPosteList[p.id].slice().sort((a, b) => (a.date_facture < b.date_facture ? -1 : 1));
                    const sub = list.reduce((s, a) => s + Number(a.total_ht), 0);
                    return (
                      <div key={p.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100">
                          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{p.label} · {list.length} factures</span>
                          <span className="text-sm font-semibold tabular-nums text-slate-700">{eur2(sub)}</span>
                        </div>
                        <div className="divide-y divide-slate-50">
                          {list.map((a) => {
                            const open = openFacture === a.id; const ls = lignesByAchat[a.id] || [];
                            return (
                              <div key={a.id}>
                                <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                                  <button onClick={() => setOpenFacture(open ? null : a.id)} className="flex items-center gap-1 text-slate-400 hover:text-slate-600"><ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} /></button>
                                  <span className="font-medium text-slate-700">{a.fournisseur}</span>
                                  {a.is_avoir && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">avoir</span>}
                                  <span className="text-[12px] text-slate-400">{fdate(a.date_facture)}</span>
                                  <span className="text-[11px] text-slate-300">· {ls.length} lignes</span>
                                  <span className="ml-auto tabular-nums font-medium">{eur2(Number(a.total_ht))}</span>
                                  <select value={a.mois_rattachement} onChange={(e) => setRattachement(a.id, e.target.value)} title="Mois de rattachement" className="h-7 rounded-md border border-slate-200 bg-white text-[11px] px-1">
                                    {months.map((m) => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                                {open && (
                                  <div className="px-4 pb-3 bg-slate-50/50">
                                    {ls.length === 0 ? <p className="text-[12px] text-slate-400 py-2">Aucune ligne extraite. Re-extrais après avoir supprimé la facture, si besoin.</p> : (
                                      <ul className="divide-y divide-slate-100">
                                        {ls.map((l) => (
                                          <li key={l.id} className={`flex flex-wrap items-center gap-2 py-1.5 text-[13px] ${l.hors_poste ? "opacity-50" : ""}`}>
                                            <span className="flex-1 min-w-[160px] text-slate-700">{l.produit}</span>
                                            <span className="text-slate-400 tabular-nums">{Number(l.quantite).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} {l.unite}</span>
                                            <span className="text-slate-400 tabular-nums">{eur2(Number(l.prix_unitaire))}</span>
                                            <span className="w-16 text-right font-medium tabular-nums">{eur2(Number(l.montant_ht))}</span>
                                            <select value={l.hors_poste ? "hors" : (l.poste || a.poste)} onChange={(e) => e.target.value === "hors" ? patchLigne(l.id, { hors_poste: true }) : patchLigne(l.id, { hors_poste: false, poste: e.target.value })} className="h-6 rounded border border-slate-200 bg-white text-[11px] px-1">
                                              {POSTES.map((pp) => <option key={pp.id} value={pp.id}>{pp.label}</option>)}
                                              <option value="hors">Hors-poste</option>
                                            </select>
                                            <button onClick={() => deleteLigne(l.id)} className="text-slate-300 hover:text-red-500" title="Supprimer la ligne"><Trash2 size={13} /></button>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Mini sparkline SVG de l'évolution de prix.
function PriceSpark({ points }: { points: { date: string; prix: number }[] }) {
  if (points.length < 2) return null;
  const w = 480, h = 60, pad = 6;
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (w - 2 * pad));
  const min = Math.min(...points.map((p) => p.prix)), max = Math.max(...points.map((p) => p.prix));
  const y = (v: number) => max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y(p.prix).toFixed(1)}`).join(" ");
  const up = points[points.length - 1].prix >= points[0].prix;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-lg h-16">
      <path d={d} fill="none" stroke={up ? "#e11d48" : "#059669"} strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={xs[i]} cy={y(p.prix)} r="2.5" fill={up ? "#e11d48" : "#059669"} />)}
    </svg>
  );
}
