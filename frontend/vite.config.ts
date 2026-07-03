import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  // GitHub Pages demo is served from a subpath (Shirleyyyxy1226.github.io/CellSeer/);
  // production (cellseer.com) serves from root.
  base: process.env.DEPLOY_ENV === 'gh-pages' ? '/CellSeer/' : '/',
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
        // The backend runs with uvicorn --reload, so it is briefly unreachable
        // (~1-2s) on every restart. Without this hook http-proxy throws and Vite
        // surfaces an opaque 500 for whatever /api request was in flight. Return
        // a clear 502 instead, and log it, so a restart window is never mistaken
        // for a real server error.
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            const target = process.env.CELLSEER_API_TARGET ?? "http://127.0.0.1:8000";
            console.warn(`[api-proxy] backend unreachable (${target}): ${err.message}`);
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  detail: "Backend unreachable (is it restarting?). Proxy could not reach the API.",
                }),
              );
            }
          });
        },
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
