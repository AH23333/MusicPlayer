/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./renderer.js"
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1DB954',
        secondary: '#191414',
        dark: '#121212',
        light: '#F8F8F8',
        gray: {
          100: '#E5E5E5',
          200: '#D1D1D1',
          300: '#B7B7B7',
          400: '#9E9E9E',
          500: '#848484',
          600: '#6B6B6B',
          700: '#525252',
          800: '#383838',
          900: '#1F1F1F',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}