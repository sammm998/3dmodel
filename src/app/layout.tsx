import type { Metadata, Viewport } from 'next';
import { display, sans } from './fonts';
import './globals.css';

const url = process.env.APP_URL;

export const metadata: Metadata = {
  metadataBase: url ? new URL(url) : undefined,
  title: { default: 'AI 3D Studio — Architecture, drafted in conversation', template: '%s · AI 3D Studio' },
  description:
    'Describe a building, speak, or import a floor plan. AI 3D Studio builds a real parametric 3D model you can refine element by element, walk through, and export to IFC, DXF, GLB, OBJ and STL.',
  openGraph: {
    title: 'AI 3D Studio — Architecture, drafted in conversation',
    description: 'Real, editable parametric building models from words, voice and drawings. Walk through them in the browser and export to BIM.',
    images: ['/marketing/og.jpg'],
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = { themeColor: '#f6f3ec' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
