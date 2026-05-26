/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0F1B2D",
        teal: "#00D4AA",
        amber: "#F5A524",
        crimson: "#FF4D6D",
      },
      fontFamily: {
        display: ['"Syne"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
