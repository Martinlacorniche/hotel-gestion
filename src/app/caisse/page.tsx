"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ThemedBackground } from "@/components/ThemedBackground";
import { supabase } from "@/lib/supabaseClient";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useSelectedHotel } from "@/context/SelectedHotelContext";
import {
  Euro, Printer, Lock, Save, Sun, Sunset,
  ChevronLeft, ChevronRight, AlertCircle, Coins,
  Loader2,
} from "lucide-react";
import { format as dfFormat, addDays, parseISO } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { SignaturePadModal } from "@/components/SignaturePadModal";

// --- TYPES ---

type ShiftType = "matin" | "soir";

type CaisseShift = {
  id?: string;
  hotel_id: string;
  date_jour: string;
  shift_type: ShiftType;
  user_id: string | null;
  user_name: string | null;
  pms_tpe: number; pms_amex: number; pms_especes: number; pms_ancv: number; pms_virement: number;
  reel_tpe: number; reel_amex: number; reel_especes: number; reel_ancv: number; reel_virement: number;
  pms_consigne: number; reel_consigne: number | null;
  commentaire: string | null;
  fond_compte_fin: number | null;
  valide: boolean;
  signature_data: string | null;
  signed_by_user_id: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
};

type Comptage = {
  hotel_id: string;
  date_jour: string;
  billets: Record<string, number>;
  pieces: Record<string, number>;
};

