'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Home, Thermometer, FileText, FolderOpen, Settings, SprayCan } from 'lucide-react';

const BASE_TABS = [
  { href: '/haccp',              label: 'Accueil',      icon: Home },
  { href: '/haccp/nettoyage',    label: 'Nettoyage',    icon: SprayCan },
  { href: '/haccp/temperatures', label: 'Températures', icon: Thermometer },
  { href: '/haccp/registre',     label: 'Registre',     icon: FileText },
  { href: '/haccp/documents',    label: 'Documents',    icon: FolderOpen },
];

const ADMIN_TAB = { href: '/haccp/admin', label: 'Admin', icon: Settings };

export function HaccpNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const tabs = isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS;

  return (
    <nav className="border-b bg-background sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 md:px-6 flex items-center gap-1 overflow-x-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/haccp' && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
