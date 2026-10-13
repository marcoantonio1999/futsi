import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

const fixture = { effects: [], calls: 0, listeners: [], timers: 0 };
globalThis.__attentionFixture = fixture;
globalThis.window = { setInterval() { fixture.timers++; }, addEventListener(name) { fixture.listeners.push(name); } };
globalThis.document = { hidden: false, addEventListener(name) { fixture.listeners.push(name); } };
const bundled = await build({ stdin: { contents: 'export { AttentionNotifications } from "./src/components/layout/AttentionNotifications";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, plugins: [{ name: "notification-fixture", setup(builder) {
  builder.onResolve({ filter: /^react$/ }, () => ({ path: "hooks", namespace: "fixture" }));
  builder.onResolve({ filter: /^\.\.\/\.\.\/api$/ }, () => ({ path: "api", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "hooks"
    ? 'export const useEffect = callback => globalThis.__attentionFixture.effects.push(callback); export const useState = value => [value, () => {}]; export const useRef = () => ({current:null});'
    : 'export const apiRequest = async () => { globalThis.__attentionFixture.calls++; return {items:[],total:0}; };', loader: "js" }));
} }] });
const loaded = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);

test("notifications load once on page mount; opening the bell does not request again", async () => {
  const tree = loaded.exports.AttentionNotifications({ token: "test-session", user: { id: 1, role: "admin" }, onOpenChats() {} });
  const cleanups = fixture.effects.map(effect => effect());
  await Promise.resolve();
  assert.equal(fixture.calls, 1);
  assert.equal(fixture.timers, 0);
  assert.deepEqual(fixture.listeners, []);
  const bell = tree.props.children[0];
  bell.props.onClick(); bell.props.onClick();
  await Promise.resolve();
  assert.equal(fixture.calls, 1);
  cleanups.forEach(cleanup => cleanup?.());
});
