import { useEffect, useRef, useState } from "react";
import { LogIn, X } from "lucide-react";
import * as THREE from "three";
import { createFieldLines, createGoal, createGrassTexture, createSoccerBall, createStands, easeInOut } from "./FutsiLandingSceneObjects";
import { LoginForm } from "../views/sharedParts/auth";
import type { User } from "../../types";

type FutsiLandingProps = {
  onLogin: (token: string, user: User) => void;
};

function useLandingScene(mountRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#082f22");
    scene.fog = new THREE.Fog("#082f22", 12, 28);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 1.45, 5.9);
    camera.lookAt(0, 0.45, -4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.dataset.testid = "landing-three-canvas";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight("#d1fae5", "#052e16", 2.2);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight("#ffffff", 3.4);
    keyLight.position.set(-3.4, 5.5, 4.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight("#bfdbfe", 24, 12);
    rimLight.position.set(2.8, 2.2, -3.4);
    scene.add(rimLight);

    const standLight = new THREE.PointLight("#d1fae5", 10, 16);
    standLight.position.set(0, 2.2, -6.8);
    scene.add(standLight);

    const grassTexture = createGrassTexture();
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#047857", map: grassTexture ?? undefined, roughness: 0.78, metalness: 0.02 }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.74;
    field.receiveShadow = true;
    scene.add(field);
    scene.add(createFieldLines());
    scene.add(createStands());

    const goal = createGoal();
    scene.add(goal);

    const ball = createSoccerBall();
    scene.add(ball);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 40),
      new THREE.MeshBasicMaterial({ color: "#022c22", transparent: true, opacity: 0.35 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.715;
    scene.add(shadow);

    const clock = new THREE.Clock();
    const pointerTarget = new THREE.Vector2(0, 0);
    const pointerCurrent = new THREE.Vector2(0, 0);
    let frameId = 0;
    let compactScene = false;
    let pointerActive = false;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      compactScene = width < 760;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = compactScene ? 6.7 : 5.9;
      camera.position.x = compactScene ? 0.18 : 0;
      camera.lookAt(0, 0.45, -4.2);
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const handlePointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      const y = 1 - ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2;
      pointerTarget.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
      pointerActive = true;
    };

    const handlePointerLeave = () => {
      pointerActive = false;
      pointerTarget.set(0, 0);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave);

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const cycle = (elapsed % 7.2) / 7.2;
      const shotStartX = compactScene ? 1.08 : 1.85;

      if (cycle < 0.24) {
        const idle = cycle / 0.24;
        ball.position.set(shotStartX + Math.sin(elapsed * 1.7) * 0.1, -0.2 + Math.sin(idle * Math.PI) * 0.34, 1.95);
      } else if (cycle < 0.79) {
        const shot = easeInOut((cycle - 0.24) / 0.55);
        const arc = Math.sin(shot * Math.PI) * 1.55;
        ball.position.set(
          THREE.MathUtils.lerp(shotStartX, 0.18, shot),
          THREE.MathUtils.lerp(-0.15, 0.35, shot) + arc,
          THREE.MathUtils.lerp(1.95, -6.85, shot),
        );
      } else {
        const settle = (cycle - 0.79) / 0.21;
        ball.position.set(0.18 + Math.sin(settle * Math.PI * 4) * 0.05, -0.22 + Math.sin(settle * Math.PI * 3) * 0.07, -6.85);
      }

      pointerCurrent.lerp(pointerTarget, pointerActive ? 0.22 : 0.06);
      const lateralInfluence = cycle < 0.24 ? 0.85 : cycle < 0.79 ? 1.15 : 0.75;
      const lateralRange = compactScene ? 1.15 : 1.85;
      ball.position.x += pointerCurrent.x * lateralRange * lateralInfluence;

      ball.rotation.x -= 0.045;
      ball.rotation.y += 0.028;
      shadow.position.x = ball.position.x;
      shadow.position.z = ball.position.z;
      const heightFactor = THREE.MathUtils.clamp((ball.position.y + 0.45) / 2.6, 0, 1);
      shadow.scale.setScalar(1.05 - heightFactor * 0.45);
      (shadow.material as THREE.MeshBasicMaterial).opacity = 0.34 - heightFactor * 0.18;

      goal.rotation.y = Math.sin(elapsed * 0.45) * 0.01;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      renderer.dispose();
      grassTexture?.dispose();
      (ball.userData.ballTexture as THREE.Texture | undefined)?.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      });
      renderer.domElement.remove();
    };
  }, [mountRef]);
}

export function FutsiLanding({ onLogin }: FutsiLandingProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  useLandingScene(mountRef);

  return (
    <main className="min-h-screen bg-zinc-950 text-white" data-testid="landing-page">
      <section className="relative min-h-[92svh] overflow-hidden">
        <div ref={mountRef} className="absolute inset-0" data-testid="landing-three-scene" aria-hidden="true" />
        <div className="absolute inset-0 bg-zinc-950/10" />

        <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img className="size-11 rounded-md bg-white object-contain p-1 shadow-lg" src="./favicon.png" alt="Futsi" />
            <div>
              <p className="text-sm font-semibold leading-none">Futsi</p>
              <p className="mt-1 text-xs text-emerald-100">Mini ERP deportivo</p>
            </div>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md border border-white/25 bg-white px-4 py-2 text-sm font-semibold text-zinc-950 shadow-lg transition hover:bg-emerald-50"
            data-testid="landing-login-button"
            onClick={() => setLoginOpen(true)}
            type="button"
          >
            <LogIn size={16} /> Iniciar sesion
          </button>
        </header>

        <div className="relative z-10 flex min-h-[92svh] items-center px-5 pb-16 pt-24 sm:px-8 lg:px-12">
          <div className="max-w-2xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-100">Sistema operativo para futbol</p>
            <h1 className="mt-4 text-5xl font-semibold leading-none text-white sm:text-6xl lg:text-7xl">Futsi</h1>
            <p className="mt-5 max-w-xl text-lg leading-7 text-emerald-50 sm:text-xl">
              Control de academia, torneos, cobranza y asistencia automatica en una sola operacion.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm text-white/90">
              <span className="rounded-md border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-sm">Asistencia por video</span>
              <span className="rounded-md border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-sm">Liga adultos</span>
              <span className="rounded-md border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-sm">Cobranza y adeudos</span>
            </div>
          </div>
        </div>
      </section>

      <section className="min-h-[8svh] border-t border-white/10 bg-zinc-950 px-5 py-5 sm:px-8 lg:px-12">
        <div className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-3">
          <p><span className="font-semibold text-white">ERP vivo.</span> Datos operativos para sedes, equipos y responsables.</p>
          <p><span className="font-semibold text-white">Automatizacion.</span> Videos, reconocimiento y reportes de asistencia.</p>
          <p><span className="font-semibold text-white">Control.</span> Pagos, facturas, gastos y seguimiento diario.</p>
        </div>
      </section>

      {loginOpen ? (
        <div className="fixed inset-0 z-[1400] grid place-items-center bg-zinc-950/70 px-4 py-8 backdrop-blur-sm" data-testid="landing-login-modal">
          <div className="relative w-full max-w-sm">
            <button
              className="absolute -right-2 -top-12 grid size-10 place-items-center rounded-md border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
              onClick={() => setLoginOpen(false)}
              type="button"
              aria-label="Cerrar inicio de sesion"
            >
              <X size={17} />
            </button>
            <LoginForm onLogin={onLogin} className="border-white/15 shadow-2xl" />
          </div>
        </div>
      ) : null}
    </main>
  );
}
