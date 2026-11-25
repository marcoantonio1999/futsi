import { useEffect, useState } from "react";
import { API_URL } from "../../api";
import { Button, Card, Input, Label } from "../../components/ui/enrollment-ui";
import type { User } from "../../types";
import { EnrollmentBrand } from "./EnrollmentBrand";
import "./enrollments.css";
import "./enrollmentAdmin.css";
import "./enrollmentButtons.css";
import "../../components/ui/enrollment-ui.css";

export function EnrollmentLogin({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Inscripciones BPower"; }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(API_URL + "/auth/login/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "No se pudo iniciar sesión.");
      onLogin(body.token, body.user);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo iniciar sesión."); }
    finally { setBusy(false); }
  }
  return <main className="enrollment-page"><Card as="form" className="registration-sheet" style={{ maxWidth: 440, marginTop: 60 }} onSubmit={submit}>
    <h1 className="enrollment-login-brand"><EnrollmentBrand /></h1>{error && <p role="alert" className="error">{error}</p>}
    <Label>Usuario<Input name="username" autoComplete="username" required /></Label>
    <Label>Contraseña<Input name="password" type="password" autoComplete="current-password" required /></Label>
    <Button className="primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
  </Card></main>;
}

export function EnrollmentAccessDenied({ onLogout }: { onLogout: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Inscripciones BPower"; }, []);

  return <main className="enrollment-page"><Card as="section" className="registration-sheet" style={{ maxWidth: 440, marginTop: 60 }}>
    <div className="enrollment-login-brand"><EnrollmentBrand /></div>
    <h1>Sin acceso a Inscripciones</h1>
    <p>Esta cuenta no tiene permiso para entrar. Cambia a tu cuenta de Inscripciones para continuar.</p>
    <Button className="primary" disabled={busy} onClick={async () => {
      setBusy(true);
      await onLogout();
    }}>{busy ? "Cerrando sesión…" : "Cambiar de cuenta"}</Button>
  </Card></main>;
}
