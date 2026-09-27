import './globals.css';
import Script from 'next/script';
import { Outfit } from 'next/font/google';
import { AppShell } from '../components/shell/app-shell';
import { StartupSequence } from '../components/startup/startup-sequence';
import { ServiceWorkerRegistration } from '../components/pwa/service-worker-registration';
import { AnalyticsCollector } from '../components/analytics/collector';
import { allowIndexing, publicConfig } from '../lib/config';
import { STARTUP_ASSET } from '../lib/startup/phases';
import { STARTUP_BOOT } from '../lib/startup/boot';

const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
});

export const metadata = {
  metadataBase: new URL(publicConfig.siteUrl),
  applicationName: 'BeezMovies',
  title: {
    default: 'BeezMovies',
    template: '%s · BeezMovies',
  },
  description: 'BeezMovies is a cinematic streaming home for film.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/branding/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/branding/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: STARTUP_ASSET, sizes: '1024x682', type: 'image/jpeg' },
    ],
    apple: [{ url: '/branding/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'BeezMovies',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    title: 'BeezMovies',
    description: 'BeezMovies is a cinematic streaming home for film.',
    siteName: 'BeezMovies',
    type: 'website',
    locale: 'en_US',
  },
  ...(allowIndexing() ? {} : { robots: { index: false, follow: false } }),
};

export const viewport = {
  themeColor: '#0B0D0F',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className={`${outfit.variable} font-international antialiased`}>
        <Script id="beezmovies-startup" strategy="beforeInteractive">
          {STARTUP_BOOT}
        </Script>
        <ServiceWorkerRegistration />
        <AnalyticsCollector />
        <StartupSequence>
          <AppShell>{children}</AppShell>
        </StartupSequence>
      </body>
    </html>
  );
}
