'use client';

import * as React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Select de FORMULAIRE moderne (pleine largeur, look champ), remplace le <select>
// natif dont la liste d'options est rendue par l'OS. Liste stylée, coche sur la
// valeur, focus aux couleurs du thème. Options = string[] ou {value,label}[].
type Opt = string | { value: string; label: string };

export function SelectField({
  value,
  options,
  onChange,
  placeholder = 'Choisir…',
  className,
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const current = opts.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center justify-between gap-2 w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] data-[state=open]:border-[var(--brand)]',
          className,
        )}
      >
        <span className={cn('truncate', current ? '' : 'text-slate-400')}>{current?.label ?? placeholder}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 overflow-y-auto min-w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {opts.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => onChange(o.value)}
            className="flex items-center justify-between gap-3 text-sm cursor-pointer"
          >
            {o.label}
            {o.value === value && <Check className="w-4 h-4 text-[var(--brand)]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
