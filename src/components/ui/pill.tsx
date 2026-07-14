import * as React from 'react';
import { cn } from '@/lib/utils';

// Badge de statut. La couleur porte du SENS (bon / attention / critique), pas de la
// déco. `brand` suit le thème de l'utilisateur ; les tons sémantiques sont fixes.
export type PillTone = 'neutral' | 'brand' | 'good' | 'warn' | 'danger';

const TONES: Record<PillTone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-[var(--brand-bg)] text-[var(--brand)]',
  good: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
};

export function Pill({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full', TONES[tone], className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
