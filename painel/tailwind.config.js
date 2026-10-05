/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf6ec',
          100: '#f8e8cd',
          400: '#d99b3f',
          500: '#c17f24',
          600: '#9c631b',
          700: '#7a4d16',
        },
      },
    },
  },
  plugins: [],
};
