import * as React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

// Bouton « + » rond et moderne : dégradé aux couleurs du thème de l'utilisateur
// (var(--brand)), ombre douce, micro-interaction au clic. Remplace les boutons
// d'ajout ad hoc en indigo codé en dur.
export function AddButton({
  onClick,
  label = 'Ajouter',
  className,
}: {
  onClick?: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-hover))' }}
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-full text-white shadow-sm transition',
        'hover:brightness-110 hover:shadow active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand)]',
        className,
      )}
    >
      <Plus className="w-5 h-5" />
    </button>
  );
}
