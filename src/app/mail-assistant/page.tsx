"use client";

// Gestionnaire de mails réception — VUE JOURNAL + VALIDATION (superadmin, Phase 2).
// Montre ce que l'assistant CLASSE sur la boîte de l'hôtel COURANT, et permet de
// VALIDER / IGNORER chaque action (human-in-the-loop). Le mode par catégorie
// (off | suggest | auto) se règle en haut. L'hôtel suit le switch GLOBAL du burger.
// Dispo pour Voiles + Corniche. ⚠️ Mews (déjà venu/tarif) = Voiles uniquement.

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { useSelectedHotel } from "@/context/SelectedHotelContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { hotelConfig } from "@/lib/mailAssistant";
import { Mail, Loader2, RefreshCw, Inbox, Check, X, ExternalLink, Copy } from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import toast from "react-hot-toast";

type Row = {
  id: string;
  created_at: string;
  mailbox: string;
  from_addr: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  category: string;
  proposed_action: string;
  reason: string | null;
  detail: Record<string, unknown>;
  status: string;
  dry_run: boolean;
  result: Record<string, unknown> | null;
  action_error: string | null;
  decided_at: string | null;
};

type Mode = "off" | "suggest" | "auto";

const CAT_META: Record<string, { label: string; badge: string }> = {
  spam_alert:  { label: "Alerte / spam",  badge: "bg-rose-50 text-rose-700 ring-rose-200" },
  resa_ota:    { label: "Réservation",    badge: "bg-sky-50 text-sky-700 ring-sky-200" },
  prise_en_charge: { label: "Prise en charge", badge: "bg-teal-50 text-teal-700 ring-teal-200" },
  facture:     { label: "Facture",        badge: "bg-violet-50 text-violet-700 ring-violet-200" },
  facture_ota: { label: "Facture OTA",    badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  candidature: { label: "Candidature",    badge: "bg-amber-50 text-amber-700 ring-amber-200" },
  commercial:  { label: "Commercial",     badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  client_msg:  { label: "Message client", badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  autre:       { label: "Autre",          badge: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const ACTION_LABEL: Record<string, string> = {
  delete: "🗑️ Supprimer",
  resa_control: "📋 Contrôle résa",
  agency_note: "📌 Prise en charge",
  route_pennylane: "🧾 → Pennylane",
  invoice_note: "📄 Facture à envoyer",
  draft_reply: "✍️ Brouillon réponse",
  commercial_followup: "📇 Suivi commercial",
  none: "— laisser à l’humain",
};

const MODE_LABEL: Record<Mode, string> = { off: "Off", suggest: "Valider", auto: "Auto" };

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// Résumé lisible du résultat d'exécution.
function resultSummary(r: Row): string | null {
  const res = r.result || {};
  if (r.status === "skipped") return "Ignoré";
  if (r.status === "executed") {
    if (res.note) return "📋 Note prête";
    if (res.movedTo === "deleteditems") return "🗑️ Mis en corbeille";
    if (res.kind === "commercial") return res.mode === "created" ? "📇 Fiche créée" : "📇 Fiche complétée";
    if (res.kind === "pennylane") return `🧾 → Pennylane (${String(res.entity)})`;
    if (res.draftId) return "✍️ Brouillon créé";
    return "Fait";
  }
  return null;
}

export default function MailAssistantPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { selectedHotelId } = useSelectedHotel();
  const isSuperadmin = user?.role === "superadmin";

  const cfg = hotelConfig(selectedHotelId);

  const [rows, setRows] = useState<Row[]>([]);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperadmin) { router.push("/"); return; }
  }, [authLoading, user, isSuperadmin, router]);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    const [jr, cr] = await Promise.all([
      fetch(`/api/mail-assistant/journal?hotel=${key}`, { headers }),
      fetch(`/api/mail-assistant/config?hotel=${key}`, { headers }),
    ]);
    const jj = await jr.json();
    const cj = await cr.json();
    if (jr.ok && jj.ok) setRows(jj.rows as Row[]); else toast.error(jj.error || "Erreur chargement");
    if (cr.ok && cj.ok) setModes(cj.modes as Record<string, Mode>);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperadmin) return;
    if (cfg) load(cfg.key); else { setRows([]); setLoading(false); }
  }, [isSuperadmin, cfg, load]);

  const runNow = async () => {
    if (!cfg) return;
    setRunning(true);
    const headers = await authHeaders();
    if (!headers) { setRunning(false); return; }
    const resp = await fetch(`/api/mail-assistant/journal?hotel=${cfg.key}`, { method: "POST", headers });
    const j = await resp.json();
    if (resp.ok && j.ok) {
      toast.success(`Tri effectué (${j.logged} nouveau·x)`);
      await load(cfg.key);
    } else toast.error(j.error || "Échec du tri");
    setRunning(false);
  };

  const changeMode = async (category: string, mode: Mode) => {
    if (!cfg) return;
    setModes((m) => ({ ...m, [category]: mode }));
    const headers = await authHeaders();
    if (!headers) return;
    const resp = await fetch(`/api/mail-assistant/config?hotel=${cfg.key}`, {
      method: "PUT", headers, body: JSON.stringify({ category, mode }),
    });
    if (!resp.ok) { toast.error("Échec màj mode"); await load(cfg.key); }
  };

  const decide = async (row: Row, decision: "validate" | "skip") => {
    if (!cfg) return;
    setBusyId(row.id);
    const headers = await authHeaders();
    if (!headers) { setBusyId(null); return; }
    const resp = await fetch(`/api/mail-assistant/execute?hotel=${cfg.key}`, {
      method: "POST", headers, body: JSON.stringify({ id: row.id, decision }),
    });
    const j = await resp.json();
    if (resp.ok && j.ok) {
      toast.success(decision === "skip" ? "Ignoré" : "Action exécutée");
      await load(cfg.key);
    } else {
      toast.error(j.error || "Échec");
      await load(cfg.key); // recharge pour afficher l'éventuelle erreur d'action
    }
    setBusyId(null);
  };

  const copyNote = async (note: string) => {
    try { await navigator.clipboard.writeText(note); toast.success("Note copiée"); }
    catch { toast.error("Copie impossible"); }
  };

  if (authLoading || !isSuperadmin) {
    return <div className="p-10 text-center text-slate-400">Chargement…</div>;
  }

  const counts = rows.reduce<Record<string, number>>((a, r) => { a[r.category] = (a[r.category] || 0) + 1; return a; }, {});

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <PageHeader
        icon={Mail}
        title="Assistant mails — journal"
        subtitle={cfg ? `${cfg.nom} · ${cfg.mailbox}${cfg.mews ? " · Mews" : ""}` : "Aperçu"}
      />

      {!cfg ? (
        <div className="mt-6">
          <EmptyState
            icon={Inbox}
            title="Assistant indisponible pour cet hôtel"
            subtitle="Le gestionnaire de mails est activé pour Les Voiles et La Corniche. Bascule d’hôtel via le menu."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 my-4">
            <Button onClick={runNow} disabled={running} className="h-11 gap-2 bg-[#004e7c] hover:bg-[#003d61] text-white">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Trier maintenant
            </Button>
            <span className="text-xs text-slate-400">Valider / Ignorer chaque action ci-dessous.</span>
          </div>

          {/* Modes par catégorie (off / valider / auto) */}
          {Object.keys(modes).length > 0 && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Modes par catégorie</div>
              <div className="flex flex-wrap gap-3">
                {Object.keys(modes).map((cat) => (
                  <div key={cat} className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-600">{(CAT_META[cat] || CAT_META.autre).label}</span>
                    <div className="inline-flex rounded-lg ring-1 ring-slate-200 overflow-hidden">
                      {(["off", "suggest", "auto"] as Mode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => changeMode(cat, m)}
                          className={`px-2 py-1 text-xs font-medium transition ${
                            modes[cat] === m
                              ? m === "off" ? "bg-slate-600 text-white" : m === "auto" ? "bg-amber-500 text-white" : "bg-[#004e7c] text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          {MODE_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Off = action désactivée · Valider = attend ton clic · Auto = exécuté au tri (à activer une fois la catégorie éprouvée).
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(counts).map(([cat, n]) => (
                <span key={cat} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${(CAT_META[cat] || CAT_META.autre).badge}`}>
                  {(CAT_META[cat] || CAT_META.autre).label} · {n}
                </span>
              ))}
            </div>
          )}

          {loading ? (
            <div className="p-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Inbox} title="Journal vide" subtitle="Clique sur « Trier maintenant » pour classer la boîte de réception." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Reçu</th>
                    <th className="text-left font-semibold px-3 py-2">De</th>
                    <th className="text-left font-semibold px-3 py-2">Objet</th>
                    <th className="text-left font-semibold px-3 py-2">Catégorie</th>
                    <th className="text-left font-semibold px-3 py-2">Action</th>
                    <th className="text-right font-semibold px-3 py-2">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const mode = modes[r.category];
                    const done = r.status === "executed" || r.status === "skipped";
                    const actionable = !done && r.proposed_action !== "none" && mode !== "off";
                    const summary = resultSummary(r);
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60 align-top">
                        <td className="px-3 py-2 whitespace-nowrap text-slate-400 tabular-nums">
                          {r.received_at ? format(parseISO(r.received_at), "dd/MM HH:mm", { locale: fr }) : "—"}
                        </td>
                        <td className="px-3 py-2 max-w-[10rem] truncate text-slate-600">{r.from_name || r.from_addr}</td>
                        <td className="px-3 py-2 max-w-[16rem] truncate">{r.subject}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${(CAT_META[r.category] || CAT_META.autre).badge}`}>
                            {(CAT_META[r.category] || CAT_META.autre).label}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600" title={r.reason || ""}>
                          {ACTION_LABEL[r.proposed_action] || r.proposed_action}
                          {r.action_error && (
                            <div className="text-[11px] text-rose-500 max-w-[14rem] whitespace-normal mt-0.5">{r.action_error}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {actionable ? (
                            <div className="inline-flex gap-1">
                              <button
                                onClick={() => decide(r, "validate")}
                                disabled={busyId === r.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-xs font-medium disabled:opacity-50"
                              >
                                {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Valider
                              </button>
                              <button
                                onClick={() => decide(r, "skip")}
                                disabled={busyId === r.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-500 px-2 py-1 text-xs font-medium disabled:opacity-50"
                              >
                                <X className="w-3 h-3" />
                                Ignorer
                              </button>
                            </div>
                          ) : r.result?.note ? (
                            <div className="inline-flex flex-col items-end gap-1 max-w-[18rem]">
                              <span className="text-xs text-slate-700 font-medium whitespace-normal text-right">{String(r.result.note)}</span>
                              <div className="inline-flex gap-1">
                                <button
                                  onClick={() => copyNote(String(r.result?.note))}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#004e7c] hover:bg-[#003d61] text-white px-2 py-1 text-xs font-medium"
                                >
                                  <Copy className="w-3 h-3" /> Copier la note
                                </button>
                                <button
                                  onClick={() => decide(r, "validate")}
                                  disabled={busyId === r.id}
                                  title="Régénérer la note (après correction)"
                                  className="inline-flex items-center gap-1 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-500 px-2 py-1 text-xs font-medium disabled:opacity-50"
                                >
                                  {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                  Rejouer
                                </button>
                              </div>
                            </div>
                          ) : summary ? (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              {summary}
                              {r.result?.webLink ? (
                                <a href={String(r.result.webLink)} target="_blank" rel="noreferrer" className="text-[#004e7c] hover:underline inline-flex items-center gap-0.5">
                                  <ExternalLink className="w-3 h-3" /> Ouvrir
                                </a>
                              ) : null}
                            </span>
                          ) : mode === "off" ? (
                            <span className="text-xs text-slate-300">désactivé</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
