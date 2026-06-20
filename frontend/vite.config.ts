import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        // Override with CELLSEER_API_TARGET when the backend runs elsewhere
        // (container, remote dev box) — no source edit needed.
        target: process.env.CELLSEER_API_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "cellseer-lib": path.resolve(__dirname, "../packages/cellseer-lib/src"),
    },
  },
}));
