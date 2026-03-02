import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // During development: proxy API calls from Vite (5173) → Express (4000)
    proxy: {
      "/api": "http://localhost:4000",
      "/products": "http://localhost:4000",
      "/sync-products": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
  },
  build: {
    outDir: "dist",
  },
});
