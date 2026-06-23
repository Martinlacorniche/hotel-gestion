// En-tête de page partagé — garantit une typographie et un agencement cohérents
// sur tous les écrans (titre + icône + sous-titre, actions à droite).
// Le retour à l'accueil est assuré par la sidebar (rail), donc plus de flèche
// « retour accueil » à dupliquer dans chaque page.
import type { LucideIcon } from 'lucide-react';

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  iconClassName = 'bg-indigo-50 text-[var(--brand)]',
  actions,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  iconClassName?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 flex items-center gap-3 ${className}`}>
      {Icon && (
        <div className={`flex items-center justify-center w-11 h-11 rounded-xl shrink-0 ${iconClassName}`}>
          <Icon className="w-6 h-6" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-800 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 truncate">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export default PageHeader;
