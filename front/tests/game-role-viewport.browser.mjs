import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.TEST_ENROLLMENT_ORIGIN || "http://127.0.0.1:5244";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const teams = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Equipo ${i + 1} con un nombre largo`, is_active: true }));
const matrix = {
  teams, matrix_team_ids: teams.slice(0, 19).map(team => team.id), schedule_enabled: true,
  standings: teams.map(team => ({team: team.id, team_name: team.name, position: team.id,
    played: 1, won: 1, lost: 0, drawn: 0, goals_for: 2, goals_against: 0, goal_difference: 2, points: 3})),
  rounds: [{ id: 1, number: 1, starts_on: "2026-11-23" }, { id: 2, number: 2, starts_on: "2026-11-30" }],
  crosses: [
    { home_team_id: 1, away_team_id: 2, round_id: 1, scheduled_on: "2026-11-29", starts_at: "14:00", ends_at: "14:50", played: true },
    { home_team_id: 2, away_team_id: 3, round_id: 1, scheduled_on: "2026-11-29", starts_at: "14:50", ends_at: "15:40", played: false },
    { home_team_id: 3, away_team_id: 4, round_id: 2, scheduled_on: "2026-12-06", starts_at: "14:00", ends_at: "14:50", played: true },
    { home_team_id: 4, away_team_id: 5, round_id: 2, scheduled_on: "2026-12-06", starts_at: "15:00", ends_at: "15:50", played: false },
    { home_team_id: 1, away_team_id: 3, round_id: 1, scheduled_on: null, starts_at: null, ends_at: null, played: false },
    ...Array.from({ length: 12 }, (_, index) => ({
      home_team_id: index + 5, away_team_id: index + 6, round_id: 1, scheduled_on: "2026-11-23",
      starts_at: `${9 + index}:00`.padStart(5, "0"), ends_at: `${9 + index}:50`.padStart(5, "0"), played: false,
    })),
  ],
  team_notes: [
    { id: 1, kind: "permit", team_id: 1, round_id: 1, note: "Permiso de prueba" },
    { id: 2, kind: "unavailable", team_id: 2, weekday: 2, note: "Prefiere evitar el miércoles" },
  ],
};
async function inside(page, locator) {
  for (const box of await locator.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) {
    const view = page.viewportSize();
    assert(box.left >= -1 && box.top >= -1 && box.right <= view.width + 1 && box.bottom <= view.height + 1,
      JSON.stringify({view, box, locator: String(locator)}));
  }
  assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth));
}

try {
  for (const [width, height] of [[320,568], [390,740], [1024,668], [1280,720], [1440,900], [1890,990]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(5000);
    await page.route("**/api/**", route => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith("/game-roles/1/")) return route.fulfill({ json: matrix });
      if (pathname.endsWith("/game-roles/2/")) return route.fulfill({ json: {
        ...matrix, teams: [], matrix_team_ids: [], rounds: [], crosses: [], standings: [], team_notes: [],
      } });
      if (pathname.endsWith("/game-roles/1/team-notes/")) {
        const note = route.request().postDataJSON();
        assert.equal(note.kind, "preferred");
        assert.equal(note.weekday, 3);
        return route.fulfill({ json: { team_notes: [...matrix.team_notes, { ...note, id: 3 }] } });
      }
      if (pathname.endsWith("/catalog/")) return route.fulfill({ json: {
        sites: [{ id: 27, name: "Colegio Franco" }], teams,
        tournaments: [
          { id: 1, name: "UEFA", site: 27, is_active: true },
          { id: 2, name: "Torneo sin equipos", site: 27, is_active: true },
        ],
      } });
      return route.fulfill({ json: { results: [], count: 0 } });
    });
    await page.goto(origin + "/tests/enrollment-register-preview.html#/admin/inscripciones/game-roles");
    await page.getByLabel("Torneo", { exact: true }).selectOption("1");
    const grid = page.getByRole("region", { name: "Matriz de cruces por equipo" });
    await grid.waitFor();
    await page.waitForFunction(() => {
      const box = document.querySelector(".game-roles-grid-scroll");
      const table = box?.querySelector("table");
      return table && table.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1 &&
        table.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1;
    }, undefined, {timeout:4000});
    await inside(page, grid.locator("table"));
    await inside(page, page.getByRole("button", {name:"Agregar equipo"}));
    const nextColumn = page.getByRole("button", { name: "Locales: siguiente" });
    if (await nextColumn.isVisible()) {
      const first = await grid.getByRole("columnheader").nth(1).textContent();
      await nextColumn.click();
      assert.notEqual(await grid.getByRole("columnheader").nth(1).textContent(), first);
      await page.getByRole("button", { name: "Locales: anterior" }).click();
    }
    const nextRow = page.getByRole("button", { name: "Visitantes: siguiente" });
    if (await nextRow.isVisible()) {
      const first = await grid.getByRole("rowheader").first().textContent();
      await nextRow.click();
      assert.notEqual(await grid.getByRole("rowheader").first().textContent(), first);
      await page.getByRole("button", { name: "Visitantes: anterior" }).click();
    }
    const tournamentSelect = page.getByLabel("Torneo", {exact:true});
    if (width < 1024) {
      assert((await grid.getByRole("button").first().boundingBox()).height >= 44);
      assert((await tournamentSelect.boundingBox()).height >= 44);
    } else {
      assert((await tournamentSelect.boundingBox()).height <= 32);
      assert.equal(await tournamentSelect.evaluate(node => getComputedStyle(node).fontSize), "12px");
      assert((await page.getByRole("button", {name:"Cerrar sesión"}).boundingBox()).height <= 32);
    }
    const navigation = page.getByRole("navigation", {name:"Vistas de Roles de juego"});
    assert.deepEqual(await navigation.getByRole("button").allTextContents(), ["Estadísticas"]);
    const slots = page.getByRole("list", {name:"Horarios de la fecha"});
    await slots.scrollIntoViewIfNeeded();
    assert.equal(await slots.getByRole("button", {name:/^14:(00|50)/}).count(), 0);
    assert(await slots.getByRole("button", {name:"15:40–16:30 Disponible"}).isVisible());
    await inside(page, slots.getByRole("button"));
    const nextSlot = page.getByRole("button", {name:"Horarios: siguiente"});
    if (await nextSlot.isVisible()) {
      await inside(page, nextSlot);
      const first = await slots.getByRole("button").first().textContent();
      await nextSlot.click();
      await slots.scrollIntoViewIfNeeded();
      await inside(page, slots.getByRole("button"));
      assert.notEqual(await slots.getByRole("button").first().textContent(), first);
    } else {
      assert.equal(await slots.getByRole("button").count(), 6);
    }
    const history = page.getByRole("region", {name:"Historial de partidos"});
    const played = history.getByRole("list", {name:"Jugados"});
    const upcoming = history.getByRole("list", {name:"Programados"});
    const roundLabels = list => list.locator(".game-role-history-round").allTextContents();
    const filter = history.getByLabel("Jornada del historial");
    assert.equal(await filter.inputValue(), "0");
    assert.deepEqual(await roundLabels(played), ["Jornada 2", "Jornada 1"]);
    assert.deepEqual(await roundLabels(upcoming), ["Jornada 2", ...Array(13).fill("Jornada 1")]);
    assert.equal(await history.getByText("Sin horario", {exact:true}).count(), 0);
    assert.equal(await history.getByRole("button", {name:/Partidos: (siguiente|anterior)/}).count(), 0);
    const capture = played.getByRole("button", {name:"Capturar marcador"}).first();
    await capture.scrollIntoViewIfNeeded();
    await inside(page, capture);
    const playedColumn = await history.getByRole("region", {name:"Jugados", exact:true}).boundingBox();
    const upcomingColumn = await history.getByRole("region", {name:"Programados", exact:true}).boundingBox();
    assert(playedColumn.x + playedColumn.width <= upcomingColumn.x && Math.abs(playedColumn.y - upcomingColumn.y) <= 1);
    await upcoming.scrollIntoViewIfNeeded();
    await inside(page, upcoming);
    assert(await upcoming.evaluate(node => node.scrollHeight > node.clientHeight));
    const lastMatch = upcoming.getByRole("button", {name:"Editar partido"}).last();
    await lastMatch.click();
    assert(await upcoming.evaluate(node => node.scrollTop > 0));
    await inside(page, lastMatch);
    await page.getByRole("dialog", {name:"Jornada y horario del partido"}).getByRole("button", {name:"Cancelar"}).click();
    await filter.selectOption("2");
    assert.deepEqual(await roundLabels(played), ["Jornada 2"]);
    assert.deepEqual(await roundLabels(upcoming), ["Jornada 2"]);
    assert.equal(await upcoming.evaluate(node => node.scrollTop), 0);
    const permits = page.getByRole("region", {name:"Permisos", exact:true});
    const suggestions = page.getByRole("region", {name:"Sugerencias de horario", exact:true});
    await permits.scrollIntoViewIfNeeded();
    await inside(page, permits);
    await inside(page, suggestions);
    assert((await permits.boundingBox()).y >= (await grid.boundingBox()).y + (await grid.boundingBox()).height - 1);
    assert(await permits.getByText("Permiso de prueba").isVisible());
    assert(await suggestions.getByText("Prefiere evitar el miércoles").isVisible());
    await permits.getByRole("button", {name:"Agregar permiso"}).click();
    await page.getByRole("dialog", {name:"Agregar permiso de equipo"}).getByRole("button", {name:"Cancelar"}).click();
    await suggestions.getByRole("button", {name:"Agregar sugerencia"}).click();
    const noteForm = page.getByRole("dialog", {name:"Agregar sugerencia de horario"});
    await noteForm.getByLabel("Equipo", {exact:true}).selectOption("3");
    await noteForm.getByLabel("Día", {exact:true}).selectOption("3");
    await noteForm.getByLabel("Nota (opcional)").fill("Comentario nuevo");
    await noteForm.getByRole("button", {name:"Guardar"}).click();
    await suggestions.getByText("Comentario nuevo").waitFor();
    await page.getByRole("button", { name:"Estadísticas", exact:true }).click();
    const standings = page.getByRole("region", { name:"Posiciones por equipo" });
    await standings.waitFor();
    await inside(page, standings);
    await standings.getByRole("button", { name:"Posiciones: siguiente" }).click();
    assert.equal(await standings.getByRole("rowheader").first().textContent(), teams[4].name);
    const scorers = page.getByRole("region", { name:"Goleo por equipo" });
    await scorers.waitFor();
    await scorers.scrollIntoViewIfNeeded();
    await inside(page, scorers);
    await navigation.getByRole("button", {name:"Volver a roles de juego"}).click();
    await grid.waitFor();
    if (width === 320) {
      await page.getByLabel("Torneo", {exact:true}).selectOption("2");
      await navigation.getByRole("button", {name:"Estadísticas"}).click();
      await standings.getByText("Aún no hay equipos.").waitFor();
      assert.equal(await standings.getByRole("columnheader").count(), 10);
      await inside(page, standings);
    }
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    console.log(`Roles sin desplazamiento a ${width} × ${height}`);
    await page.close();
  }
} finally {
  await browser.close();
}
