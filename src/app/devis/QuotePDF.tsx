import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 9, color: '#334155' },
  
  // Header avec courbes et aération
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 40,
    paddingBottom: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0'
  },
  headerCol: { flex: 1 },
  logo: { width: 100, height: 'auto', alignSelf: 'center' },
  
  title: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#075985', // Bleu Horizon Méditerranée
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  hotelName: { fontSize: 10, fontWeight: 'bold', color: '#0369a1', textTransform: 'uppercase', textAlign: 'right' },
  hotelAddress: { fontSize: 7, textAlign: 'right', marginTop: 2, color: '#64748b', lineHeight: 1.4 },

  // Blocs Client & Projet arrondis
  infoGrid: { flexDirection: 'row', marginBottom: 35, gap: 15 },
  infoCol: { 
    flex: 1, 
    padding: 15, 
    backgroundColor: '#f8fafc', // Gris perle doux
    borderRadius: 12, // Rondeur prononcée
    borderWidth: 0.5,
    borderColor: '#e2e8f0'
  },
  label: { fontSize: 7, fontWeight: 'bold', color: '#0ea5e9', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 1 },

  // Tableau "Soft" sans bordures agressives
  tableHeader: { 
    flexDirection: 'row', 
    backgroundColor: '#075985', 
    padding: 10, 
    borderRadius: 8, // Arrondi sur l'entête
    color: '#ffffff',
    marginBottom: 5
  },
  tableRow: { 
    flexDirection: 'row', 
    paddingVertical: 12, 
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f1f5f9',
    alignItems: 'center' 
  },
  colDate: { width: '15%', fontSize: 7, color: '#64748b' },
  colDesc: { width: '40%', fontSize: 8, fontWeight: 'bold', color: '#1e293b', paddingRight: 10 },
  colQty: { width: '8%', textAlign: 'center' },
  colPU: { width: '12%', textAlign: 'right' },
  colTVA: { width: '10%', textAlign: 'center', color: '#94a3b8' },
  colTotal: { width: '15%', textAlign: 'right', fontWeight: 'bold', color: '#0369a1' },

  // Totaux épurés
  recapSection: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 25 },
  totalBox: { 
    width: 180, 
    padding: 15, 
    backgroundColor: '#f0f9ff', // Bleu très léger
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0f2fe'
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  grandTotal: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    borderTopWidth: 1, 
    borderTopColor: '#0ea5e9', 
    paddingTop: 10, 
    marginTop: 5 
  },

  // Signature "Signature Experience"
  footer: { marginTop: 'auto', paddingTop: 20 },
  signatureBox: { 
    width: 220, 
    height: 80, 
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    marginTop: 10,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  },
  
  // NOUVEAU : Mentions légales
  legalMention: {
    marginTop: 25,
    textAlign: 'center',
    fontSize: 5.5,
    color: '#cbd5e1', // Gris très clair
    lineHeight: 1.6,
    letterSpacing: 0.3
  }
});

