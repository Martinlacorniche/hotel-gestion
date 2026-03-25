import { Document } from '@react-pdf/renderer';
import { FichePDFPage } from './FichePDF';
import { QuotePDFPage } from '../devis/QuotePDF';

export const CombinedPDF = ({ ficheData, quoteData }: { ficheData: any; quoteData: any }) => (
  <Document title={`Fiche + Devis - ${ficheData.lead?.nom_client || ''}`}>
    <FichePDFPage data={ficheData} />
    <QuotePDFPage data={quoteData.data} lines={quoteData.lines} totals={quoteData.totals} />
  </Document>
);
