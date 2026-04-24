import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Gestion de l'interface WiFi",
};

export default function WifiAdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
