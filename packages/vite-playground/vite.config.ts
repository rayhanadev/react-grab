import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { sourceInspector } from "react-grab/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Universal source inspector - works with React, Vue, Svelte, Solid
    sourceInspector({
      react: true,
      toggleCombo: "alt", // Option+Click on Mac, Alt+Click on Windows
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
