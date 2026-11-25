import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { isEnrollmentAdminHash } from "./features/enrollments/enrollmentHistory";

const App = React.lazy(() => import("./App"));
const EnrollmentApplication = React.lazy(() => import("./features/enrollments/EnrollmentApplication"));
const PublicEnrollment = React.lazy(() => import("./features/enrollments/PlayerEnrollment").then(module => ({ default: module.PublicPlayerEnrollment })));
const PublicWithdrawal = React.lazy(() => import("./features/enrollments/PlayerEnrollment").then(module => ({ default: module.PublicPlayerWithdrawal })));
const PublicPermit = React.lazy(() => import("./features/enrollments/EnrollmentPermits").then(module => ({ default: module.PublicEnrollmentPermit })));
const PublicGameRole = React.lazy(() => import("./features/game-roles/GameRoleShare").then(module => ({ default: module.PublicGameRole })));

function Application() {
  const [hash, setHash] = React.useState(window.location.hash);
  React.useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const brand = import.meta.env.VITE_APP_BRAND;
  let screen = <App />;
  if (brand !== "soccerwa") {
    if (hash.startsWith("#/inscripcion/")) screen = <PublicEnrollment key={hash} invitation={hash.slice("#/inscripcion/".length)} />;
    else if (hash.startsWith("#/baja/")) screen = <PublicWithdrawal key={hash} invitation={hash.slice("#/baja/".length)} />;
    else if (hash.startsWith("#/permiso/")) screen = <PublicPermit key={hash} invitation={hash.slice("#/permiso/".length)} />;
    else if (hash.startsWith("#/rol-de-juego/")) screen = <PublicGameRole key={hash} token={hash.slice("#/rol-de-juego/".length)} />;
    else if (brand === "inscripciones" || isEnrollmentAdminHash(hash)) screen = <EnrollmentApplication />;
  }
  return <React.Suspense fallback={<main className="p-8" role="status">Cargando…</main>}>
    {screen}
  </React.Suspense>;
}

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
    <Application />
  </AppErrorBoundary>,
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}
