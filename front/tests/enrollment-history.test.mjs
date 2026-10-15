import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createEnrollmentHistory, enrollmentScreenFromHash, enrollmentScreenUrl, isEnrollmentAdminHash } from '../src/features/enrollments/enrollmentHistory.ts';

function fixture(hash = '#/admin/inscripciones') {
  const entries = [{ state: null, url: 'https://www.google.com/' }, { state: { unrelated: 'retained' }, url: hash }];
  let index = 1;
  const listeners = new Map();
  const move = delta => { index += delta; for (const listener of listeners.get('popstate') || []) listener(); };
  const browser = {
    location: { get hash() { return entries[index].url; } },
    history: {
      get state() { return entries[index].state; },
      pushState(state, _, url) { entries.splice(index + 1); entries.push({ state, url }); index++; },
      replaceState(state, _, url) { entries[index] = { state, url }; },
      back() { move(-1); },
    },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
  };
  return { browser, entries, move, listeners };
}
test('subsections, roster, alignment and details all remain inside enrollment routing', () => {
  for (const section of ['history', 'tools', 'withdraw-history', 'commission', 'blacklist', 'tournament-teams']) {
    const screen = { ...enrollmentScreenFromHash('#/admin/inscripciones'), section, roster: 41, alignment: true, detail: 12 };
    const url = enrollmentScreenUrl(screen);
    assert.ok(isEnrollmentAdminHash(url));
    const parsed = enrollmentScreenFromHash(url);
    assert.equal(parsed.section, section); assert.equal(parsed.roster, 41); assert.equal(parsed.detail, 12); assert.equal(parsed.alignment, true);
  }
  assert.equal(isEnrollmentAdminHash('#/admin/inscripciones-mal'), false);
  assert.equal(enrollmentScreenFromHash('#/admin/inscripciones/no-existe?equipo=NaN').roster, null);
});
test('Back and Forward restore the exact filtered list, page, paper and scroll without adding entries', () => {
  const f = fixture(); let screen;
  const nav = createEnrollmentHistory(f.browser, 'enrollments:5', next => { screen = next; });
  nav.values('roster.tournament', '7'); nav.values('roster.search', 'Paris');
  nav.scroll({ x: 0, y: 410, regions: [[90, 120]] });
  assert.equal(f.entries.length, 2, 'filters and scrolling must not create Back-button stops');
  nav.navigate({ roster: 9 }); nav.values('paper.9.date', '2026-10-15');
  nav.navigate({ section: 'withdraw-history', roster: null }); nav.values('withdrawals.page', 3);
  nav.navigate({ detail: 72 });
  const count = f.entries.length;
  f.move(-1); assert.equal(screen.section, 'withdraw-history'); assert.equal(screen.detail, null); assert.equal(screen.values['withdrawals.page'], 3);
  f.move(-1); assert.equal(screen.roster, 9); assert.equal(screen.values['paper.9.date'], '2026-10-15');
  f.move(-1); assert.equal(screen.section, 'history'); assert.equal(screen.roster, null); assert.equal(screen.values['roster.search'], 'Paris'); assert.equal(screen.scroll.y, 410); assert.deepEqual(screen.scroll.regions, [[90, 120]]);
  f.move(1); assert.equal(screen.roster, 9); f.move(1); assert.equal(screen.values['withdrawals.page'], 3);
  assert.equal(f.entries.length, count); assert.equal(f.browser.history.state.unrelated, 'retained');
  nav.dispose(); assert.ok([...f.listeners.values()].every(listeners => !listeners.size));
});
test('reload restores its owned entry, while another user does not inherit filters', () => {
  const f = fixture(); const first = createEnrollmentHistory(f.browser, 'enrollments:5', () => {});
  first.navigate({ section: 'tournament-teams' }); first.values('teams.tournament', '18'); first.dispose();
  const same = createEnrollmentHistory(f.browser, 'enrollments:5', () => {});
  assert.equal(same.screen.section, 'tournament-teams'); assert.equal(same.screen.values['teams.tournament'], '18');
  const count = f.entries.length; same.dispose();
  const other = createEnrollmentHistory(f.browser, 'enrollments:6', () => {});
  assert.deepEqual(other.screen.values, {}); assert.equal(f.entries.length, count); other.dispose();
});
test('direct paper link has an in-app fallback, but native Back can leave the first entry normally', () => {
  const f = fixture('#/admin/inscripciones/tools?equipo=9&hoja=alineacion');
  const nav = createEnrollmentHistory(f.browser, 'enrollments:5', () => {});
  nav.back(); assert.equal(nav.screen.section, 'tools'); assert.equal(nav.screen.roster, null); assert.equal(f.entries.length, 2);
  f.move(-1); assert.equal(f.browser.location.hash, 'https://www.google.com/'); nav.dispose();
});
test('one traversal restores once despite popstate/hashchange, including repeated scroll round trips', () => {
  const f = fixture(); let restorations = 0;
  const nav = createEnrollmentHistory(f.browser, 'enrollments:5', () => { restorations++; });
  nav.scroll({ x: 0, y: 0, regions: [[0, 549]] }, false);
  nav.navigate({ roster: 10 });
  for (let index = 0; index < 3; index++) {
    const before = restorations;
    f.move(-1);
    for (const listener of f.listeners.get('hashchange')) listener();
    assert.equal(restorations, before + 1);
    assert.equal(nav.screen.scroll.regions[0][1], 549);
    nav.navigate({ roster: 10 });
  }
  nav.dispose();
});
test('the actual application accepts enrollment subroutes and mounts user-scoped history', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/features/enrollments/PlayerEnrollment.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('enrollmentAdmin={isEnrollmentAdminHash(hash)}'));
  assert.ok(app.includes('userId={currentUser.id}'));
  assert.ok(dashboard.includes('<EnrollmentNavigation'));
  assert.ok(dashboard.includes('navigation.navigate({ roster: item.id'));
  assert.ok(dashboard.includes('navigation.back()'));
});
