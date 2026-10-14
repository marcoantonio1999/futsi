import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = await build({
  stdin: { contents: 'export { PrintableDelegate } from "./src/features/enrollments/PrintableDelegate";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
});
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const render = name => renderToStaticMarkup(React.createElement(loaded.exports.PrintableDelegate, { name }));

test("prints the active delegate's full name without screen-only styling", () => {
  assert.match(render("José Luis Orduña Pérez"), /Delegado: <strong>José Luis Orduña Pérez<\/strong>/);
  assert.doesNotMatch(render("José Luis Orduña Pérez"), /no-print|hidden/);
  assert.match(render("Delegado nuevo"), /Delegado nuevo/);
});
test("does not invent a delegate when none remains active", () => {
  assert.match(render(), /Sin delegado asignado/);
});
test("both paper formats include delegate on every page, outside the hidden toolbar", () => {
  const source = readFileSync(new URL("../src/features/enrollments/PlayerEnrollment.tsx", import.meta.url), "utf8");
  const paper = source.slice(source.indexOf("{pages.map((pagePlayers, page)"), source.indexOf("export function EnrollmentDashboard"));
  assert.match(paper, /alignment \? "alignment-paper" : "photo-paper"/);
  assert.match(paper, /<PrintableDelegate name=\{players.find\(row => row.is_delegate\)\?\.name\} \/>/);
  assert.doesNotMatch(paper, /no-print[^\n]*PrintableDelegate/);
});
