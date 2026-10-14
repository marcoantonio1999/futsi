import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = await build({
  stdin: { contents: 'export { WithdrawalPlayerCard } from "./src/features/enrollments/WithdrawalPlayerCard";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
});
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const render = (player, selected = false) => renderToStaticMarkup(React.createElement(loaded.exports.WithdrawalPlayerCard, { player, selected, endpoint: "/withdrawal/test-token/", onChange: () => {} }));
test("lists each player with a photo and independent selection", () => {
  const html = render({ id: 7, name: "José Luis Pérez Orduña", is_delegate: true, has_photo: true }, true);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked=""/);
  assert.match(html, /src="\/withdrawal\/test-token\/photos\/7\/"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /Delegado/);
  assert.doesNotMatch(html, /supabase|service_role/);
});
test("missing photo keeps the player selectable without broken image", () => {
  const html = render({ id: 8, name: "Otra persona", is_delegate: false, has_photo: false });
  assert.match(html, /Sin foto/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /type="checkbox"/);
});
test("batch confirmation sends all IDs and requires a new signature after selection changes", () => {
  const source = readFileSync(new URL("../src/features/enrollments/PlayerEnrollment.tsx", import.meta.url), "utf8");
  assert.match(source, /selected.forEach\(id => data.append\("enrollment_ids", String\(id\)\)\)/);
  assert.match(source, /setAccepted\(false\); setSignature\(null\)/);
  assert.match(source, /Signature key=\{selected.join\(","\)\}/);
  assert.match(source, /Mi firma aplica a todas estas bajas/);
});
