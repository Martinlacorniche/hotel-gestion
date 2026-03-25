import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const TEAL      = '#0f766e';
const TEAL_MID  = '#0d9488';
const SLATE_800 = '#1e293b';
const SLATE_600 = '#475569';
const SLATE_400 = '#94a3b8';
const SLATE_100 = '#f1f5f9';
const SLATE_50  = '#f8fafc';

function formatEur(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\u00a0/g, ' ') + ' EUR';
}

const s = StyleSheet.create({
  page: {
    paddingHorizontal: 30,
    paddingTop: 20,
    paddingBottom: 36,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: SLATE_600,
  },

  // ── Header ──
  header: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 12, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0',
  },
  logo: { width: 36, height: 36, marginRight: 9 },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: 'flex-end' },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: TEAL, letterSpacing: 0.8 },
  refLine: { fontSize: 6.5, color: SLATE_400, marginTop: 2 },
  hotelName: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: TEAL_MID },
  hotelAddress: { fontSize: 6.5, color: SLATE_400, marginTop: 2, lineHeight: 1.4 },

  // ── Synthèse (barre fine 4 colonnes) ──
  synth: {
    flexDirection: 'row',
    backgroundColor: SLATE_50,
    borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 5,
    marginBottom: 10,
    paddingVertical: 7, paddingHorizontal: 10,
  },
  synthCol: { flex: 1, paddingRight: 10 },
  synthColLast: { flex: 1 },
  synthSep: { width: 0.5, backgroundColor: '#e2e8f0', marginHorizontal: 6 },
  slabel: { fontSize: 6, fontFamily: 'Helvetica-Bold', color: TEAL_MID, letterSpacing: 0.7, marginBottom: 3 },
  sval: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: SLATE_800 },
  ssub: { fontSize: 7, color: SLATE_600, marginTop: 1.5 },
  saccent: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: TEAL, marginTop: 1.5 },
  sbadge: {
    alignSelf: 'flex-start', marginTop: 3,
    fontSize: 6.5, fontFamily: 'Helvetica-Bold',
    paddingVertical: 2, paddingHorizontal: 5,
    borderRadius: 3,
  },

  // ── Programme table ──
  progTable: { marginBottom: 8 },
  progHeader: {
    flexDirection: 'row', backgroundColor: TEAL,
    borderRadius: 4,
    paddingVertical: 5, paddingHorizontal: 7, marginBottom: 1,
  },
  progRow: {
    flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 7,
    borderBottomWidth: 0.5, borderBottomColor: SLATE_100,
    alignItems: 'center',
  },
  progRowAlt: { backgroundColor: '#f9fafb' },
  thText: { color: '#fff', fontSize: 6.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.3 },
  colDate:   { width: '13%' },
  colHeure:  { width: '10%' },
  colType:   { width: '11%' },
  colMoment: { width: '30%' },
  colSalle:  { width: '20%' },
  colDispo:  { width: '16%' },

  // ── Sections génériques ──
  section: {
    marginBottom: 7,
    borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 4,
  },
  sectionHeader: {
    paddingVertical: 5, paddingHorizontal: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0',
  },
  sectionTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.7 },
  sectionBody: { padding: 8 },
  row: { flexDirection: 'row', marginBottom: 4 },
  rowLabel: { width: '32%', fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: SLATE_400 },
  rowVal: { flex: 1, fontSize: 8, color: SLATE_800 },
  noteBox: {
    marginTop: 4, padding: 6,
    backgroundColor: SLATE_50,
    borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 3,
  },
  noteLabel: { fontSize: 5.5, fontFamily: 'Helvetica-Bold', color: SLATE_400, letterSpacing: 0.5, marginBottom: 2 },
  noteText: { fontSize: 7.5, color: SLATE_600, lineHeight: 1.5 },

  // ── Facturation (4 cellules sur 1 ligne) ──
  factuGrid: { flexDirection: 'row', marginBottom: 4 },
  factuCell: { flex: 1, paddingRight: 6 },
  factuSep: { width: 0.5, backgroundColor: '#e2e8f0', marginRight: 6 },
  factuCellLabel: { fontSize: 5.5, fontFamily: 'Helvetica-Bold', color: SLATE_400, letterSpacing: 0.5, marginBottom: 2 },
  factuCellVal: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: SLATE_800 },

  // ── Prestations ──
  prestItem: { flexDirection: 'row', paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: SLATE_100 },
  prestQty: { width: '10%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: TEAL_MID },
  prestLabel: { flex: 1, fontSize: 7.5, color: SLATE_800 },
  prestPrice: { width: '20%', fontSize: 7.5, color: SLATE_600, textAlign: 'right' },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 14, left: 30, right: 30,
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 0.5, borderTopColor: SLATE_100, paddingTop: 5,
  },
  footerText: { fontSize: 6, color: SLATE_400 },
});

