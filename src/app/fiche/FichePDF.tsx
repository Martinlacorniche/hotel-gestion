import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const TEAL       = '#0f766e';
const TEAL_MID   = '#0d9488';
const TEAL_LIGHT = '#5eead4';
const SLATE_800  = '#1e293b';
const SLATE_600  = '#475569';
const SLATE_400  = '#94a3b8';
const SLATE_100  = '#f1f5f9';
const SLATE_50   = '#f8fafc';

const DEPT_COLORS: Record<string, string> = {
  housekeeping: '#0369a1',
  reception:    '#7c3aed',
  direction:    '#b45309',
  food:         '#15803d',
  night:        '#1e293b',
};
const DEPT_BG: Record<string, string> = {
  housekeeping: '#eff6ff',
  reception:    '#f5f3ff',
  direction:    '#fffbeb',
  food:         '#f0fdf4',
  night:        '#f8fafc',
};

// Formateur de montant compatible Helvetica (pas d'espace insecable)
function formatEur(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\u00a0/g, ' ') + ' EUR';
}

const s = StyleSheet.create({
  page: {
    paddingHorizontal: 36,
    paddingVertical: 28,
    paddingBottom: 44,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: SLATE_600,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: { flex: 1 },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  logo: { width: 44, height: 44, alignSelf: 'flex-start', marginRight: 10 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: TEAL, letterSpacing: 1 },
  refLine: { fontSize: 7, color: SLATE_400, marginTop: 3 },
  hotelName: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: TEAL_MID },
  hotelAddress: { fontSize: 7, color: SLATE_400, marginTop: 2, lineHeight: 1.4 },
  synthRow: { flexDirection: 'row', marginBottom: 14 },
  synthCol: {
    flex: 1, padding: 10,
    backgroundColor: SLATE_50,
    borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 6,
  },
  synthColL: { marginRight: 6 },
  synthColR: { marginLeft: 6 },
  label: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: TEAL_MID, letterSpacing: 0.8, marginBottom: 4 },
  bigName: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: SLATE_800 },
  sub: { fontSize: 8, color: SLATE_600, marginTop: 2 },
  accent: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: TEAL, marginTop: 2 },
  progTable: { marginBottom: 14 },
  progHeader: {
    flexDirection: 'row', backgroundColor: TEAL,
    borderRadius: 5,
    paddingVertical: 6, paddingHorizontal: 8, marginBottom: 2,
  },
  progRow: {
    flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8,
    borderBottomWidth: 0.5, borderBottomColor: SLATE_100,
    alignItems: 'center',
  },
  progRowAlt: { backgroundColor: '#f9fafb' },
  thText: { color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: 0.4 },
  colHeure: { width: '20%' },
  colMoment: { width: '30%' },
  colSalle: { width: '30%' },
  colPax: { width: '20%', textAlign: 'right' },
  deptSection: {
    marginBottom: 10,
    borderWidth: 0.5, borderColor: '#e2e8f0',
    borderRadius: 4,
  },
  deptHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7, paddingHorizontal: 10,
    borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0',
  },
  deptAccent: { width: 3, marginRight: 8 },
  deptTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.8 },
  deptBody: { padding: 10 },
  deptRow: { flexDirection: 'row', marginBottom: 5 },
  deptLabel: { width: '32%', fontSize: 7, fontFamily: 'Helvetica-Bold', color: SLATE_400 },
  deptVal: { flex: 1, fontSize: 8, color: SLATE_800 },
  deptNoteBox: {
    marginTop: 6, padding: 8,
    backgroundColor: SLATE_50,
    borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 4,
  },
  deptNoteLabel: { fontSize: 6, fontFamily: 'Helvetica-Bold', color: SLATE_400, letterSpacing: 0.6, marginBottom: 3 },
  deptNoteText: { fontSize: 8, color: SLATE_600, lineHeight: 1.5 },
  footer: {
    position: 'absolute',
    bottom: 16, left: 36, right: 36,
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 0.5, borderTopColor: SLATE_100,
    paddingTop: 6,
  },
  footerText: { fontSize: 6.5, color: SLATE_400 },
});

