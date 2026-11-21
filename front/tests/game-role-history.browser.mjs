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
  weekly_schedule: [
    { weekday: 1, starts_at: "22:30", ends_at: "23:20" },
    { weekday: 2, starts_at: "22:30", ends_at: "23:20" },
    ...[3, 4].flatMap(weekday => [
      { weekday, starts_at: "21:40", ends_at: "22:30" },
      { weekday, starts_at: "22:40", ends_at: "23:30" },
    ]),
  ],
  rounds: [{ id: 1, number: 1, starts_on: "2026-11-23" }, { id: 2, number: 2, starts_on: "2026-11-30" }, { id: 3, number: 3, starts_on: "2026-12-07" }],
  crosses: [{ home_team_id: 1, away_team_id: 2, round_id: 1, scheduled_on: "2026-11-26",
    starts_at: "01:00", ends_at: "02:00", played: true, home_goals: null, away_goals: null },
    { home_team_id: 2, away_team_id: 1, round_id: 1, scheduled_on: "2026-11-24",
      starts_at: "22:40", ends_at: "23:30", played: false },
    ...["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10"].map((scheduled_on, index) => ({
      home_team_id: 3, away_team_id: index < 2 ? index + 1 : 4,
      ...(index === 3 ? { home_team_id: 4, away_team_id: 3 } : {}),
      round_id: 3, scheduled_on, starts_at: index < 2 ? "22:40" : "21:50", ends_at: "23:30", played: false,
    })),
  ],
};

