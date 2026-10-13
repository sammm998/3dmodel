import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm graphite for the studio (dark) UI.
        ink: {
          950: '#0a0a09',
          900: '#0f0f0d',
          850: '#141412',
          800: '#191917',
          750: '#1f1e1c',
          700: '#272623',
          600: '#34332f',
          500: '#46443f',
          400: '#6c6961',
          300: '#9a968c',
          200: '#c7c3b9',
          100: '#ece9e2',
        },
        // Champagne brass accent.
        accent: {
          DEFAULT: '#cdab74',
          soft: '#cdab741f',
          strong: '#dcbd8a',
        },
        // Light "drawing paper" palette for the site, dashboard and account pages.
        paper: {
          DEFAULT: '#f6f3ec',
          2: '#efebe2',
          3: '#e5dfd2',
        },
        char: {
          DEFAULT: '#181713',
          2: '#2e2c27',
          3: '#5f5b51',
          4: '#8c877b',
        },
        bronze: {
          DEFAULT: '#8f6a3c',
          light: '#b48a52',
        },
        info: '#7aa7ff',
        success: '#5fd39a',
        danger: '#ff6b6b',
        warn: '#f5b84a',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 10px 40px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
        glow: '0 0 0 1px rgba(205,171,116,0.35), 0 0 24px -4px rgba(205,171,116,0.3)',
        card: '0 1px 0 rgba(24,23,19,0.04), 0 12px 32px -18px rgba(24,23,19,0.28)',
        lift: '0 2px 0 rgba(24,23,19,0.03), 0 30px 60px -30px rgba(24,23,19,0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        rise: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulse2: { '0%,100%': { opacity: '0.4' }, '50%': { opacity: '1' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        rise: 'rise 700ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
        pulse2: 'pulse2 1.4s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
