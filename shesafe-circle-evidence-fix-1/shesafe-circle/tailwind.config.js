/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        blush: '#f472b6',
        rose: '#fb7185',
        plum: '#7c3aed',
        midnight: '#0f172a',
        mist: '#f8fafc',
      },
      boxShadow: {
        soft: '0 20px 45px rgba(15, 23, 42, 0.18)',
      },
    },
  },
  plugins: [],
}

