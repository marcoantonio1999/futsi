export const enrollmentSections = ['history', 'send', 'tools', 'withdraw', 'withdraw-history', 'sanction-new', 'commission', 'blacklist', 'players', 'tournament-overview', 'tournament-create', 'tournament-teams', 'tournament-team-create'] as const;
export type EnrollmentSection = typeof enrollmentSections[number];
export type EnrollmentScreen = {
  section: EnrollmentSection; roster: number | null; alignment: boolean; detail: number | null;
  values: Record<string, string | number>; scroll: { x: number; y: number; regions: [number, number][] };
};
type Entry = { owner: string; index: number; screen: EnrollmentScreen };
type Browser = Pick<Window, 'history' | 'location' | 'addEventListener' | 'removeEventListener'>;
const base = '#/admin/inscripciones';
export const emptyEnrollmentScreen = (): EnrollmentScreen => ({ section: 'history', roster: null, alignment: false, detail: null, values: {}, scroll: { x: 0, y: 0, regions: [] } });
export function isEnrollmentAdminHash(hash: string) { return hash === base || hash.startsWith(base + '/') || hash.startsWith(base + '?'); }
export function enrollmentScreenUrl(screen: EnrollmentScreen) {
  const params = new URLSearchParams();
  if (screen.roster) params.set('equipo', String(screen.roster));
  if (screen.alignment && screen.roster) params.set('hoja', 'alineacion');
  if (screen.detail) params.set('detalle', String(screen.detail));
  return `${base}/${screen.section}${params.size ? '?' + params : ''}`;
}
export function enrollmentScreenFromHash(hash: string): EnrollmentScreen {
  const screen = emptyEnrollmentScreen(), [path, query] = hash.split('?');
  const section = path.slice(base.length + 1);
  if (enrollmentSections.includes(section as EnrollmentSection)) screen.section = section as EnrollmentSection;
  const params = new URLSearchParams(query);
  const id = (key: string) => /^\d+$/.test(params.get(key) || '') && Number(params.get(key)) > 0 ? Number(params.get(key)) : null;
  screen.roster = id('equipo'); screen.detail = id('detalle'); screen.alignment = !!screen.roster && params.get('hoja') === 'alineacion';
  return screen;
}
function readEntry(state: unknown, owner: string): Entry | null {
  const entry = (state as { enrollmentNavigation?: Entry } | null)?.enrollmentNavigation;
  return entry?.owner === owner && Number.isInteger(entry.index) && entry.index >= 0
    && enrollmentSections.includes(entry.screen?.section) && entry.screen?.values && entry.screen?.scroll ? entry : null;
}
export function initialEnrollmentScreen(browser: Browser, owner: string) {
  const saved = readEntry(browser.history.state, owner);
  return saved && enrollmentScreenUrl(saved.screen) === browser.location.hash ? saved.screen : enrollmentScreenFromHash(browser.location.hash);
}
// Explicit navigation pushes; filter/page/scroll edits replace the current entry.
// No effect infers navigation from state, and popstate never adds a new entry.
export function createEnrollmentHistory(browser: Browser, owner: string, restore: (screen: EnrollmentScreen, restorePosition?: boolean) => void) {
  const saved = readEntry(browser.history.state, owner);
  let current: Entry = { owner, index: saved && enrollmentScreenUrl(saved.screen) === browser.location.hash ? saved.index : 0, screen: initialEnrollmentScreen(browser, owner) };
  const positions = new Map<number, EnrollmentScreen['scroll']>();
  const write = (push: boolean) => browser.history[push ? 'pushState' : 'replaceState']({ ...browser.history.state, enrollmentNavigation: current }, '', enrollmentScreenUrl(current.screen));
  write(false);
  const onPop = () => {
    const entry = readEntry(browser.history.state, owner);
    // Browsers emit popstate AND hashchange for one traversal. Restore only once.
    if (entry?.index === current.index && enrollmentScreenUrl(entry.screen) === enrollmentScreenUrl(current.screen) && browser.location.hash === enrollmentScreenUrl(current.screen)) return;
    positions.set(current.index, current.screen.scroll);
    if (!isEnrollmentAdminHash(browser.location.hash)) return;
    current = entry && enrollmentScreenUrl(entry.screen) === browser.location.hash ? entry : { owner, index: 0, screen: enrollmentScreenFromHash(browser.location.hash) };
    if (positions.has(current.index)) current = { ...current, screen: { ...current.screen, scroll: positions.get(current.index)! } };
    restore(current.screen);
  };
  browser.addEventListener('popstate', onPop);
  browser.addEventListener('hashchange', onPop);
  return {
    get screen() { return current.screen; },
    navigate(patch: Partial<Pick<EnrollmentScreen, 'section' | 'roster' | 'alignment' | 'detail'>>, replace = false) {
      const screen = { ...current.screen, ...patch };
      if (enrollmentScreenUrl(screen) === enrollmentScreenUrl(current.screen)) return;
      positions.set(current.index, current.screen.scroll);
      if (!replace) write(false);
      current = { ...current, index: current.index + (replace ? 0 : 1), screen: { ...screen, scroll: { x: 0, y: 0, regions: [] } } };
      write(!replace); restore(current.screen);
    },
    values(key: string, value: string | number) {
      current = { ...current, screen: { ...current.screen, values: { ...current.screen.values, [key]: value } } };
      write(false); restore(current.screen, false);
    },
    scroll(scroll: EnrollmentScreen['scroll'], persist = true) { current = { ...current, screen: { ...current.screen, scroll } }; if (persist) write(false); },
    flushScroll() { if (browser.location.hash === enrollmentScreenUrl(current.screen)) write(false); },
    back() {
      if (current.index > 0) browser.history.back();
      else this.navigate({ roster: null, detail: null, alignment: false }, true);
    },
    dispose() { browser.removeEventListener('popstate', onPop); browser.removeEventListener('hashchange', onPop); },
  };
}