export const QuotePDF = ({ data, lines, totals }: any) => (
  <Document title={`Proposition Commerciale - ${data.clientName}`}>
    <Page size="A4" style={styles.page}>
      
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerCol}>
          <Text style={styles.title}>Proposition</Text>
          <Text style={{ color: '#94a3b8', fontSize: 7, marginTop: 5 }}>RÉF : {data.quoteNumber} — Émise le {data.quoteDate}</Text>
        </View>
        <Image src="/logo-la corniche.png" style={styles.logo} />
        <View style={styles.headerCol}>
          <Text style={styles.hotelName}>Hôtel La Corniche****</Text>
          <Text style={styles.hotelAddress}>17 Littoral Frédéric Mistral, 83000 Toulon</Text>
          <Text style={styles.hotelAddress}>+33 (0)4 94 41 35 12 — hotel-corniche.com</Text>
        </View>
      </View>

      {/* CLIENT & PROJET */}
      <View style={styles.infoGrid}>
        <View style={styles.infoCol}>
          <Text style={styles.label}>Client </Text>
          <Text style={{ fontWeight: 'bold', fontSize: 11, color: '#1e293b' }}>{data.clientName}</Text>
          <Text style={{ fontSize: 8, color: '#64748b', marginTop: 4 }}>{data.clientEmail}</Text>
        </View>
        <View style={styles.infoCol}>
          <Text style={styles.label}>Détails de l'événement</Text>
          <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#1e293b' }}>{data.eventTitle}</Text>
          <Text style={{ fontSize: 8, color: '#0ea5e9', marginTop: 4, fontWeight: 'bold' }}>Prévu le {data.eventDate}</Text>
        </View>
      </View>

      {/* TABLEAU PRESTATIONS */}
      <View style={styles.tableHeader}>
        <Text style={[styles.colDate, { color: '#fff' }]}>DATE</Text>
        <Text style={[styles.colDesc, { color: '#fff' }]}>DÉSIGNATION</Text>
        <Text style={[styles.colQty, { color: '#fff' }]}>QTÉ</Text>
        <Text style={[styles.colPU, { color: '#fff' }]}>P.U TTC</Text>
        <Text style={[styles.colTVA, { color: '#fff' }]}>TVA</Text>
        <Text style={[styles.colTotal, { color: '#fff' }]}>TOTAL</Text>
      </View>
      
      {lines.map((line: any, i: number) => (
        <View key={i} style={styles.tableRow} wrap={false}>
          <Text style={styles.colDate}>{line.date}</Text>
          <Text style={styles.colDesc}>{line.description}</Text>
          <Text style={styles.colQty}>{line.quantity}</Text>
          <Text style={styles.colPU}>{line.unitPriceTTC} €</Text>
          <Text style={styles.colTVA}>{line.tvaRate}%</Text>
          <Text style={styles.colTotal}>{line.totalTTC} €</Text>
        </View>
      ))}

      {/* TOTALS */}
      <View style={styles.recapSection}>
        <View style={{ width: '50%' }}>
          <Text style={styles.label}>Détail des taxes</Text>
          {Object.entries(totals?.tvaDetails || {}).map(([rate, vals]: any) => (
            <Text key={rate} style={{ fontSize: 7, color: '#94a3b8', marginBottom: 3 }}>
              TVA {rate}% sur {Number(vals?.ht || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}€ : {Number(vals?.tva || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}€
            </Text>
          ))}
        </View>
        <View style={styles.totalBox}>
          <View style={styles.totalRow}>
            <Text style={{ fontSize: 8, color: '#64748b' }}>Montant Total HT</Text>
            <Text style={{ fontSize: 8 }}>{totals.ht} €</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text style={{ fontWeight: 'bold', fontSize: 11, color: '#0369a1' }}>TOTAL TTC</Text>
            <Text style={{ fontWeight: 'bold', fontSize: 13, color: '#0369a1' }}>{totals.ttc} €</Text>
          </View>
        </View>
      </View>

      {/* FOOTER & SIGNATURE */}
      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', gap: 30 }}>
          <View style={{ flex: 1.5 }}>
            <Text style={styles.label}>Conditions Générales</Text>
            {data.conditions && data.conditions.map((c: string, i: number) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 5 }}>
                <Text style={{ fontSize: 7, width: 8, color: '#0ea5e9' }}>•</Text>
                <Text style={{ fontSize: 7, flex: 1, color: '#64748b', lineHeight: 1.4 }}>{c}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 6, color: '#cbd5e1', marginTop: 10 }}>IBAN : FR76 4255 9100 0008 0284 3567 534 — BIC: CCOPFRPPXXX</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={styles.label}>Bon pour accord</Text>
            <View style={styles.signatureBox}>
              <Text style={{ fontSize: 6, color: '#cbd5e1', textTransform: 'uppercase' }}>Signature & Cachet</Text>
            </View>
          </View>
        </View>

        {/* NOUVEAU : Mentions légales intégrées */}
        <View style={styles.legalMention}>
          <Text>SARL AU CAPITAL DE 10 000€ — SIRET : 341 797 199 00013 — TVA INTRACOM : FR50341797199 — RCS TOULON 87800562</Text>
          <Text>HÔTEL LA CORNICHE — 17 LITTORAL FRÉDÉRIC MISTRAL, 83000 TOULON — +33 (0)4 94 41 35 12 — HOTEL-CORNICHE.COM</Text>
        </View>

      </View>
    </Page>
  </Document>
);