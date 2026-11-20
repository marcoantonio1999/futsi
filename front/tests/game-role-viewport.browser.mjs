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
  ],
  team_notes: [{ id: 1, kind: "permit", team_id: 1, round_id: 1, note: "Permiso de prueba" }],
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
      if (pathname.endsWith("/catalog/")) return route.fulfill({ json: {
        sites: [{ id: 27, name: "Colegio Franco" }], teams,
        tournaments: [{ id: 1, name: "UEFA", site: 27, is_active: true }],
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
    if (width < 1024) {
      assert((await grid.getByRole("button").first().boundingBox()).height >= 44);
      await page.getByRole("button", { name:"Horarios", exact:true }).click();
      assert.equal(await grid.isVisible(), false);
    }
    const slots = page.getByRole("list", {name:"Horarios de la fecha"});
    await inside(page, slots.getByRole("button"));
    const nextSlot = page.getByRole("button", {name:"Horarios: siguiente"});
    if (await nextSlot.isVisible()) {
      await inside(page, nextSlot);
      const first = await slots.getByRole("button").first().textContent();
      await nextSlot.click();
      await inside(page, slots.getByRole("button"));
      assert.notEqual(await slots.getByRole("button").first().textContent(), first);
    } else {
      assert.equal(await slots.getByRole("button").count(), 8);
    }
    if (width < 1024) await page.getByRole("button", {name:"Historial",exact:true}).click();
    const history = page.getByRole("region", {name:"Historial de partidos"});
    await inside(page, history.getByRole("button", {name:"Capturar marcador"}));
    await history.getByLabel("Jornada del historial").selectOption("1");
    await history.getByRole("button", {name:"Partidos: siguiente"}).click();
    await inside(page, history.getByRole("button", {name:"Editar partido"}));
    await page.getByRole("button", {name:"Permisos",exact:true}).click();
    const notes = page.getByRole("dialog", {name:"Permisos"});
    assert(await notes.getByText("Permiso de prueba").isVisible());
    await notes.getByRole("button", {name:"Agregar permiso"}).click();
    await page.getByRole("dialog", {name:"Agregar permiso"}).getByRole("button", {name:"Cancelar"}).click();
    await notes.getByRole("button", {name:"Cerrar"}).click();
    await page.getByRole("button", { name:"Estadísticas", exact:true }).click();
    const standings = page.getByRole("region", { name:"Posiciones por equipo" });
    await standings.waitFor();
    await inside(page, standings);
    await standings.getByRole("button", { name:"Posiciones: siguiente" }).click();
    assert.equal(await standings.getByRole("rowheader").first().textContent(), teams[4].name);
    if (width < 1024) await page.getByRole("button", { name:"Goleo", exact:true }).click();
    const scorers = page.getByRole("region", { name:"Goleo por equipo" });
    await scorers.waitFor();
    await inside(page, scorers);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    console.log(`Roles sin desplazamiento a ${width} × ${height}`);
    await page.close();
  }
} finally {
  await browser.close();
}
