import React from "react";
import { createRoot } from "react-dom/client";
import FaceStationApp from "./App";
import "./face-station.css";

class FaceStationErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 p-6 text-zinc-100">
        <section className="w-full max-w-xl rounded-xl border border-red-500/40 bg-red-950/30 p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-red-300">Error de interfaz</p>
          <h1 className="mt-2 text-xl font-bold">Face Station no pudo renderizarse.</h1>
          <p className="mt-3 text-sm text-red-100">Recarga la pantalla. Si vuelve a pasar, comparte este mensaje:</p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-red-100">{this.state.error.message}</pre>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <FaceStationErrorBoundary>
    <FaceStationApp />
  </FaceStationErrorBoundary>,
);
