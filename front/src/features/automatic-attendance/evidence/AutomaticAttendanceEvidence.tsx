import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

type EvidenceImageFit = "cover" | "contain";
type EvidenceImageRatio = "wide" | "square" | "portrait";

const ratioClass: Record<EvidenceImageRatio, string> = {
  wide: "aspect-[2/1]",
  square: "aspect-square",
  portrait: "aspect-[4/5]",
};

export function EvidenceImage({ url, token, fit = "cover", ratio = "wide" }: { url?: string; token: string; fit?: EvidenceImageFit; ratio?: EvidenceImageRatio }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [retryKey, setRetryKey] = useState(0);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (!url) {
      setShouldLoad(false);
      return;
    }
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "220px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [url]);

  useEffect(() => {
    if (!url) {
      setSrc("");
      setStatus("idle");
      return;
    }
    if (!shouldLoad) return;
    let objectUrl = "";
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    setSrc("");
    setStatus("loading");
    fetch(url, { headers: { Authorization: `Token ${token}` }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar evidencia.");
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
        setStatus("loaded");
      })
      .catch(() => {
        if (!cancelled) {
          setSrc("");
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [retryKey, shouldLoad, token, url]);

  const frameClass = ratioClass[ratio];

  if (!url) {
    return (
      <div ref={containerRef} className={`flex ${frameClass} items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-100 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400`}>
        Sin evidencia
      </div>
    );
  }

  if (!shouldLoad) {
    return (
      <div ref={containerRef} className={`flex ${frameClass} items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400`}>
        Evidencia lista
      </div>
    );
  }

  if (status === "error") {
    return (
      <div ref={containerRef} className={`flex ${frameClass} flex-col items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-center text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100`}>
        <span>La evidencia tardo en cargar.</span>
        <button
          className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1 font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          onClick={() => setRetryKey((value) => value + 1)}
          type="button"
        >
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    );
  }

  if (status === "loading" || !src) {
    return (
      <div ref={containerRef} className={`relative ${frameClass} overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900`}>
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-100 dark:from-zinc-900 dark:via-zinc-800 dark:to-zinc-900" />
        <div className="absolute inset-x-4 bottom-4 h-2 rounded-full bg-white/80 dark:bg-zinc-700/80" />
        <div className="absolute left-4 top-4 h-3 w-24 rounded-full bg-white/80 dark:bg-zinc-700/80" />
        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-zinc-500 dark:text-zinc-300">Cargando evidencia</div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <img
        src={src}
        alt="Comparacion de rostro"
        className={`${frameClass} w-full rounded-md border border-zinc-300 bg-black ${fit === "contain" ? "object-contain" : "object-cover"} dark:border-zinc-700`}
        onError={() => setStatus("error")}
      />
    </div>
  );
}
