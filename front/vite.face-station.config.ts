import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/static/",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, "../face_station/app/static-react"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "face-station/index.html"),
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5174,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/health": "http://127.0.0.1:8765",
      "/favicon.ico": "http://127.0.0.1:8765",
    },
  },
});
