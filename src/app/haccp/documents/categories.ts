// Catégories de documents HACCP — doit matcher le CHECK constraint dans
// db/migrations/04_haccp_documents.sql

export type DocumentCategory =
  | 'pms'
  | 'formation_haccp'
  | 'contrat_nuisibles'
  | 'rapport_nuisibles'
  | 'ft_produit_menage'
  | 'fds_produit_menage'
  | 'maintenance_equipement'
  | 'etalonnage_thermometre'
  | 'eau_potable'
  | 'attestation_fournisseur'
  | 'autre';

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  pms: 'Plan de Maîtrise Sanitaire',
  formation_haccp: 'Formation HACCP',
  contrat_nuisibles: 'Contrat nuisibles',
  rapport_nuisibles: 'Rapport nuisibles',
  ft_produit_menage: 'Fiche technique produit',
  fds_produit_menage: 'Fiche données sécurité (FDS)',
  maintenance_equipement: 'Maintenance équipement',
  etalonnage_thermometre: 'Étalonnage thermomètre',
  eau_potable: 'Analyse eau potable',
  attestation_fournisseur: 'Attestation fournisseur',
  autre: 'Autre',
};

export const CATEGORY_GROUPS: { label: string; values: DocumentCategory[] }[] = [
  { label: 'Document chapeau', values: ['pms'] },
  { label: 'Personnel', values: ['formation_haccp'] },
  { label: 'Nuisibles', values: ['contrat_nuisibles', 'rapport_nuisibles'] },
  { label: 'Produits ménage', values: ['ft_produit_menage', 'fds_produit_menage'] },
  { label: 'Équipements', values: ['maintenance_equipement', 'etalonnage_thermometre'] },
  { label: 'Autres', values: ['eau_potable', 'attestation_fournisseur', 'autre'] },
];

export const ALL_CATEGORIES: DocumentCategory[] =
  Object.keys(CATEGORY_LABELS) as DocumentCategory[];
