import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

// react-pdf n'accepte pas gap, height:'auto', display:'flex' dans StyleSheet
// Tous ces problèmes sont corrigés ci-dessous.

const VOILES_ID   = 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53';
const CORNICHE_ID = 'f9d59e56-9a2f-433e-bcf4-f9753f105f32';

export type HotelBranding = {
  name: string;
  logo: string;
  addressLine1: string;
  addressLine2: string;
  phone?: string;
  website?: string;
  email?: string;
  legalFooter: string;
};

const CORNICHE_BRANDING: HotelBranding = {
  name: 'Hôtel La Corniche****',
  logo: '/logo-la corniche.png',
  addressLine1: '17 Littoral Frédéric Mistral',
  addressLine2: '83000 Toulon, France',
  phone: '+33 (0)4 94 41 35 12',
  website: 'hotel-corniche.com',
  email: 'contact@hotel-corniche.com',
  legalFooter: 'HÔTEL LA CORNICHE — 17 LITTORAL FRÉDÉRIC MISTRAL, 83000 TOULON — +33 (0)4 94 41 35 12 — HOTEL-CORNICHE.COM',
};

const VOILES_BRANDING: HotelBranding = {
  name: 'Hôtel Les Voiles',
  logo: '/voiles.jpg',
  addressLine1: '124 rue Gubler',
  addressLine2: '83000 Toulon, France',
  legalFooter: 'HÔTEL LES VOILES — 124 RUE GUBLER, 83000 TOULON',
};

export function getHotelBranding(hotelId?: string | null, hotelName?: string | null): HotelBranding {
  if (hotelId === VOILES_ID) return VOILES_BRANDING;
  if (hotelId === CORNICHE_ID) return CORNICHE_BRANDING;
  if (hotelName && /voiles/i.test(hotelName)) return VOILES_BRANDING;
  return CORNICHE_BRANDING;
}

const BLUE      = '#075985';
const BLUE_MID  = '#0369a1';
const BLUE_LIGHT= '#0ea5e9';
const SLATE_800 = '#1e293b';
const SLATE_600 = '#475569';
const SLATE_400 = '#94a3b8';
const SLATE_100 = '#f1f5f9';
const SLATE_50  = '#f8fafc';
const ICE       = '#f0f9ff';
const ICE_BORDER= '#e0f2fe';

