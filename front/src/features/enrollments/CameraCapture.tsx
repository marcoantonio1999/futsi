import { useEffect, useRef, useState } from "react";

export function CameraCapture({ selfie, onCapture, onClose }: {
  selfie: boolean; onCapture: (file: File) => void; onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: selfie ? "user" : "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      } catch (err) {
        if (stopped) return;
        const name = err instanceof Error ? err.name : "";
        setError(name === "NotAllowedError" ? "Permite el acceso a la cámara en tu navegador."
          : name === "NotFoundError" ? "No se encontró una cámara. Puedes adjuntar una foto."
          : name === "NotReadableError" ? "La cámara está en uso. Cierra la otra aplicación e intenta nuevamente."
          : "No se pudo abrir la cámara. Usa HTTPS o localhost, o adjunta una foto.");
      }
    }
    void start();
    return () => { stopped = true; stream?.getTracks().forEach(track => track.stop()); previousFocus?.focus(); };
  }, [selfie]);
  function capture() {
    const source = video.current;
    if (!source?.videoWidth || capturing) return;
    setCapturing(true);
    const scale = Math.min(1, 2000 / Math.max(source.videoWidth, source.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(source.videoWidth * scale);
    canvas.height = Math.round(source.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) onCapture(new File([blob], "foto.jpg", { type: "image/jpeg" }));
      else { setError("No se pudo tomar la foto. Intenta de nuevo."); setCapturing(false); }
    }, "image/jpeg", 0.9);
  }
  return <div className="enrollment-camera-overlay" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section className="enrollment-camera-dialog" role="dialog" aria-modal="true" aria-label="Tomar foto">
      <header><h2>Tomar foto</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="Cerrar cámara">✕</button></header>
      <video ref={video} autoPlay muted playsInline onLoadedData={() => setReady(true)} />
      {error && <p className="error" role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancelar</button>
        <button type="button" className="primary" disabled={!ready || !!error || capturing} onClick={capture}>Tomar foto</button></footer>
    </section>
  </div>;
}
