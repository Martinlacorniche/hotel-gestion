import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Co-Work',
};

export default function FideliteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