const s = StyleSheet.create({
  page: {
    paddingHorizontal: 36,
    paddingVertical: 32,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: SLATE_600,
    // Flex column par défaut dans react-pdf
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: { flex: 1 },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  logo: { width: 50, height: 50, alignSelf: 'flex-start' },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  refLine: { fontSize: 7, color: SLATE_400, marginTop: 4 },
  hotelName: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: BLUE_MID, textTransform: 'uppercase' },
  hotelAddress: { fontSize: 7, color: SLATE_400, marginTop: 2, lineHeight: 1.4 },

  // ── Blocs infos client / événement ──────────────────────────────────────
  infoGrid: { flexDirection: 'row', marginBottom: 24 },
  infoCol: {
    flex: 1,
    padding: 12,
    backgroundColor: SLATE_50,
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
    borderRadius: 8,
  },
  infoColLeft:  { marginRight: 8 },  // remplace gap
  infoColRight: { marginLeft: 8 },
  label: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: BLUE_LIGHT,
    textTransform: 'uppercase',
    marginBottom: 5,
    letterSpacing: 0.8,
  },
  infoName:  { fontFamily: 'Helvetica-Bold', fontSize: 11, color: SLATE_800 },
  infoSub:   { fontSize: 8, color: SLATE_600, marginTop: 3 },
  infoAccent:{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: BLUE_LIGHT, marginTop: 3 },

  // ── Tableau ─────────────────────────────────────────────────────────────
  // Pas de borderRadius sur fond coloré → utiliser un View en dessous
  tableHeaderWrap: {
    marginBottom: 4,
    borderRadius: 6,
    overflow: 'hidden',  // pour que borderRadius soit respecté
    backgroundColor: BLUE,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: SLATE_100,
    alignItems: 'center',
  },
  tableRowAlt: { backgroundColor: '#fafbfc' },
  colDate:  { width: '13%', fontSize: 7, color: SLATE_400 },
  colDesc:       { width: '42%', paddingRight: 8 },
  colDescTitle:  { fontSize: 8, fontFamily: 'Helvetica-Bold', color: SLATE_800 },
  colDescDetail: { fontSize: 6.5, color: SLATE_400, marginTop: 2, lineHeight: 1.4 },
  colQty:   { width: '8%',  textAlign: 'center' },
  colPU:    { width: '13%', textAlign: 'right' },
  colTVA:   { width: '9%',  textAlign: 'center', color: SLATE_400 },
  colTotal: { width: '15%', textAlign: 'right', fontFamily: 'Helvetica-Bold', color: BLUE_MID },
  thText:   { color: '#ffffff', fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },

  // ── Totaux ───────────────────────────────────────────────────────────────
  recapSection: { flexDirection: 'row', marginTop: 20 },
  tvaSection:   { flex: 1, paddingRight: 16 },
  totalBox: {
    width: 175,
    padding: 14,
    backgroundColor: ICE,
    borderWidth: 1,
    borderColor: ICE_BORDER,
    borderRadius: 8,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  totalLabel: { fontSize: 8, color: SLATE_600 },
  totalVal:   { fontSize: 8 },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
    paddingTop: 8,
    marginTop: 4,
  },

  // ── Footer CGV + Signature — wrap:false pour ne jamais couper ───────────
  footer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: 16,
  },
  footerInner: {
    flexDirection: 'row',
  },
  footerLeft:  { flex: 1.5, paddingRight: 20 },
  footerRight: { flex: 1, alignItems: 'flex-end' },

  signatureBox: {
    width: 200,
    height: 72,
    backgroundColor: SLATE_50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    marginTop: 8,
    // PAS de display:'flex' — react-pdf est flex par défaut
    justifyContent: 'center',
    alignItems: 'center',
  },

  legal: {
    marginTop: 18,
    borderTopWidth: 0.5,
    borderTopColor: SLATE_100,
    paddingTop: 8,
    textAlign: 'center',
    fontSize: 5.5,
    color: '#cbd5e1',
    lineHeight: 1.6,
    letterSpacing: 0.3,
  },
});

