"use client";

// Gestionnaire de mails réception — VUE JOURNAL (superadmin uniquement, Phase 1).
// Montre ce que l'assistant CLASSERAIT (dry-run) sur la boîte de l'hôtel COURANT,
// SANS rien supprimer ni envoyer. L'hôtel suit le switch GLOBAL du menu burger
// (useSelectedHotel) — pas de sélecteur in-page. Dispo pour Voiles + Corniche.

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { useSelectedHotel } from "@/context/SelectedHotelContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { hotelConfig } from "@/lib/mailAssistant";
import { Mail, Loader2, RefreshCw, Inbox } from "lucide-react";
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
};

const CAT_META: Record<string, { label: string; badge: string }> = {
  spam_alert:  { label: "Alerte / spam",  badge: "bg-rose-50 text-rose-700 ring-rose-200" },
  resa_ota:    { label: "Réservation",    badge: "bg-sky-50 text-sky-700 ring-sky-200" },
  facture:     { label: "Facture",        badge: "bg-violet-50 text-violet-700 ring-violet-200" },
  candidature: { label: "Candidature",    badge: "bg-amber-50 text-amber-700 ring-amber-200" },
  commercial:  { label: "Commercial",     badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  client_msg:  { label: "Message client", badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  autre:       { label: "Autre",          badge: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const ACTION_LABEL: Record<string, string> = {
  delete: "🗑️ Supprimer",
  resa_control: "📋 Contrôle résa",
  route_pennylane: "🧾 → Pennylane",
  draft_reply: "✍️ Brouillon réponse",
  commercial_followup: "📇 Suivi commercial",
  none: "— laisser à l’humain",
};

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export default function MailAssistantPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { selectedHotelId } = useSelectedHotel();
  const isSuperadmin = user?.role === "superadmin";

  // L'hôtel courant (switch global du burger) → config boîte + flag Mews.
  const cfg = hotelConfig(selectedHotelId);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Garde d'accès : superadmin uniquement (page discrète, hors menu).
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperadmin) { router.push("/"); return; }
  }, [authLoading, user, isSuperadmin, router]);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    const resp = await fetch(`/api/mail-assistant/journal?hotel=${key}`, { headers });
    const j = await resp.json();
    if (resp.ok && j.ok) setRows(j.rows as Row[]); else toast.error(j.error || "Erreur chargement");
    setLoading(false);
  }, []);

  // Recharge quand on bascule d'hôtel via le menu.
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
      toast.success(`Tri effectué (${j.logged} nouveau·x) — dry-run, rien supprimé`);
      await load(cfg.key);
    } else toast.error(j.error || "Échec du tri");
    setRunning(false);
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
        subtitle={cfg ? `Aperçu (dry-run) · ${cfg.nom} · ${cfg.mailbox}` : "Aperçu (dry-run)"}
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
            <span className="text-xs text-slate-400">Dry-run — rien n’est supprimé ni envoyé.</span>
          </div>

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
                    <th className="text-left font-semibold px-3 py-2">Action proposée</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
