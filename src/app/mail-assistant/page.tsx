"use client";

// Assistant mails — poste de travail (superadmin, Phase 2).
//
// L'assistant CLASSE la boîte de l'hôtel courant ; l'humain VALIDE. Rien ne part
// sans un clic tant que la catégorie est en mode « Valider ».
//
// Parti pris de l'écran : ce qui RESTE À FAIRE occupe toute la place, le reste
// s'efface. Les réglages par catégorie sont de la configuration — on les règle
// une fois par mois, pas dix fois par jour : ils vivent donc dans un panneau
// replié. Et la sélection multiple existe parce que le geste courant est répétitif
// (sept pubs à jeter = un clic, pas sept).
//
// ⚠️ Périmètre : Voiles + Corniche uniquement, barrière posée dans graphMailbox.
// ⚠️ Mews (déjà venu / taxe de séjour) = Voiles uniquement.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { useSelectedHotel } from "@/context/SelectedHotelContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { hotelConfig } from "@/lib/mailAssistant";
import {
  Mail, Loader2, RefreshCw, Inbox, Check, X, ExternalLink, Copy,
  SlidersHorizontal, ChevronDown, CheckCheck, CircleCheckBig,
} from "lucide-react";
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

// Toutes les catégories du classifieur, pour qu'aucune ne retombe sur « Autre » —
// c'est ce qui faisait apparaître deux fois le même libellé dans les réglages.
const CAT_META: Record<string, { label: string; badge: string }> = {
  spam_alert:      { label: "Alerte / spam",    badge: "bg-rose-50 text-rose-700 ring-rose-200" },
  resa_ota:        { label: "Réservation",      badge: "bg-sky-50 text-sky-700 ring-sky-200" },
  resa_swile:      { label: "Résa Swile",       badge: "bg-sky-50 text-sky-700 ring-sky-200" },
  resa_rooftop:    { label: "Résa Rooftop",     badge: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  prise_en_charge: { label: "Prise en charge",  badge: "bg-teal-50 text-teal-700 ring-teal-200" },
  facture:         { label: "Facture",          badge: "bg-violet-50 text-violet-700 ring-violet-200" },
  facture_interne: { label: "Notre facture",    badge: "bg-violet-50 text-violet-700 ring-violet-200" },
  facture_ota:     { label: "Facture OTA",      badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  facture_client:  { label: "Facture client",   badge: "bg-purple-50 text-purple-700 ring-purple-200" },
  commission_ota:  { label: "Commission",       badge: "bg-orange-50 text-orange-700 ring-orange-200" },
  candidature:     { label: "Candidature",      badge: "bg-amber-50 text-amber-700 ring-amber-200" },
  commercial:      { label: "Commercial",       badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  client_msg:      { label: "Message client",   badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  pre_sejour:      { label: "Pré-séjour",       badge: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  rapport_pms:     { label: "Rapport PMS",      badge: "bg-slate-100 text-slate-600 ring-slate-200" },
  litige_ota:      { label: "Litige OTA",       badge: "bg-red-50 text-red-700 ring-red-200" },
  livraison:       { label: "Livraison",        badge: "bg-lime-50 text-lime-700 ring-lime-200" },
  autre:           { label: "Autre",            badge: "bg-slate-100 text-slate-600 ring-slate-200" },
};
const meta = (c: string) => CAT_META[c] || CAT_META.autre;

const ACTION_LABEL: Record<string, string> = {
  delete: "Mettre à la corbeille",
  archive: "Classer",
  resa_control: "Contrôler la réservation",
  agency_note: "Note de prise en charge",
  route_pennylane: "Envoyer à Pennylane",
  invoice_note: "Facture à envoyer",
  draft_reply: "Préparer un brouillon",
  commercial_followup: "Ouvrir un suivi commercial",
  presejour_check: "Lire le formulaire pré-séjour",
  rooftop_check: "Vérifier la résa Rooftop",
  livraison_consigne: "Créer la consigne de livraison",
  none: "Je te laisse la main",
};

// Les trois boutons sont des engagements de JUNIOR, à la première personne comme
// le reste de la page. « Me demander » laissait planer un doute : qui est « me » ?
const MODE_LABEL: Record<Mode, string> = {
  off: "Je ne touche pas",
  suggest: "Je te demande",
  auto: "Je fais seul",
};
// Ce que Junior fait concrètement dans chaque famille, et si le geste est
// RÉVERSIBLE. C'est l'information qui manquait : on ne choisit pas un mode en
// lisant « off / suggest / auto », on le choisit en sachant ce qui se passera
// sans nous. Un tri qui classe se rattrape ; un tri qui répond, beaucoup moins.
const CAT_EFFET: Record<string, { geste: string; risque: "sur" | "moyen" | "sensible" }> = {
  spam_alert:      { geste: "Je mets à la corbeille", risque: "sur" },
  resa_ota:        { geste: "J’écris la note dans Mews et je classe le mail", risque: "moyen" },
  resa_swile:      { geste: "J’écris la note dans Mews et je classe le mail", risque: "moyen" },
  resa_rooftop:    { geste: "Je vérifie que la résa est dans l’app, puis je supprime", risque: "moyen" },
  prise_en_charge: { geste: "Je prépare la note de prise en charge", risque: "sur" },
  facture:         { geste: "J’envoie la facture à Pennylane", risque: "sensible" },
  facture_interne: { geste: "Je classe (ou je supprime nos confirmations)", risque: "sur" },
  facture_ota:     { geste: "Je prépare la note « facture à envoyer »", risque: "sur" },
  facture_client:  { geste: "Je te laisse la main — la facture est dans le PMS, je ne la vois pas", risque: "sur" },
  commission_ota:  { geste: "Je prépare la réponse puis je mets à la corbeille", risque: "sensible" },
  candidature:     { geste: "Je prépare la réponse « effectifs au complet »", risque: "moyen" },
  commercial:      { geste: "J’ouvre une fiche de suivi commercial", risque: "moyen" },
  client_msg:      { geste: "Je prépare un brouillon de réponse", risque: "sensible" },
  pre_sejour:      { geste: "Je lis le formulaire et j’en tire une note", risque: "moyen" },
  livraison:       { geste: "Je crée la consigne de livraison", risque: "moyen" },
  litige_ota:      { geste: "Je classe sans supprimer", risque: "sur" },
  rapport_pms:     { geste: "Je classe", risque: "sur" },
  autre:           { geste: "Je ne sais pas quoi en faire, je te le passe", risque: "sur" },
};
const effet = (c: string) => CAT_EFFET[c] || CAT_EFFET.autre;

// La conséquence du mode choisi, écrite en clair. Un réglage doit se lire, pas se deviner.
const MODE_SENS: Record<Mode, string> = {
  off: "Je n’y touche pas du tout.",
  suggest: "Je te le propose, tu décides.",
  auto: "Je le fais seul, sans te demander.",
};


async function authHeaders(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function resultSummary(r: Row): string | null {
  const res = r.result || {};
  if (r.status === "skipped") return "Ignoré";
  if (r.status === "executed") {
    if (res.note) return res.classe ? "Note écrite dans Mews · classé" : "Note écrite dans Mews";
    if (res.movedTo === "deleteditems") return "Mis à la corbeille";
    if (res.movedTo === "archive") return "Classé";
    if (res.kind === "commercial") return res.mode === "created" ? "Fiche créée" : "Fiche complétée";
    if (res.kind === "pennylane") return `Envoyé à Pennylane (${String(res.entity)})`;
    if (res.draftId) return "Brouillon créé";
    return "Fait";
  }
  return null;
}

export default function MailAssistantPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { selectedHotelId } = useSelectedHotel();
  const isSuperadmin = user?.role === "superadmin";
  // Les réglages décident de ce que Junior fait SANS demander : c'est de la
  // délégation, pas du travail quotidien. Quand la page s'ouvrira aux équipes,
  // elles valideront les actions mais ne changeront pas le niveau d'autonomie.
  const peutRegler = user?.role === "superadmin" || user?.role === "admin";
  const cfg = hotelConfig(selectedHotelId);

  const [rows, setRows] = useState<Row[]>([]);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reglages, setReglages] = useState(false);
  const [filtre, setFiltre] = useState<string | null>(null);
  const [voirTraites, setVoirTraites] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  // « Non, c'est plutôt… » — la correction est de la DONNÉE, pas une conversation :
  // elle retraite le mail tout de suite ET s'accumule pour devenir une règle plus
  // tard. Sans elle, une erreur de Junior disparaît dans l'oubli.
  const [corrige, setCorrige] = useState<string | null>(null);
  const [corCat, setCorCat] = useState("");
  const [corAct, setCorAct] = useState("");
  const [corMot, setCorMot] = useState("");

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
    setSelection(new Set());
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
      // « 0 nouveau » ne veut pas dire « boîte vide » : les mails déjà journalisés
      // sont ignorés. Le message doit dire lequel des deux, sinon on cherche en vain
      // une ligne qui n'a pas été créée.
      toast.success(
        j.logged ? `J’ai classé ${j.logged} nouveau${j.logged > 1 ? "x" : ""} mail${j.logged > 1 ? "s" : ""}`
        : "Rien de neuf — tout ce qui est dans la boîte est déjà dans la liste",
      );
      await load(cfg.key);
    } else toast.error(j.error || "Je n’ai pas réussi à lire la boîte");
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
    if (!resp.ok) { toast.error("Échec de la mise à jour"); await load(cfg.key); }
  };

  // Une décision, sans rechargement : le lot en enchaîne plusieurs et ne recharge
  // qu'à la fin — sinon l'écran clignote à chaque ligne.
  const decideOne = async (row: Row, decision: "validate" | "skip"): Promise<boolean> => {
    if (!cfg) return false;
    const headers = await authHeaders();
    if (!headers) return false;
    const resp = await fetch(`/api/mail-assistant/execute?hotel=${cfg.key}`, {
      method: "POST", headers, body: JSON.stringify({ id: row.id, decision }),
    });
    const j = await resp.json().catch(() => ({}));
    return resp.ok && j.ok;
  };

  const decide = async (row: Row, decision: "validate" | "skip") => {
    setBusyId(row.id);
    const ok = await decideOne(row, decision);
    toast[ok ? "success" : "error"](ok ? (decision === "skip" ? "OK, je laisse tomber" : "C’est fait !") : "Ça a coincé");
    await load(cfg!.key);
    setBusyId(null);
  };

  const decideLot = async (decision: "validate" | "skip") => {
    const cibles = visibles.filter((r) => selection.has(r.id));
    if (!cibles.length) return;
    setBusyId("lot");
    let ok = 0;
    for (const r of cibles) if (await decideOne(r, decision)) ok++;
    const rate = cibles.length - ok;
    if (rate) toast.error(`${ok}/${cibles.length} traités — ${rate} en échec`);
    else toast.success(decision === "skip" ? `OK, j’en laisse ${ok} de côté` : `${ok} de faits !`);
    await load(cfg!.key);
    setBusyId(null);
  };

  const envoyerCorrection = async (row: Row) => {
    if (!cfg) return;
    if (!corCat && !corAct && !corMot.trim()) { toast.error("Dis-moi au moins ce qui n’allait pas"); return; }
    setBusyId(row.id);
    const headers = await authHeaders();
    if (!headers) { setBusyId(null); return; }
    const resp = await fetch(`/api/mail-assistant/correct?hotel=${cfg.key}`, {
      method: "POST", headers,
      body: JSON.stringify({
        id: row.id,
        category: corCat || undefined,
        action: corAct || undefined,
        commentaire: corMot.trim() || undefined,
        // On ne retraite que si une action a été choisie : un simple commentaire
        // enrichit le dossier sans rien déclencher.
        executer: !!corAct,
      }),
    });
    const j = await resp.json().catch(() => ({}));
    if (resp.ok && j.ok) {
      toast.success(corAct ? "Corrigé, je m’en occupe" : "Noté, merci — ça me servira");
      setCorrige(null); setCorCat(""); setCorAct(""); setCorMot("");
      await load(cfg.key);
    } else toast.error(j.error || "Ça a coincé");
    setBusyId(null);
  };

  const copyNote = async (note: string) => {
    try { await navigator.clipboard.writeText(note); toast.success("Note copiée"); }
    catch { toast.error("Copie impossible"); }
  };

  const estTraite = (r: Row) => r.status === "executed" || r.status === "skipped";
  // Dépend de `modes` (une catégorie en Off ne propose plus rien) → useCallback,
  // sinon les mémos qui s'en servent ne se recalculent pas quand un mode change.
  const estActionnable = useCallback(
    (r: Row) => !estTraite(r) && r.proposed_action !== "none" && modes[r.category] !== "off",
    [modes],
  );

  const aFaire = useMemo(() => rows.filter(estActionnable), [rows, estActionnable]);
  const visibles = useMemo(() => {
    const base = voirTraites ? rows : rows.filter((r) => !estTraite(r));
    return filtre ? base.filter((r) => r.category === filtre) : base;
  }, [rows, filtre, voirTraites]);

  const compteurs = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) if (voirTraites || !estTraite(r)) c[r.category] = (c[r.category] || 0) + 1;
    return c;
  }, [rows, voirTraites]);

  const selectionnables = visibles.filter(estActionnable);
  const toutSelectionne = selectionnables.length > 0 && selectionnables.every((r) => selection.has(r.id));

  if (authLoading || !isSuperadmin) {
    return <div className="p-10 text-center text-slate-400">Chargement…</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 pb-28">
      <PageHeader
        icon={Mail}
        title="Junior"
        subtitle={cfg ? `Ton collègue qui trie les mails · ${cfg.nom}` : "Ton collègue qui trie les mails"}
      />

      {!cfg ? (
        <div className="mt-6">
          <EmptyState
            icon={Inbox}
            title="Assistant indisponible pour cet hôtel"
            subtitle="Je ne m’occupe que des Voiles et de La Corniche. Bascule d’hôtel via le menu."
          />
        </div>
      ) : (
        <>
          {/* Barre d'action : le tri, et l'état en un coup d'œil. */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={runNow} disabled={running} variant="brand" className="h-11 gap-2">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {running ? "Je regarde…" : "Junior, au boulot !"}
            </Button>
            <div className="text-sm text-slate-500">
              {aFaire.length > 0
                ? <>J’ai <span className="font-semibold text-slate-800">{aFaire.length} truc{aFaire.length > 1 ? "s" : ""}</span> pour toi — tu valides, je m’en occupe.</>
                : rows.length > 0 ? "Boîte à jour, rien ne traîne 👌" : "Je n’ai pas encore mis le nez dans la boîte."}
            </div>
            {peutRegler && (
            <button
              onClick={() => setReglages((v) => !v)}
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-2.5 h-8 rounded-lg border border-slate-200 hover:bg-slate-50"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" /> Réglages
              <ChevronDown className={`w-3.5 h-3.5 transition ${reglages ? "rotate-180" : ""}`} />
            </button>
            )}
          </div>

          {/* Réglages. Le panneau ne demande plus « off / suggest / auto » : il dit,
              famille par famille, CE QUE JUNIOR FAIT et CE QUI SE PASSERA sans toi.
              Les familles sensibles (répondre à un client, envoyer une facture en
              compta) portent un avertissement quand elles passent en autonomie. */}
          {peutRegler && reglages && Object.keys(modes).length > 0 && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                <p className="text-sm font-semibold text-slate-800">Jusqu’où tu me laisses aller</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pour chaque famille de mails, dis-moi jusqu’où je vais. Commence par « Je te demande » :
                  quand une famille ne te surprend plus, passe-la en autonomie et tu ne la verras plus.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {Object.keys(modes)
                  .sort((a, b) => meta(a).label.localeCompare(meta(b).label))
                  .map((cat) => {
                    const m = modes[cat];
                    const e = effet(cat);
                    return (
                      <div key={cat} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${meta(cat).badge}`}>
                              {meta(cat).label}
                            </span>
                            {e.risque === "sensible" && (
                              <span className="text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2 py-0.5">
                                à surveiller
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-700 mt-1">{e.geste}</p>
                          <p className={`text-xs mt-0.5 ${m === "auto" ? "text-amber-700" : "text-slate-400"}`}>
                            {MODE_SENS[m]}
                            {m === "auto" && e.risque === "sensible" && " ⚠️ rien ne repassera devant toi."}
                          </p>
                        </div>
                        <div className="inline-flex rounded-xl ring-1 ring-slate-200 overflow-hidden shrink-0 self-start">
                          {(["off", "suggest", "auto"] as Mode[]).map((mm) => (
                            <button
                              key={mm}
                              onClick={() => changeMode(cat, mm)}
                              title={MODE_SENS[mm]}
                              className={`px-3 py-1.5 text-xs font-medium transition whitespace-nowrap ${
                                m === mm
                                  ? mm === "off" ? "bg-slate-700 text-white"
                                    : mm === "auto" ? "bg-amber-500 text-white"
                                    : "bg-[var(--brand)] text-white"
                                  : "bg-white text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {MODE_LABEL[mm]}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Filtres : par famille, et bascule traités / à faire. */}
          {rows.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFiltre(null)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                  filtre === null ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"}`}
              >
                Tout · {Object.values(compteurs).reduce((a, b) => a + b, 0)}
              </button>
              {Object.entries(compteurs).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                <button
                  key={cat}
                  onClick={() => setFiltre(filtre === cat ? null : cat)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                    filtre === cat ? "bg-slate-800 text-white ring-slate-800" : `${meta(cat).badge} hover:brightness-95`}`}
                >
                  {meta(cat).label} · {n}
                </button>
              ))}
              <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                <input type="checkbox" checked={voirTraites} onChange={(e) => setVoirTraites(e.target.checked)} className="w-3.5 h-3.5 accent-slate-600" />
                Voir aussi les traités
              </label>
            </div>
          )}

          {loading ? (
            <div className="p-16 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
          ) : visibles.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                icon={rows.length ? CircleCheckBig : Inbox}
                title={rows.length ? "Tout est propre" : "Je n’ai encore rien regardé"}
                subtitle={rows.length
                  ? "J’ai passé la boîte en revue, il n’y a plus rien qui traîne."
                  : "Clique sur « Junior, au boulot ! » et je te dis ce qu’il y a dans la boîte."}
              />
            </div>
          ) : (
            <>
              {/* Sélection : cocher la ligne d'en-tête sélectionne tout le visible. */}
              {selectionnables.length > 0 && (
                <label className="mt-4 mb-1 flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={toutSelectionne}
                    onChange={(e) => setSelection(e.target.checked ? new Set(selectionnables.map((r) => r.id)) : new Set())}
                    className="w-4 h-4 accent-[var(--brand)]"
                  />
                  Tout sélectionner ({selectionnables.length})
                </label>
              )}

              <div className="mt-2 space-y-2">
                {visibles.map((r) => {
                  const actionnable = estActionnable(r);
                  const summary = resultSummary(r);
                  const note = r.result?.note ? String(r.result.note) : null;
                  const resa = (r.result?.resa as Record<string, unknown> | undefined) || null;
                  const choisi = selection.has(r.id);
                  return (
                    <div
                      key={r.id}
                      className={`rounded-xl border bg-white p-3 sm:p-4 transition ${
                        choisi ? "border-[var(--brand)] ring-1 ring-[var(--brand)]/20" : "border-slate-200 hover:border-slate-300"}`}
                    >
                      <div className="flex items-start gap-3">
                        {actionnable ? (
                          <input
                            type="checkbox"
                            checked={choisi}
                            onChange={(e) => setSelection((s) => {
                              const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n;
                            })}
                            className="mt-1 w-4 h-4 accent-[var(--brand)] shrink-0"
                          />
                        ) : <span className="w-4 shrink-0" />}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${meta(r.category).badge}`}>
                              {meta(r.category).label}
                            </span>
                            <span className="text-xs text-slate-400 tabular-nums">
                              {r.received_at ? format(parseISO(r.received_at), "dd/MM · HH:mm", { locale: fr }) : "—"}
                            </span>
                            <span className="text-xs text-slate-500 truncate">{r.from_name || r.from_addr}</span>
                          </div>

                          {/* Ce qui parle à un réceptionniste, c'est le NOM du client et
                              ses dates — pas « 1B97MF ». On ne l'a qu'après traitement
                              (le parseur lit le corps du mail), d'où le repli sur l'objet. */}
                          {resa ? (
                            <>
                              <p className="mt-1 text-sm font-semibold text-slate-800 break-words">
                                {String(resa.guest)}
                                {resa.room ? <span className="font-normal text-slate-500"> · {String(resa.room)}</span> : null}
                              </p>
                              <p className="text-xs text-slate-500">
                                {String(resa.arrival)}{resa.departure ? ` → ${String(resa.departure)}` : ""}
                                {resa.nights ? ` · ${resa.nights} nuit${Number(resa.nights) > 1 ? "s" : ""}` : ""}
                                {resa.amount ? ` · ${String(resa.amount)}` : ""}
                                {resa.ref ? <span className="text-slate-300"> · {String(resa.ref)}</span> : null}
                              </p>
                            </>
                          ) : (
                            <p className="mt-1 text-sm font-medium text-slate-800 break-words">{r.subject || "(sans objet)"}</p>
                          )}

                          <p className="mt-1.5 text-sm text-slate-600">
                            <span className="text-slate-400">Je propose :</span>{" "}
                            <span className="font-medium">{ACTION_LABEL[r.proposed_action] || r.proposed_action}</span>
                          </p>
                          {r.reason && <p className="text-xs text-slate-400 mt-0.5">{r.reason}</p>}

                          {note && (
                            <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                              <p className="text-sm text-slate-800 font-mono break-words">{note}</p>
                              <button
                                onClick={() => copyNote(note)}
                                className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline"
                              >
                                <Copy className="w-3 h-3" /> Copier la note
                              </button>
                            </div>
                          )}

                          {/* Checklist commerciale. Un lead n'est pas UNE action mais une
                              petite séquence — fiche, devis, réponse — avec une DÉCISION
                              HUMAINE au milieu (le prix, la faisabilité). Enchaîner les
                              trois d'un clic produirait un devis inventé et une promesse
                              intenable : Junior fait ce qu'il sait faire seul et ouvre la
                              porte pour le reste. La ligne reste visible tant que la
                              séquence n'est pas finie. */}
                          {r.result?.kind === "commercial" && (
                            <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2 space-y-1.5">
                              <p className="text-xs text-emerald-800 flex items-center gap-1.5">
                                <Check className="w-3.5 h-3.5" />
                                Fiche {r.result.mode === "rattache" ? "rattachée au dossier" : r.result.mode === "updated" ? "complétée" : "créée"}
                                {r.result.ref ? <span className="text-emerald-600">· {String(r.result.ref)}</span> : null}
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                {r.result.id ? (
                                  <a
                                    href={`/devis?leadId=${String(r.result.id)}`}
                                    className="inline-flex items-center gap-1 rounded-lg bg-white ring-1 ring-emerald-200 hover:bg-emerald-50 text-emerald-800 px-2.5 h-7 text-xs font-medium"
                                  >
                                    Ouvrir le devis <ExternalLink className="w-3 h-3" />
                                  </a>
                                ) : null}
                                {r.result.webLink ? (
                                  <a
                                    href={String(r.result.webLink)} target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-1 rounded-lg bg-white ring-1 ring-emerald-200 hover:bg-emerald-50 text-emerald-800 px-2.5 h-7 text-xs font-medium"
                                  >
                                    Relire le brouillon <ExternalLink className="w-3 h-3" />
                                  </a>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    Brouillon : dis-moi le prix ci-dessous et je le rédige.
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Correction : ouverte à tous ceux qui traitent, parce que c'est
                              celui qui voit le mail qui sait ce qu'il fallait en faire. */}
                          {corrige === r.id ? (
                            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                              <p className="text-xs font-semibold text-slate-600">Qu’est-ce que j’aurais dû faire ?</p>
                              <div className="grid sm:grid-cols-2 gap-2">
                                <select
                                  value={corCat} onChange={(e) => setCorCat(e.target.value)}
                                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
                                >
                                  <option value="">— même famille ({meta(r.category).label}) —</option>
                                  {Object.keys(CAT_META).map((c) => <option key={c} value={c}>{meta(c).label}</option>)}
                                </select>
                                <select
                                  value={corAct} onChange={(e) => setCorAct(e.target.value)}
                                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
                                >
                                  <option value="">— même action —</option>
                                  {Object.keys(ACTION_LABEL).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                                </select>
                              </div>
                              <textarea
                                value={corMot} onChange={(e) => setCorMot(e.target.value)}
                                rows={2}
                                placeholder="Ce que je ne peux pas voir : « déjà remboursé, vu avec Nina », « c’est un habitué »…"
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => envoyerCorrection(r)} disabled={!!busyId}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white px-3 h-8 text-xs font-medium disabled:opacity-50"
                                >
                                  {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                  Envoyer la correction
                                </button>
                                <button
                                  onClick={() => { setCorrige(null); setCorCat(""); setCorAct(""); setCorMot(""); }}
                                  className="text-xs text-slate-400 hover:text-slate-600"
                                >
                                  Annuler
                                </button>
                                <span className="ml-auto text-[11px] text-slate-400">
                                  {corAct ? "Je retraite le mail tout de suite." : "Sans action choisie, je note sans rien faire."}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setCorrige(r.id); setCorCat(""); setCorAct(""); setCorMot(""); }}
                              className="mt-2 text-xs text-slate-400 hover:text-[var(--brand)] underline underline-offset-2"
                            >
                              Non, c’est plutôt…
                            </button>
                          )}

                          {r.action_error && (
                            <p className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">
                              {r.action_error}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 flex flex-col items-end gap-1.5">
                          {actionnable ? (
                            <>
                              <button
                                onClick={() => decide(r, "validate")}
                                disabled={!!busyId}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 h-8 text-xs font-medium disabled:opacity-50"
                              >
                                {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                Valider
                              </button>
                              <button
                                onClick={() => decide(r, "skip")}
                                disabled={!!busyId}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-500 px-3 h-8 text-xs font-medium disabled:opacity-50"
                              >
                                <X className="w-3.5 h-3.5" /> Ignorer
                              </button>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap">
                              {summary || (modes[r.category] === "off" ? "désactivé" : "—")}
                              {r.result?.webLink ? (
                                <a href={String(r.result.webLink)} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline inline-flex items-center gap-0.5 ml-1">
                                  <ExternalLink className="w-3 h-3" /> Ouvrir
                                </a>
                              ) : null}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Barre de lot, collée en bas : elle n'apparaît que s'il y a une sélection. */}
          {selection.size > 0 && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl bg-slate-900 text-white shadow-xl px-4 py-3">
              <span className="text-sm">
                <b>{selection.size}</b> sélectionné{selection.size > 1 ? "s" : ""}
              </span>
              <button
                onClick={() => decideLot("validate")}
                disabled={!!busyId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 h-9 text-sm font-medium disabled:opacity-50"
              >
                {busyId === "lot" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                Je fais tout
              </button>
              <button
                onClick={() => decideLot("skip")}
                disabled={!!busyId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 h-9 text-sm font-medium disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Tout laisser
              </button>
              <button onClick={() => setSelection(new Set())} className="text-white/50 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
