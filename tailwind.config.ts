import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07080a',
          900: '#0b0d10',
          850: '#101216',
          800: '#14171c',
          750: '#191c22',
          700: '#1f232a',
          600: '#2a2f38',
          500: '#3a404b',
          400: '#5a6170',
          300: '#8a91a0',
          200: '#b8bdc7',
          100: '#e3e6eb',
        },
        accent: {
          DEFAULT: '#e2b86b',
          soft: '#e2b86b1f',
          strong: '#f0c97f',
        },
        info: '#7aa7ff',
        success: '#5fd39a',
        danger: '#ff6b6b',
        warn: '#f5b84a',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 10px 40px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
        glow: '0 0 0 1px rgba(226,184,107,0.35), 0 0 24px -4px rgba(226,184,107,0.35)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulse2: { '0%,100%': { opacity: '0.4' }, '50%': { opacity: '1' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        pulse2: 'pulse2 1.4s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
