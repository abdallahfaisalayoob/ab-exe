/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        machine: {
          950: "#080b0d",
          900: "#101519",
          850: "#141b21",
          800: "#1a232b",
          700: "#26323c",
          500: "#5a6b78",
        },
        copper: "#e0a83a",
        cyanline: "#31c6df",
        fault: "#f05252",
      },
      boxShadow: {
        glow: "0 0 38px rgba(49, 198, 223, 0.14)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
