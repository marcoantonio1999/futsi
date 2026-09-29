import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), tailwindcss(), {
    name: "soccer-wa-document-brand",
    transformIndexHtml(html) {
      if (process.env.VITE_APP_BRAND !== "soccerwa") return html;
      return html
        .replace('<link rel="manifest" href="./manifest.webmanifest" />', "")
        .replace('./favicon.png', './soccer-wa-logo.png')
        .replace('<link rel="apple-touch-icon" href="./icon-192.png" />', "")
        .replace('<title>Futsi Mini ERP</title>', '<title>Soccer WA</title>')
        .replace('./logo-futsi.png', './soccer-wa-logo.png')
        .replace('alt="Futsi"', 'alt="Soccer WA"');
    },
  }],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/three/")) return "vendor-three";
          if (id.includes("/recharts/") || id.includes("/d3-")) return "vendor-charts";
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react";
          if (id.includes("/leaflet/")) return "vendor-map";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    host: process.env.VITE_DEV_HOST || "127.0.0.1",
    allowedHosts: process.env.VITE_ALLOW_EXTERNAL_HOSTS === "true" ? true : undefined,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