function Section({ title, color, children, noWrap = true }: { title: string; color: string; children: React.ReactNode; noWrap?: boolean }) {
  return (
    <View style={s.section} wrap={!noWrap}>
      <View style={s.sectionHeader}>
        <Text style={[s.sectionTitle, { color }]}>{title}</Text>
      </View>
      <View style={s.sectionBody}>{children}</View>
    </View>
  );
}

const TYPE_LABELS: Record<string, string> = {
  seminaire: 'SEMIN.', repas: 'REPAS', pause: 'PAUSE', autre: 'AUTRE',
};
const TYPE_COLORS: Record<string, string> = {
  seminaire: '#0f766e', repas: '#15803d', pause: '#b45309', autre: '#94a3b8',
};
const STATUT_COLORS: Record<string, string> = {
  'Nouveau': '#3b82f6', 'Devis envoyé': '#f59e0b', 'Option': '#8b5cf6',
  'Confirmé': '#10b981', 'Refus': '#ef4444',
};

export function FichePDFPage({ data }: { data: any }) {
  const { lead, hotel, quoteItems, fiche, programmeRows, ficheDate } = data;

  const fmtDate = (d: string) => d
    ? new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '-';

  const dateDebut = fmtDate(lead?.date_evenement);
  const dateFin = (lead?.date_fin_evenement && lead.date_fin_evenement !== lead.date_evenement)
    ? fmtDate(lead.date_fin_evenement)
    : null;

  const contactParts = [lead?.email, lead?.telephone].filter(Boolean);
  const rows: any[] = (programmeRows || []).filter((r: any) => r.heure || r.label);
  const allQuoteItems = (quoteItems || []).filter((i: any) => i.label?.trim());
  const budget = lead?.budget_estime ? Number(lead.budget_estime) : 0;
  const paye   = lead?.montant_paye  ? Number(lead.montant_paye)  : 0;
  const reste  = Math.max(0, budget - paye);
  const statutColor = STATUT_COLORS[lead?.statut] || SLATE_400;

  return (
    <Page size="A4" style={s.page}>

        {/* ── HEADER ── */}
        <View style={s.header} fixed>
          <Image src="/logo-la corniche.png" style={s.logo} />
          <View style={s.headerLeft}>
            <Text style={s.title}>FICHE DE FONCTIONS</Text>
            <Text style={s.refLine}>Etablie le {ficheDate} · {lead?.nom_client}</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.hotelName}>{hotel?.nom || 'Hotel La Corniche'}</Text>
            <Text style={s.hotelAddress}>{hotel?.adresse || '17 Littoral Frederic Mistral, 83000 Toulon'}</Text>
          </View>
        </View>

        {/* ── SYNTHÈSE (barre 4 colonnes) ── */}
        <View style={s.synth} wrap={false}>
          <View style={s.synthCol}>
            <Text style={s.slabel}>CLIENT</Text>
            <Text style={s.sval}>{lead?.nom_client}</Text>
            {lead?.societe ? <Text style={s.ssub}>{lead.societe}</Text> : null}
          </View>
          <View style={s.synthSep} />
          <View style={s.synthCol}>
            <Text style={s.slabel}>ÉVÉNEMENT</Text>
            <Text style={s.sval}>{lead?.titre_demande}</Text>
            <Text style={s.saccent}>{dateDebut}{dateFin ? ` → ${dateFin}` : ''}</Text>
          </View>
          <View style={s.synthSep} />
          <View style={s.synthCol}>
            <Text style={s.slabel}>CONTACT</Text>
            {contactParts.map((c, i) => <Text key={i} style={s.ssub}>{c}</Text>)}
          </View>
          <View style={s.synthSep} />
          <View style={s.synthColLast}>
            <Text style={s.slabel}>STATUT</Text>
            <Text style={[s.sbadge, { color: statutColor, backgroundColor: `${statutColor}18`, borderWidth: 0.5, borderColor: `${statutColor}40` }]}>
              {lead?.statut}
            </Text>
            {lead?.etat_paiement ? <Text style={[s.ssub, { marginTop: 4 }]}>{lead.etat_paiement}</Text> : null}
          </View>
        </View>

        {/* ── PRESTATIONS ── */}
        {allQuoteItems.length > 0 && (
          <Section title="PRESTATIONS" color={TEAL}>
            {allQuoteItems.map((item: any, i: number) => (
              <View key={i} style={s.prestItem}>
                <Text style={s.prestQty}>{item.quantity}×</Text>
                <Text style={s.prestLabel}>{item.label}</Text>
                {item.unit_price ? (
                  <Text style={s.prestPrice}>{formatEur(Number(item.unit_price) * Number(item.quantity))}</Text>
                ) : null}
              </View>
            ))}
          </Section>
        )}

        {/* ── PROGRAMME ── */}
        {rows.length > 0 && (
          <View style={s.progTable}>
            <View style={s.progHeader}>
              <Text style={[s.thText, s.colDate]}>DATE</Text>
              <Text style={[s.thText, s.colHeure]}>HEURE</Text>
              <Text style={[s.thText, s.colType]}>TYPE</Text>
              <Text style={[s.thText, s.colMoment]}>MOMENT</Text>
              <Text style={[s.thText, s.colSalle]}>SALLE / LIEU</Text>
              <Text style={[s.thText, s.colDispo]}>DISPOSITION</Text>
            </View>
            {rows.map((r: any, i: number) => {
              const typeColor = TYPE_COLORS[r.type] || SLATE_400;
              const dateStr = r.date
                ? new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                : '';
              return (
                <View key={i} style={[s.progRow, i % 2 === 1 ? s.progRowAlt : {}]}>
                  <Text style={[s.colDate, { fontSize: 7, color: SLATE_400 }]}>{dateStr}</Text>
                  <Text style={[s.colHeure, { fontFamily: 'Helvetica-Bold', color: TEAL }]}>{r.heure}</Text>
                  <Text style={[s.colType, { fontSize: 6, fontFamily: 'Helvetica-Bold', color: typeColor }]}>
                    {TYPE_LABELS[r.type] || ''}
                  </Text>
                  <Text style={s.colMoment}>{r.label}</Text>
                  <Text style={s.colSalle}>{r.salle}</Text>
                  <Text style={[s.colDispo, { fontSize: 7 }]}>{r.disposition || ''}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── NOTES GÉNÉRALES ── */}
        {fiche?.notes_generales ? (
          <Section title="NOTES GENERALES" color={TEAL_MID}>
            <Text style={s.noteText}>{fiche.notes_generales}</Text>
          </Section>
        ) : null}

        {/* ── MR. COCKTAIL ── */}
        {lead?.besoin_gaetan && lead.besoin_gaetan !== 'Pas besoin' ? (
          <Section title="MR. COCKTAIL — GAETAN" color="#7c3aed">
            <View style={s.row}>
              <Text style={s.rowLabel}>STATUT</Text>
              <Text style={[s.rowVal, { color: '#7c3aed', fontFamily: 'Helvetica-Bold' }]}>{lead.besoin_gaetan}</Text>
            </View>
            {fiche?.notes_gaetan ? (
              <View style={s.noteBox}>
                <Text style={s.noteText}>{fiche.notes_gaetan}</Text>
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* ── FACTURATION (4 cellules sur 1 ligne) ── */}
        <Section title="FACTURATION" color="#b45309">
          <View style={s.factuGrid}>
            <View style={s.factuCell}>
              <Text style={s.factuCellLabel}>ETAT PAIEMENT</Text>
              <Text style={[s.factuCellVal, { color: '#b45309' }]}>{lead?.etat_paiement || '-'}</Text>
            </View>
            <View style={s.factuSep} />
            <View style={s.factuCell}>
              <Text style={s.factuCellLabel}>BUDGET ESTIME</Text>
              <Text style={s.factuCellVal}>{budget ? formatEur(budget) : '-'}</Text>
            </View>
            <View style={s.factuSep} />
            <View style={s.factuCell}>
              <Text style={s.factuCellLabel}>MONTANT PAYE</Text>
              <Text style={[s.factuCellVal, { color: '#15803d' }]}>{paye ? formatEur(paye) : '-'}</Text>
            </View>
            <View style={s.factuSep} />
            <View style={s.factuCell}>
              <Text style={s.factuCellLabel}>RESTE A PAYER</Text>
              <Text style={[s.factuCellVal, { color: reste > 0 ? '#dc2626' : '#15803d' }]}>{formatEur(reste)}</Text>
            </View>
          </View>
          {fiche?.notes_facturation ? (
            <View style={s.noteBox}>
              <Text style={s.noteText}>{fiche.notes_facturation}</Text>
            </View>
          ) : null}
        </Section>

        {/* ── FOOTER ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Fiche de Fonctions · {lead?.nom_client} · {dateDebut}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

    </Page>
  );
}

export const FichePDF = ({ data }: { data: any }) => (
  <Document title={`Fiche de Fonctions - ${data.lead?.nom_client || ''}`}>
    <FichePDFPage data={data} />
  </Document>
);
