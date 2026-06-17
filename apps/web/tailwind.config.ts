import type { Config } from "tailwindcss";

/**
 * TankDawgs battlefield theme — gunmetal/steel surfaces with olive-drab accents
 * and metallic gold trim, cream type. The "emerald"/"mahogany"/"gunmetal" token
 * names are kept (now mapped to military shades) so the app reskins from here.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        /** Touch-first devices (phones/tablets) — pointer is coarse. */
        touch: { raw: "(pointer: coarse)" },
        /** Mouse-driven devices (PCs) — pointer is fine. */
        desktop: { raw: "(pointer: fine)" },
      },
      colors: {
        // Surface ramp (deep → light) — gunmetal steel.
        mahogany: {
          DEFAULT: "#1e2730",
          dark: "#161d24",
          deep: "#0e1318",
        },
        // "emerald" names kept for the reskin; now steel / olive values.
        emerald: {
          felt: "#3a4a32", // olive-drab field
          deep: "#0e1318", // page / box background
          panel: "#1a222b", // gunmetal panel
          rail: "#2c3a2a", // olive rail
        },
        walnut: "#161d24",
        gold: {
          DEFAULT: "#c9a227",
          bright: "#e8c547",
          dim: "#8a7a3d",
        },
        cream: {
          DEFAULT: "#f5ecd6",
          dim: "#d8cba8",
        },
        cloth: {
          emerald: "#3a4a32",
          midnight: "#1a2533",
          crimson: "#4a1a12",
        },
        gunmetal: {
          DEFAULT: "#2a3540",
          dark: "#161d24",
        },
        burn: "#ff6b35",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "Times New Roman", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "gold-glow": "0 0 12px rgba(201, 162, 39, 0.45)",
        "pocket-glow": "0 0 18px rgba(232, 197, 71, 0.6)",
        "burn-glow": "0 0 14px rgba(255, 107, 53, 0.55)",
        "felt-inset": "inset 0 1px 0 rgba(232,197,71,0.08), inset 0 0 40px rgba(0,0,0,0.45)",
      },
      backgroundImage: {
        "wood-grain":
          "linear-gradient(160deg, #3a4a32 0%, #2a3540 45%, #0e1318 100%)",
        "gold-sheen":
          "linear-gradient(110deg, #8a6d1d 0%, #e8c547 50%, #8a6d1d 100%)",
        "felt-radial":
          "radial-gradient(ellipse at 50% 35%, #2c3a48 0%, #1a2230 45%, #0e1318 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
