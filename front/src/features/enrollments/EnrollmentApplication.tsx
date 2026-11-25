import { lazy, Suspense, useEffect, useState } from "react";
import { apiRequest } from "../../api";
import type { User } from "../../types";
import { EnrollmentAccessDenied, EnrollmentLogin } from "./EnrollmentAccess";

const EnrollmentDashboard = lazy(() => import("./PlayerEnrollment").then(module => ({ default: module.EnrollmentDashboard })));
const loading = <main className="p-8" role="status">Cargando Inscripciones…</main>;

export default function EnrollmentApplication() {
  const [token, setToken] = useState(() => localStorage.getItem("futsi_token") ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const expire = () => { setToken(""); setUser(null); setError(""); };
    window.addEventListener("futsi:session-expired", expire);
    return () => window.removeEventListener("futsi:session-expired", expire);
  }, []);

  useEffect(() => {
    if (!token || user) return;
    const controller = new AbortController();
    void apiRequest<User>("/auth/me/", token, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setUser(result); })
      .catch(() => { if (!controller.signal.aborted) setError("No se pudo comprobar tu sesión."); });
    return () => controller.abort();
  }, [token, user, revision]);

  async function logout() {
    await apiRequest<void>("/auth/logout/", token, { method: "POST" }).catch(() => undefined);
    localStorage.removeItem("futsi_token");
    setToken(""); setUser(null); setError("");
  }

  if (!token) return <EnrollmentLogin onLogin={(next, authenticated) => {
    localStorage.setItem("futsi_token", next);
    setUser(authenticated);
    setToken(next);
  }} />;
  if (!user) return error ? <main className="p-8" role="alert">{error} <button type="button" onClick={() => {
    setError(""); setRevision(value => value + 1);
  }}>Reintentar</button></main> : loading;
  const admin = ["admin", "owner", "dev"].includes(user.role);
  if (!admin && !user.section_permissions?.includes("player_enrollments_only")) return <EnrollmentAccessDenied onLogout={logout} />;
  return <Suspense fallback={loading}><EnrollmentDashboard token={token} userId={user.id} onLogout={logout}
    canManageRoles={admin || user.section_permissions?.includes("game_roles_manage")} /></Suspense>;
}
