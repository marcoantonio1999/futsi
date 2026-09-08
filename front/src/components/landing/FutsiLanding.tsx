import { useRef } from "react";
import { ArrowRight, ClipboardCheck, CreditCard, LogIn, Moon, Sun, Trophy, X } from "lucide-react";
import { LoginForm } from "../views/sharedParts/auth";
import { useLandingScene } from "./useLandingScene";
import type { ThemeMode, User } from "../../types";
import "./landing.css";

type FutsiLandingProps = {
  onLogin: (token: string, user: User) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

const features = [
  { icon: ClipboardCheck, title: "Asistencia automática", description: "Videos, reconocimiento y seguimiento de tus alumnos." },
  { icon: CreditCard, title: "Cobranza y adeudos", description: "Pagos, gastos y control diario de tu academia." },
  { icon: Trophy, title: "Academia y torneos", description: "Sedes, equipos y liga de adultos en una sola operación." },
];

export function FutsiLanding({ onLogin, theme, onToggleTheme }: FutsiLandingProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const loginRef = useRef<HTMLDialogElement | null>(null);
  const sceneReady = useLandingScene(mountRef);

  function openLogin() {
    loginRef.current?.showModal();
    loginRef.current?.querySelector<HTMLInputElement>("#username")?.focus();
  }

  return (
    <main className="futsi-welcome" data-testid="landing-page">
      <section className="stadium-hero" aria-labelledby="welcome-title">
        <header className="welcome-header">
          <a className="welcome-brand" href="#" aria-label="Futsi, inicio">
            <img src="./favicon.png" alt="" width="44" height="44" />
            <span><strong>Futsi</strong><span>Gestión deportiva</span></span>
          </a>
          <div className="welcome-header-actions">
            <button className="welcome-theme" onClick={onToggleTheme} type="button" data-testid="theme-toggle" aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"} title={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}>
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="welcome-access-link" onClick={openLogin} data-testid="landing-login-button" type="button"><LogIn size={16} aria-hidden="true" /> Iniciar sesión</button>
          </div>
        </header>
        <div className="stadium-copy">
          <p className="welcome-eyebrow"><span /> SISTEMA OPERATIVO PARA FÚTBOL</p>
          <h1 id="welcome-title">Tu academia,<br /><span>bajo control.</span></h1>
          <p className="welcome-description">Alumnos, asistencias, cobros y torneos.<br />Toda tu operación conectada, dentro y fuera de la cancha.</p>
          <button className="stadium-primary" onClick={openLogin} type="button">Entrar a Futsi <ArrowRight size={18} aria-hidden="true" /></button>
          <p className="stadium-access-note">Tu equipo. Tus sedes. Un solo lugar.</p>
        </div>
        <div className="stadium-scene" aria-hidden="true">
          <div ref={mountRef} className="stadium-canvas" data-testid="landing-three-scene" />
          {!sceneReady ? <div className="stadium-fallback" data-testid="landing-static-scene"><div /></div> : null}
        </div>
        <div className="stadium-shade" aria-hidden="true" />
      </section>
      <section className="welcome-features" aria-label="Lo que puedes hacer con Futsi">
        {features.map(({ icon: Icon, title, description }) => (
          <article className="welcome-feature" key={title}>
            <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
            <div><h2>{title}</h2><p>{description}</p></div>
          </article>
        ))}
      </section>
      <dialog ref={loginRef} className="welcome-login-dialog" data-testid="landing-login-modal" aria-labelledby="login-title" onClick={(event) => { if (event.target === event.currentTarget) loginRef.current?.close(); }}>
        <div className="welcome-login-content">
          <button className="welcome-close" onClick={() => loginRef.current?.close()} type="button" aria-label="Cerrar inicio de sesión"><X size={20} /></button>
          <LoginForm onLogin={onLogin} variant="landing" />
          <p className="welcome-account-help">¿Necesitas una cuenta o recuperar tu acceso?<br />Contacta al administrador de tu academia.</p>
        </div>
      </dialog>
    </main>
  );
}
