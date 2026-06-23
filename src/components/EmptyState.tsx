// État vide partagé — un rendu homogène (icône + message + sous-texte + action)
// au lieu des multiples styles « Aucun … » dispersés dans les pages.
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center mb-4">
          <Icon className="w-8 h-8" />
        </div>
      )}
      <p className="text-slate-600 font-medium">{title}</p>
      {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-sm">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default EmptyState;
