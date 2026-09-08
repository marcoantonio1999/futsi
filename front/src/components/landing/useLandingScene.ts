import { useEffect, useState, type RefObject } from "react";
import * as THREE from "three";
import { createFieldLines, createGoal, createGrassTexture, createSoccerBall, createStands, easeInOut } from "./FutsiLandingSceneObjects";
export function useLandingScene(mountRef: RefObject<HTMLDivElement | null>) {
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#082f22");
    scene.fog = new THREE.Fog("#082f22", 12, 28);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 1.45, 5.9);
    camera.lookAt(0, 0.45, -4.2);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch (error) {
      console.warn("Landing WebGL scene unavailable; using static fallback.", error);
      setSceneReady(false);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.dataset.testid = "landing-three-canvas";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    mount.appendChild(renderer.domElement);
    setSceneReady(true);

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
      scene.traverse((object: THREE.Object3D) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      });
      renderer.domElement.remove();
      setSceneReady(false);
    };
  }, [mountRef]);

  return sceneReady;
}