try {
  for (const width of [320, 390, 1100, 1440, 1890]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let crosses = matrix.crosses;
    let deleteRequests = 0;
    let premierSchedule = [2, 3, 4].flatMap(weekday => [
      { weekday, starts_at: "20:00", ends_at: "20:50" },
      { weekday, starts_at: "20:50", ends_at: "21:40" },
    ]);
    await page.route("**/api/**", route => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith("/game-roles/1/")) {
        if (route.request().method() === "PUT") {
          const data = route.request().postDataJSON();
          assert.deepEqual(data, { home_team_id: 2, away_team_id: 1, round_id: null });
          deleteRequests++;
          crosses = crosses.filter(cross => cross.home_team_id !== 2 || cross.away_team_id !== 1);
        }
        return route.fulfill({ json: { ...matrix, crosses } });
      }
      if (pathname.endsWith("/game-roles/2/")) {
        if (route.request().method() === "PATCH") premierSchedule = route.request().postDataJSON().weekly_schedule;
        return route.fulfill({ json: { ...matrix, crosses, weekly_schedule: premierSchedule } });
      }
      if (pathname.endsWith("/catalog/")) return route.fulfill({ json: {
        sites: [{ id: 27, name: "Colegio Franco" }], teams,
        tournaments: [{ id: 1, name: "Nocturno", site: 27, is_active: true },
          { id: 2, name: "premier liga 2026", site: 27, is_active: true }],
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
    assert.equal(await page.getByRole("heading", {name:"Horarios", exact:true}).count(), 0);
    assert.equal(await page.getByRole("list", {name:"Horarios de la fecha"}).count(), 0);
    const roundSelect = page.getByLabel("Jornada de la matriz");
    const openUnscheduled = () => grid.getByRole("button", { name: /PALMEIRAS local, FRANCO CANADIENSE visitante, Sin horario/ }).click();
    const editor = page.getByRole("dialog", { name: "Jornada y horario del partido" });
    await roundSelect.selectOption("2");
    await openUnscheduled();
    assert.equal(await editor.getByRole("button", { name: "Eliminar partido" }).count(), 0);
    const editorDate = editor.getByLabel("Fecha del partido");
    assert.equal(await editorDate.inputValue(), "2026-11-30");
    const mondaySlot = editor.getByLabel("Horario disponible", {exact:true});
    assert.equal(await mondaySlot.locator("option:checked").textContent(), "10:30");
    assert.equal(await mondaySlot.inputValue(), "22:30–23:20");
    await editorDate.selectOption("2026-12-01");
    assert.equal(await mondaySlot.locator("option:checked").textContent(), "10:30");
    assert.equal(await mondaySlot.inputValue(), "22:30–23:20");
    await editor.getByRole("button", {name:"Cancelar"}).click();
    await roundSelect.selectOption("1");
    await openUnscheduled();
    assert.equal(await editorDate.inputValue(), "2026-11-26");
    assert.deepEqual(await editor.locator("select").evaluateAll(selects => selects.map(select => getComputedStyle(select).appearance)),
      ["auto", "auto", "auto"]);
    const editorSlot = editor.getByLabel("Horario disponible", { exact: true });
    assert.equal(await editorSlot.inputValue(), "21:40–22:30");
    assert.equal(await editorSlot.locator("option:checked").textContent(), "9:40");
    await editorDate.selectOption("2026-11-25");
    assert.equal(await editorSlot.inputValue(), "21:40–22:30");
    assert.equal(await editorSlot.locator("option:checked").textContent(), "9:40");
    await editorDate.selectOption("2026-11-26");
    assert.equal(await editor.locator('input[type="time"]').count(), 0);
    await editorSlot.selectOption("22:40–23:30");
    assert.equal(await editor.getByText("Horarios ocupados en este torneo").count(), 0);
    assert.equal(await editor.getByText("El rango elegido está disponible.").count(), 0);
    assert.deepEqual(await editor.locator("form").evaluate(form => {
      const data = new FormData(form);
      return [data.get("scheduled_on"), data.get("starts_at"), data.get("ends_at")];
    }), ["2026-11-26", "22:40", "23:30"]);
    await editorDate.selectOption("2026-11-23");
    assert.equal(await editorSlot.inputValue(), "22:30–23:20");
    assert.equal(await editorDate.locator('option[value="2026-11-27"]').count(), 0);
    await editor.getByLabel("Jornada", {exact:true}).selectOption("3");
    await editor.getByText("No hay horarios disponibles para esta jornada.").waitFor();
    assert.equal(await editorDate.locator('option:not([value=""])').count(), 0);
    assert.equal(await editor.locator('input[type="time"]').count(), 0);
    await editor.getByRole("button", { name: "Cancelar" }).click();
    const history = page.getByRole("region", { name: "Historial de partidos" });
    const capture = history.getByRole("button", { name: /^Capturar marcador:/ });
    await capture.waitFor();
    assert(await capture.getByText("jueves 26 de nov", {exact: true}).isVisible());
    const geometry = await capture.evaluate(row => ({
      height: row.getBoundingClientRect().height,
      width: row.getBoundingClientRect().width,
      columnWidth: row.closest("ul").clientWidth,
      background: getComputedStyle(row).backgroundColor,
    }));
    assert(geometry.height >= 44 && geometry.height <= 64, JSON.stringify({width, ...geometry}));
    assert(Math.abs(geometry.width - geometry.columnWidth) <= 1, JSON.stringify({width, ...geometry}));
    assert.equal(geometry.background, "rgb(18, 70, 160)");
    await capture.click();
    const dialog = page.getByRole("dialog", { name: "Jornada y horario del partido" });
    assert(await dialog.getByLabel("Goles local").isVisible());
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    const pendingMatch = history.getByRole("button", { name: /^Editar partido: CACOMIXTLES DEL COLEGIO FRANCO vs. FRANCO CANADIENSE/ });
    await pendingMatch.click();
    await editor.getByRole("button", { name: "Eliminar partido", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Eliminar partido", exact: true });
    await confirmation.getByText("CACOMIXTLES DEL COLEGIO FRANCO vs. FRANCO CANADIENSE", { exact: true }).waitFor();
    assert.equal(deleteRequests, 0);
    assert(await confirmation.evaluate(element => element.scrollWidth <= element.clientWidth));
    await confirmation.getByRole("button", { name: "Volver", exact: true }).click();
    await editor.getByRole("button", { name: "Eliminar partido", exact: true }).click();
    await confirmation.getByRole("button", { name: "Confirmar eliminación" }).click();
    await pendingMatch.waitFor({ state: "hidden" });
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(deleteRequests, 1);
    assert(await capture.isVisible());
    await page.getByLabel("Torneo", { exact: true }).selectOption("2");
    await openUnscheduled();
    assert.deepEqual(await editorSlot.locator('option:not([value=""])').allTextContents(), ["8:00", "8:50"]);
    assert.equal(await editor.locator('input[type="time"]').count(), 0);
    await editor.getByRole("button", { name: "Cancelar" }).click();
    await page.getByRole("button", { name: "Horarios", exact: true }).click();
    const weeklyEditor = page.getByRole("region", {name:"Horarios semanales"});
    assert.equal(await weeklyEditor.getByLabel("Inicio del bloque 1").inputValue(), "20:00");
    assert.equal(await weeklyEditor.getByLabel("Fin del bloque 1").count(), 0);
    await weeklyEditor.getByLabel("Inicio del bloque 1").fill("19:55");
    await weeklyEditor.getByRole("button", {name:"Guardar horarios"}).click();
    await weeklyEditor.getByText("Horarios guardados.").waitFor();
    assert.deepEqual(premierSchedule[0], { weekday: 2, starts_at: "19:55", ends_at: "20:45" });
    console.log(`Historial y captura de marcador verificados a ${width} px`);
    await page.close();
  }
} finally {
  await browser.close();
}
