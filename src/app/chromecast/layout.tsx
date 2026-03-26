import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chromecast',
};

export default function ChromecastLayout({ children }: { children: React.ReactNode }) {
  return children;
}
