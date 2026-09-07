/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'Arial', 'sans-serif'],
        display: ['Assistant', 'Heebo', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#17120e', // espresso — warm near-black
        canvas: '#f2f0ea', // warm porcelain
        // primary — their orange, deepened to a confident burnt persimmon
        brand: {
          50: '#fdf3ee',
          light: '#fbe7db',
          100: '#f8d8c6',
          200: '#f2b591',
          300: '#ec8f5c',
          DEFAULT: '#e5702f',
          500: '#d55f23',
          dark: '#b64d1c',
          700: '#8f3d17',
        },
        // signature secondary — deep pine (hospitality / bistro)
        pine: {
          50: '#eef3f0',
          light: '#e2ece7',
          200: '#bcd2c9',
          300: '#8db3a4',
          DEFAULT: '#2f5d4f',
          dark: '#244a3f',
          700: '#1a382f',
        },
        brass: '#b0813a', // warm metallic highlight, used sparingly
      },
      boxShadow: {
        soft: '0 1px 2px rgba(23, 18, 14, 0.035), 0 4px 12px -4px rgba(23, 18, 14, 0.06), 0 14px 30px -16px rgba(23, 18, 14, 0.11)',
        pop: '0 14px 40px -12px rgba(23, 18, 14, 0.24), 0 4px 10px -4px rgba(23, 18, 14, 0.09)',
        glow: '0 6px 22px -6px rgba(229, 112, 47, 0.45)',
        pine: '0 6px 22px -8px rgba(47, 93, 79, 0.4)',
      },
      borderRadius: {
        xl: '0.7rem',
        '2xl': '1.05rem',
        '3xl': '1.5rem',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(0.97)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scale-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
