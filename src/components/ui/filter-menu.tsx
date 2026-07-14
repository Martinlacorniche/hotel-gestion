'use client';

import * as React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Filtre déroulant moderne (remplace le <select> natif, dont la liste est rendue
// par l'OS et non stylable). Menu shadcn stylé, coche sur l'option active, teinte
// de marque (thème de l'utilisateur) sur le focus et la coche.
export function FilterMenu({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] data-[state=open]:border-[var(--brand)] data-[state=open]:text-slate-800',
          className,
        )}
      >
        {value}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[168px]">
        {options.map((o) => (
          <DropdownMenuItem
            key={o}
            onSelect={() => onChange(o)}
            className="flex items-center justify-between gap-3 text-sm cursor-pointer"
          >
            {o}
            {o === value && <Check className="w-4 h-4 text-[var(--brand)]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
