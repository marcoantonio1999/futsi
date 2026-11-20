import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.TEST_ENROLLMENT_ORIGIN || "http://127.0.0.1:5242";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const teams = [
  { id: 1, name: "FRANCO CANADIENSE", is_active: true },
  { id: 2, name: "CACOMIXTLES DEL COLEGIO FRANCO", is_active: true },
  { id: 3, name: "CABO VERDE", is_active: true },
  { id: 4, name: "PALMEIRAS", is_active: true },
  { id: 5, name: "OTRO EQUIPO DEL TORNEO", is_active: true },
];
const matrix = {
  teams, matrix_team_ids: [3, 4], schedule_enabled: true, standings: [],
  rounds: [{ id: 1, number: 1, starts_on: "2026-11-23" }, { id: 2, number: 2, starts_on: "2026-11-30" }],
  crosses: [{ home_team_id: 1, away_team_id: 2, round_id: 1, scheduled_on: "2026-11-26",
    starts_at: "01:00", ends_at: "02:00", played: true, home_goals: null, away_goals: null }],
};

try {
  for (const width of [320, 390, 1100, 1440, 1890]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/api/**", route => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith("/game-roles/1/")) return route.fulfill({ json: matrix });
      if (pathname.endsWith("/catalog/")) return route.fulfill({ json: {
        sites: [{ id: 27, name: "Colegio Franco" }], teams,
        tournaments: [{ id: 1, name: "Nocturno", site: 27, is_active: true }],
      } });
      return route.fulfill({ json: { results: [], count: 0 } });
    });
    await page.goto(origin + "/tests/enrollment-register-preview.html#/admin/inscripciones/game-roles");
    await page.getByLabel("Torneo", { exact: true }).selectOption("1");
    const grid = page.getByRole("region", { name: "Matriz de cruces por equipo" });
    const matchCell = grid.getByRole("button", { name: /FRANCO CANADIENSE local, CACOMIXTLES DEL COLEGIO FRANCO visitante, jornada 1, Jugado/ });
    await matchCell.waitFor({ state: "visible" });
    assert.deepEqual(await grid.locator(".game-role-column-name").allTextContents(),
      [teams[2].name, teams[3].name, teams[0].name, teams[1].name]);
    await page.getByRole("button", { name: "Agregar equipo", exact: true }).click();
    const teamPicker = page.getByRole("dialog", { name: "Agregar equipo" });
    assert.deepEqual(await teamPicker.locator('option:not([value=""])').allTextContents(), [teams[4].name]);
    await teamPicker.getByRole("button", { name: "Cancelar" }).click();
    if (width < 1024) await page.getByRole("button", { name: "Horarios", exact: true }).click();
    const date = page.getByLabel("Fecha", { exact: true });
    const slots = page.getByRole("list", { name: "Horarios de la fecha" });
    const slotTimes = () => slots.locator("strong").allTextContents();
    assert.equal(await date.inputValue(), "2026-11-26");
    assert.deepEqual(await date.locator('optgroup[label="Días de juego"] option').evaluateAll(options => options.map(option => option.value)),
      ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]);
    assert.match(await date.locator('option[value="2026-11-23"]').textContent(), /lunes.*23/);
    const roundSelect = page.locator(".game-role-hours select").first();
    await roundSelect.selectOption("2");
    assert.equal(await date.inputValue(), "2026-11-30");
    assert.deepEqual(await date.locator('optgroup[label="Días de juego"] option').evaluateAll(options => options.map(option => option.value)),
      ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]);
    await roundSelect.selectOption("1");
    assert.deepEqual(await slotTimes(), ["01:00–02:00", "21:50–22:40", "22:40–23:30"]);
    await date.selectOption("2026-11-23");
    assert.deepEqual(await slotTimes(), ["22:40–23:30"]);
    assert.equal(await slots.locator(".game-role-slot-color").count(), 1);
    await date.selectOption("2026-11-27");
    await page.getByText("Este día no tiene horarios preestablecidos.").waitFor();
    assert.equal(await slots.count(), 0);
    await date.selectOption("2026-11-26");
    await slots.getByRole("button", { name: "21:50–22:40 Disponible" }).click();
    const assign = page.getByRole("dialog", { name: /Asignar partido/ });
    await assign.getByLabel("Equipo local").selectOption("3");
    await assign.getByLabel("Equipo visitante").selectOption("4");
    await assign.getByRole("button", { name: "Continuar" }).click();
    const editor = page.getByRole("dialog", { name: "Jornada y horario del partido" });
    const editorSlot = editor.getByLabel("Horario disponible", { exact: true });
    assert.equal(await editorSlot.inputValue(), "21:50–22:40");
    assert.equal(await editor.locator('input[type="time"]').count(), 0);
    await editorSlot.selectOption("22:40–23:30");
    assert.equal(await editor.getByText("Horarios ocupados en este torneo").count(), 0);
    assert.equal(await editor.getByText("El rango elegido está disponible.").count(), 0);
    assert.deepEqual(await editor.locator("form").evaluate(form => {
      const data = new FormData(form);
      return [data.get("scheduled_on"), data.get("starts_at"), data.get("ends_at")];
    }), ["2026-11-26", "22:40", "23:30"]);
    const editorDate = editor.getByLabel("Fecha del partido");
    await editorDate.selectOption("2026-11-23");
    assert.equal(await editorSlot.inputValue(), "22:40–23:30");
    await editorDate.selectOption("2026-11-27");
    assert.equal(await editorSlot.count(), 0);
    assert(await editor.getByLabel("Hora de inicio").isVisible());
    assert(await editor.getByLabel("Hora de fin").isVisible());
    await editor.getByLabel("Hora de inicio").fill("12:00");
    await editor.getByLabel("Hora de fin").fill("11:00");
    await editor.getByRole("status").filter({ hasText: "La hora de fin debe ser posterior a la de inicio." }).waitFor();
    await editor.getByRole("button", { name: "Cancelar" }).click();
    for (const view of width < 1024 ? ["Historial"] : ["Matriz", "Historial"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      const history = page.getByRole("region", { name: "Historial de partidos" });
      const capture = history.getByRole("button", { name: "Capturar marcador" });
      await capture.waitFor();
      const geometry = await history.locator(".game-role-history-list li").evaluate(row => {
        const title = row.querySelector("strong");
        const time = row.querySelector("strong + span");
        const lines = element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return Array.from(range.getClientRects());
        };
        const titleLines = lines(title);
        const timeLines = lines(time);
        return {
          titleLines: titleLines.length, timeLines: timeLines.length,
          width: title.getBoundingClientRect().width, rowWidth: row.clientWidth,
          overflow: row.scrollWidth > row.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert(geometry.width >= Math.min(geometry.rowWidth, 170), JSON.stringify({width, view, ...geometry}));
      assert(geometry.titleLines <= 5 && geometry.timeLines <= 3 && !geometry.overflow, JSON.stringify({width, view, ...geometry}));
      await capture.click();
      const dialog = page.getByRole("dialog", { name: "Jornada y horario del partido" });
      assert(await dialog.getByLabel("Goles local").isVisible());
      await dialog.getByRole("button", { name: "Cancelar" }).click();
    }
    console.log(`Historial y captura de marcador verificados a ${width} px`);
    await page.close();
  }
} finally {
  await browser.close();
}
