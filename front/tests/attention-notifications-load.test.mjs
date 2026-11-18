import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

const fixture = { state: [], cursor: 0, effects: [], calls: 0, timers: 0 };
globalThis.__attentionFixture = fixture;
globalThis.window = { setInterval() { fixture.timers++; }, addEventListener() {}, removeEventListener() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const bundled = await build({ stdin: { contents: 'export { AttentionNotifications } from "./src/components/layout/AttentionNotifications";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, plugins: [{ name: "notification-fixture", setup(builder) {
  builder.onResolve({ filter: /^react$/ }, () => ({ path: "hooks", namespace: "fixture" }));
  builder.onResolve({ filter: /^\.\.\/\.\.\/api$/ }, () => ({ path: "api", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "hooks"
    ? 'export const useEffect = (callback,deps) => globalThis.__attentionFixture.effects.push({callback,deps}); export const useState = initial => { const f=globalThis.__attentionFixture, i=f.cursor++; if (!(i in f.state)) f.state[i]=initial; return [f.state[i], v => { f.state[i]=typeof v === "function" ? v(f.state[i]) : v; }]; }; export const useRef = () => ({current:null});'
    : 'export const apiRequest = async () => { globalThis.__attentionFixture.calls++; return {items:[],total:0}; };', loader: "js" }));
} }] });
const loaded = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
function render() { fixture.cursor=0; fixture.effects=[]; return loaded.exports.AttentionNotifications({ token: "test-session", user: { id: 1, role: "admin" }, onOpenChats() {} }); }

test("opening the bell requests fresh alerts without background polling", async () => {
  let tree=render();
  const initialLoad=fixture.effects.find(effect => effect.deps?.length === 3);
  const cleanup=initialLoad.callback(); await Promise.resolve();
  assert.equal(fixture.calls,1);
  tree.props.children[0].props.onClick();
  tree=render();
  const reopenedLoad=fixture.effects.find(effect => effect.deps?.length === 3);
  assert.notDeepEqual(reopenedLoad.deps,initialLoad.deps);
  cleanup(); const cleanup2=reopenedLoad.callback(); await Promise.resolve();
  assert.equal(fixture.calls,2); assert.equal(fixture.timers,0);
  cleanup2();
});

