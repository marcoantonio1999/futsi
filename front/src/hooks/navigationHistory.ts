type NavigationEntry<T> = { owner: string; screen: T };
type BrowserNavigation = Pick<Window, "history" | "addEventListener" | "removeEventListener">;

// A real entry per screen, not a synthetic Back-button trap.
export function createNavigationHistory<T>(browser: BrowserNavigation, owner: string, initial: T, restore: (screen: T) => void, url: (screen: T) => string) {
  const key = (screen: T) => JSON.stringify(screen);
  let current = key(initial);
  let restoring: string | null = null;
  const read = (state: unknown): T | null => {
    const entry = (state as { futsiNavigation?: NavigationEntry<T> } | null)?.futsiNavigation;
    return entry?.owner === owner && entry.screen != null ? entry.screen : null;
  };
  const saved = read(browser.history.state);
  if (saved) {
    current = restoring = key(saved);
    restore(saved);
  } else {
    browser.history.replaceState({ futsiNavigation: { owner, screen: initial } }, "", url(initial));
  }
  const onPop = (event: PopStateEvent) => {
    const screen = read(event.state);
    if (!screen) return;
    current = restoring = key(screen);
    restore(screen);
  };
  browser.addEventListener("popstate", onPop);
  return {
    update(screen: T) {
      const next = key(screen);
      if (restoring != null) {
        if (next === restoring) restoring = null;
        return;
      }
      if (next === current) return;
      current = next;
      browser.history.pushState({ futsiNavigation: { owner, screen } }, "", url(screen));
    },
    dispose() { browser.removeEventListener("popstate", onPop); },
  };
}
