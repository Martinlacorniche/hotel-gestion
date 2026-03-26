import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Parking',
};

export default function ParkingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
