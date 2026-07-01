/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Rubik', 'system-ui', 'Arial', 'sans-serif'],
      },
      colors: {
        ink: '#0f172a',
        brand: {
          light: '#fdeee4',
          DEFAULT: '#ea7a48',
          dark: '#d1662f',
        },
      },
      boxShadow: {
        soft: '0 2px 14px rgba(15, 23, 42, 0.06)',
        pop: '0 12px 34px rgba(15, 23, 42, 0.14)',
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.15rem',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-in': 'fade-in 0.25s ease-out' },
    },
  },
  plugins: [],
};
