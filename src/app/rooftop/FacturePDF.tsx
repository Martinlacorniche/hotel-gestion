// Facture réglementaire du POS Rooftop (Les Voiles) — rendu SERVEUR (renderToBuffer).
// Mentions légales DYNAMIQUES (identité de l'hôtel émetteur lue en base, jamais
// hardcodée) : forme juridique, capital, SIRET, TVA intra, RCS. Ventilation TVA
// par taux (soft/food 10%, alcool 50% à 10% + 50% à 20%).

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getHotelBranding } from "@/app/devis/QuotePDF";

export type FactureLigne = {
  designation: string;
  qty: number;
  puTTC: number;
  tauxLabel: string; // "10%" | "10/20%"
  totalTTC: number;
};

export type FactureData = {
  hotelId: string;
  hotelNom: string;
  numero: string;
  dateEmission: string; // "03/07/2026"
  vendeur: {
    raisonSociale: string | null;
    formeJuridique: string | null;
    capital: string | null;
    siret: string | null;
    tvaIntra: string | null;
    rcs: string | null;
    adresse: string | null;
    iban: string | null;
    bic: string | null;
  };
  client: { nom: string; email: string; adresse?: string | null };
  lignes: FactureLigne[];
  ventilation: {
    ht10: number; tva10: number; ht20: number; tva20: number;
    totalHt: number; totalTva: number; totalTtc: number;
  };
  paiement: string | null;
};

const BLUE = "#075985", BLUE_MID = "#0369a1", BLUE_LIGHT = "#0ea5e9";
const SLATE_800 = "#1e293b", SLATE_600 = "#475569", SLATE_400 = "#94a3b8";
const SLATE_100 = "#f1f5f9", SLATE_50 = "#f8fafc", ICE = "#f0f9ff", ICE_BORDER = "#e0f2fe";
const eur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

const s = StyleSheet.create({
  page: { paddingHorizontal: 36, paddingVertical: 32, fontFamily: "Helvetica", fontSize: 9, color: SLATE_600 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 24, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  headerLeft: { flex: 1 },
  headerRight: { flex: 1, alignItems: "flex-end" },
  logo: { width: 48, height: 48 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: BLUE, letterSpacing: 1, textTransform: "uppercase" },
  refLine: { fontSize: 8, color: SLATE_600, marginTop: 4, fontFamily: "Helvetica-Bold" },
  refSub: { fontSize: 7, color: SLATE_400, marginTop: 2 },
  hotelName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BLUE_MID, textTransform: "uppercase" },
  hotelAddress: { fontSize: 7, color: SLATE_400, marginTop: 2, lineHeight: 1.4, textAlign: "right" },

  infoGrid: { flexDirection: "row", marginBottom: 22 },
  infoCol: { flex: 1, padding: 12, backgroundColor: SLATE_50, borderWidth: 0.5, borderColor: "#e2e8f0", borderRadius: 8 },
  infoColLeft: { marginRight: 8 },
  infoColRight: { marginLeft: 8 },
  label: { fontSize: 7, fontFamily: "Helvetica-Bold", color: BLUE_LIGHT, textTransform: "uppercase", marginBottom: 5, letterSpacing: 0.8 },
  infoName: { fontFamily: "Helvetica-Bold", fontSize: 10, color: SLATE_800 },
  infoSub: { fontSize: 8, color: SLATE_600, marginTop: 3, lineHeight: 1.4 },

  tableHeaderWrap: { marginBottom: 4, borderRadius: 6, overflow: "hidden", backgroundColor: BLUE },
  tableHeader: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 8 },
  tableRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: SLATE_100, alignItems: "center" },
  tableRowAlt: { backgroundColor: "#fafbfc" },
  colDesc: { width: "50%", paddingRight: 8, fontSize: 8, color: SLATE_800 },
  colQty: { width: "10%", textAlign: "center" },
  colPU: { width: "15%", textAlign: "right" },
  colTVA: { width: "10%", textAlign: "center", color: SLATE_400 },
  colTotal: { width: "15%", textAlign: "right", fontFamily: "Helvetica-Bold", color: BLUE_MID },
  thText: { color: "#ffffff", fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },

  recapSection: { flexDirection: "row", marginTop: 18 },
  tvaSection: { flex: 1, paddingRight: 16 },
  tvaTableHead: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingBottom: 3, marginBottom: 3 },
  tvaRow: { flexDirection: "row", marginBottom: 2 },
  tvaC1: { width: "34%", fontSize: 7, color: SLATE_600 },
  tvaC2: { width: "33%", fontSize: 7, color: SLATE_600, textAlign: "right" },
  tvaC3: { width: "33%", fontSize: 7, color: SLATE_600, textAlign: "right" },
  totalBox: { width: 180, padding: 14, backgroundColor: ICE, borderWidth: 1, borderColor: ICE_BORDER, borderRadius: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  totalLabel: { fontSize: 8, color: SLATE_600 },
  totalVal: { fontSize: 8, fontFamily: "Helvetica-Bold", color: SLATE_800 },
  grandTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: BLUE_LIGHT, paddingTop: 8, marginTop: 4 },

  payLine: { marginTop: 18, fontSize: 8, color: SLATE_600 },
  footer: { flexGrow: 1, justifyContent: "flex-end" },
  legal: { marginTop: 18, borderTopWidth: 0.5, borderTopColor: SLATE_100, paddingTop: 8, textAlign: "center", fontSize: 6, color: "#94a3b8", lineHeight: 1.6, letterSpacing: 0.3 },
});

