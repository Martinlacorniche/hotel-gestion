import './globals.css';
import type { Metadata } from 'next';
import { Inter, Poppins, DM_Sans, Lora, Playfair_Display, Kalam } from 'next/font/google';
import { AuthProvider } from '@/context/AuthContext';
import { Toaster } from 'react-hot-toast';

// Polices chargées en parallèle, chaque exposée via une variable CSS
// (--font-inter, --font-poppins, ...) que `applyFont()` peut activer.
const inter    = Inter({           subsets: ['latin'], variable: '--font-inter',    display: 'swap' });
const poppins  = Poppins({         subsets: ['latin'], weight: ['400','500','600','700'], variable: '--font-poppins',  display: 'swap' });
const dmSans   = DM_Sans({         subsets: ['latin'], variable: '--font-dm-sans',  display: 'swap' });
const lora     = Lora({            subsets: ['latin'], variable: '--font-lora',     display: 'swap' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap' });
const kalam    = Kalam({           subsets: ['latin'], weight: ['400','700'],       variable: '--font-kalam',    display: 'swap' });

const fontVars = [inter, poppins, dmSans, lora, playfair, kalam].map((f) => f.variable).join(' ');

export const metadata: Metadata = {
  title: 'Consignes HTBM',
  description: 'Gestions des consignes',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={fontVars}>
      <body>
        <AuthProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: '#fff',
                color: '#333',
                padding: '12px 16px',
                borderRadius: '8px',
                fontSize: '14px',
              },
              success: { iconTheme: { primary: '#4ade80', secondary: '#fff' } },
              error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
