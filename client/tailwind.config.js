/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0D12',
        panel: '#151922',
        line: '#232A38',
        muted: '#8A94A6',
        accent: '#7C5CFF',
        good: '#3ECF8E',
        bad: '#FF6B6B',
        warn: '#FFB454',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