function FactureDoc({ data }: { data: FactureData }) {
  const branding = getHotelBranding(data.hotelId, data.hotelNom);
  const v = data.vendeur;
  const legalMain = [
    v.raisonSociale || branding.name,
    v.formeJuridique && v.capital ? `${v.formeJuridique} au capital de ${v.capital}`
      : v.formeJuridique ? v.formeJuridique : null,
    v.siret ? `SIRET ${v.siret}` : null,
    v.tvaIntra ? `TVA ${v.tvaIntra}` : null,
    v.rcs || null,
  ].filter(Boolean).join(" — ");
  const ibanLine = v.iban ? `IBAN ${v.iban}${v.bic ? ` — BIC ${v.bic}` : ""}` : null;

  return (
    <Document title={`Facture ${data.numero}`}>
      <Page size="A4" style={s.page}>
        {/* HEADER */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.title}>Facture</Text>
            <Text style={s.refLine}>N° {data.numero}</Text>
            <Text style={s.refSub}>Émise le {data.dateEmission}</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.hotelName}>{v.raisonSociale || branding.name}</Text>
            <Text style={s.hotelAddress}>{v.adresse || `${branding.addressLine1}, ${branding.addressLine2}`}</Text>
            {v.tvaIntra ? <Text style={s.hotelAddress}>TVA {v.tvaIntra}</Text> : null}
          </View>
        </View>

        {/* VENDEUR / CLIENT */}
        <View style={s.infoGrid}>
          <View style={[s.infoCol, s.infoColLeft]}>
            <Text style={s.label}>Émetteur</Text>
            <Text style={s.infoName}>{v.raisonSociale || branding.name}</Text>
            <Text style={s.infoSub}>{v.adresse || `${branding.addressLine1}, ${branding.addressLine2}`}</Text>
            {v.siret ? <Text style={s.infoSub}>SIRET {v.siret}</Text> : null}
          </View>
          <View style={[s.infoCol, s.infoColRight]}>
            <Text style={s.label}>Facturé à</Text>
            <Text style={s.infoName}>{data.client.nom || "—"}</Text>
            {data.client.adresse ? <Text style={s.infoSub}>{data.client.adresse}</Text> : null}
            {data.client.email ? <Text style={s.infoSub}>{data.client.email}</Text> : null}
          </View>
        </View>

        {/* LIGNES */}
        <View style={s.tableHeaderWrap}>
          <View style={s.tableHeader}>
            <Text style={[s.colDesc, s.thText]}>DÉSIGNATION</Text>
            <Text style={[s.colQty, s.thText]}>QTÉ</Text>
            <Text style={[s.colPU, s.thText]}>P.U TTC</Text>
            <Text style={[s.colTVA, s.thText]}>TVA</Text>
            <Text style={[s.colTotal, s.thText]}>TOTAL TTC</Text>
          </View>
        </View>
        {data.lignes.map((l, i) => (
          <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
            <Text style={s.colDesc}>{l.designation}</Text>
            <Text style={s.colQty}>{l.qty}</Text>
            <Text style={s.colPU}>{eur(l.puTTC)}</Text>
            <Text style={s.colTVA}>{l.tauxLabel}</Text>
            <Text style={s.colTotal}>{eur(l.totalTTC)}</Text>
          </View>
        ))}

        {/* TOTAUX + VENTILATION TVA */}
        <View style={s.recapSection} wrap={false}>
          <View style={s.tvaSection}>
            <Text style={s.label}>Ventilation de la TVA</Text>
            <View style={s.tvaTableHead}>
              <Text style={s.tvaC1}>Taux</Text>
              <Text style={s.tvaC2}>Base HT</Text>
              <Text style={s.tvaC3}>TVA</Text>
            </View>
            {data.ventilation.ht10 > 0 && (
              <View style={s.tvaRow}>
                <Text style={s.tvaC1}>10%</Text>
                <Text style={s.tvaC2}>{eur(data.ventilation.ht10)}</Text>
                <Text style={s.tvaC3}>{eur(data.ventilation.tva10)}</Text>
              </View>
            )}
            {data.ventilation.ht20 > 0 && (
              <View style={s.tvaRow}>
                <Text style={s.tvaC1}>20%</Text>
                <Text style={s.tvaC2}>{eur(data.ventilation.ht20)}</Text>
                <Text style={s.tvaC3}>{eur(data.ventilation.tva20)}</Text>
              </View>
            )}
          </View>
          <View style={s.totalBox}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total HT</Text>
              <Text style={s.totalVal}>{eur(data.ventilation.totalHt)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total TVA</Text>
              <Text style={s.totalVal}>{eur(data.ventilation.totalTva)}</Text>
            </View>
            <View style={s.grandTotal}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10, color: BLUE_MID }}>TOTAL TTC</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 14, color: BLUE_MID }}>{eur(data.ventilation.totalTtc)}</Text>
            </View>
          </View>
        </View>

        {data.paiement ? <Text style={s.payLine}>Règlement : {data.paiement}.</Text> : null}

        {/* MENTIONS LÉGALES (dynamiques) */}
        <View style={s.footer}>
          <View style={s.legal}>
            <Text>{legalMain}</Text>
            {ibanLine ? <Text>{ibanLine}</Text> : null}
            <Text>TVA acquittée sur les débits.</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

// Rendu serveur → Buffer PDF (pour pièce jointe mail).
// FactureDoc renvoie un <Document> ; le cast satisfait la signature de renderToBuffer.
export async function renderFactureBuffer(data: FactureData): Promise<Buffer> {
  const el = createElement(FactureDoc, { data }) as unknown as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(el);
}
