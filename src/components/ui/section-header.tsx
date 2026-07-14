import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// En-tête de section unifié : pastille d'icône (teinte du thème user) + titre + count
// optionnel + action à droite. Remplace les h2/h3 ad hoc (souvent préfixés d'un emoji)
// pour une hiérarchie et un style cohérents dans toute l'app.
export function SectionHeader({
  icon: Icon,
  title,
  count,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  count?: number | string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 mb-3 min-h-9', className)}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && (
          <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 text-slate-500">
            <Icon className="w-4 h-4" />
          </span>
        )}
        <h2 className="text-base font-semibold tracking-tight text-slate-800 truncate">{title}</h2>
        {count != null && (
          <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 tabular-nums">
            {count}
          </span>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
