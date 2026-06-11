// Types et schéma JSON du routeur de capture universelle.
// Partagé entre l'API route (/api/capture) et la barre de capture (CaptureBar).

export type CaptureType =
  | 'consigne'
  | 'demande'
  | 'ticket'
  | 'maintenance'
  | 'objet_trouve'
  | 'cloture'
  | 'inconnu';

// Élément ouvert proposable à la clôture. Le client le construit, n'envoie
// que le label à l'API (le modèle référence par index), et garde id/kind
// pour exécuter l'update après confirmation.
export type OpenItemKind = 'consigne' | 'demande' | 'ticket' | 'maintenance';

export interface OpenItem {
  kind: OpenItemKind;
  id: string | number;
  label: string;
}

export const DEMANDE_TYPES = ['Taxi', 'Réveil', 'VTC'] as const;
export const TICKET_SERVICES = ['Réception', 'Housekeeping', 'F&B', 'Maintenance'] as const;
export const TICKET_PRIORITES = ['Basse', 'Moyenne', 'Haute'] as const;
export const MAINTENANCE_TYPES = [
  'plomberie',
  'electricité',
  'luminaires',
  'sol',
  'salle de bain',
  'murs',
  'portes',
  'clim',
  'dégat',
  'autres',
] as const;

export interface CaptureProposal {
  type: CaptureType;
  resume: string;
  hotel: string | null;
  consigne?: {
    texte: string;
    date_fin: string | null;
  };
  demande?: {
    type_demande: (typeof DEMANDE_TYPES)[number];
    chambre: string;
    date: string;
    heure: string;
    prix: number | null;
  };
  ticket?: {
    titre: string;
    service: (typeof TICKET_SERVICES)[number];
    priorite: (typeof TICKET_PRIORITES)[number];
    date_action: string;
    date_fin: string | null;
  };
  maintenance?: {
    titre: string;
    type: (typeof MAINTENANCE_TYPES)[number];
    chambres: string[];
    commentaire: string | null;
  };
  objet_trouve?: {
    date: string;
    chambre: string;
    nom_client: string;
    objet: string;
  };
  cloture?: {
    target_index: number;
    temps_travail: number | null;
    budget: number | null;
  };
}

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

// Schéma d'UN élément capturé. Une note peut en produire plusieurs
// (ex : "réveil 17 6h30 + taxi gare 7h15" → 2 éléments).
const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'resume', 'hotel'],
  properties: {
    type: {
      type: 'string',
      enum: ['consigne', 'demande', 'ticket', 'maintenance', 'objet_trouve', 'cloture', 'inconnu'],
      description: 'Le module cible de la note capturée, ou "cloture" pour clôturer un élément ouvert.',
    },
    resume: {
      type: 'string',
      description: 'Une phrase courte en français reformulant ce qui va être créé.',
    },
    hotel: {
      ...nullableString,
      description:
        'Nom EXACT de l’hôtel (parmi la liste fournie) si la note le mentionne explicitement, sinon null.',
    },
    consigne: {
      type: 'object',
      additionalProperties: false,
      required: ['texte', 'date_fin'],
      properties: {
        texte: { type: 'string', description: 'Texte de la consigne, reformulé proprement.' },
        date_fin: { ...nullableString, description: 'Date de fin yyyy-MM-dd, ou null si permanente.' },
      },
    },
    demande: {
      type: 'object',
      additionalProperties: false,
      required: ['type_demande', 'chambre', 'date', 'heure', 'prix'],
      properties: {
        type_demande: { type: 'string', enum: [...DEMANDE_TYPES] },
        chambre: { type: 'string', description: 'Numéro de chambre, "" si non précisé.' },
        date: { type: 'string', description: 'Date yyyy-MM-dd.' },
        heure: { type: 'string', description: 'Heure HH:mm.' },
        prix: { ...nullableNumber, description: 'Prix en euros, uniquement pour un VTC, sinon null.' },
      },
    },
    ticket: {
      type: 'object',
      additionalProperties: false,
      required: ['titre', 'service', 'priorite', 'date_action', 'date_fin'],
      properties: {
        titre: { type: 'string' },
        service: { type: 'string', enum: [...TICKET_SERVICES] },
        priorite: { type: 'string', enum: [...TICKET_PRIORITES] },
        date_action: { type: 'string', description: 'Date yyyy-MM-dd à laquelle faire la tâche.' },
        date_fin: { ...nullableString, description: 'Date limite yyyy-MM-dd, ou null.' },
      },
    },
    maintenance: {
      type: 'object',
      additionalProperties: false,
      required: ['titre', 'type', 'chambres', 'commentaire'],
      properties: {
        titre: { type: 'string', description: 'Description courte du problème.' },
        type: { type: 'string', enum: [...MAINTENANCE_TYPES] },
        chambres: {
          type: 'array',
          items: { type: 'string' },
          description: 'Chambres ou lieux concernés. ["?"] si non précisé.',
        },
        commentaire: { ...nullableString, description: 'Détails supplémentaires, ou null.' },
      },
    },
    objet_trouve: {
      type: 'object',
      additionalProperties: false,
      required: ['date', 'chambre', 'nom_client', 'objet'],
      properties: {
        date: { type: 'string', description: 'Date yyyy-MM-dd (aujourd’hui si non précisée).' },
        chambre: { type: 'string', description: 'Chambre, "" si non précisée.' },
        nom_client: { type: 'string', description: 'Nom du client, "" si non précisé.' },
        objet: { type: 'string', description: 'Description de l’objet.' },
      },
    },
    cloture: {
      type: 'object',
      additionalProperties: false,
      required: ['target_index', 'temps_travail', 'budget'],
      properties: {
        target_index: {
          type: 'integer',
          description: 'Index (0-based) de l’élément ouvert à clôturer dans la liste fournie.',
        },
        temps_travail: {
          ...nullableNumber,
          description:
            'Heures de travail mentionnées dans la note (maintenance uniquement), sinon null.',
        },
        budget: {
          ...nullableNumber,
          description: 'Coût en euros mentionné dans la note (maintenance uniquement), sinon null.',
        },
      },
    },
  },
} as const;

// Schéma racine pour structured outputs (output_config.format).
export const CAPTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: PROPOSAL_SCHEMA,
      description: 'Un élément par action/information distincte contenue dans la note.',
    },
  },
} as const;
