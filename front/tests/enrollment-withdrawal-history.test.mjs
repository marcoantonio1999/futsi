import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const bundle = await build({
  stdin: { contents: 'export { WithdrawalHistory } from "./src/features/enrollments/WithdrawalHistory";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", define: { "import.meta.env": "{}" },
});
globalThis.window = { location: { hostname: "localhost", origin: "http://localhost", protocol: "http:" } };
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
test("history renders automatic player, tournament, team and date filters", () => {
  const html = renderToStaticMarkup(React.createElement(loaded.exports.WithdrawalHistory, { token: "fixture", revision: 0, renderSignature: () => null }));
  for (const text of ["Histórico de bajas", "Jugador", "Todos los torneos", "Todos los equipos", "Desde", "Hasta"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /setInterval|Buscar<\/button/);
});
test("history is a separate subsection and requests only withdrawals with server pagination", () => {
  const dashboard = readFileSync(new URL("../src/features/enrollments/PlayerEnrollment.tsx", import.meta.url), "utf8");
  assert.match(dashboard, />Bajas<\/div>/);
  assert.match(dashboard, />Nueva baja<\/Button>/);
  assert.match(dashboard, />Histórico de bajas<\/Button>/);
  const source = readFileSync(new URL("../src/features/enrollments/WithdrawalHistory.tsx", import.meta.url), "utf8");
  assert.match(source, /withdrawn_only: "true"/);
  assert.match(source, /page: String\(page\)/);
  assert.match(source, /document.kind === "withdrawal_signature"/);
  assert.match(source, /showModal\(\)/);
  assert.doesNotMatch(source, /setInterval/);
});

test("withdrawal table has independent styles outside the tournament directory layout", () => {
  const source = readFileSync(new URL("../src/features/enrollments/WithdrawalHistory.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/features/enrollments/enrollmentAdmin.css", import.meta.url), "utf8");
  assert.match(source, /className="withdrawal-history-table"/);
  assert.match(source, /className="withdrawal-history-scroll" role="region"/);
  assert.match(source, /<th scope="row">\{row.name\}/);
  assert.match(source, /<time dateTime=\{row.withdrawn_at\}/);
  assert.match(css, /\.withdrawal-history-table th,\.withdrawal-history-table td\{padding:16px 18px/);
  assert.match(css, /\.withdrawal-history-scroll\{[^}]*overflow-x:auto/);
  assert.match(css, /\.withdrawal-history \.withdrawal-history-filters\{grid-template-columns:minmax\(0,1fr\)/);
});
