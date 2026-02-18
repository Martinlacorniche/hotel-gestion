/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",     // Ajoute "src/"
    "./src/pages/**/*.{js,ts,jsx,tsx}",   // Ajout de "src/"
    "./src/components/**/*.{js,ts,jsx,tsx}", // Ajout de "src/"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}