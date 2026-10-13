import localFont from 'next/font/local';

/** Self-hosted, preloaded fonts (no flash of fallback text, no third-party requests). */
export const sans = localFont({
  src: [
    { path: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', weight: '100 900', style: 'normal' },
    { path: '../../node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2', weight: '100 900', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial'],
  adjustFontFallback: 'Arial',
});

export const display = localFont({
  src: [
    { path: '../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
  adjustFontFallback: 'Times New Roman',
});