const BILLET_DENOMS = [500, 200, 100, 50, 20, 10, 5];
const PIECE_DENOMS = [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

const SHIFT_LABELS: Record<ShiftType, string> = {
  matin: "Shift Matin",
  soir: "Shift Soir",
};

const SHIFT_ICONS: Record<ShiftType, React.ComponentType<any>> = {
  matin: Sun,
  soir: Sunset,
};

const SHIFT_COLORS: Record<ShiftType, { bg: string; text: string; border: string; btn: string; accent: string }> = {
  matin:   { bg: "bg-amber-50/40",   text: "text-amber-700",   border: "border-amber-200/70",   btn: "bg-amber-600 hover:bg-amber-700",   accent: "bg-amber-500" },
  soir:    { bg: "bg-orange-50/40",  text: "text-orange-700",  border: "border-orange-200/70",  btn: "bg-orange-600 hover:bg-orange-700", accent: "bg-orange-500" },
};

const emptyShift = (hotel_id: string, date_jour: string, shift_type: ShiftType): CaisseShift => ({
  hotel_id, date_jour, shift_type,
  user_id: null, user_name: null,
  pms_tpe: 0, pms_amex: 0, pms_especes: 0, pms_ancv: 0, pms_virement: 0,
  reel_tpe: 0, reel_amex: 0, reel_especes: 0, reel_ancv: 0, reel_virement: 0,
  pms_consigne: 0, reel_consigne: null,
  commentaire: "", fond_compte_fin: null, valide: false,
  signature_data: null, signed_by_user_id: null, signed_by_name: null, signed_at: null,
});

const emptyComptage = (hotel_id: string, date_jour: string): Comptage => ({
  hotel_id, date_jour,
  billets: Object.fromEntries(BILLET_DENOMS.map((d) => [String(d), 0])),
  pieces: Object.fromEntries(PIECE_DENOMS.map((d) => [String(d), 0])),
});

const fmtEur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// --- COMPONENT ---

function CaissePageInner() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const isAdmin = (user as any)?.role === "admin" || (user as any)?.role === "superadmin";

  // Hôtel sélectionné = contexte global (synchro avec le toggle du rail/burger).
  const { selectedHotelId: hotelId, setSelectedHotelId: setHotelId } = useSelectedHotel();
  const [hotelName, setHotelName] = useState<string>("");
  const [hotels, setHotels] = useState<{ id: string; nom: string }[]>([]);
  const [dateJour, setDateJour] = useState<string>(dfFormat(new Date(), "yyyy-MM-dd"));
  // Encaissé Stripe NET du jour (réglés − remboursés), figé à l'ouverture de la page.
  const [stripeDayNet, setStripeDayNet] = useState<number>(0);

  const [fondCible, setFondCible] = useState<number>(0);
  const [fondCibleDraft, setFondCibleDraft] = useState<number>(0);
  const [fondDebutJour, setFondDebutJour] = useState<number>(0);

  const [shifts, setShifts] = useState<Record<ShiftType, CaisseShift>>({
    matin: emptyShift("", "", "matin"),
    soir: emptyShift("", "", "soir"),
  });

  const [comptage, setComptage] = useState<Comptage>(emptyComptage("", ""));
  const [comptageId, setComptageId] = useState<string | null>(null);
  // Date du comptage J-1 dont on a pré-rempli les billets/pièces (null = saisie vierge)
  const [prefilledFromDate, setPrefilledFromDate] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingShift, setSavingShift] = useState<ShiftType | null>(null);
  const [comptageStatus, setComptageStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const comptageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosaveRef = useRef<boolean>(false);
  const [signingShift, setSigningShift] = useState<ShiftType | null>(null);

  // --- Init hotel ---
  // Le contexte restaure déjà l'hôtel (localStorage). Ici : priorité au deep-link
  // ?hotel_id=, sinon défaut sur l'hôtel du user si rien n'est encore sélectionné.
  useEffect(() => {
    (async () => {
      const fromQS = searchParams?.get("hotel_id");
      if (fromQS) { setHotelId(fromQS); return; }
      if (hotelId) return;
      const { data: authRes } = await supabase.auth.getUser();
      if (authRes?.user?.id) {
        const { data: u } = await supabase.from("users").select("hotel_id").eq("id_auth", authRes.user.id).maybeSingle();
        if (u?.hotel_id) setHotelId(u.hotel_id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("hotels").select("id, nom").order("nom", { ascending: true });
      setHotels(data || []);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!hotelId) { setHotelName(""); return; }
      const { data } = await supabase.from("hotels").select("nom").eq("id", hotelId).maybeSingle();
      setHotelName(data?.nom || "");
    })();
  }, [hotelId]);

  useEffect(() => { document.title = "Caisse"; }, []);

  // --- Load fond cible ---
  useEffect(() => {
    (async () => {
      if (!hotelId) return;
      const { data } = await supabase.from("caisse_config").select("fond_cible").eq("hotel_id", hotelId).maybeSingle();
      const v = Number(data?.fond_cible || 0);
      setFondCible(v);
      setFondCibleDraft(v);
    })();
  }, [hotelId]);

  // --- Load shifts + comptage + fond début (= total comptage J-1) ---
  useEffect(() => {
    (async () => {
      if (!hotelId || !dateJour) return;
      setLoading(true);

      const [{ data: shiftRows }, { data: cpt }, { data: prevCpt }] = await Promise.all([
        supabase.from("caisse_shifts").select("*").eq("hotel_id", hotelId).eq("date_jour", dateJour),
        supabase.from("caisse_comptage").select("*").eq("hotel_id", hotelId).eq("date_jour", dateJour).maybeSingle(),
        supabase.from("caisse_comptage").select("billets, pieces, date_jour").eq("hotel_id", hotelId).lt("date_jour", dateJour).order("date_jour", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const map: Record<ShiftType, CaisseShift> = {
        matin: emptyShift(hotelId, dateJour, "matin"),
        soir: emptyShift(hotelId, dateJour, "soir"),
      };
      (shiftRows || []).forEach((r: any) => {
        // Les anciennes lignes 'cloture' (shift retiré) sont ignorées au chargement.
        if (r.shift_type === "matin" || r.shift_type === "soir") {
          map[r.shift_type as ShiftType] = {
            ...emptyShift(hotelId, dateJour, r.shift_type),
            ...r,
            commentaire: r.commentaire || "",
          };
        }
      });
      setShifts(map);

      skipNextAutosaveRef.current = true;
      if (cpt) {
        setComptage({
          hotel_id: hotelId,
          date_jour: dateJour,
          billets: { ...emptyComptage("", "").billets, ...(cpt.billets || {}) },
          pieces: { ...emptyComptage("", "").pieces, ...(cpt.pieces || {}) },
        });
        setComptageId(cpt.id || null);
        setComptageStatus("saved");
        setPrefilledFromDate(null);
      } else {
        // Aucun comptage pour ce jour → pré-remplir avec le dernier comptage connu (J-1)
        // pour éviter de tout retaper si rien n'a bougé dans la caisse depuis hier.
        // Status reste "idle" : l'employé doit modifier OU valider explicitement pour persister.
        const base = emptyComptage(hotelId, dateJour);
        if (prevCpt && prevCpt.date_jour) {
          base.billets = { ...base.billets, ...(prevCpt.billets || {}) };
          base.pieces = { ...base.pieces, ...(prevCpt.pieces || {}) };
          setPrefilledFromDate(prevCpt.date_jour);
        } else {
          setPrefilledFromDate(null);
        }
        setComptage(base);
        setComptageId(null);
        setComptageStatus("idle");
      }

      // Fond début de journée = total comptage J-1 (dernier connu) ; fallback : fond cible
      let total = 0;
      if (prevCpt) {
        BILLET_DENOMS.forEach((d) => { total += d * Number((prevCpt.billets || {})[String(d)] || 0); });
        PIECE_DENOMS.forEach((d) => { total += d * Number((prevCpt.pieces || {})[String(d)] || 0); });
      }
      setFondDebutJour(round2(total));

      setLoading(false);
    })();
  }, [hotelId, dateJour]);

  // --- Encaissé Stripe NET du jour (réglés − remboursés), snapshot à l'ouverture ---
  useEffect(() => {
    if (!hotelId || !dateJour) { setStripeDayNet(0); return; }
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("amount, status, paid_at, refunded_at")
        .eq("hotel_id", hotelId)
        .in("status", ["paid", "refunded"]);
      let net = 0;
      (data || []).forEach((p: any) => {
        if (p.paid_at && String(p.paid_at).slice(0, 10) === dateJour) net += Number(p.amount) || 0;
        if (p.status === "refunded" && p.refunded_at && String(p.refunded_at).slice(0, 10) === dateJour) net -= Number(p.amount) || 0;
      });
      setStripeDayNet(round2(net));
    })();
  }, [hotelId, dateJour]);

  // --- Helpers ---
  const updateShift = (s: ShiftType, patch: Partial<CaisseShift>) => {
    setShifts((prev) => ({ ...prev, [s]: { ...prev[s], ...patch } }));
  };

  const updateBillet = (denom: number, qty: number) => {
    setComptage((prev) => ({ ...prev, billets: { ...prev.billets, [String(denom)]: qty } }));
  };

  const updatePiece = (denom: number, qty: number) => {
    setComptage((prev) => ({ ...prev, pieces: { ...prev.pieces, [String(denom)]: qty } }));
  };

  // --- Computed totals per shift ---
  const totalsFor = (sh: CaisseShift) => {
    // € consigne : figé si shift validé, sinon net Stripe du jour en direct.
    const consigneReel = sh.valide && sh.reel_consigne != null ? sh.reel_consigne : stripeDayNet;
    const consignePms = sh.pms_consigne || 0;
    const totalPmsBrut = sh.pms_tpe + sh.pms_amex + sh.pms_especes + sh.pms_ancv + sh.pms_virement + consignePms;
    const totalReelBrut = sh.reel_tpe + sh.reel_amex + sh.reel_especes + sh.reel_ancv + sh.reel_virement + consigneReel;
    const ecartTpe = round2(sh.reel_tpe - sh.pms_tpe);
    const ecartAmex = round2(sh.reel_amex - sh.pms_amex);
    const ecartEsp = round2(sh.reel_especes - sh.pms_especes);
    const ecartAncv = round2(sh.reel_ancv - sh.pms_ancv);
    const ecartVir = round2(sh.reel_virement - sh.pms_virement);
    const ecartConsigne = round2(consigneReel - consignePms);
    const ecartTotal = round2(totalReelBrut - totalPmsBrut);
    return {
      totalPmsBrut: round2(totalPmsBrut),
      totalReelBrut: round2(totalReelBrut),
      consigneReel: round2(consigneReel),
      ecartTpe, ecartAmex, ecartEsp, ecartAncv, ecartVir, ecartConsigne, ecartTotal,
    };
  };

  // Comptage totals
  const comptageTotals = useMemo(() => {
    let totalBillets = 0;
    BILLET_DENOMS.forEach((d) => { totalBillets += d * (Number(comptage.billets[String(d)]) || 0); });
    let totalPieces = 0;
    PIECE_DENOMS.forEach((d) => { totalPieces += d * (Number(comptage.pieces[String(d)]) || 0); });
    const totalCompte = round2(totalBillets + totalPieces);
    return {
      totalBillets: round2(totalBillets),
      totalPieces: round2(totalPieces),
      totalCompte,
      ecartCible: round2(totalCompte - fondCible),
      ecartDebut: round2(totalCompte - fondDebutJour),
    };
  }, [comptage, fondCible, fondDebutJour]);

  // --- Day totals (encaissements) ---
  const dayTotals = useMemo(() => {
    const sum = (k: keyof CaisseShift) =>
      (shifts.matin[k] as number || 0) + (shifts.soir[k] as number || 0);
    // Stripe = encaissement du jour, compté UNE SEULE FOIS (pas par shift).
    const totalReel = sum("reel_tpe") + sum("reel_amex") + sum("reel_especes") + sum("reel_ancv") + sum("reel_virement") + stripeDayNet;
    const totalPms = sum("pms_tpe") + sum("pms_amex") + sum("pms_especes") + sum("pms_ancv") + sum("pms_virement") + sum("pms_consigne");
    return {
      totalReel: round2(totalReel),
      totalPms: round2(totalPms),
      ecart: round2(totalReel - totalPms),
    };
  }, [shifts, stripeDayNet]);

  // --- Save shift ---
  // signature = dataURL PNG fourni par la modale au moment de la validation.
  // null = pas de validation (enregistrement simple) ou réouverture admin (efface la signature).
  const saveShift = async (s: ShiftType, valide: boolean, signature: string | null = null) => {
    if (!hotelId) return;
    setSavingShift(s);
    const sh = shifts[s];
    const meName = (user as any)?.name || user?.email || null;
    const meId = user?.id || null;

    const payload: any = {
      hotel_id: hotelId,
      date_jour: dateJour,
      shift_type: s,
      user_id: sh.user_id || meId,
      user_name: sh.user_name || meName,
      pms_tpe: sh.pms_tpe, pms_amex: sh.pms_amex, pms_especes: sh.pms_especes, pms_ancv: sh.pms_ancv, pms_virement: sh.pms_virement,
      reel_tpe: sh.reel_tpe, reel_amex: sh.reel_amex, reel_especes: sh.reel_especes, reel_ancv: sh.reel_ancv, reel_virement: sh.reel_virement,
      pms_consigne: sh.pms_consigne,
      // € consigne : figé au net Stripe du moment à la validation (sinon vit en direct)
      reel_consigne: valide ? stripeDayNet : sh.reel_consigne,
      commentaire: sh.commentaire,
      // À la validation, on fige le fond compté = total comptage live
      fond_compte_fin: valide ? comptageTotals.totalCompte : sh.fond_compte_fin,
      valide,
      // Signature : posée à la validation, effacée à la réouverture
      signature_data: valide ? signature : null,
      signed_by_user_id: valide ? meId : null,
      signed_by_name: valide ? meName : null,
      signed_at: valide ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
      .from("caisse_shifts")
      .upsert(payload, { onConflict: "hotel_id,date_jour,shift_type" })
      .select()
      .single();

    setSavingShift(null);
    if (error) { toast.error("Erreur enregistrement : " + error.message); return; }
    if (data) {
      updateShift(s, {
        id: data.id, user_id: data.user_id, user_name: data.user_name, valide: data.valide,
        fond_compte_fin: data.fond_compte_fin,
        signature_data: data.signature_data,
        signed_by_user_id: data.signed_by_user_id,
        signed_by_name: data.signed_by_name,
        signed_at: data.signed_at,
      });
    }
  };

  const handleSignatureValidate = async (dataUrl: string) => {
    if (!signingShift) return;
    const s = signingShift;
    setSigningShift(null);
    await saveShift(s, true, dataUrl);
  };

  // --- Save comptage (auto-save debounced) ---
  const saveComptage = async () => {
    if (!hotelId) return;
    setComptageStatus("saving");
    const meName = (user as any)?.name || user?.email || null;
    const payload: any = {
      hotel_id: hotelId,
      date_jour: dateJour,
      billets: comptage.billets,
      pieces: comptage.pieces,
      total_compte: comptageTotals.totalCompte,
      updated_by: meName,
    };
    const { data, error } = await supabase
      .from("caisse_comptage")
      .upsert(payload, { onConflict: "hotel_id,date_jour" })
      .select()
      .single();
    if (error) { setComptageStatus("dirty"); console.error("Erreur comptage : " + error.message); return; }
    if (data?.id) setComptageId(data.id);
    setComptageStatus("saved");
  };

  // Trigger auto-save when comptage changes (debounced)
  useEffect(() => {
    if (!hotelId) return;
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return; }
    setComptageStatus("dirty");
    if (comptageDebounceRef.current) clearTimeout(comptageDebounceRef.current);
    comptageDebounceRef.current = setTimeout(() => { saveComptage(); }, 800);
    return () => { if (comptageDebounceRef.current) clearTimeout(comptageDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comptage.billets, comptage.pieces]);

  // --- Save fond cible (admin) ---
  const saveFondCible = async () => {
    if (!isAdmin || !hotelId) return;
    const { error } = await supabase
      .from("caisse_config")
      .upsert({ hotel_id: hotelId, fond_cible: fondCibleDraft }, { onConflict: "hotel_id" });
    if (error) { toast.error("Erreur : " + error.message); return; }
    setFondCible(fondCibleDraft);
  };

  // --- Date nav ---
  const changeDate = (delta: number) => {
    const d = new Date(dateJour + "T00:00:00");
    setDateJour(dfFormat(addDays(d, delta), "yyyy-MM-dd"));
  };

  // --- Render ---
  const dateLabel = useMemo(() => {
    try { return dfFormat(new Date(dateJour + "T00:00:00"), "EEEE d MMMM yyyy", { locale: frLocale }); }
    catch { return dateJour; }
  }, [dateJour]);

  return (
    <div className="min-h-screen font-sans text-slate-900 relative">
      <ThemedBackground />
      {/* Print styles — 1 page A4 paysage, ultra compact */}
      <style jsx global>{`
        /* Grille encaissements (header + lignes + total alignés sur les mêmes colonnes) */
        .enc-grid { display: grid; grid-template-columns: 92px 88px 88px 58px; gap: 8px; }

        @media print {
          @page { size: A4 landscape; margin: 6mm; }
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 9px !important; min-height: 0 !important; }
          .min-h-screen { min-height: 0 !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }

          /* Wrapper : zéro padding, faible interligne */
          .caisse-content { padding: 0 !important; margin: 0 !important; }
          .caisse-content > * + * { margin-top: 2mm !important; }
          .caisse-content > .space-y-5 > * + *, .caisse-content.space-y-5 > * + * { margin-top: 2mm !important; }
          /* Surcharge la classe Tailwind space-y-5 */
          .space-y-5 > :not([hidden]) ~ :not([hidden]) { margin-top: 2mm !important; }

          /* Cartes */
          .shift-card, .comptage-card { box-shadow: none !important; border: 1px solid #94a3b8 !important; break-inside: avoid; page-break-inside: avoid; border-radius: 4px !important; }
          .shift-card .card-header, .comptage-card .card-header { padding: 3px 6px !important; }
          .shift-card .card-body { padding: 4px 6px !important; gap: 3px !important; }
          .shift-card .card-body > * + * { margin-top: 3px !important; }

          /* Comptage : layout 3 colonnes forcé + denoms en 2 colonnes internes */
          .comptage-card .card-body {
            padding: 4px 6px !important;
            display: grid !important;
            grid-template-columns: 2fr 2fr 1.1fr !important;
            gap: 6px !important;
          }
          .comptage-card .card-body > * { margin: 0 !important; }
          .denom-list { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 2px 6px !important; }
          .denom-row {
            padding: 0 3px !important;
            font-size: 9px !important;
            border: none !important;
            background: transparent !important;
            gap: 4px !important;
          }
          .denom-row > .denom-chip { min-width: 38px !important; height: 14px !important; padding: 0 3px !important; font-size: 9px !important; border-radius: 3px !important; }
          .denom-row > .denom-mult { display: none !important; }
          .denom-input { height: 14px !important; padding: 0 3px !important; font-size: 9px !important; max-width: 38px !important; min-width: 28px !important; border-radius: 3px !important; }
          .denom-row > .denom-sub { font-size: 9px !important; min-width: 38px !important; }

          /* Total card : compact + désactiver accents décoratifs */
          .total-print {
            padding: 4px 6px !important;
            background: white !important;
            border: 1px solid #94a3b8 !important;
            box-shadow: none !important;
            border-radius: 4px !important;
            overflow: hidden !important;
          }
          .total-print > div.absolute { display: none !important; }
          .total-print .pl-2 { padding-left: 0 !important; }
          .total-print .total-big { font-size: 16px !important; line-height: 1.1 !important; }
          .total-print .total-label { font-size: 8px !important; }
          .total-print .total-meta { font-size: 7.5px !important; gap: 4px !important; }

          .ecart-print { padding: 3px 6px !important; border-width: 1px !important; border-radius: 4px !important; }
          .ecart-print .ecart-label { font-size: 7.5px !important; }
          .ecart-print .ecart-val { font-size: 11px !important; }

          /* Shifts (encaissements) */
          .print-grid-3 { display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; gap: 3mm !important; }
          .enc-grid { grid-template-columns: 50px 1fr 1fr 38px !important; gap: 3px !important; }
          .enc-row { padding: 0 !important; font-size: 9px !important; }
          .enc-row > span:first-child { height: 14px !important; padding: 0 3px !important; font-size: 9px !important; }
          .enc-input { height: 14px !important; padding: 0 3px !important; font-size: 9px !important; }
          .ec-text { font-size: 9px !important; }

          /* Titres + tailles */
          .pg-title { font-size: 11px !important; }
          .pg-h1 { font-size: 12px !important; }
          .pg-h2 { font-size: 9px !important; margin-bottom: 2px !important; }
          .pg-big { font-size: 12px !important; }

          textarea { font-size: 8.5px !important; min-height: 16px !important; padding: 2px 4px !important; }
          input, textarea { border-color: #cbd5e1 !important; background: white !important; }

          .signature-zone { display: block !important; padding-top: 2px !important; margin-top: 2px !important; }
          /* Ligne vide (signature absente) : conserve 18px ; image (signature présente) : 14mm max */
          .signature-zone > div.h-10 { height: 18px !important; }
          .signature-zone .signature-img-wrap { height: 14mm !important; display: flex !important; align-items: end !important; }
          .signature-zone .signature-img { max-height: 14mm !important; max-width: 100% !important; }
        }
        .print-only { display: none; }
        .signature-zone { display: none; }
      `}</style>

      {/* Header — sobre, sans pill, sticky */}
      <div className="no-print h-16 flex items-center justify-between px-6 md:px-10 gap-6 sticky top-0 bg-white/75 backdrop-blur-xl z-30 border-b border-slate-200/60">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2.5">
            <Euro className="w-[18px] h-[18px] text-emerald-600" strokeWidth={2.5} />
            <h1 className="text-[15px] font-semibold text-slate-900 tracking-tight">Caisse</h1>
          </div>
          {hotelName && <><span className="text-slate-300">·</span><span className="text-[13px] font-medium text-slate-600">{hotelName}</span></>}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => changeDate(-1)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-slate-200/60 transition">
              <ChevronLeft className="w-4 h-4 text-slate-500" />
            </button>
            <input
              type="date"
              value={dateJour}
              onChange={(e) => setDateJour(e.target.value)}
              className="px-2 h-8 text-[13px] font-medium text-slate-700 bg-transparent outline-none cursor-pointer rounded-md hover:bg-slate-200/60 transition"
            />
            <button onClick={() => changeDate(1)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-slate-200/60 transition">
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-[0_1px_0_rgba(0,0,0,0.02)] hover:border-slate-300 hover:bg-slate-50 transition">
            <Printer className="w-3.5 h-3.5" /> Imprimer
          </button>
        </div>
      </div>

      <div className="caisse-content max-w-[1400px] mx-auto px-4 md:px-8 py-6 space-y-5">
        {/* Print header */}
        <div className="print-only">
          <div className="flex justify-between items-end border-b border-slate-300 pb-2 mb-3">
            <div>
              <h1 className="text-lg font-extrabold">Feuille de caisse — {hotelName}</h1>
              <p className="text-xs text-slate-600 capitalize">{dateLabel}</p>
            </div>
            <div className="text-xs text-slate-600">
              Fond cible : <strong>{fmtEur(fondCible)}</strong> · Caisse début : <strong>{fmtEur(fondDebutJour)}</strong>
            </div>
          </div>
        </div>

        {/* Hero — date + chiffre principal + KPIs secondaires */}
        {(() => {
          const ecartOk = Math.abs(dayTotals.ecart) < 0.01;
          return (
            <div className="no-print relative rounded-3xl bg-white border border-slate-200/60 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] overflow-hidden">
              {/* Décor subtil — halo emerald derrière le chiffre */}
              <div className="absolute -top-32 -left-20 w-96 h-96 rounded-full bg-emerald-500/[0.04] blur-3xl pointer-events-none" />
              <div className="relative px-8 py-7 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-7 items-end">
                {/* Bloc gauche : date + chiffre principal */}
                <div className="min-w-0">
                  <div className="text-[12px] text-slate-500 capitalize font-medium">{dateLabel}</div>
                  <div className="mt-0.5 text-[13px] font-semibold text-slate-800">{hotelName || "—"}</div>
                  <div className="mt-5 flex items-baseline gap-3 flex-wrap">
                    <div className="text-[44px] leading-none font-semibold tracking-tight text-slate-900 tabular-nums">
                      {fmtEur(dayTotals.totalReel)}
                    </div>
                    <div className="text-[13px] text-slate-500 font-medium">encaissé aujourd'hui</div>
                  </div>
                  <div className="mt-3.5 inline-flex items-center gap-2.5">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full text-[12px] font-semibold ring-1 ${
                      ecartOk
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200/60"
                        : dayTotals.ecart > 0
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200/60"
                          : "bg-rose-50 text-rose-700 ring-rose-200/60"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ecartOk ? "bg-emerald-500" : dayTotals.ecart > 0 ? "bg-emerald-500" : "bg-rose-500"}`} />
                      {ecartOk ? "Aucun écart" : `Écart ${fmtEur(dayTotals.ecart)}`}
                    </span>
                    <span className="text-[12px] text-slate-400 tabular-nums">PMS {fmtEur(dayTotals.totalPms)}</span>
                  </div>
                </div>

                {/* Bloc droit : Fond cible + Caisse début + Total PMS pour étoffer */}
                <div className="flex items-stretch gap-0 divide-x divide-slate-200/70 border border-slate-200/70 rounded-2xl bg-gradient-to-b from-white to-slate-50/40 shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
                  <div className="px-5 py-3.5 min-w-[140px]">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Fond cible</div>
                    {isAdmin ? (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input
                          type="number" step="0.01"
                          value={fondCibleDraft}
                          onChange={(e) => setFondCibleDraft(Number(e.target.value))}
                          className="w-20 text-[15px] font-semibold text-slate-900 bg-white border border-slate-200 rounded-md px-2 py-0.5 outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400 tabular-nums"
                        />
                        <button onClick={saveFondCible} className="inline-flex items-center justify-center h-6 w-6 rounded-md text-emerald-700 hover:bg-emerald-50 transition">
                          <Save className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 text-[18px] font-semibold text-slate-900 tabular-nums tracking-tight">{fmtEur(fondCible)}</div>
                    )}
                  </div>
                  <div className="px-5 py-3.5 min-w-[140px]">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Caisse début</div>
                    <div className="mt-1 text-[18px] font-semibold text-slate-900 tabular-nums tracking-tight">{fmtEur(fondDebutJour)}</div>
                  </div>
                  <div className="px-5 py-3.5 min-w-[140px]">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total PMS</div>
                    <div className="mt-1 text-[18px] font-semibold text-slate-900 tabular-nums tracking-tight">{fmtEur(dayTotals.totalPms)}</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* COMPTAGE PARTAGÉ — un seul bloc pour la journée (en haut, le + utilisé) */}
        <div className="comptage-card rounded-3xl border border-slate-200/60 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="card-header px-7 py-4 border-b border-slate-200/70 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Coins className="w-4 h-4 text-slate-400" strokeWidth={2.25} />
              <div>
                <div className="text-[14px] font-semibold text-slate-900">Comptage caisse</div>
                {prefilledFromDate && comptageStatus === "idle" ? (
                  <div className="text-[11px] text-amber-700 font-medium">
                    Pré-rempli depuis le {dfFormat(parseISO(prefilledFromDate), "d MMMM", { locale: frLocale })} — modifie si besoin
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">Saisie partagée, sauvegarde automatique</div>
                )}
              </div>
            </div>
            <div className="no-print flex items-center gap-2">
              {comptageStatus === "saving" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
                  <Loader2 className="w-3 h-3 animate-spin" /> Enregistrement
                </span>
              )}
              {comptageStatus === "saved" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Enregistré
                </span>
              )}
              {comptageStatus === "dirty" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Modifié
                </span>
              )}
            </div>
          </div>

          <div className="card-body p-6 grid grid-cols-1 lg:grid-cols-[230px_230px_minmax(0,1fr)] gap-x-10 gap-y-6 lg:items-start">
              {/* Billets */}
              <div>
                <div className="flex items-baseline justify-between mb-2.5 px-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pg-h2">Billets</div>
                  <div className="text-[12px] font-semibold text-slate-700 tabular-nums">{fmtEur(comptageTotals.totalBillets)}</div>
                </div>
                <div className="denom-list flex flex-col gap-px">
                  {BILLET_DENOMS.map((d) => {
                    const qty = Number(comptage.billets[String(d)] || 0);
                    const sub = round2(d * qty);
                    const active = qty > 0;
                    return (
                      <div key={d} className={`denom-row group flex items-center gap-2.5 px-1.5 py-[5px] rounded-md transition ${active ? "bg-emerald-50/40" : "hover:bg-slate-50"}`}>
                        <span className="denom-chip inline-flex items-center justify-center w-11 h-6 rounded-md bg-slate-900 text-white text-[11px] font-semibold tabular-nums shrink-0">{d}€</span>
                        <span className="denom-mult text-slate-300 select-none text-[11px]">×</span>
                        <input
                          type="number" inputMode="numeric" min={0} step={1}
                          value={qty || ""}
                          onChange={(e) => updateBillet(d, Number(e.target.value) || 0)}
                          placeholder="0"
                          className={`denom-input w-[60px] h-7 text-right text-[13px] font-medium tabular-nums px-2 rounded-md outline-none transition border ${active ? "bg-white border-slate-200" : "bg-slate-100/70 border-transparent group-hover:bg-white group-hover:border-slate-200"} focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 shrink-0`}
                        />
                        <span className={`denom-sub ml-auto text-right text-[12.5px] font-semibold tabular-nums ${active ? "text-slate-900" : "text-slate-300"}`}>{active ? fmtEur(sub) : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pièces */}
              <div>
                <div className="flex items-baseline justify-between mb-2.5 px-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pg-h2">Pièces</div>
                  <div className="text-[12px] font-semibold text-slate-700 tabular-nums">{fmtEur(comptageTotals.totalPieces)}</div>
                </div>
                <div className="denom-list flex flex-col gap-px">
                  {PIECE_DENOMS.map((d) => {
                    const qty = Number(comptage.pieces[String(d)] || 0);
                    const sub = round2(d * qty);
                    const active = qty > 0;
                    const label = d < 1 ? `${Math.round(d * 100)}c` : `${d}€`;
                    return (
                      <div key={d} className={`denom-row group flex items-center gap-2.5 px-1.5 py-[5px] rounded-md transition ${active ? "bg-emerald-50/40" : "hover:bg-slate-50"}`}>
                        <span className="denom-chip inline-flex items-center justify-center w-11 h-6 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold tabular-nums shrink-0">{label}</span>
                        <span className="denom-mult text-slate-300 select-none text-[11px]">×</span>
                        <input
                          type="number" inputMode="numeric" min={0} step={1}
                          value={qty || ""}
                          onChange={(e) => updatePiece(d, Number(e.target.value) || 0)}
                          placeholder="0"
                          className={`denom-input w-[60px] h-7 text-right text-[13px] font-medium tabular-nums px-2 rounded-md outline-none transition border ${active ? "bg-white border-slate-200" : "bg-slate-100/70 border-transparent group-hover:bg-white group-hover:border-slate-200"} focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 shrink-0`}
                        />
                        <span className={`denom-sub ml-auto text-right text-[12.5px] font-semibold tabular-nums ${active ? "text-slate-900" : "text-slate-300"}`}>{active ? fmtEur(sub) : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

            {/* Totaux + écarts (sticky à droite) */}
            <div className="w-full lg:max-w-[340px] lg:ml-auto space-y-2.5 self-start lg:sticky lg:top-20">
              <div className="total-print relative rounded-2xl bg-white border border-slate-200/70 px-5 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-emerald-500" />
                <div className="pl-2">
                  <div className="total-label text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total compté</div>
                  <div className="total-big text-[26px] font-semibold tabular-nums leading-none mt-1.5 tracking-tight text-slate-900">{fmtEur(comptageTotals.totalCompte)}</div>
                  <div className="total-meta mt-2 flex items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                    <span>cible <span className="text-slate-700 font-medium">{fmtEur(fondCible)}</span></span>
                    <span className="text-slate-300">·</span>
                    <span>début <span className="text-slate-700 font-medium">{fmtEur(fondDebutJour)}</span></span>
                  </div>
                </div>
              </div>

              {(() => {
                const ok = Math.abs(comptageTotals.ecartCible) < 0.01;
                return (
                  <div className={`ecart-print flex items-center justify-between px-4 py-2.5 rounded-xl border ${
                    ok ? "border-emerald-200/70 bg-emerald-50/50" : "border-rose-200/70 bg-rose-50/50"
                  }`}>
                    <span className={`ecart-label inline-flex items-center gap-2 text-[12px] font-medium ${ok ? "text-emerald-700" : "text-rose-700"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                      Écart / cible
                    </span>
                    <span className={`ecart-val text-[15px] font-semibold tabular-nums ${ok ? "text-emerald-800" : "text-rose-800"}`}>{ok ? "0,00 €" : fmtEur(comptageTotals.ecartCible)}</span>
                  </div>
                );
              })()}

              {(() => {
                const empty = fondDebutJour === 0;
                const ok = !empty && Math.abs(comptageTotals.ecartDebut) < 0.01;
                return (
                  <div className={`ecart-print flex items-center justify-between px-4 py-2.5 rounded-xl border ${
                    empty ? "border-slate-200/70 bg-white"
                      : ok ? "border-emerald-200/70 bg-emerald-50/50"
                      : "border-rose-200/70 bg-rose-50/50"
                  }`}>
                    <span className={`ecart-label inline-flex items-center gap-2 text-[12px] font-medium ${empty ? "text-slate-500" : ok ? "text-emerald-700" : "text-rose-700"}`}>
                      {!empty && <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />}
                      Écart / début
                    </span>
                    <span className={`ecart-val text-[15px] font-semibold tabular-nums ${empty ? "text-slate-400" : ok ? "text-emerald-800" : "text-rose-800"}`}>{empty ? "—" : ok ? "0,00 €" : fmtEur(comptageTotals.ecartDebut)}</span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* 3 SHIFTS — encaissements + commentaire + signature */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 print-grid-3">
          {(["matin", "soir"] as ShiftType[]).map((sType) => {
            const sh = shifts[sType];
            const t = totalsFor(sh);
            const Icon = SHIFT_ICONS[sType];
            const colors = SHIFT_COLORS[sType];
            // Une fois validé/signé : figé pour tout le monde (y compris admin).
            const locked = sh.valide;
            const num = (v: number) => isNaN(v) ? 0 : v;
            return (
              <div key={sType} className="shift-card rounded-3xl border border-slate-200/60 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)] overflow-hidden flex flex-col">
                <div className="card-header px-6 py-4 border-b border-slate-200/70 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-6 rounded-full ${colors.accent}`} />
                    <Icon className={`w-4 h-4 ${colors.text}`} strokeWidth={2.25} />
                    <div>
                      <div className="text-[14px] font-semibold text-slate-900 leading-tight">{SHIFT_LABELS[sType]}</div>
                      {sh.user_name && (
                        <div className="text-[11px] text-slate-500 leading-tight mt-0.5">par {sh.user_name}</div>
                      )}
                    </div>
                  </div>
                  {sh.valide ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Validé
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300" /> En cours
                    </span>
                  )}
                </div>

                <div className="card-body p-5 space-y-4 flex-1">
                  <div className="flex justify-center">
                    <div className="space-y-0 inline-block">
                      {/* Header row */}
                      <div className="enc-row enc-grid items-center text-[10px] text-slate-400 font-medium pb-2 mb-1 border-b border-slate-100">
                        <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px] pg-h2">Type</span>
                        <span className="text-center text-slate-400 font-medium tabular-nums uppercase tracking-wider text-[10px]">PMS</span>
                        <span className="text-center text-slate-400 font-medium tabular-nums uppercase tracking-wider text-[10px]">Réel</span>
                        <span className="text-right text-slate-400 font-medium tabular-nums uppercase tracking-wider text-[10px]">Écart</span>
                      </div>

                      {[
                        { key: "tpe",      label: "TPE CB",   dot: "bg-sky-500",      pmsK: "pms_tpe",      reelK: "reel_tpe",      e: t.ecartTpe },
                        { key: "amex",     label: "TPE AMEX", dot: "bg-blue-700",     pmsK: "pms_amex",     reelK: "reel_amex",     e: t.ecartAmex },
                        { key: "especes",  label: "Espèces",  dot: "bg-emerald-500",  pmsK: "pms_especes",  reelK: "reel_especes",  e: t.ecartEsp },
                        { key: "ancv",     label: "ANCV",     dot: "bg-violet-500",   pmsK: "pms_ancv",     reelK: "reel_ancv",     e: t.ecartAncv },
                        { key: "virement", label: "Virement", dot: "bg-amber-500",    pmsK: "pms_virement", reelK: "reel_virement", e: t.ecartVir },
                      ].map((row) => {
                        const ok = Math.abs(row.e) < 0.01;
                        return (
                          <div key={row.key} className="enc-row enc-grid items-center py-1 group">
                            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
                              <span className={`w-1.5 h-1.5 rounded-full ${row.dot}`} />
                              {row.label}
                            </span>
                            <input
                              type="number" step="0.01" inputMode="decimal" disabled={locked}
                              value={(sh as any)[row.pmsK] ?? 0}
                              onChange={(e) => updateShift(sType, { [row.pmsK]: num(Number(e.target.value)) } as any)}
                              className="enc-input h-7 w-full text-right text-[13px] font-medium tabular-nums px-2 rounded-md outline-none transition border bg-slate-50 border-transparent group-hover:bg-white group-hover:border-slate-200 focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:bg-transparent disabled:text-slate-500 disabled:border-transparent"
                            />
                            <input
                              type="number" step="0.01" inputMode="decimal" disabled={locked}
                              value={(sh as any)[row.reelK] ?? 0}
                              onChange={(e) => updateShift(sType, { [row.reelK]: num(Number(e.target.value)) } as any)}
                              className="enc-input h-7 w-full text-right text-[13px] font-medium tabular-nums px-2 rounded-md outline-none transition border bg-slate-50 border-transparent group-hover:bg-white group-hover:border-slate-200 focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:bg-transparent disabled:text-slate-500 disabled:border-transparent"
                            />
                            <span className={`ec-text text-[12px] font-medium tabular-nums text-right ${
                              ok ? "text-slate-300" : row.e > 0 ? "text-emerald-700" : "text-rose-700"
                            }`}>{ok ? "—" : fmtEur(row.e)}</span>
                          </div>
                        );
                      })}
                      {/* € consigne (encaissé Stripe / site consignes) — Réel auto, PMS à saisir */}
                      {(() => {
                        const okC = Math.abs(t.ecartConsigne) < 0.01;
                        return (
                          <div className="enc-row enc-grid items-center py-1 group">
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 leading-tight">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                              {hotelName.toLowerCase().includes('voiles') ? 'Paiement en ligne' : 'Stripe Direct'}
                            </span>
                            <input
                              type="number" step="0.01" inputMode="decimal" disabled={locked}
                              value={sh.pms_consigne ?? 0}
                              onChange={(e) => updateShift(sType, { pms_consigne: num(Number(e.target.value)) })}
                              className="enc-input h-7 w-full text-right text-[13px] font-medium tabular-nums px-2 rounded-md outline-none transition border bg-slate-50 border-transparent group-hover:bg-white group-hover:border-slate-200 focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:bg-transparent disabled:text-slate-500 disabled:border-transparent"
                            />
                            <span className="h-7 flex items-center justify-end text-right text-[13px] font-semibold tabular-nums px-2 text-indigo-600" title="Encaissé Stripe du jour — auto">{fmtEur(t.consigneReel)}</span>
                            <span className={`ec-text text-[12px] font-medium tabular-nums text-right ${okC ? "text-slate-300" : t.ecartConsigne > 0 ? "text-emerald-700" : "text-rose-700"}`}>{okC ? "—" : fmtEur(t.ecartConsigne)}</span>
                          </div>
                        );
                      })()}
                      {/* Total row */}
                      <div className="enc-row enc-grid items-center pt-2 mt-1 border-t border-slate-100 text-[12px] font-semibold">
                        <span className="text-slate-900">Total</span>
                        <span className="text-right tabular-nums text-slate-900 pr-2">{fmtEur(t.totalPmsBrut)}</span>
                        <span className="text-right tabular-nums text-slate-900 pr-2">{fmtEur(t.totalReelBrut)}</span>
                        <span className={`ec-text text-right tabular-nums ${
                          Math.abs(t.ecartTotal) < 0.01 ? "text-slate-400" : t.ecartTotal > 0 ? "text-emerald-700" : "text-rose-700"
                        }`}>{fmtEur(t.ecartTotal)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <textarea
                      disabled={locked}
                      value={sh.commentaire || ""}
                      onChange={(e) => updateShift(sType, { commentaire: e.target.value })}
                      rows={2}
                      placeholder="Commentaire, anomalie…"
                      className="w-full text-[12px] px-3 py-2 rounded-lg border border-transparent bg-slate-50 outline-none transition hover:border-slate-200 hover:bg-white focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-70 placeholder:text-slate-400 resize-none"
                    />
                  </div>

                  {/* Fond compté en fin de shift — auto depuis le comptage live (ou snapshot si validé) */}
                  {(() => {
                    const displayed = sh.valide && sh.fond_compte_fin != null
                      ? sh.fond_compte_fin
                      : comptageTotals.totalCompte;
                    const ecart = round2(displayed - fondCible);
                    const ok = Math.abs(ecart) < 0.01;
                    return (
                      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-white border border-slate-200/70 px-4 py-3">
                        <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${colors.accent}`} />
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                              Fond en caisse
                              {sh.valide ? (
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-400 normal-case tracking-normal"><Lock className="w-2.5 h-2.5" /> figé</span>
                              ) : (
                                <span className="text-[9px] text-slate-400 normal-case tracking-normal">live</span>
                              )}
                            </div>
                            <div className="text-[22px] font-semibold text-slate-900 tabular-nums leading-tight pg-big mt-0.5 tracking-tight">{fmtEur(displayed)}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Écart</div>
                            <div className={`inline-flex items-center gap-1.5 text-[12px] font-semibold tabular-nums ec-text mt-1 ${ok ? "text-emerald-700" : "text-rose-700"}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                              {ok ? "0,00 €" : fmtEur(ecart)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Signature print zone — affiche la vraie signature si présente, sinon ligne vide */}
                  <div className="signature-zone border-t border-slate-300 pt-2 mt-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Signature</div>
                      {sh.signed_by_name && (
                        <div className="text-[9px] text-slate-500">
                          {sh.signed_by_name}
                          {sh.signed_at && (
                            <> — {dfFormat(new Date(sh.signed_at), "d/MM/yyyy HH:mm")}</>
                          )}
                        </div>
                      )}
                    </div>
                    {sh.signature_data ? (
                      <div className="signature-img-wrap mt-1 border-b border-slate-400">
                        <img
                          src={sh.signature_data}
                          alt="Signature"
                          className="signature-img block max-h-12 object-contain"
                        />
                      </div>
                    ) : (
                      <div className="h-10 border-b border-slate-400 mt-1" />
                    )}
                  </div>
                </div>

                <div className="no-print px-6 py-3 border-t border-slate-200/70 flex items-center justify-between gap-2">
                  {sh.valide ? (
                    <div className="flex items-center gap-3 min-w-0">
                      {sh.signature_data && (
                        <img
                          src={sh.signature_data}
                          alt="Signature"
                          title="Signature électronique"
                          className="h-9 w-[68px] object-contain bg-white border border-slate-200 rounded-md shrink-0"
                        />
                      )}
                      <div className="text-[11px] leading-tight min-w-0">
                        <div className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Validé & signé
                        </div>
                        {sh.signed_by_name && (
                          <div className="text-slate-500 truncate mt-0.5">
                            par <span className="font-medium text-slate-700">{sh.signed_by_name}</span>
                            {sh.signed_at && (
                              <> · {dfFormat(new Date(sh.signed_at), "d/MM/yyyy HH:mm")}</>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => saveShift(sType, false)}
                        disabled={savingShift === sType || loading}
                        className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:border-slate-300 hover:bg-slate-50 transition disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" /> {savingShift === sType ? "…" : "Enregistrer"}
                      </button>
                      <button
                        onClick={() => setSigningShift(sType)}
                        disabled={savingShift === sType || loading}
                        className="inline-flex items-center gap-1.5 h-8 px-3.5 text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition disabled:opacity-50"
                      >
                        <Lock className="w-3.5 h-3.5" /> Valider & signer
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!hotelId && (
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50/40 px-5 py-3.5 flex items-center gap-2.5 text-[13px] font-medium text-amber-800">
            <AlertCircle className="w-4 h-4" /> Sélectionne un hôtel pour commencer.
          </div>
        )}
      </div>

      <SignaturePadModal
        open={signingShift !== null}
        onOpenChange={(o) => { if (!o) setSigningShift(null); }}
        title={signingShift ? `Valider — ${SHIFT_LABELS[signingShift]}` : ""}
        subtitle={
          signingShift
            ? `${hotelName ? hotelName + " · " : ""}${dateLabel}. En signant, vous validez les montants saisis pour ce shift.`
            : undefined
        }
        onValidate={handleSignatureValidate}
      />
    </div>
  );
}

export default function CaissePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-500">Chargement…</div>}>
      <CaissePageInner />
    </Suspense>
  );
}
