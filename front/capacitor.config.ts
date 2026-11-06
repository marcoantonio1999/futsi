import type { CapacitorConfig } from "@capacitor/cli";

const enrollments = process.env.VITE_APP_BRAND === "inscripciones";

const config: CapacitorConfig = {
  appId: enrollments ? "mx.bpoweracademy.inscripciones" : "com.futsi.app",
  appName: enrollments ? "Inscripciones BPower" : "Futsi",
  webDir: "dist",
  server: {
    androidScheme: enrollments ? "https" : "http",
    hostname: enrollments ? "futsi.bpoweracademy.mx" : "localhost",
    cleartext: !enrollments,
  },
};

export default config;
