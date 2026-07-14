import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Tuile de statistique (KPI) unifiée : valeur dominante + libellé + icône/indice
// optionnels. Chiffres en tabular-nums pour un alignement propre en grille.
export function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-3.5 flex items-start gap-3', className)}>
      {Icon && (
        <span className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--brand-bg)] text-[var(--brand)]">
          <Icon className="w-5 h-5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xl font-bold tracking-tight text-slate-800 leading-none tabular-nums">{value}</div>
        <div className="text-xs text-slate-500 mt-1 truncate">{label}</div>
        {hint != null && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}
