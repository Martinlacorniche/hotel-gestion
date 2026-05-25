import type { Metadata } from 'next';
import { HaccpNav } from './HaccpNav';

export const metadata: Metadata = {
  title: {
    default: 'HACCP',
    template: '%s — HACCP',
  },
};

export default function HACCPLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <HaccpNav />
      {children}
    </div>
  );
}