function DeptSection({ title, color, bg, rows, notes }: {
  title: string; color: string; bg: string;
  rows: { label: string; value: string }[];
  notes?: string;
}) {
  const hasContent = rows.some(r => r.value) || notes;
  if (!hasContent) return null;
  return (
    <View style={s.deptSection} wrap={false}>
      <View style={s.deptHeader}>
        <Text style={[s.deptTitle, { color }]}>{title}</Text>
      </View>
      <View style={s.deptBody}>
        {rows.filter(r => r.value).map((r, i) => (
          <View key={i} style={s.deptRow}>
            <Text style={s.deptLabel}>{r.label.toUpperCase()}</Text>
            <Text style={s.deptVal}>{r.value}</Text>
          </View>
        ))}
        {notes ? (
          <View style={s.deptNoteBox}>
            <Text style={s.deptNoteLabel}>NOTES &amp; INSTRUCTIONS</Text>
            <Text style={s.deptNoteText}>{notes}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const FichePDF = ({ data }: { data: any }) => {
  const { lead, hotel, rooms, quoteItems, fiche, ficheDate } = data;

  const hebergItems = (quoteItems || []).filter((i: any) =>
    i.label?.toLowerCase().includes('chambre') || i.category === 'Hebergement'
  );
  const restaurItems = (quoteItems || []).filter((i: any) =>
    i.category === 'Restauration' ||
    i.label?.toLowerCase().includes('menu') ||
    i.label?.toLowerCase().includes('repas') ||
    i.label?.toLowerCase().includes('diner') ||
    i.label?.toLowerCase().includes('dejeuner') ||
    i.label?.toLowerCase().includes('buffet')
  );

  const hebergText = hebergItems.map((i: any) => `${i.quantity}x ${i.label}`).join(' / ') || '-';
  const restaurText = restaurItems.map((i: any) => `${i.quantity}x ${i.label}`).join('\n') || '-';

  const fmtDate = (d: string) => d
    ? new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '-';

  const dateDebut = fmtDate(lead?.date_evenement);
  const dateFin = (lead?.date_fin_evenement && lead.date_fin_evenement !== lead.date_evenement)
    ? fmtDate(lead.date_fin_evenement)
    : null;

  const contactParts = [lead?.email, lead?.telephone].filter(Boolean);
  const contactText = contactParts.join(' - ');

  const progRows: { heure: string; moment: string; salle: string; pax: string }[] = [];
  if (fiche?.heure_petitdej)    progRows.push({ heure: fiche.heure_petitdej.substring(0,5),    moment: 'Petit-dejeuner',  salle: '', pax: fiche.nb_personnes ? String(fiche.nb_personnes) : '' });
  if (fiche?.heure_pause_matin) progRows.push({ heure: fiche.heure_pause_matin.substring(0,5), moment: 'Pause matin',      salle: '', pax: '' });
  if (rooms?.length)            progRows.push({ heure: rooms[0]?.start_time?.substring(0,5) || '', moment: 'Debut seminaire', salle: rooms.map((r: any) => r.room_name || r.name).join(', '), pax: fiche?.nb_personnes ? String(fiche.nb_personnes) : '' });
  if (fiche?.heure_dejeuner)    progRows.push({ heure: fiche.heure_dejeuner.substring(0,5),    moment: 'Dejeuner',         salle: '', pax: fiche.nb_personnes ? String(fiche.nb_personnes) : '' });
  if (fiche?.heure_pause_aprem) progRows.push({ heure: fiche.heure_pause_aprem.substring(0,5), moment: 'Pause apres-midi', salle: '', pax: '' });
  if (rooms?.length)            progRows.push({ heure: rooms[0]?.end_time?.substring(0,5) || '',  moment: 'Fin seminaire',   salle: rooms.map((r: any) => r.room_name || r.name).join(', '), pax: '' });
  if (fiche?.heure_diner)       progRows.push({ heure: fiche.heure_diner.substring(0,5),        moment: 'Diner',            salle: '', pax: fiche.nb_personnes ? String(fiche.nb_personnes) : '' });

  const budgetText = lead?.budget_estime ? formatEur(Number(lead.budget_estime)) : '';

  return (
    <Document title={`Fiche de Fonctions - ${lead?.nom_client || ''}`}>
      <Page size="A4" style={s.page}>

        {/* HEADER */}
        <View style={s.header} fixed>
          <Image src="/logo-la corniche.png" style={s.logo} />
          <View style={s.headerLeft}>
            <Text style={s.title}>FICHE DE FONCTIONS</Text>
            <Text style={s.refLine}>Etablie le {ficheDate} - Ref. dossier : {lead?.nom_client}</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.hotelName}>{hotel?.nom || 'Hotel La Corniche'}</Text>
            <Text style={s.hotelAddress}>{hotel?.adresse || '17 Littoral Frederic Mistral, 83000 Toulon'}</Text>
          </View>
        </View>

        {/* SYNTHESE */}
        <View style={s.synthRow} wrap={false}>
          <View style={[s.synthCol, s.synthColL]}>
            <Text style={s.label}>CLIENT</Text>
            <Text style={s.bigName}>{lead?.nom_client}</Text>
            {lead?.societe ? <Text style={s.sub}>{lead.societe}</Text> : null}
            {contactText ? <Text style={s.sub}>{contactText}</Text> : null}
          </View>
          <View style={[s.synthCol, s.synthColR]}>
            <Text style={s.label}>EVENEMENT</Text>
            <Text style={s.bigName}>{lead?.titre_demande}</Text>
            <Text style={s.accent}>{dateDebut}{dateFin ? ` -> ${dateFin}` : ''}</Text>
            {fiche?.nb_personnes ? <Text style={s.sub}>{fiche.nb_personnes} participant(s)</Text> : null}
            <Text style={[s.sub, { marginTop: 4 }]}>{lead?.statut}{lead?.etat_paiement ? ` - ${lead.etat_paiement}` : ''}</Text>
          </View>
        </View>

        {/* PROGRAMME */}
        {progRows.length > 0 && (
          <View style={s.progTable} wrap={false}>
            <View style={s.progHeader}>
              <Text style={[s.thText, s.colHeure]}>HEURE</Text>
              <Text style={[s.thText, s.colMoment]}>MOMENT</Text>
              <Text style={[s.thText, s.colSalle]}>SALLE / LIEU</Text>
              <Text style={[s.thText, s.colPax]}>PAX</Text>
            </View>
            {progRows.map((r, i) => (
              <View key={i} style={[s.progRow, i % 2 === 1 ? s.progRowAlt : {}]}>
                <Text style={[s.colHeure, { fontFamily: 'Helvetica-Bold', color: TEAL }]}>{r.heure}</Text>
                <Text style={s.colMoment}>{r.moment}</Text>
                <Text style={s.colSalle}>{r.salle}</Text>
                <Text style={s.colPax}>{r.pax}</Text>
              </View>
            ))}
          </View>
        )}

        {/* SECTIONS */}
        <DeptSection
          title="HOUSEKEEPING"
          color={DEPT_COLORS.housekeeping} bg={DEPT_BG.housekeeping}
          rows={[
            { label: 'Hebergement',  value: hebergText },
            { label: 'Arrivee',      value: dateDebut },
            { label: 'Depart',       value: dateFin || dateDebut },
            { label: 'Disposition',  value: fiche?.disposition_salle || '' },
            { label: 'Materiel',     value: fiche?.materiel || '' },
          ]}
          notes={fiche?.notes_housekeeping}
        />

        <DeptSection
          title="RECEPTION"
          color={DEPT_COLORS.reception} bg={DEPT_BG.reception}
          rows={[
            { label: 'Client',       value: lead?.nom_client },
            { label: 'Societe',      value: lead?.societe || '' },
            { label: 'Contact',      value: contactText },
            { label: 'Arrivee',      value: dateDebut },
            { label: 'Depart',       value: dateFin || dateDebut },
            { label: 'Facturation',  value: lead?.etat_paiement || '' },
          ]}
          notes={fiche?.notes_reception}
        />

        <DeptSection
          title="DIRECTION"
          color={DEPT_COLORS.direction} bg={DEPT_BG.direction}
          rows={[
            { label: 'Dossier',      value: lead?.titre_demande },
            { label: 'Participants', value: fiche?.nb_personnes ? `${fiche.nb_personnes} pers.` : '' },
            { label: 'Budget',       value: budgetText },
            { label: 'Statut',       value: lead?.statut || '' },
          ]}
          notes={fiche?.notes_direction}
        />

        <DeptSection
          title="FOOD & BEVERAGE"
          color={DEPT_COLORS.food} bg={DEPT_BG.food}
          rows={[
            { label: 'Prestations',  value: restaurText },
            { label: 'Participants', value: fiche?.nb_personnes ? `${fiche.nb_personnes} pers.` : '' },
            { label: 'Regimes',      value: fiche?.regimes_speciaux || '' },
            { label: 'Petit-dej',    value: fiche?.heure_petitdej ? fiche.heure_petitdej.substring(0,5) : '' },
            { label: 'Dejeuner',     value: fiche?.heure_dejeuner ? fiche.heure_dejeuner.substring(0,5) : '' },
            { label: 'Diner',        value: fiche?.heure_diner ? fiche.heure_diner.substring(0,5) : '' },
          ]}
          notes={fiche?.notes_food}
        />

        <DeptSection
          title="NIGHT"
          color={DEPT_COLORS.night} bg={DEPT_BG.night}
          rows={[
            { label: 'Check-out',    value: dateFin || dateDebut },
            { label: 'Hebergement',  value: hebergText },
          ]}
          notes={fiche?.notes_night}
        />

        {fiche?.programme ? (
          <View style={{ marginBottom: 10, padding: 10, backgroundColor: SLATE_50, borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 6 }} wrap={false}>
            <Text style={[s.label, { marginBottom: 6 }]}>PROGRAMME / NOTES GENERALES</Text>
            <Text style={{ fontSize: 8, color: SLATE_600, lineHeight: 1.6 }}>{fiche.programme}</Text>
          </View>
        ) : null}

        {/* FOOTER */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Fiche de Fonctions - {lead?.nom_client} - {dateDebut}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

      </Page>
    </Document>
  );
};
