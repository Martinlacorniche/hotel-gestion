"use client";

// Junior — poste de travail de l’assistant mails (superadmin, Phase 2).
// La page vit sur /junior : c’est son nom, celui que l’équipe emploie.
// Les routes gardent le préfixe /api/mail-assistant (historique, sans effet visible).
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

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { useSelectedHotel } from "@/context/SelectedHotelContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { hotelConfig } from "@/lib/mailAssistant";
import {
  Mail, Loader2, RefreshCw, Inbox, Check, X, ExternalLink, Copy,
  SlidersHorizontal, CheckCheck, ChevronDown,
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
  if (r.status !== "executed") return null;

  const fait = (() => {
    if (res.note) return res.classe ? "Note écrite dans Mews · classé" : "Note écrite dans Mews";
    if (res.movedTo === "deleteditems") return "Mis à la corbeille";
    if (res.movedTo === "archive") return "Classé";
    if (res.kind === "commercial") {
      if (res.mode === "deja_repondu") return "Un collègue avait déjà répondu";
      if (res.mode === "sans_fiche") return res.draftId ? "Brouillon prêt · pas de fiche" : "Pas de fiche pour ce dossier";
      if (res.mode === "rattache") return "Rattaché au dossier";
      // Dossier perdu : ce qui compte à l'écran, c'est de savoir si le motif a été
      // enregistré quelque part — sinon la perte ne laisse aucune trace exploitable.
      if (res.mode === "annule") {
        return res.ficheId ? "Dossier perdu · passé en Refus · classé" : "Dossier perdu · aucune fiche à mettre à jour · classé";
      }
      if (res.mode === "confirme") {
        return [
          res.ficheId ? "Dossier confirmé · relance annulée" : "Dossier confirmé · aucune fiche",
          res.consigne ? "consigne Hotsoft posée" : null,
          res.ecart_vente ? `⚠️ ${String(res.ecart_vente)}` : null,
        ].filter(Boolean).join(" · ");
      }
      return res.mode === "created" ? "Fiche créée" : "Fiche complétée";
    }
    if (res.kind === "pennylane") {
      return `Envoyé à Pennylane (${String(res.entity)})${res.classe === false ? " · à classer à la main" : " · classé"}`;
    }
    if (res.draftId) return "Brouillon créé";
    return "Fait";
  })();

  // Ce qui a été fait SANS CLIC doit se distinguer de ce qu'on a validé soi-même :
  // c'est la seule trace qu'il en reste. Une famille en « Je fais seul » agit pendant
  // qu'on regarde ailleurs — si l'écran ne le dit pas, un mail supprimé devient un
  // mail disparu.
  return res.auto ? `${fait} · sans te demander` : fait;
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
  // Ce que Junior vient de faire SOUS LES YEUX de la personne reste affiché.
  // Sinon la ligne bascule en « traité » à la seconde où elle est validée, et
  // disparaît — emportant avec elle les boutons « Relire le brouillon » et
  // « Ouvrir le devis », c'est-à-dire précisément ce qu'il fallait aller voir
  // (Martin 2026-07-23). Ces lignes ne survivent pas au rechargement : la liste
  // du lendemain doit rester une liste de choses À FAIRE.
  const [fraichementTraites, setFraichementTraites] = useState<Set<string>>(new Set());
  // « Non, c'est plutôt… » — la correction est de la DONNÉE, pas une conversation :
  // elle retraite le mail tout de suite ET s'accumule pour devenir une règle plus
  // tard. Sans elle, une erreur de Junior disparaît dans l'oubli.
  const [corrige, setCorrige] = useState<string | null>(null);
  // Le dossier ouvert à droite, et — sur petit écran, où les deux colonnes ne
  // tiennent pas — laquelle des deux on regarde.
  const [actif, setActif] = useState<string | null>(null);
  const [vue, setVue] = useState<"liste" | "conv">("conv");
  const [corCat, setCorCat] = useState("");
  const [corAct, setCorAct] = useState("");
  const [corMot, setCorMot] = useState("");

  const initiales = (r: Row) => {
    const n = (r.from_name || r.from_addr || "?").replace(/[<>"]/g, " ").trim();
    const mots = n.split(/[\s.@_-]+/).filter(Boolean);
    return ((mots[0]?.[0] || "") + (mots[1]?.[0] || "")).toUpperCase() || "?";
  };
  const toggleSel = (id: string) =>
    setSelection((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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
      // Ce que j'ai fait TOUT SEUL doit se dire, sinon des mails disparaissent de la
      // boîte sans que personne sache pourquoi. Une famille en « Je fais seul » agit
      // pour de bon : on l'annonce dans la même phrase que le reste.
      const classes = j.logged
        ? `J’ai classé ${j.logged} nouveau${j.logged > 1 ? "x" : ""} mail${j.logged > 1 ? "s" : ""}`
        : "Rien de neuf — tout ce qui est dans la boîte est déjà dans la liste";
      toast.success(
        j.autonomes ? `${classes} · j’en ai traité ${j.autonomes} tout seul` : classes,
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
    if (ok) setFraichementTraites((s) => new Set(s).add(row.id));
    await load(cfg!.key);
    setBusyId(null);
  };

  const decideLot = async (decision: "validate" | "skip") => {
    const cibles = visibles.filter((r) => selection.has(r.id));
    if (!cibles.length) return;
    setBusyId("lot");
    let ok = 0;
    const faits: string[] = [];
    for (const r of cibles) if (await decideOne(r, decision)) { ok++; faits.push(r.id); }
    setFraichementTraites((s) => { const n = new Set(s); for (const id of faits) n.add(id); return n; });
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
      setFraichementTraites((s) => new Set(s).add(row.id));
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

  const garde = useCallback(
    (r: Row) => voirTraites || !estTraite(r) || fraichementTraites.has(r.id),
    [voirTraites, fraichementTraites],
  );
  const visibles = useMemo(() => {
    const base = rows.filter(garde);
    return filtre ? base.filter((r) => r.category === filtre) : base;
  }, [rows, filtre, garde]);

  const compteurs = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) if (garde(r)) c[r.category] = (c[r.category] || 0) + 1;
    return c;
  }, [rows, garde]);


  if (authLoading || !isSuperadmin) {
    return <div className="p-10 text-center text-slate-400">Chargement…</div>;
  }

  if (!cfg) {
    return (
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <PageHeader icon={Mail} title="Junior" subtitle="Ton collègue qui trie les mails" />
        <div className="mt-6">
          <EmptyState
            icon={Inbox}
            title="Assistant indisponible pour cet hôtel"
            subtitle="Je ne m’occupe que des Voiles et de La Corniche. Bascule d’hôtel via le menu."
          />
        </div>
      </div>
    );
  }

  const attendent = visibles.filter(estActionnable);
  const regles = visibles.filter((r) => !estActionnable(r));
  const ouvert = rows.find((r) => r.id === actif) || attendent[0] || regles[0] || null;

  return (
    <div className="p-3 sm:p-5">
      <div className="flex h-[calc(100vh-7rem)] min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

        {/* ── La liste : courte, deux lignes par dossier, on ouvre pour traiter ── */}
        <aside className={`w-full sm:w-[330px] shrink-0 border-r border-slate-200 flex-col min-h-0 ${vue === "liste" ? "flex" : "hidden sm:flex"}`}>
          <div className="px-4 pt-4 pb-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--brand)] text-white grid place-items-center font-semibold shrink-0">J</div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800 leading-tight">Junior</p>
              <p className="text-xs text-slate-400 truncate">
                {attendent.length ? `${attendent.length} pour toi` : "rien ne t’attend"}
                {regles.length ? ` · ${regles.length} réglé${regles.length > 1 ? "s" : ""}` : ""}
              </p>
            </div>
            {peutRegler && (
              <button
                onClick={() => { setReglages((v) => !v); setVue("conv"); }}
                title="Jusqu’où je vais tout seul"
                className={`w-9 h-9 rounded-lg border grid place-items-center transition ${
                  reglages ? "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-bg)]" : "border-slate-200 text-slate-400 hover:text-slate-600"}`}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={runNow} disabled={running} title="Relever la boîte"
              className="w-9 h-9 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white grid place-items-center disabled:opacity-60"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>

          {rows.length > 0 && (
            <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
              {[null, ...Object.keys(compteurs).sort()].map((c) => (
                <button
                  key={c ?? "tout"}
                  onClick={() => setFiltre(c)}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition ${
                    filtre === c ? "bg-[var(--brand)] text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                >
                  {c === null ? `Tout · ${visibles.length}` : `${meta(c).label} · ${compteurs[c]}`}
                </button>
              ))}
              <button
                onClick={() => setVoirTraites((v) => !v)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition ${
                  voirTraites ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
              >
                {voirTraites ? "Masquer l’historique" : "Ce que j’ai fait"}
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto pb-3">
            {loading ? (
              <p className="p-4 text-sm text-slate-400">Je regarde…</p>
            ) : !visibles.length ? (
              <p className="p-4 text-sm text-slate-400">
                {rows.length ? "Rien dans ce filtre." : "Je n’ai pas encore mis le nez dans la boîte."}
              </p>
            ) : (
              <>
                <Groupe titre="Ils t’attendent" liste={attendent} />
                <Groupe titre="Réglés" liste={regles} />
              </>
            )}
          </div>
        </aside>

        {/* ── La conversation : on traite ici, et nulle part ailleurs ── */}
        <main className={`flex-1 min-w-0 flex-col bg-slate-50/60 ${vue === "conv" ? "flex" : "hidden sm:flex"}`}>
          {reglages && peutRegler ? (
            <Reglages />
          ) : !ouvert ? (
            <div className="flex-1 grid place-items-center text-sm text-slate-400 px-6 text-center">
              Choisis un dossier à gauche — ou clique sur la flèche pour que j’aille relever la boîte.
            </div>
          ) : (
            <Conversation r={ouvert} />
          )}
        </main>
      </div>

      {/* Le lot reste : sept pubs à jeter, c’est un clic, pas sept. */}
      {selection.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl bg-slate-900 text-white shadow-xl px-4 py-3">
          <span className="text-sm"><b>{selection.size}</b> sélectionné{selection.size > 1 ? "s" : ""}</span>
          <button
            onClick={() => decideLot("validate")} disabled={!!busyId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 h-9 text-sm font-medium disabled:opacity-50"
          >
            {busyId === "lot" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
            Je fais tout
          </button>
          <button
            onClick={() => decideLot("skip")} disabled={!!busyId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 h-9 text-sm font-medium disabled:opacity-50"
          >
            <X className="w-4 h-4" /> Tout laisser
          </button>
          <button onClick={() => setSelection(new Set())} className="text-white/50 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );

  // ── Un groupe de la liste ────────────────────────────────────────────────
  function Groupe({ titre, liste }: { titre: string; liste: Row[] }) {
    if (!liste.length) return null;
    return (
      <>
        <p className="px-4 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{titre}</p>
        {liste.map((r) => {
          const actionnable = estActionnable(r);
          const apercu = actionnable
            ? (r.reason || ACTION_LABEL[r.proposed_action] || "")
            : (resultSummary(r) || r.reason || "");
          return (
            <button
              key={r.id}
              onClick={() => { setActif(r.id); setVue("conv"); setCorrige(null); }}
              className={`w-full text-left flex gap-2.5 px-3 py-2.5 items-start relative transition ${
                ouvert?.id === r.id ? "bg-[var(--brand-bg)]" : "hover:bg-slate-50"}`}
            >
              {ouvert?.id === r.id && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--brand)]" />}
              {actionnable ? (
                <span
                  role="checkbox" aria-checked={selection.has(r.id)} tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); toggleSel(r.id); }}
                  onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleSel(r.id); } }}
                  className={`mt-0.5 w-8 h-8 shrink-0 rounded-lg grid place-items-center text-[11px] font-semibold transition ${
                    selection.has(r.id)
                      ? "bg-[var(--brand)] text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                >
                  {selection.has(r.id) ? <Check className="w-4 h-4" /> : initiales(r)}
                </span>
              ) : (
                <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-slate-50 text-emerald-600 grid place-items-center">
                  <Check className="w-4 h-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <b className={`flex-1 min-w-0 truncate text-[13.5px] ${actionnable ? "font-semibold text-slate-800" : "font-medium text-slate-500"}`}>
                    {r.subject || "(sans objet)"}
                  </b>
                  <time className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                    {r.received_at ? format(parseISO(r.received_at), "HH:mm") : ""}
                  </time>
                </span>
                <span className="block truncate text-[12.5px] text-slate-400 mt-0.5">{apercu}</span>
              </span>
              {actionnable && <span className="mt-2 w-2 h-2 rounded-full bg-[var(--brand)] shrink-0" />}
            </button>
          );
        })}
      </>
    );
  }

  // ── La conversation d'un dossier ─────────────────────────────────────────
  function Conversation({ r }: { r: Row }) {
    const cle = cfg!.key;
    const actionnable = estActionnable(r);
    const res = (r.result || {}) as Record<string, unknown>;
    const note = (res.note as string) || (r.detail?.note as string) || null;
    const resume = resultSummary(r);
    const aVerifier = Array.isArray(res.incertitudes) ? (res.incertitudes as unknown[]).map(String) : [];
    const aFaire = res.message ? String(res.message) : null;
    const liens = [
      res.id ? { href: `/devis?leadId=${String(res.id)}`, label: "Chiffrer le devis" } : null,
      // Les brouillons ne sont plus des liens : ils s'affichent en entier plus bas.
    ].filter(Boolean) as { href: string; label: string }[];

    return (
      <>
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-white flex items-center gap-3">
          <button onClick={() => setVue("liste")} className="sm:hidden w-8 h-8 rounded-lg border border-slate-200 text-slate-400 grid place-items-center">←</button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-800 truncate leading-tight">{r.subject || "(sans objet)"}</p>
            <p className="text-xs text-slate-400 truncate">
              {r.from_name || r.from_addr}
              {r.received_at ? ` · ${format(parseISO(r.received_at), "d MMM à HH:mm", { locale: fr })}` : ""}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${meta(r.category).badge}`}>
            {meta(r.category).label}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-3">
          {/* Ce qu'il a compris du mail — sa première bulle. */}
          <Bulle>
            <p className="text-[14.5px] text-slate-700">{r.reason || "Je n’ai rien de particulier à en dire."}</p>
            {resume && !actionnable && (
              <ul className="mt-2.5 space-y-1">
                <li className="text-[13px] text-slate-500 flex gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />{resume}
                </li>
              </ul>
            )}
          </Bulle>

          {note && (
            <Bulle>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">La note pour l’équipe</p>
              <p className="text-sm text-slate-800 font-mono whitespace-pre-wrap break-words">{note}</p>
              <button onClick={() => copyNote(note)} className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline">
                <Copy className="w-3 h-3" /> Copier
              </button>
            </Bulle>
          )}

          {/* Ce qu'il propose, ou ce qui te revient : le seul bloc avec des boutons. */}
          {actionnable ? (
            <Demande titre="Je te propose">
              <p className="text-[15px] text-slate-800 font-medium">{ACTION_LABEL[r.proposed_action] || r.proposed_action}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => decide(r, "validate")} disabled={!!busyId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white px-3.5 h-9 text-[13px] font-semibold disabled:opacity-50"
                >
                  {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Vas-y
                </button>
                <button
                  onClick={() => decide(r, "skip")} disabled={!!busyId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-500 px-3.5 h-9 text-[13px] font-medium disabled:opacity-50"
                >
                  <X className="w-4 h-4" /> Laisse tomber
                </button>
              </div>
            </Demande>
          ) : (aFaire || aVerifier.length || liens.length) ? (
            <Demande titre="C’est à toi">
              {aFaire && <p className="text-[14.5px] text-slate-800">{aFaire}</p>}
              {aVerifier.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {aVerifier.map((x, i) => (
                    <li key={i} className="text-[13px] text-amber-800 flex gap-2">
                      <span className="shrink-0">⚠️</span><span>{x}</span>
                    </li>
                  ))}
                </ul>
              )}
              {liens.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {liens.map((l) => (
                    <a
                      key={l.href} href={l.href} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-700 px-3 h-9 text-[13px] font-semibold"
                    >
                      {l.label} <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ))}
                </div>
              )}
            </Demande>
          ) : null}

          {r.action_error && (
            <Demande titre="Je me suis arrêté là" ton="alerte">
              <p className="text-[14px] text-slate-800">{r.action_error}</p>
            </Demande>
          )}

          {/* Ce qu'il propose d'envoyer — lisible et décidable ici même. */}
          {res.draftId ? (
            <Proposition
              logId={r.id} hotel={cle} quel="client" titre="Ma réponse au client"
              lien={res.webLink ? String(res.webLink) : undefined}
              onFait={() => load(cle)}
            />
          ) : null}
          {res.draftGaetanId ? (
            <Proposition
              logId={r.id} hotel={cle} quel="gaetan" titre="Mon mot pour Gaëtan"
              lien={res.draftGaetanLink ? String(res.draftGaetanLink) : undefined}
              onFait={() => load(cle)}
            />
          ) : null}

          {/* La correction, c'est TOI qui parles : elle s'écrit donc du côté droit,
              dans ta bulle. Les listes déroulantes du navigateur cassaient la
              conversation en plein milieu — on choisit maintenant en cliquant, comme
              on cocherait une réponse. */}
          {corrige === r.id ? (
            <BulleMoi qui={user?.name}>
              <textarea
                value={corMot} onChange={(e) => setCorMot(e.target.value)} rows={2} autoFocus
                placeholder="Dis-lui ce qu’il ne peut pas voir : « déjà remboursé, vu avec Nina », « c’est un habitué »…"
                className="w-full rounded-xl border border-white/40 bg-white/80 px-3 py-2 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
              />
              <Choix
                valeur={corAct ? `${corCat}|${corAct}` : ""}
                onChange={(v) => {
                  const [c, a] = v.split("|");
                  setCorCat(c || ""); setCorAct(a || "");
                }}
              />
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => envoyerCorrection(r)} disabled={!!busyId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white px-3.5 h-9 text-[13px] font-semibold disabled:opacity-50"
                >
                  {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Envoyer
                </button>
                <button
                  onClick={() => { setCorrige(null); setCorCat(""); setCorAct(""); setCorMot(""); }}
                  className="text-[13px] text-slate-500 hover:text-slate-700"
                >
                  Annuler
                </button>
                <span className="ml-auto text-[11px] text-slate-500">
                  {corAct ? "Il retraite le mail tout de suite." : "Sans action choisie, il note sans rien faire."}
                </span>
              </div>
            </BulleMoi>
          ) : null}
        </div>

        {/* Le pied : la place de la conversation, quand l'agent arrivera. */}
        <div className="border-t border-slate-200 bg-white px-4 sm:px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setCorrige(r.id); setCorCat(""); setCorAct(""); setCorMot(""); }}
              className="text-[13px] text-slate-500 hover:text-[var(--brand)] underline underline-offset-2"
            >
              Non, c’est plutôt…
            </button>
            {!estActionnable(r) && fraichementTraites.has(r.id) && (
              <button
                onClick={() => setFraichementTraites((s) => { const n = new Set(s); n.delete(r.id); return n; })}
                className="text-[13px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
              >
                ranger
              </button>
            )}
            <span className="ml-auto text-[11.5px] text-slate-400">
              Lui écrire arrivera avec l’agent — pour l’instant, dis-moi ce qui n’allait pas.
            </span>
          </div>
        </div>
      </>
    );
  }

  // ── Réglages : dans la zone de droite, pas en surimpression de la liste ──
  function Reglages() {
    return (
      <>
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-white flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-800 leading-tight">Jusqu’où tu me laisses aller</p>
            <p className="text-xs text-slate-400">
              Commence par « Je te demande ». Quand une famille ne te surprend plus, passe-la en autonomie.
            </p>
          </div>
          <button onClick={() => setReglages(false)} className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 grid place-items-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-white">
          {Object.keys(modes).sort((a, b) => meta(a).label.localeCompare(meta(b).label)).map((cat) => {
            const m = modes[cat];
            const e = effet(cat);
            return (
              <div key={cat} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${meta(cat).badge}`}>{meta(cat).label}</span>
                    {e.risque === "sensible" && (
                      <span className="text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2 py-0.5">à surveiller</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 mt-1">{e.geste}</p>
                  <p className={`text-xs mt-0.5 ${m === "auto" ? "text-amber-700" : "text-slate-400"}`}>
                    {MODE_SENS[m]}{m === "auto" && e.risque === "sensible" && " ⚠️ rien ne repassera devant toi."}
                  </p>
                </div>
                <div className="inline-flex rounded-xl ring-1 ring-slate-200 overflow-hidden shrink-0 self-start">
                  {(["off", "suggest", "auto"] as Mode[]).map((mm) => (
                    <button
                      key={mm} onClick={() => changeMode(cat, mm)} title={MODE_SENS[mm]}
                      className={`px-3 py-1.5 text-xs font-medium transition whitespace-nowrap ${
                        m === mm
                          ? mm === "off" ? "bg-slate-700 text-white"
                            : mm === "auto" ? "bg-amber-500 text-white"
                            : "bg-[var(--brand)] text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"}`}
                    >
                      {MODE_LABEL[mm]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }
}

// ── Briques de la conversation ──────────────────────────────────────────────
// Junior parle à gauche, dans une bulle neutre : ce qu'il dit n'appelle pas
// d'action. Une « demande » est visuellement autre chose — c'est la seule forme
// qui porte des boutons, pour qu'on ne confonde jamais un compte rendu avec du
// travail qui attend.
function Bulle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 items-end max-w-[92%]">
      <span className="w-7 h-7 shrink-0 rounded-lg bg-[var(--brand)] text-white grid place-items-center text-[11px] font-semibold mb-0.5">J</span>
      <div className="rounded-2xl rounded-bl-md bg-white ring-1 ring-slate-200/70 px-4 py-3 min-w-0">{children}</div>
    </div>
  );
}

// Ta bulle : à droite, à ta couleur. Ce que tu écris ne doit jamais ressembler à
// ce que Junior dit — sinon on ne sait plus qui parle dans la conversation.
// ── La réponse qu'il propose : lisible et envoyable sans quitter l'écran ────
//
// Le lien « Relire le brouillon » ouvrait Outlook : deux applications, un
// aller-retour, et des réponses qui ne partaient jamais — neuf brouillons oubliés
// purgés le 17/07, dont une réponse à un client qui n'a jamais rien reçu. Le texte
// s'affiche donc ici, et l'envoi tient en un clic (Martin 2026-07-24).
function Proposition({
  logId, hotel, quel, titre, lien, onFait,
}: {
  logId: string; hotel: string; quel: "client" | "gaetan"; titre: string; lien?: string; onFait: () => void;
}) {
  const [texte, setTexte] = useState<string | null>(null);
  const [absent, setAbsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replie, setReplie] = useState(false);

  useEffect(() => {
    let vivant = true;
    (async () => {
      const headers = await authHeaders();
      if (!headers) return;
      const r = await fetch(`/api/mail-assistant/draft?hotel=${hotel}&id=${logId}&quel=${quel}`, { headers });
      const j = await r.json().catch(() => ({}));
      if (!vivant) return;
      if (r.ok && j.ok) setTexte(j.texte as string); else setAbsent(true);
    })();
    return () => { vivant = false; };
  }, [logId, hotel, quel]);

  const decider = async (decision: "send" | "discard") => {
    setBusy(true);
    const headers = await authHeaders();
    if (!headers) { setBusy(false); return; }
    const r = await fetch(`/api/mail-assistant/draft?hotel=${hotel}`, {
      method: "POST", headers, body: JSON.stringify({ id: logId, quel, decision }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      toast.success(decision === "send" ? "C’est parti !" : "Brouillon jeté");
      setReplie(true); onFait();
    } else toast.error(j.error || "Ça a coincé");
    setBusy(false);
  };

  if (absent || replie) return null;

  return (
    <div className="flex gap-2.5 items-end max-w-[92%]">
      <span className="w-7 h-7 shrink-0 rounded-lg bg-[var(--brand)] text-white grid place-items-center text-[11px] font-semibold mb-0.5">J</span>
      <div className="rounded-2xl rounded-bl-md bg-white ring-1 ring-slate-200 overflow-hidden min-w-0">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{titre}</p>
          {lien && (
            <a href={lien} target="_blank" rel="noreferrer" className="ml-auto text-[11.5px] text-slate-400 hover:text-slate-600 inline-flex items-center gap-1">
              Modifier <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        {texte === null ? (
          <p className="px-4 pb-3 text-[13px] text-slate-400">Je relis ce que j’ai écrit…</p>
        ) : (
          <>
            <p className="px-4 pb-3 text-[14px] text-slate-700 whitespace-pre-line leading-relaxed">{texte}</p>
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
              <button
                onClick={() => decider("send")} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white px-3.5 h-9 text-[13px] font-semibold disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Envoie-le
              </button>
              <button
                onClick={() => decider("discard")} disabled={busy}
                className="text-[13px] text-slate-500 hover:text-rose-600 px-2"
              >
                Non, jette-le
              </button>
              <span className="ml-auto text-[11px] text-slate-400">Signé et prêt à partir.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BulleMoi({ qui, children }: { qui?: string; children: React.ReactNode }) {
  const initiale = (qui || "M").trim()[0]?.toUpperCase() || "M";
  return (
    <div className="flex gap-2.5 items-end justify-end">
      <div className="rounded-2xl rounded-br-md bg-[var(--brand-bg)] ring-1 ring-[var(--brand)]/20 px-4 py-3 min-w-0 max-w-[92%] space-y-2.5">
        {children}
      </div>
      <span className="w-7 h-7 shrink-0 rounded-lg bg-white ring-1 ring-slate-200 text-slate-500 grid place-items-center text-[11px] font-semibold mb-0.5">
        {initiale}
      </span>
    </div>
  );
}

// ── Ce qu'il aurait dû en faire, dit comme à la réception ───────────────────
//
// On demandait deux choses — une « famille » et une « action » — dans le
// vocabulaire du code : Résa Swile, Note de prise en charge, Rapport PMS. Trente
// étiquettes à l'écran, et rien qui parle à quelqu'un qui tient le desk (Martin
// 2026-07-24 : « pense aux équipes, est-ce que ça va leur parler »).
//
// On ne pose donc plus qu'UNE question, avec les réponses que quelqu'un donnerait
// à voix haute. Chacune porte le couple famille/action que Junior comprend : la
// traduction se fait ici, pas dans la tête de la personne.
const REPONSES: { v: string; label: string; sous: string }[] = [
  { v: "spam_alert|delete",           label: "C’était de la pub",            sous: "à la corbeille" },
  { v: "client_msg|draft_reply",      label: "Un client écrit",              sous: "il faut lui répondre" },
  { v: "commercial|commercial_followup", label: "Une demande de groupe",     sous: "séminaire, mariage, devis" },
  { v: "resa_ota|resa_control",       label: "Une réservation",              sous: "à contrôler avant de classer" },
  { v: "facture|route_pennylane",     label: "Une facture fournisseur",      sous: "à envoyer en compta" },
  { v: "facture_ota|invoice_note",    label: "On nous réclame une facture",  sous: "à préparer pour l’agence" },
  { v: "candidature|draft_reply",     label: "Une candidature",              sous: "réponse « effectifs au complet »" },
  { v: "autre|archive",               label: "Rien à faire, juste à classer", sous: "on le garde, sans suite" },
  { v: "autre|none",                  label: "Laisse, on s’en occupe",       sous: "il n’y touche pas" },
];

function Choix({ valeur, onChange }: { valeur: string; onChange: (v: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  const choisi = REPONSES.find((o) => o.v === valeur);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => { if (!boite.current?.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: KeyboardEvent) => { if (e.key === "Escape") setOuvert(false); };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => { document.removeEventListener("mousedown", dehors); document.removeEventListener("keydown", echap); };
  }, [ouvert]);

  return (
    <div className="relative" ref={boite}>
      <button
        onClick={() => setOuvert((v) => !v)}
        className="w-full flex items-center gap-2 rounded-xl bg-white/80 ring-1 ring-slate-200 hover:ring-slate-300 px-3.5 h-11 text-left transition"
      >
        <span className="flex-1 min-w-0">
          {choisi ? (
            <>
              <span className="block text-[14px] font-medium text-slate-800 truncate">{choisi.label}</span>
              <span className="block text-[11.5px] text-slate-400 truncate -mt-0.5">{choisi.sous}</span>
            </>
          ) : (
            <span className="text-[14px] text-slate-400">Qu’est-ce qu’il aurait dû en faire ?</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition ${ouvert ? "rotate-180" : ""}`} />
      </button>

      {ouvert && (
        <div className="absolute z-20 left-0 right-0 mt-1.5 rounded-xl bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden py-1">
          {choisi && (
            <button
              onClick={() => { onChange(""); setOuvert(false); }}
              className="w-full text-left px-3.5 py-2 text-[13px] text-slate-400 hover:bg-slate-50"
            >
              Aucune de ces réponses — je lui explique juste
            </button>
          )}
          {REPONSES.map((o) => (
            <button
              key={o.v}
              onClick={() => { onChange(o.v); setOuvert(false); }}
              className={`w-full text-left px-3.5 py-2 flex items-center gap-2 transition ${
                o.v === valeur ? "bg-[var(--brand-bg)]" : "hover:bg-slate-50"}`}
            >
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] text-slate-800">{o.label}</span>
                <span className="block text-[11.5px] text-slate-400 -mt-0.5">{o.sous}</span>
              </span>
              {o.v === valeur && <Check className="w-4 h-4 text-[var(--brand)] shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Demande({ titre, ton = "action", children }: { titre: string; ton?: "action" | "alerte"; children: React.ReactNode }) {
  const alerte = ton === "alerte";
  return (
    <div className="flex gap-2.5 items-end max-w-[92%]">
      <span className="w-7 h-7 shrink-0 rounded-lg bg-[var(--brand)] text-white grid place-items-center text-[11px] font-semibold mb-0.5">J</span>
      <div
        className={`rounded-2xl rounded-bl-md px-4 py-3 min-w-0 border-l-[3px] ${
          alerte ? "bg-rose-50 border-rose-400 ring-1 ring-rose-100" : "bg-[var(--brand-bg)] border-[var(--brand)]"}`}
      >
        <p className={`text-[10.5px] font-bold uppercase tracking-wider mb-1.5 ${alerte ? "text-rose-600" : "text-[var(--brand)]"}`}>
          {titre}
        </p>
        {children}
      </div>
    </div>
  );
}
