import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.futsi.app",
  appName: "Futsi",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    androidScheme: "http",
    cleartext: true,
  },
};

export default config;
