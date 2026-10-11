import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 3D Studio — AI-native architectural modeling',
  description: 'Create and edit real, parametric 3D building models by describing them, speaking, or importing drawings.',
};

export const viewport: Viewport = { themeColor: '#0b0d10' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
