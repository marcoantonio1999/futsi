import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = await build({
  stdin: { contents: 'export { TournamentsPanel } from "./src/features/tournaments"; export { emptyData } from "./src/appState";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
});
const loaded = { exports: {} };
globalThis.window = { location: { hostname: "localhost", origin: "http://localhost", protocol: "http:" } };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { TournamentsPanel, emptyData } = loaded.exports;
const tournament = { id: 81, site: 9, name: "Torneo ficticio", billing_type: "weekly_match", starts_on: "2026-10-08", expected_weeks: 12, is_active: true };
const data = { ...emptyData, sites: [{ id: 9, name: "Sede ficticia" }], tournaments: [tournament],
  teams: [{ id: 82, tournament: 81, name: "Equipo ficticio", is_active: true, representative_name: "CONTACTO_PRIVADO", representative_phone: "CONTACTO_PRIVADO" }] };
const noop = () => {};
const unavailable = async () => { throw new Error("Not allowed in fixture"); };
function render(section, setupOnly = true) {
  return renderToStaticMarkup(React.createElement(TournamentsPanel, { data, token: "local-test-only", scope: "adult", setupOnly, section,
    onSelectSection: noop, onCreateTournament: unavailable, onCreateTeam: unavailable, onDeleteTournament: unavailable,
    onRegisterStudent: unavailable, onUpdateRegistration: unavailable, onCreateMatch: unavailable, onUpdateMatch: unavailable }));
}

test("Inscripciones embeds the actual shared Futsi workspace, not separate forms", () => {
  const source = readFileSync(new URL("../src/features/enrollments/PlayerEnrollment.tsx", import.meta.url), "utf8");
  assert.match(source, /<TournamentsPanel/);
  assert.doesNotMatch(source, /<TournamentCreatePage|<CreateTeamDialog/);
});
test("Create subsection renders Futsi's existing tournament page", () => {
  const html = render("create");
  assert.match(html, /data-testid="tournament-create-page"/);
  assert.match(html, /Datos del torneo/);
  assert.match(html, /Sede ficticia/);
  assert.doesNotMatch(html, /Categoría/);
});
test("Teams subsection lists real catalog teams and keeps the existing Create team action", () => {
  const html = render("teams");
  assert.match(html, /Equipos del torneo/);
  assert.match(html, /Crear equipo/);
  assert.match(html, /Equipo ficticio/);
  assert.doesNotMatch(html, /CONTACTO_PRIVADO|Partidos|Dashboard|Alumnos inscritos/);
});
test("Restricted setup directory does not expose deletion or fictitious counts", () => {
  const html = render("overview");
  assert.match(html, /Abrir torneo Torneo ficticio/);
  assert.doesNotMatch(html, /Eliminar torneo|Jugadores|Partidos/);
});
test("Normal Futsi teams view remains unchanged outside restricted setup", () => {
  const html = render("teams", false);
  assert.match(html, /CONTACTO_PRIVADO/);
  assert.match(html, /Partidos|Dashboard/);
});
