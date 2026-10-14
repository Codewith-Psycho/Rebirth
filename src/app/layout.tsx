import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Inter } from 'next/font/google';

import { ThemeProvider } from '@/components/layout/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: {
    default: 'REBIRTH',
    template: '%s · REBIRTH',
  },
  description:
    'A calm place to see what you actually did: structured days, honest records, and no pressure to be perfect.',
  applicationName: 'REBIRTH',
  // The app is entirely private. Nothing here should be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available: capping it would be an accessibility failure.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F3EB' },
    { media: '(prefers-color-scheme: dark)', color: '#171A18' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${cormorant.variable}`}>
      <body className="min-h-[100dvh] bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          {/* First tab stop for keyboard users, on every page. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:shadow-elevated focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
