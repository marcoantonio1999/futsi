import test from "node:test";
import assert from "node:assert/strict";
import { createNavigationHistory } from "../src/hooks/navigationHistory.ts";

function browserFixture() {
  const entries = [{ state: null, url: "https://www.google.com/" }, { state: null, url: "/" }];
  let index = 1;
  const listeners = new Set();
  const browser = {
    history: {
      get state() { return entries[index].state; },
      replaceState(state, _, url) { entries[index] = { state, url }; },
      pushState(state, _, url) { entries.splice(index + 1); entries.push({ state, url }); index++; },
    },
    addEventListener(_, listener) { listeners.add(listener); },
    removeEventListener(_, listener) { listeners.delete(listener); },
  };
  return { browser, entries, listeners, move(delta) { index += delta; for (const listener of listeners) listener({ state: entries[index].state }); }, get url() { return entries[index].url; } };
}

test("Back and Forward restore sections without creating another entry or leaving the app", () => {
  const fixture = browserFixture();
  let screen = "summary";
  const nav = createNavigationHistory(fixture.browser, "soccerwa:1", screen, value => { screen = value; }, value => `#/app/${value}`);
  for (const next of ["chat-quality", "weekly-stats", "whatsapp"]) { screen = next; nav.update(screen); }
  assert.equal(fixture.entries.length, 5);
  nav.update("whatsapp");
  assert.equal(fixture.entries.length, 5);
  fixture.move(-1); assert.equal(screen, "weekly-stats"); nav.update(screen);
  fixture.move(-1); assert.equal(screen, "chat-quality"); nav.update(screen);
  fixture.move(1); assert.equal(screen, "weekly-stats"); nav.update(screen);
  assert.equal(fixture.entries.length, 5);
  fixture.move(-1); nav.update(screen);
  fixture.move(-1); assert.equal(screen, "summary"); nav.update(screen);
  fixture.move(-1); assert.equal(fixture.url, "https://www.google.com/");
  nav.dispose(); assert.equal(fixture.listeners.size, 0);
});

test("reload restores the same screen and does not push the stale initial screen", () => {
  const fixture = browserFixture();
  const first = createNavigationHistory(fixture.browser, "soccerwa:1", "summary", () => {}, value => `#/app/${value}`);
  first.update("chat-quality"); first.dispose();
  let restored;
  const reloaded = createNavigationHistory(fixture.browser, "soccerwa:1", "summary", value => { restored = value; }, value => `#/app/${value}`);
  assert.equal(restored, "chat-quality");
  reloaded.update("summary"); reloaded.update(restored);
  assert.equal(fixture.entries.length, 3);
  reloaded.update("weekly-stats");
  assert.equal(fixture.entries.length, 4);
  reloaded.dispose();
});

test("a different user does not restore the previous user's navigation", () => {
  const fixture = browserFixture();
  const first = createNavigationHistory(fixture.browser, "soccerwa:1", "calls", () => {}, value => `#/app/${value}`);
  first.dispose();
  let restored = false;
  const next = createNavigationHistory(fixture.browser, "soccerwa:2", "summary", () => { restored = true; }, value => `#/app/${value}`);
  assert.equal(restored, false);
  assert.equal(fixture.browser.history.state.futsiNavigation.owner, "soccerwa:2");
  next.dispose();
});
