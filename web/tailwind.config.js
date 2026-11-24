/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: '#050505',
        platinum: '#e5e4e2',
        'steel-blue': '#8fa3b8',
        'midnight-elegance': '#aeb2b8',
        cyber: {
          dark: '#08090d',
          card: '#0f121d',
          border: '#1f293d',
          cyan: '#00f0ff',
          neon: '#06b6d4',
          gold: '#f59e0b',
          amber: '#fbbf24',
          purple: '#8b5cf6',
          emerald: '#10b981',
          rose: '#f43f5e'
        }
      },
      fontFamily: {
        sans: ['"Google Sans"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        'google-sans': ['"Google Sans"', 'sans-serif'],
        caveat: ['"Caveat"', 'cursive'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'cyan-glow': '0 0 20px rgba(0, 240, 255, 0.25)',
        'cyan-glow-lg': '0 0 35px rgba(0, 240, 255, 0.4)',
        'gold-glow': '0 0 20px rgba(245, 158, 11, 0.3)',
        'purple-glow': '0 0 20px rgba(139, 92, 246, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-spin': 'spin 12s linear infinite',
      }
    },
  },
  plugins: [],
}
