import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { createEnrollmentHistory, initialEnrollmentScreen, type EnrollmentScreen } from './enrollmentHistory';

type Navigation = {
  screen: EnrollmentScreen;
  navigate: (patch: Partial<Pick<EnrollmentScreen, 'section' | 'roster' | 'alignment' | 'detail'>>) => void;
  back: () => void; value: (key: string, value: string | number) => void;
  restoreScroll: () => void;
};
const Context = createContext<Navigation | null>(null);
const regions = () => Array.from(document.querySelectorAll<HTMLElement>('.enrollment-admin-layout :is([role=region], .tournament-directory-scroll, .enrollment-team-roster-scroll)'));
const scrollPosition = () => ({ x: window.scrollX, y: window.scrollY, regions: regions().map(element => [element.scrollLeft, element.scrollTop] as [number, number]) });

export function EnrollmentNavigation({ userId, children }: { userId: number; children: ReactNode }) {
  const owner = `enrollments:${userId}`;
  const [screen, setScreen] = useState(() => initialEnrollmentScreen(window, owner));
  const controller = useRef<ReturnType<typeof createEnrollmentHistory> | null>(null);
  const pending = useRef<EnrollmentScreen['scroll'] | null>(screen.scroll);
  const restoreScroll = () => {
    const position = pending.current;
    if (!position) return;
    window.scrollTo(position.x, position.y);
    const elements = regions();
    position.regions.forEach(([left, top], index) => elements[index]?.scrollTo(left, top));
    if (Math.abs(window.scrollY - position.y) < 2 && position.regions.every(([left, top], index) => elements[index] && Math.abs(elements[index].scrollTop - top) < 2 && Math.abs(elements[index].scrollLeft - left) < 2)) pending.current = null;
  };
  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const history = createEnrollmentHistory(window, owner, (next, restorePosition = true) => { if (restorePosition) pending.current = next.scroll; setScreen(next); });
    controller.current = history; setScreen(history.screen);
    let frame = 0;
    const saveScroll = () => {
      if (pending.current || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (!pending.current) history.scroll(scrollPosition(), false); });
    };
    window.addEventListener('scroll', saveScroll, true);
    const flush = () => { if (!pending.current) { history.scroll(scrollPosition(), false); history.flushScroll(); } };
    window.addEventListener('pagehide', flush);
    return () => { history.flushScroll(); history.dispose(); controller.current = null; window.history.scrollRestoration = previous; window.removeEventListener('scroll', saveScroll, true); window.removeEventListener('pagehide', flush); cancelAnimationFrame(frame); };
  }, [owner]);
  useLayoutEffect(() => { restoreScroll(); }, [screen.section, screen.roster, screen.detail]);
  const navigation: Navigation = {
    screen,
    navigate(patch) {
      controller.current?.scroll(scrollPosition(), false);
      controller.current?.navigate(patch);
    },
    back: () => controller.current?.back(),
    value: (key, value) => controller.current?.values(key, value),
    restoreScroll,
  };
  return <Context.Provider value={navigation}>{children}</Context.Provider>;
}
export function useEnrollmentNavigation() { return useContext(Context); }
// Outside Inscripciones, shared tournament components retain their original local state.
// Only navigation/filter values are stored; never credentials, files or form signatures.
export function useEnrollmentViewState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const navigation = useContext(Context), [local, setLocal] = useState(initial);
  const value = (navigation?.screen.values[key] ?? local) as T;
  return [value, next => {
    const updated = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
    if (navigation && (typeof updated === 'string' || typeof updated === 'number')) navigation.value(key, updated); else setLocal(updated);
  }];
}
export function useEnrollmentScrollReady(ready: boolean) {
  const navigation = useContext(Context);
  useEffect(() => { if (ready) navigation?.restoreScroll(); }, [ready, navigation?.screen.section, navigation?.screen.roster, navigation?.screen.detail]);
}
export function useEnrollmentDetail<T extends { id: number }>(rows: T[]): [T | null, (row: T | null) => void] {
  const navigation = useContext(Context), [local, setLocal] = useState<T | null>(null), closing = useRef(false);
  const id = navigation?.screen.detail;
  useEffect(() => { closing.current = false; }, [id]);
  return [navigation ? rows.find(row => row.id === id) || null : local, row => {
    if (!navigation) { setLocal(row); return; }
    if (row) navigation.navigate({ detail: row.id });
    else if (id && !closing.current) { closing.current = true; navigation.back(); }
  }];
}
