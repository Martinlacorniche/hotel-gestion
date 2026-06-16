export type CleaningFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export type CleaningZone = {
  id: string;
  hotel_id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CleaningTask = {
  id: string;
  zone_id: string;
  name: string;
  frequency: CleaningFrequency;
  product: string | null;
  instructions: string | null;
  estimated_min: number | null;
  assigned_role: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CleaningLog = {
  id: string;
  task_id: string;
  hotel_id: string;
  done_by: string | null;
  done_by_name: string | null;
  done_at: string;
  period_key: string;
  notes: string | null;
};

export const FREQUENCY_LABELS: Record<CleaningFrequency, string> = {
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
};

export const FREQUENCY_BADGE_CLASSES: Record<CleaningFrequency, string> = {
  daily: 'bg-blue-50 text-blue-700 border-blue-200',
  weekly: 'bg-violet-50 text-violet-700 border-violet-200',
  monthly: 'bg-amber-50 text-amber-700 border-amber-200',
  quarterly: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const FREQUENCY_ORDER: CleaningFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly'];

/**
 * Calcule la period_key pour un horodatage et une fréquence donnés.
 * Doit rester aligné avec public.haccp_cleaning_period_key (SQL).
 */
export function periodKeyFor(frequency: CleaningFrequency, at: Date = new Date()): string {
  const d = new Date(at);
  if (frequency === 'daily') {
    return d.toISOString().slice(0, 10);
  }
  if (frequency === 'weekly') {
    // lundi de la semaine ISO
    const day = d.getDay(); // 0 = dim, 1 = lun…
    const diff = (day === 0 ? -6 : 1 - day);
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    return monday.toISOString().slice(0, 10);
  }
  if (frequency === 'monthly') {
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }
  // quarterly
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1).toISOString().slice(0, 10);
}
