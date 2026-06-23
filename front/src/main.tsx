import React from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
          <section className="mx-auto max-w-2xl rounded-md border border-red-500/40 bg-red-950/30 p-5">
            <p className="text-sm font-semibold text-red-200">Error de interfaz</p>
            <h1 className="mt-2 text-2xl font-semibold">La pantalla no pudo renderizarse.</h1>
            <p className="mt-3 text-sm text-red-100">
              Recarga la pagina. Si vuelve a pasar, revisa consola con este mensaje:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs text-red-100">
              {this.state.error.message}
            </pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}
