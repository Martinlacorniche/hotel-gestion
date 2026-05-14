"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  Euro, Printer, Lock, Unlock, Save, Sun, Moon, Sunset,
  ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Calculator, Coins,
  Loader2,
} from "lucide-react";
import { format as dfFormat, addDays } from "date-fns";
import { fr as frLocale } from "date-fns/locale";

// --- TYPES ---

type ShiftType = "matin" | "soir" | "cloture";

type CaisseShift = {
  id?: string;
  hotel_id: string;
  date_jour: string;
  shift_type: ShiftType;
  user_id: string | null;
  user_name: string | null;
  pms_tpe: number; pms_especes: number; pms_ancv: number; pms_virement: number;
  reel_tpe: number; reel_especes: number; reel_ancv: number; reel_virement: number;
  commentaire: string | null;
  fond_compte_fin: number | null;
  valide: boolean;
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
  cloture: "Clôture",
};

const SHIFT_ICONS: Record<ShiftType, React.ComponentType<any>> = {
  matin: Sun,
  soir: Sunset,
  cloture: Moon,
};

const SHIFT_COLORS: Record<ShiftType, { bg: string; text: string; border: string; btn: string }> = {
  matin:   { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   btn: "bg-amber-600 hover:bg-amber-700" },
  soir:    { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  btn: "bg-orange-600 hover:bg-orange-700" },
  cloture: { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200",  btn: "bg-indigo-600 hover:bg-indigo-700" },
};

const emptyShift = (hotel_id: string, date_jour: string, shift_type: ShiftType): CaisseShift => ({
  hotel_id, date_jour, shift_type,
  user_id: null, user_name: null,
  pms_tpe: 0, pms_especes: 0, pms_ancv: 0, pms_virement: 0,
  reel_tpe: 0, reel_especes: 0, reel_ancv: 0, reel_virement: 0,
  commentaire: "", fond_compte_fin: null, valide: false,
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

  const [hotelId, setHotelId] = useState<string>("");
  const [hotelName, setHotelName] = useState<string>("");
  const [hotels, setHotels] = useState<{ id: string; nom: string }[]>([]);
  const [dateJour, setDateJour] = useState<string>(dfFormat(new Date(), "yyyy-MM-dd"));

  const [fondCible, setFondCible] = useState<number>(0);
  const [fondCibleDraft, setFondCibleDraft] = useState<number>(0);
  const [fondDebutJour, setFondDebutJour] = useState<number>(0);

  const [shifts, setShifts] = useState<Record<ShiftType, CaisseShift>>({
    matin: emptyShift("", "", "matin"),
    soir: emptyShift("", "", "soir"),
    cloture: emptyShift("", "", "cloture"),
  });

  const [comptage, setComptage] = useState<Comptage>(emptyComptage("", ""));
  const [comptageId, setComptageId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingShift, setSavingShift] = useState<ShiftType | null>(null);
  const [comptageStatus, setComptageStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const comptageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosaveRef = useRef<boolean>(false);

  // --- Init hotel ---
  useEffect(() => {
    (async () => {
      const fromQS = searchParams?.get("hotel_id");
      if (fromQS) { setHotelId(fromQS); return; }
      if (typeof window !== "undefined") {
        const fromLS = window.localStorage.getItem("selectedHotelId");
        if (fromLS) { setHotelId(fromLS); return; }
      }
      const { data: authRes } = await supabase.auth.getUser();
      if (authRes?.user?.id) {
        const { data: u } = await supabase.from("users").select("hotel_id").eq("id_auth", authRes.user.id).maybeSingle();
        if (u?.hotel_id) {
          setHotelId(u.hotel_id);
          if (typeof window !== "undefined") window.localStorage.setItem("selectedHotelId", u.hotel_id);
        }
      }
    })();
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
        cloture: emptyShift(hotelId, dateJour, "cloture"),
      };
      (shiftRows || []).forEach((r: any) => {
        if (r.shift_type === "matin" || r.shift_type === "soir" || r.shift_type === "cloture") {
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
      } else {
        setComptage(emptyComptage(hotelId, dateJour));
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

  // --- Helpers ---
  const switchHotel = (newId: string) => {
    if (!newId || newId === hotelId) return;
    setHotelId(newId);
    if (typeof window !== "undefined") window.localStorage.setItem("selectedHotelId", newId);
  };

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
    const totalPmsBrut = sh.pms_tpe + sh.pms_especes + sh.pms_ancv + sh.pms_virement;
    const totalReelBrut = sh.reel_tpe + sh.reel_especes + sh.reel_ancv + sh.reel_virement;
    const ecartTpe = round2(sh.reel_tpe - sh.pms_tpe);
    const ecartEsp = round2(sh.reel_especes - sh.pms_especes);
    const ecartAncv = round2(sh.reel_ancv - sh.pms_ancv);
    const ecartVir = round2(sh.reel_virement - sh.pms_virement);
    const ecartTotal = round2(totalReelBrut - totalPmsBrut);
    return {
      totalPmsBrut: round2(totalPmsBrut),
      totalReelBrut: round2(totalReelBrut),
      ecartTpe, ecartEsp, ecartAncv, ecartVir, ecartTotal,
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
      (shifts.matin[k] as number || 0) + (shifts.soir[k] as number || 0) + (shifts.cloture[k] as number || 0);
    const totalReel = sum("reel_tpe") + sum("reel_especes") + sum("reel_ancv") + sum("reel_virement");
    const totalPms = sum("pms_tpe") + sum("pms_especes") + sum("pms_ancv") + sum("pms_virement");
    return {
      totalReel: round2(totalReel),
      totalPms: round2(totalPms),
      ecart: round2(totalReel - totalPms),
    };
  }, [shifts]);

  // --- Save shift ---
  const saveShift = async (s: ShiftType, valide: boolean) => {
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
      pms_tpe: sh.pms_tpe, pms_especes: sh.pms_especes, pms_ancv: sh.pms_ancv, pms_virement: sh.pms_virement,
      reel_tpe: sh.reel_tpe, reel_especes: sh.reel_especes, reel_ancv: sh.reel_ancv, reel_virement: sh.reel_virement,
      commentaire: sh.commentaire,
      // À la validation, on fige le fond compté = total comptage live
      fond_compte_fin: valide ? comptageTotals.totalCompte : sh.fond_compte_fin,
      valide,
    };

    const { data, error } = await supabase
      .from("caisse_shifts")
      .upsert(payload, { onConflict: "hotel_id,date_jour,shift_type" })
      .select()
      .single();

    setSavingShift(null);
    if (error) { alert("Erreur enregistrement : " + error.message); return; }
    if (data) {
      updateShift(s, {
        id: data.id, user_id: data.user_id, user_name: data.user_name, valide: data.valide,
        fond_compte_fin: data.fond_compte_fin,
      });
    }
  };

  const reopenShift = async (s: ShiftType) => {
    if (!isAdmin) return;
    await saveShift(s, false);
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
    if (error) { alert("Erreur : " + error.message); return; }
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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Print styles — 1 page A4 paysage, ultra compact */}
      <style jsx global>{`
        /* Grille encaissements (header + lignes + total alignés sur les mêmes colonnes) */
        .enc-grid { display: grid; grid-template-columns: 78px 1fr 1fr 56px; gap: 6px; }

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

          /* Total card : compact */
          .total-print { padding: 4px 6px !important; }
          .total-print .total-big { font-size: 16px !important; line-height: 1.1 !important; }
          .total-print .total-label { font-size: 8px !important; }
          .total-print .total-meta { font-size: 7.5px !important; }

          .ecart-print { padding: 3px 6px !important; border-width: 1px !important; }
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
          .signature-zone > div:last-child { height: 18px !important; }
        }
        .print-only { display: none; }
        .signature-zone { display: none; }
      `}</style>

      {/* Header */}
      <div className="no-print h-20 flex items-center justify-between px-4 md:px-8 gap-4 sticky top-0 bg-slate-50/90 backdrop-blur z-30 border-b border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-white rounded-2xl shadow-sm flex items-center justify-center shrink-0">
            <Euro className="w-5 h-5 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Caisse</h1>
          {hotels.length > 1 && (
            <select
              value={hotelId}
              onChange={(e) => switchHotel(e.target.value)}
              className="ml-3 bg-white border border-slate-200 rounded-xl px-3 h-10 text-sm font-bold text-slate-700 shadow-sm hover:border-emerald-300 focus:ring-2 focus:ring-emerald-500 outline-none transition"
            >
              {hotels.map((h) => (
                <option key={h.id} value={h.id}>{h.nom}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white rounded-full shadow-sm border border-slate-200 px-1 py-1">
            <Button variant="ghost" size="icon" onClick={() => changeDate(-1)} className="h-8 w-8 rounded-full hover:bg-slate-100">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </Button>
            <input
              type="date"
              value={dateJour}
              onChange={(e) => setDateJour(e.target.value)}
              className="px-3 text-sm font-semibold text-slate-700 bg-transparent outline-none cursor-pointer"
            />
            <Button variant="ghost" size="icon" onClick={() => changeDate(1)} className="h-8 w-8 rounded-full hover:bg-slate-100">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </Button>
          </div>
          <Button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-900 text-white shadow-md rounded-2xl px-5 h-10 text-sm font-bold">
            <Printer className="w-4 h-4 mr-2" /> Imprimer
          </Button>
        </div>
      </div>

      <div className="caisse-content px-4 md:px-8 py-6 space-y-5">
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

        {/* Bandeau récap journée */}
        <div className="no-print rounded-2xl border border-slate-200 bg-white shadow-sm p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Journée</div>
            <div className="text-lg font-bold text-slate-800 capitalize">{dateLabel}</div>
            <div className="text-xs text-slate-500">{hotelName || "—"}</div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Total PMS jour</div>
              <div className="text-lg font-bold text-slate-700">{fmtEur(dayTotals.totalPms)}</div>
            </div>
            <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Total réel jour</div>
              <div className="text-lg font-bold text-slate-700">{fmtEur(dayTotals.totalReel)}</div>
            </div>
            <div className={`px-4 py-2 rounded-xl border ${
              Math.abs(dayTotals.ecart) < 0.01
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-rose-50 border-rose-200 text-rose-700"
            }`}>
              <div className="text-[10px] uppercase font-bold opacity-80">Écart jour</div>
              <div className="text-lg font-bold">{fmtEur(dayTotals.ecart)}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200">
            <Calculator className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="text-[10px] uppercase font-bold text-emerald-700">Fond cible</div>
              {isAdmin ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number" step="0.01"
                    value={fondCibleDraft}
                    onChange={(e) => setFondCibleDraft(Number(e.target.value))}
                    className="w-24 text-sm font-bold text-emerald-800 bg-white border border-emerald-300 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                  <Button onClick={saveFondCible} size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
                    <Save className="w-3 h-3 mr-1" />OK
                  </Button>
                </div>
              ) : (
                <div className="text-lg font-bold text-emerald-800">{fmtEur(fondCible)}</div>
              )}
            </div>
          </div>
        </div>

        {/* COMPTAGE PARTAGÉ — un seul bloc pour la journée (en haut, le + utilisé) */}
        <div className="comptage-card rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="card-header px-5 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center text-emerald-600">
                <Coins className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-emerald-800">Comptage caisse — {dateLabel}</div>
                <div className="text-[11px] text-emerald-700/80">Comptage partagé — réécris dessus à chaque shift, sauvegarde auto</div>
              </div>
            </div>
            <div className="no-print flex items-center gap-2">
              {comptageStatus === "saving" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                  <Loader2 className="w-3 h-3 animate-spin" /> Enregistrement…
                </span>
              )}
              {comptageStatus === "saved" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Enregistré
                </span>
              )}
              {comptageStatus === "dirty" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-full">
                  <Save className="w-3 h-3" /> En cours…
                </span>
              )}
            </div>
          </div>

          <div className="card-body p-5 grid grid-cols-1 lg:grid-cols-[1fr_1fr_minmax(240px,_300px)] gap-6">
            {/* Billets — tuile par denom */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase font-bold text-slate-500 tracking-wider pg-h2">Billets</div>
                <div className="text-xs font-bold text-slate-700 tabular-nums">{fmtEur(comptageTotals.totalBillets)}</div>
              </div>
              <div className="denom-list grid grid-cols-1 gap-1.5">
                {BILLET_DENOMS.map((d) => {
                  const qty = Number(comptage.billets[String(d)] || 0);
                  const sub = round2(d * qty);
                  const active = qty > 0;
                  return (
                    <div key={d} className={`denom-row flex items-center gap-3 px-3 py-2 rounded-xl border transition ${active ? "bg-emerald-50/40 border-emerald-200" : "bg-white border-slate-100 hover:border-slate-200"}`}>
                      <span className="denom-chip inline-flex items-center justify-center min-w-[56px] h-7 px-2 rounded-lg bg-slate-900 text-white text-xs font-extrabold">{d} €</span>
                      <span className="denom-mult text-slate-300 select-none">×</span>
                      <input
                        type="number" inputMode="numeric" min={0} step={1}
                        value={qty || ""}
                        onChange={(e) => updateBillet(d, Number(e.target.value) || 0)}
                        placeholder="0"
                        className="denom-input w-full max-w-[110px] h-9 text-right text-base font-bold tabular-nums px-2 rounded-lg bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                      <span className={`denom-sub ml-auto text-sm font-bold tabular-nums ${active ? "text-emerald-700" : "text-slate-300"}`}>{active ? fmtEur(sub) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pièces — tuile par denom */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase font-bold text-slate-500 tracking-wider pg-h2">Pièces</div>
                <div className="text-xs font-bold text-slate-700 tabular-nums">{fmtEur(comptageTotals.totalPieces)}</div>
              </div>
              <div className="denom-list grid grid-cols-1 gap-1.5">
                {PIECE_DENOMS.map((d) => {
                  const qty = Number(comptage.pieces[String(d)] || 0);
                  const sub = round2(d * qty);
                  const active = qty > 0;
                  const label = d < 1 ? `${Math.round(d * 100)} c` : `${d} €`;
                  return (
                    <div key={d} className={`denom-row flex items-center gap-3 px-3 py-2 rounded-xl border transition ${active ? "bg-emerald-50/40 border-emerald-200" : "bg-white border-slate-100 hover:border-slate-200"}`}>
                      <span className="denom-chip inline-flex items-center justify-center min-w-[56px] h-7 px-2 rounded-lg bg-slate-200 text-slate-800 text-xs font-extrabold">{label}</span>
                      <span className="denom-mult text-slate-300 select-none">×</span>
                      <input
                        type="number" inputMode="numeric" min={0} step={1}
                        value={qty || ""}
                        onChange={(e) => updatePiece(d, Number(e.target.value) || 0)}
                        placeholder="0"
                        className="denom-input w-full max-w-[110px] h-9 text-right text-base font-bold tabular-nums px-2 rounded-lg bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                      <span className={`denom-sub ml-auto text-sm font-bold tabular-nums ${active ? "text-emerald-700" : "text-slate-300"}`}>{active ? fmtEur(sub) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Totaux + écarts (sticky-feel) */}
            <div className="space-y-3 self-start lg:sticky lg:top-24">
              <div className="total-print rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white px-5 py-4 shadow-lg">
                <div className="total-label text-[10px] uppercase font-bold text-slate-300 tracking-widest">Total compté</div>
                <div className="total-big text-3xl font-extrabold tabular-nums leading-tight">{fmtEur(comptageTotals.totalCompte)}</div>
                <div className="total-meta mt-1 text-[10px] text-slate-300">cible : {fmtEur(fondCible)} · début : {fmtEur(fondDebutJour)}</div>
              </div>

              <div className={`ecart-print px-4 py-3 rounded-2xl border-2 ${
                Math.abs(comptageTotals.ecartCible) < 0.01
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                  : "bg-rose-50 border-rose-300 text-rose-700"
              }`}>
                <div className="flex items-center justify-between">
                  <span className="ecart-label text-[10px] font-bold uppercase tracking-wider opacity-80">Écart / fond cible</span>
                  {Math.abs(comptageTotals.ecartCible) < 0.01 && <CheckCircle2 className="w-4 h-4" />}
                </div>
                <div className="ecart-val text-xl font-extrabold tabular-nums">{Math.abs(comptageTotals.ecartCible) < 0.01 ? "✓ OK" : fmtEur(comptageTotals.ecartCible)}</div>
              </div>

              <div className={`ecart-print px-4 py-3 rounded-2xl border-2 ${
                fondDebutJour === 0
                  ? "bg-slate-50 border-slate-200 text-slate-500"
                  : Math.abs(comptageTotals.ecartDebut) < 0.01
                    ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : "bg-rose-50 border-rose-300 text-rose-700"
              }`}>
                <div className="flex items-center justify-between">
                  <span className="ecart-label text-[10px] font-bold uppercase tracking-wider opacity-80">Écart / début de journée</span>
                  {fondDebutJour > 0 && Math.abs(comptageTotals.ecartDebut) < 0.01 && <CheckCircle2 className="w-4 h-4" />}
                </div>
                <div className="ecart-val text-xl font-extrabold tabular-nums">{fondDebutJour === 0 ? "—" : Math.abs(comptageTotals.ecartDebut) < 0.01 ? "✓ OK" : fmtEur(comptageTotals.ecartDebut)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 3 SHIFTS — encaissements + commentaire + signature */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 print-grid-3">
          {(["matin", "soir", "cloture"] as ShiftType[]).map((sType) => {
            const sh = shifts[sType];
            const t = totalsFor(sh);
            const Icon = SHIFT_ICONS[sType];
            const colors = SHIFT_COLORS[sType];
            const locked = sh.valide && !isAdmin;
            const num = (v: number) => isNaN(v) ? 0 : v;
            return (
              <div key={sType} className={`shift-card rounded-2xl border ${colors.border} bg-white shadow-sm overflow-hidden flex flex-col`}>
                <div className={`card-header px-5 py-3 ${colors.bg} ${colors.border} border-b flex items-center justify-between`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 bg-white rounded-xl flex items-center justify-center ${colors.text}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className={`text-base font-bold ${colors.text}`}>{SHIFT_LABELS[sType]}</div>
                      {sh.user_name && (
                        <div className="text-[10px] text-slate-500">par {sh.user_name}</div>
                      )}
                    </div>
                  </div>
                  {sh.valide ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
                      <Lock className="w-3 h-3" /> Validé
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white px-2 py-1 rounded-full border border-slate-200">
                      <Unlock className="w-3 h-3" /> En cours
                    </span>
                  )}
                </div>

                <div className="card-body p-4 space-y-3 flex-1">
                  <div>
                    <div className="text-xs uppercase font-bold text-slate-500 tracking-wider pg-h2 mb-1.5">Encaissements</div>
                    <div className="space-y-1">
                      {/* Header row — colonnes alignées avec les inputs */}
                      <div className="enc-row enc-grid items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <span></span>
                        <span className="text-center">PMS</span>
                        <span className="text-center">Réel</span>
                        <span className="text-right">Écart</span>
                      </div>

                      {[
                        { key: "tpe",      label: "TPE",      chip: "bg-sky-100 text-sky-700",       pmsK: "pms_tpe",      reelK: "reel_tpe",      e: t.ecartTpe },
                        { key: "especes",  label: "Espèces",  chip: "bg-emerald-100 text-emerald-700", pmsK: "pms_especes",  reelK: "reel_especes",  e: t.ecartEsp },
                        { key: "ancv",     label: "ANCV",     chip: "bg-violet-100 text-violet-700", pmsK: "pms_ancv",     reelK: "reel_ancv",     e: t.ecartAncv },
                        { key: "virement", label: "Virement", chip: "bg-amber-100 text-amber-700",   pmsK: "pms_virement", reelK: "reel_virement", e: t.ecartVir },
                      ].map((row) => {
                        const ok = Math.abs(row.e) < 0.01;
                        return (
                          <div key={row.key} className="enc-row enc-grid items-center">
                            <span className={`inline-flex items-center justify-center px-2 h-7 rounded-lg text-[11px] font-extrabold tracking-wide ${row.chip} w-full`}>{row.label}</span>
                            <input
                              type="number" step="0.01" inputMode="decimal" disabled={locked}
                              value={(sh as any)[row.pmsK] ?? 0}
                              onChange={(e) => updateShift(sType, { [row.pmsK]: num(Number(e.target.value)) } as any)}
                              className="enc-input h-8 w-full text-right text-sm font-semibold tabular-nums px-2 rounded-lg bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-400 disabled:bg-slate-50 disabled:text-slate-500"
                            />
                            <input
                              type="number" step="0.01" inputMode="decimal" disabled={locked}
                              value={(sh as any)[row.reelK] ?? 0}
                              onChange={(e) => updateShift(sType, { [row.reelK]: num(Number(e.target.value)) } as any)}
                              className="enc-input h-8 w-full text-right text-sm font-semibold tabular-nums px-2 rounded-lg bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-400 disabled:bg-slate-50 disabled:text-slate-500"
                            />
                            <span className={`ec-text text-xs font-bold tabular-nums text-right ${
                              ok ? "text-slate-300" : row.e > 0 ? "text-emerald-700" : "text-rose-700"
                            }`}>{ok ? "—" : fmtEur(row.e)}</span>
                          </div>
                        );
                      })}
                      {/* Total row */}
                      <div className="enc-row enc-grid items-center pt-1.5 mt-0.5 border-t border-slate-100 text-xs font-extrabold text-slate-700">
                        <span className="px-2">Total</span>
                        <span className="text-center tabular-nums">{fmtEur(t.totalPmsBrut)}</span>
                        <span className="text-center tabular-nums">{fmtEur(t.totalReelBrut)}</span>
                        <span className={`ec-text text-right tabular-nums ${
                          Math.abs(t.ecartTotal) < 0.01 ? "text-slate-400" : t.ecartTotal > 0 ? "text-emerald-700" : "text-rose-700"
                        }`}>{fmtEur(t.ecartTotal)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Commentaire</div>
                    <textarea
                      disabled={locked}
                      value={sh.commentaire || ""}
                      onChange={(e) => updateShift(sType, { commentaire: e.target.value })}
                      rows={2}
                      placeholder="Anomalie, remarque…"
                      className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-emerald-400 disabled:bg-slate-50"
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
                      <div className={`rounded-xl border ${colors.border} ${colors.bg} px-3 py-2`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className={`text-[10px] uppercase font-bold ${colors.text} flex items-center gap-1`}>
                              Fond en caisse
                              {sh.valide ? (
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full"><Lock className="w-2.5 h-2.5" /> figé</span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full">live</span>
                              )}
                            </div>
                            <div className="text-xl font-extrabold text-slate-800 tabular-nums leading-tight pg-big">{fmtEur(displayed)}</div>
                          </div>
                          <div className={`text-right shrink-0 ${ok ? "text-emerald-700" : "text-rose-700"}`}>
                            <div className="text-[9px] uppercase font-bold opacity-70">Écart cible</div>
                            <div className={`text-sm font-bold tabular-nums ec-text ${ok ? "" : ""}`}>{ok ? "✓ OK" : fmtEur(ecart)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Signature print zone */}
                  <div className="signature-zone border-t border-slate-300 pt-2 mt-2">
                    <div className="text-[10px] uppercase font-bold text-slate-500">Signature</div>
                    <div className="h-10 border-b border-slate-400 mt-1" />
                  </div>
                </div>

                <div className="no-print px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
                  {sh.valide ? (
                    isAdmin ? (
                      <Button onClick={() => reopenShift(sType)} variant="outline" size="sm" className="text-xs">
                        <Unlock className="w-3 h-3 mr-1" /> Rouvrir
                      </Button>
                    ) : (
                      <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Validé
                      </span>
                    )
                  ) : (
                    <>
                      <Button
                        onClick={() => saveShift(sType, false)}
                        disabled={savingShift === sType || loading}
                        variant="outline" size="sm" className="text-xs"
                      >
                        <Save className="w-3 h-3 mr-1" /> {savingShift === sType ? "…" : "Enregistrer"}
                      </Button>
                      <Button
                        onClick={() => saveShift(sType, true)}
                        disabled={savingShift === sType || loading}
                        size="sm"
                        className={`text-xs text-white ${colors.btn}`}
                      >
                        <Lock className="w-3 h-3 mr-1" /> Valider
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!hotelId && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center gap-3 text-amber-800">
            <AlertCircle className="w-5 h-5" /> Sélectionne un hôtel pour commencer.
          </div>
        )}
      </div>
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
