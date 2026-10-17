import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Team Live', description: 'Who is working, on break, and free right now' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
