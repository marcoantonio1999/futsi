import { useEffect, useRef, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function useInfiniteTrigger(onVisible: () => void, enabled: boolean, root?: Element | null) {
  const callbackRef = useRef(onVisible);
  const [node, setNode] = useState<HTMLElement | null>(null);
  callbackRef.current = onVisible;

  useEffect(() => {
    if (!node || !enabled || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callbackRef.current();
      },
      { root: root ?? null, rootMargin: "320px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node, root]);

  return setNode;
}

export function useEscape(onEscape: () => void, enabled = true) {
  const callbackRef = useRef(onEscape);
  callbackRef.current = onEscape;
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") callbackRef.current();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled]);
}
