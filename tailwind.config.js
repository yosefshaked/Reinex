import tailwindcssAnimate from "tailwindcss-animate"

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["\"Nunito\"", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "\"Segoe UI\"", "sans-serif"],
        heading: ["\"Nunito\"", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "\"Segoe UI\"", "sans-serif"],
      },
      fontSize: {
        "display-lg": ["2.5rem", { lineHeight: "1.2", fontWeight: "700" }],
        "display-md": ["2rem", { lineHeight: "1.25", fontWeight: "700" }],
        "title-lg": ["1.5rem", { lineHeight: "1.3", fontWeight: "700" }],
        "title-md": ["1.25rem", { lineHeight: "1.35", fontWeight: "600" }],
        "body-lg": ["1.125rem", { lineHeight: "1.6", fontWeight: "500" }],
        "body-md": ["1rem", { lineHeight: "1.6", fontWeight: "500" }],
        "body-sm": ["0.875rem", { lineHeight: "1.5", fontWeight: "500" }],
      },
      spacing: {
        "2xs": "0.375rem",
        xs: "0.5rem",
        sm: "0.75rem",
        md: "1rem",
        lg: "1.5rem",
        xl: "2rem",
        "2xl": "3rem",
        "3xl": "4rem",
      },
      borderRadius: {
        xl: "1.5rem",
        lg: "1rem",
      },
      boxShadow: {
        card: "0 18px 40px -25px rgba(15, 23, 42, 0.35)",
      },
      colors: {
        background: "#F7F9FC",
        surface: "#FFFFFF",
        overlay: "rgba(15, 23, 42, 0.6)",
        foreground: "#1F2933",
        border: "#E1E6EF",
        input: "#E1E6EF",
        ring: "#B8C2D9",
        // Map shadcn/ui token colors to CSS variables so utility classes like
        // bg-popover, text-popover-foreground, bg-accent, bg-muted, etc. work.
        // This fixes invisible dropdown/popover backgrounds when those classes
        // are used by primitives like Select/Popover.
        popover: "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        primary: {
          DEFAULT: "#5B5BD6",
          foreground: "#F9FAFF",
        },
        neutral: {
          50: "#F7F9FC",
          100: "#E9EEF5",
          200: "#D9DFE7",
          300: "#C0C8D6",
          400: "#9AA6BE",
          500: "#6C7A95",
          600: "#4B5774",
          700: "#33405B",
          800: "#242C41",
          900: "#171D2C",
        },
        success: {
          DEFAULT: "#2D9D78",
          foreground: "#F9FAFF",
          surface: "#D8F3E8",
        },
        warning: {
          DEFAULT: "#F59F48",
          foreground: "#1F2933",
          surface: "#FEEEDB",
        },
        error: {
          DEFAULT: "#E5484D",
          foreground: "#F9FAFF",
          surface: "#FAD4D6",
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