export const QuotePDFPage = ({ data, lines, totals }: any) => {
  const branding: HotelBranding = data.branding || getHotelBranding(data.hotelId, data.hotelName);
  const contactLine = [branding.phone, branding.website].filter(Boolean).join(' — ');
  return (
  <Page size="A4" style={s.page}>

      {/* ── HEADER ── */}
      <View style={s.header} fixed>
        <View style={s.headerLeft}>
          <Text style={s.title}>Proposition</Text>
          <Text style={s.refLine}>RÉF : {data.quoteNumber} — Émise le {data.quoteDate}</Text>
        </View>
        <Image src={branding.logo} style={s.logo} />
        <View style={s.headerRight}>
          <Text style={s.hotelName}>{branding.name}</Text>
          <Text style={s.hotelAddress}>{branding.addressLine1}, {branding.addressLine2}</Text>
          {contactLine ? <Text style={s.hotelAddress}>{contactLine}</Text> : null}
        </View>
      </View>

      {/* ── CLIENT & ÉVÉNEMENT ── */}
      <View style={s.infoGrid} wrap={false}>
        <View style={[s.infoCol, s.infoColLeft]}>
          <Text style={s.label}>Client</Text>
          <Text style={s.infoName}>{data.clientName}</Text>
          <Text style={s.infoSub}>{data.clientEmail}</Text>
        </View>
        <View style={[s.infoCol, s.infoColRight]}>
          <Text style={s.label}>Détails de l'événement</Text>
          <Text style={s.infoName}>{data.eventTitle}</Text>
          <Text style={s.infoAccent}>Prévu le {data.eventDate}</Text>
        </View>
      </View>

      {/* ── TABLEAU PRESTATIONS ── */}
      {/* En-tête tableau : borderRadius via wrapper overflow:hidden */}
      <View style={s.tableHeaderWrap} wrap={false}>
        <View style={s.tableHeader}>
          <Text style={[s.colDate,  s.thText]}>DATE</Text>
          <Text style={[s.colDesc,  s.thText]}>DÉSIGNATION</Text>
          <Text style={[s.colQty,   s.thText]}>QTÉ</Text>
          <Text style={[s.colPU,    s.thText]}>P.U TTC</Text>
          <Text style={[s.colTVA,   s.thText]}>TVA</Text>
          <Text style={[s.colTotal, s.thText]}>TOTAL</Text>
        </View>
      </View>

      {lines.map((line: any, i: number) => (
        <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}, { alignItems: 'flex-start' }]} wrap={false}>
          <Text style={[s.colDate, { paddingTop: 1 }]}>{line.date}</Text>
          <View style={s.colDesc}>
            <Text style={s.colDescTitle}>{line.description}</Text>
            {line.detail ? <Text style={s.colDescDetail}>{line.detail}</Text> : null}
          </View>
          <Text style={[s.colQty, { paddingTop: 1 }]}>{line.quantity}</Text>
          <Text style={[s.colPU,    { paddingTop: 1 }]}>{line.unitPriceTTC} €</Text>
          <Text style={[s.colTVA,   { paddingTop: 1 }]}>{line.tvaRate}%</Text>
          <Text style={[s.colTotal, { paddingTop: 1 }]}>{line.totalTTC} €</Text>
        </View>
      ))}

      {/* ── TOTAUX ── */}
      <View style={s.recapSection} wrap={false}>
        <View style={s.tvaSection}>
          <Text style={s.label}>Détail des taxes</Text>
          {Object.entries(totals?.tvaDetails || {}).map(([rate, vals]: any) => (
            <Text key={rate} style={{ fontSize: 7, color: SLATE_400, marginBottom: 3 }}>
              TVA {rate}% sur {Number(vals?.ht || 0).toFixed(2)} € HT
              {' '}= {Number(vals?.tva || 0).toFixed(2)} € TVA
            </Text>
          ))}
        </View>
        <View style={s.totalBox}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Montant HT</Text>
            <Text style={s.totalVal}>{totals.ht} €</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>TVA</Text>
            <Text style={s.totalVal}>{totals.tva} €</Text>
          </View>
          <View style={s.grandTotal}>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 10, color: BLUE_MID }}>TOTAL TTC</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 14, color: BLUE_MID }}>{totals.ttc} €</Text>
          </View>
        </View>
      </View>

      {/* ── FOOTER : CGV + Signature — jamais découpé ── */}
      <View style={s.footer} wrap={false}>
        <View style={s.footerInner}>
          <View style={s.footerLeft}>
            <Text style={s.label}>Conditions Particulières</Text>
            {data.conditions && data.conditions.map((cond: string, i: number) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 4 }}>
                <Text style={{ fontSize: 7, width: 8, color: BLUE_LIGHT }}>•</Text>
                <Text style={{ fontSize: 7, flex: 1, color: SLATE_600, lineHeight: 1.4 }}>{cond}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 6, color: '#cbd5e1', marginTop: 8 }}>
              IBAN : FR76 4255 9100 0008 0284 3567 534 — BIC : CCOPFRPPXXX
            </Text>
          </View>
          <View style={s.footerRight}>
            <Text style={s.label}>Bon pour accord</Text>
            <View style={s.signatureBox}>
              <Text style={{ fontSize: 6, color: '#cbd5e1', textTransform: 'uppercase', textAlign: 'center' }}>
                Signature & Cachet
              </Text>
            </View>
          </View>
        </View>

        {/* Mentions légales */}
        <View style={s.legal}>
          <Text>SARL AU CAPITAL DE 10 000€ — SIRET : 341 797 199 00013 — TVA INTRACOM : FR50341797199 — RCS TOULON 87800562</Text>
          <Text>{branding.legalFooter}</Text>
        </View>
      </View>

  </Page>
  );
};

export const QuotePDF = ({ data, lines, totals }: any) => (
  <Document title={`Proposition Commerciale - ${data.clientName}`}>
    <QuotePDFPage data={data} lines={lines} totals={totals} />
  </Document>
);