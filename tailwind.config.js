/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/**/*.{html,js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1DB954',
      },
    },
  },
  plugins: [],
}
