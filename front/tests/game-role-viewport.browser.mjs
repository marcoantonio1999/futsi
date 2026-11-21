import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.TEST_ENROLLMENT_ORIGIN || "http://127.0.0.1:5244";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const teams = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Equipo ${i + 1} con un nombre largo`, is_active: true }));
const matrix = {
  teams, matrix_team_ids: teams.slice(1, 19).map(team => team.id), schedule_enabled: true,
  standings: [teams.at(-1), ...teams.slice(0, -1)].map((team, index) => ({team: team.id, team_name: team.name, position: index + 1,
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
    const smallMatrix = {
      ...matrix, matrix_team_ids: teams.slice(0, 6).map(team => team.id),
      crosses: matrix.crosses.filter(cross => cross.home_team_id <= 6 && cross.away_team_id <= 6),
    };
    const emptyMatrix = {
      ...matrix, teams: [], matrix_team_ids: [], rounds: [], crosses: [], standings: [], team_notes: [], weekly_schedule: [],
    };
    let weeklySchedule = [{ weekday: 0, starts_at: "14:00", ends_at: "14:50" }];
    let identity = {
      id: 99, username: "pancho.inscripciones", role: "collaborator",
      section_permissions: ["player_enrollments_only", "game_roles_manage"],
    };
    await page.route("**/api/**", route => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith("/auth/me/")) return route.fulfill({ json: identity });
      if (pathname.endsWith("/game-roles/1/")) {
        if (route.request().method() === "PATCH") {
          const { weekly_schedule, previous_weekly_schedule } = route.request().postDataJSON();
          assert.deepEqual(previous_weekly_schedule, weeklySchedule);
          weeklySchedule = weekly_schedule;
        }
        return route.fulfill({ json: { ...matrix, weekly_schedule: weeklySchedule } });
      }
      if (pathname.endsWith("/public/game-roles/enlace-eurocopa/")) return route.fulfill({ json: {
        tournament: "Eurocopa", site: "Colegio Franco", number: 2, starts_on: "2026-11-30", matches: [],
      } });
      if (pathname.endsWith("/public/game-roles/enlace-de-prueba/")) return route.fulfill({ json: {
        tournament: "Nocturno", site: "Colegio Franco", number: 2, starts_on: "2026-11-30", matches: [],
      } });
      if (pathname.endsWith("/game-roles/3/")) {
        if (route.request().method() === "PATCH") smallMatrix.matrix_team_ids.push(route.request().postDataJSON().add_team_id);
        return route.fulfill({ json: smallMatrix });
      }
      const share = pathname.endsWith("/share/") && pathname.split("/").at(-3);
      if (share) {
        const round = matrix.rounds.find(row => row.id === Number(share));
        const matches = matrix.crosses.filter(cross => cross.round_id === round.id && cross.scheduled_on)
          .map(cross => ({
            ...cross, home_team__name: teams.find(team => team.id === cross.home_team_id).name,
            away_team__name: teams.find(team => team.id === cross.away_team_id).name,
          }));
        return route.fulfill({ json: { tournament: "UEFA", site: "Colegio Franco", number: round.number,
          starts_on: round.starts_on, matches, token: "enlace-de-prueba",
          results_round: 1, results: [{ home_team__name: teams[0].name, away_team__name: teams[1].name, home_goals: 3, away_goals: 1 }],
          standings: matrix.standings.slice(0, 10), scoring: [{ team: teams[0].name, goals: 3 }] } });
      }
      if (pathname.endsWith("/game-roles/2/")) {
        if (route.request().method() === "PATCH") {
          assert.deepEqual(route.request().postDataJSON(), {
            new_team: { name: "Equipo nuevo", representative_name: "Delegado de prueba", representative_phone: "" },
          });
          emptyMatrix.teams.push({ id: 21, name: "Equipo nuevo", is_active: true });
          emptyMatrix.matrix_team_ids.push(21);
        }
        return route.fulfill({ json: emptyMatrix });
      }
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
          { id: 3, name: "Torneo de seis equipos", site: 27, is_active: true },
        ],
      } });
      return route.fulfill({ json: { results: [], count: 0 } });
    });
    await page.clock.setFixedTime(new Date("2026-11-25T12:00:00Z"));
    await page.goto(origin + "/tests/enrollment-register-preview.html#/admin/inscripciones/game-roles", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.getByLabel("Torneo", { exact: true }).selectOption("1");
    const grid = page.getByRole("region", { name: "Matriz de cruces por equipo" });
    await grid.waitFor();
    await page.waitForFunction(() => {
      const box = document.querySelector(".game-roles-grid-scroll");
      const table = box?.querySelector("table");
      return table && table.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1 &&
        table.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1;
    }, undefined, {timeout:4000});
    await grid.scrollIntoViewIfNeeded();
    await inside(page, grid.locator("table"));
    const matrixPanel = page.getByRole("region", {name:"Matriz de equipos"});
    assert.equal(await matrixPanel.getByText("Color de la jornada").count(), 0);
    assert.equal(await matrixPanel.getByText(/Jornada.*cruces?/).count(), 0);
    const addTeam = page.getByRole("button", {name:"Agregar equipo"});
    await addTeam.scrollIntoViewIfNeeded();
    await inside(page, addTeam);
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
    assert.equal(await tournamentSelect.evaluate(node => getComputedStyle(node).appearance), "auto");
    if (width < 1024) {
      assert((await grid.getByRole("button").first().boundingBox()).height >= 44);
      assert((await tournamentSelect.boundingBox()).height >= 44);
    } else {
      assert((await tournamentSelect.boundingBox()).height <= 32);
      assert.equal(await tournamentSelect.evaluate(node => getComputedStyle(node).fontSize), "12px");
      assert((await page.getByRole("button", {name:"Cerrar sesión"}).boundingBox()).height <= 32);
    }
    const navigation = page.getByRole("navigation", {name:"Vistas de Roles de juego"});
    assert.deepEqual(await navigation.getByRole("button").allTextContents(), ["Horarios", "Estadísticas", "Siguiente rol"]);
    assert.equal(await page.getByRole("heading", {name:"Horarios", exact:true}).count(), 0);
    const roundSelect = page.getByLabel("Jornada de la matriz");
    assert.equal(await roundSelect.evaluate(node => getComputedStyle(node).appearance), "auto");
    await page.getByRole("button", {name:"Editar jornada", exact:true}).click();
    await page.getByRole("dialog").getByRole("button", {name:"Cancelar"}).click();
    const history = page.getByRole("region", {name:"Historial de partidos"});
    const played = history.getByRole("list", {name:"Jugados"});
    const upcoming = history.getByRole("list", {name:"Programados"});
    const roundLabels = list => list.locator(".game-role-history-round").allTextContents();
    const filter = history.getByLabel("Jornada del historial");
    assert.equal(await filter.inputValue(), "0");
    assert.deepEqual(await roundLabels(played), ["J2", "J1"]);
    const rowBackgrounds = await played.getByRole("button").evaluateAll(rows => rows.map(row => getComputedStyle(row).backgroundColor));
    assert.deepEqual(rowBackgrounds, ["rgb(109, 41, 122)", "rgb(18, 70, 160)"]);
    assert.deepEqual(await roundLabels(upcoming), ["J2", ...Array(13).fill("J1")]);
    assert.equal(await history.getByText("Sin horario", {exact:true}).count(), 0);
    assert.equal(await history.getByRole("button", {name:/Partidos: (siguiente|anterior)/}).count(), 0);
    const capture = played.getByRole("button", {name:/^Capturar marcador:/}).first();
    await capture.scrollIntoViewIfNeeded();
    await inside(page, capture);
    const playedColumn = await history.getByRole("region", {name:"Jugados", exact:true}).boundingBox();
    const upcomingColumn = await history.getByRole("region", {name:"Programados", exact:true}).boundingBox();
    assert(playedColumn.x + playedColumn.width <= upcomingColumn.x && Math.abs(playedColumn.y - upcomingColumn.y) <= 1);
    await upcoming.scrollIntoViewIfNeeded();
    await inside(page, upcoming);
    const historyOverflows = await upcoming.evaluate(node => node.scrollHeight > node.clientHeight);
    const lastMatch = upcoming.getByRole("button", {name:/^Editar partido:/}).last();
    await lastMatch.click();
    if (historyOverflows) assert(await upcoming.evaluate(node => node.scrollTop > 0));
    await inside(page, lastMatch);
    await page.getByRole("dialog", {name:"Jornada y horario del partido"}).getByRole("button", {name:"Cancelar"}).click();
    await filter.selectOption("2");
    assert.deepEqual(await roundLabels(played), ["J2"]);
    assert.deepEqual(await roundLabels(upcoming), ["J2"]);
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
    const expectedTeams = teams.slice(0, 19).map(team => team.name);
    const positionRows = standings.getByRole("rowheader");
    assert.deepEqual(await positionRows.allTextContents(), expectedTeams);
    assert.equal(await standings.getByRole("row").nth(1).getByRole("cell").first().textContent(), "1");
    assert.equal(await standings.getByRole("button").count(), 0);
    await inside(page, positionRows.first());
    await positionRows.last().scrollIntoViewIfNeeded();
    await inside(page, positionRows.last());
    const scorers = page.getByRole("region", { name:"Goleo por equipo" });
    const scoringRows = scorers.getByRole("rowheader");
    assert.deepEqual(await scoringRows.allTextContents(), expectedTeams);
    assert.equal(await scorers.getByRole("button").count(), 0);
    await scoringRows.last().scrollIntoViewIfNeeded();
    await inside(page, scoringRows.last());
    await navigation.getByRole("button", {name:"Siguiente rol"}).click();
    assert.equal(await navigation.getByRole("button", {name:"Siguiente rol", pressed:true}).count(), 1);
    assert.equal(await navigation.getByRole("button", {name:"Estadísticas", pressed:false}).count(), 1);
    const next = page.getByRole("region", {name:"Próximos partidos"});
    const nextRound = next.getByLabel("Jornada del rol");
    assert.equal(await nextRound.inputValue(), "1");
    await nextRound.selectOption("2");
    assert.equal(await next.getByRole("row").count(), 2);
    assert(await next.getByText("15:00–15:50").isVisible());
    assert.equal(await next.getByText("14:00–14:50").count(), 0);
    await inside(page, next);
    await next.getByRole("button", {name:"Compartir rol de juego"}).click();
    const shareDialog = page.getByRole("dialog", {name:"Compartir rol de juego"});
    const whatsapp = shareDialog.getByRole("link", {name:"Compartir por WhatsApp"});
    await whatsapp.waitFor();
    assert.equal(await shareDialog.getByText("En vivo", {exact:true}).count(), 0);
    for (const title of ["Sistema de Competencia", "LIGUILLA", "Resultados · Jornada 1", "Próximos Partidos", "DESCANSO", "Tabla de Posiciones", "Tabla de Goleo"]) {
      assert(await shareDialog.getByRole("heading", {name:title, exact:true}).isVisible());
    }
    assert(await shareDialog.getByRole("img", {name:"BPower"}).isVisible());
    assert(await shareDialog.locator(".game-role-report-facebook").isVisible());
    assert.equal(await shareDialog.getByRole("link", {name:"www.facebook.com/supergol.bosques"}).getAttribute("href"),
      "https://www.facebook.com/supergol.bosques");
    const logo = shareDialog.getByRole("img", {name:"BPower"});
    assert.equal(await logo.evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    const watermark = shareDialog.locator(".game-role-report-watermark");
    assert(await watermark.evaluate(node => {
      const style = getComputedStyle(node);
      return style.backgroundImage !== "none" && Number(style.opacity) > 0 && Number(style.opacity) <= 0.06
        && Math.abs(node.clientHeight - node.parentElement.clientHeight) <= 1;
    }));
    assert(await shareDialog.getByText(/Jornada 15 del torneo/).isVisible());
    assert(await shareDialog.getByText("3–1", {exact:true}).isVisible());
    const bracket = shareDialog.getByRole("group", {name:"Llaves de liguilla"});
    const finalMatch = bracket.getByRole("group", {name:"Final", exact:true});
    const trophy = await bracket.getByRole("img", {name:"Trofeo de la final"}).boundingBox();
    const finalBox = await finalMatch.boundingBox();
    assert(trophy && finalBox && trophy.y + trophy.height < finalBox.y);
    assert(Math.abs(trophy.x + trophy.width / 2 - finalBox.x - finalBox.width / 2) <= 1);
    assert.deepEqual(await finalMatch.getByText("Por definir", {exact:true}).allTextContents(), ["Por definir", "Por definir"]);
    assert.equal(await bracket.getByText("8.º lugar", {exact:true}).count(), 1);
    assert.equal(await bracket.locator(".game-role-bracket-match").count(), 7);
    assert(await bracket.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const reportStandings = shareDialog.locator('[data-standings="true"]');
    assert.equal(await reportStandings.locator('tr[data-cutoff="true"]').count(), 1);
    assert(await reportStandings.getByText("Zona de clasificación · 1.º a 8.º", {exact:true}).isVisible());
    assert(await reportStandings.getByText("Fuera de zona · 9.º en adelante", {exact:true}).isVisible());
    const outside = reportStandings.locator('tr[data-zone="outside"]:not([data-zone-label])');
    assert.equal(await outside.count(), 2);
    assert.equal(await outside.first().evaluate(row => getComputedStyle(row).backgroundColor), "rgb(255, 240, 239)");
    assert.equal(await reportStandings.locator("tbody td:last-child:not([colspan])").first().evaluate(node => getComputedStyle(node).fontWeight), "800");
    assert(await shareDialog.locator(".game-role-sheet").evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const preview = shareDialog.locator(".game-role-share-body");
    const layout = await preview.evaluate(node => {
      const sheet = node.querySelector(".game-role-sheet");
      const grid = sheet.querySelector(".game-role-report-grid");
      const headings = [...grid.querySelectorAll("th")];
      return {
        width: sheet.clientWidth,
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        readableHeadings: headings.every(th => getComputedStyle(th).whiteSpace === "nowrap" && th.scrollWidth <= th.clientWidth + 1),
      };
    });
    assert.equal(layout.columns, layout.width <= 790 ? 1 : 2);
    if (width >= 1024) assert(layout.width >= 900, JSON.stringify(layout));
    assert(layout.readableHeadings, JSON.stringify(layout));
    await inside(page, whatsapp);
    await preview.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await inside(page, whatsapp);
    const message = new URL(await whatsapp.getAttribute("href")).searchParams.get("text");
    assert.match(message, /Jornada 2/);
    assert.match(message, /15:00–15:50/);
    assert.match(message, /rol-de-juego\/enlace-de-prueba/);
    assert.doesNotMatch(message, /14:00–14:50/);
    const download = page.waitForEvent("download");
    await shareDialog.getByRole("button", {name:"Descargar imagen"}).click();
    assert.equal((await download).suggestedFilename(), "rol-UEFA-jornada-2.png");
    await shareDialog.getByRole("button", {name:"Cerrar"}).click();
    await navigation.getByRole("button", {name:"Volver a roles de juego"}).click();
    await grid.waitFor();
    if (width === 320) {
      await page.getByLabel("Torneo", {exact:true}).selectOption("2");
      await navigation.getByRole("button", {name:"Estadísticas"}).click();
      await standings.getByText("Aún no hay equipos.").waitFor();

      assert.equal(await standings.getByRole("columnheader").count(), 10);
      await inside(page, standings);
      await navigation.getByRole("button", {name:"Siguiente rol"}).click();
      await next.getByText("Agrega una jornada para programar partidos.").waitFor();
      assert.equal(await next.getByRole("button", {name:"Compartir rol de juego"}).count(), 0);
    }
    if (width === 1440) {
      await tournamentSelect.selectOption("3");
      await grid.waitFor();
      const firstCross = grid.getByRole("button").first();
      await firstCross.waitFor();
      const fill = () => grid.evaluate(frame => {
        const table = frame.querySelector("table");
        return { width: Math.abs(table.getBoundingClientRect().width - frame.clientWidth),
          height: Math.abs(table.getBoundingClientRect().height - frame.clientHeight) };
      });
      assert.equal(await grid.getByRole("rowheader").count(), 6);
      const scheduledStyles = () => grid.locator('button[data-assigned="true"][data-played="false"]')
        .filter({ hasText: /14:50|15:00/ }).evaluateAll(cells => cells.map(cell => {
          const style = getComputedStyle(cell);
          return [style.borderTopWidth, style.borderTopColor, style.color, cell.dataset.highlighted];
        }));
      const blue = "rgb(18, 70, 160)";
      const purple = "rgb(109, 41, 122)";
      assert.deepEqual(await scheduledStyles(), [["2px", blue, blue, "true"], ["2px", purple, purple, "false"]]);
      await roundSelect.selectOption("2");
      assert.deepEqual(await scheduledStyles(), [["2px", blue, blue, "false"], ["2px", purple, purple, "true"]]);
      await roundSelect.selectOption("1");
      const before = await firstCross.boundingBox();
      const beforeFill = await fill();
      assert(beforeFill.width <= 1 && beforeFill.height <= 1, JSON.stringify(beforeFill));
      await page.getByRole("button", {name:"Agregar equipo", exact:true}).click();
      const picker = page.getByRole("dialog", {name:"Agregar equipo", exact:true});
      await picker.getByRole("button", {name:"Crear equipo nuevo", exact:true}).click();
      await picker.getByLabel("Nombre del equipo", {exact:true}).waitFor();
      await picker.getByRole("button", {name:"Elegir equipo existente", exact:true}).click();
      await picker.locator("select").selectOption("7");
      await picker.getByRole("button", {name:"Agregar equipo", exact:true}).click();
      await picker.waitFor({state:"hidden"});
      assert.equal(await grid.getByRole("rowheader").count(), 7);
      const after = await firstCross.boundingBox();
      const afterFill = await fill();
      assert(after.width < before.width && after.height < before.height, JSON.stringify({before, after}));
      assert(afterFill.width <= 1 && afterFill.height <= 1, JSON.stringify(afterFill));
      const side = await history.boundingBox();
      const workspace = await page.locator(".game-roles-workspace").boundingBox();
      assert(Math.abs(side.width / workspace.width - 0.4) < 0.01);
    }
    if ([320, 390, 1440].includes(width)) {
      const returnToMatrix = navigation.getByRole("button", { name: "Volver a roles de juego" });
      if (await returnToMatrix.isVisible()) await returnToMatrix.click();
      await tournamentSelect.selectOption("2");
      await page.getByRole("button", { name: "Agregar equipo", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Agregar equipo", exact: true });
      const createNew = picker.getByRole("button", { name: "Crear equipo nuevo", exact: true });
      await createNew.waitFor();
      await inside(page, createNew);
      await createNew.click();
      await picker.getByLabel("Nombre del equipo", { exact: true }).fill(" Equipo nuevo ");
      assert.equal(await picker.getByLabel("Delegado", { exact: true }).evaluate(field => field.validity.valueMissing), true);
      await picker.getByLabel("Delegado", { exact: true }).fill("Delegado de prueba");
      const create = picker.getByRole("button", { name: "Crear y agregar" });
      await create.scrollIntoViewIfNeeded();
      await inside(page, create);
      await create.click();
      await picker.waitFor({ state: "hidden" });
      await grid.getByRole("rowheader", { name: "Equipo nuevo", exact: true }).waitFor();
      await tournamentSelect.selectOption("1");
      await navigation.getByRole("button", { name: "Horarios", exact: true }).click();
      const hours = page.getByRole("region", { name: "Horarios semanales" });
      const day = hours.getByLabel("Día de juego");
      assert.equal(await day.inputValue(), "0");
      await hours.getByLabel("Inicio del bloque 1").fill("14:10");
      await day.selectOption("3");
      await hours.getByRole("button", { name: "Agregar bloque" }).click();
      await hours.getByLabel("Inicio del bloque 1").fill("20:00");
      await hours.getByLabel("Fin del bloque 1").fill("20:50");
      const saveHours = hours.getByRole("button", { name: "Guardar horarios" });
      await inside(page, saveHours);
      await saveHours.click();
      await hours.getByRole("status").filter({ hasText: "Horarios guardados." }).waitFor();
      assert.deepEqual(weeklySchedule, [
        { weekday: 0, starts_at: "14:10", ends_at: "14:50" },
        { weekday: 3, starts_at: "20:00", ends_at: "20:50" },
      ]);
      await hours.getByRole("button", { name: "Quitar bloque 1" }).click();
      await saveHours.click();
      await hours.getByRole("status").filter({ hasText: "Horarios guardados." }).waitFor();
      assert.equal(weeklySchedule.length, 1);
      await navigation.getByRole("button", { name: "Volver a roles de juego" }).click();
    }
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    if (width === 390) {
      await page.goto(origin + "/#/rol-de-juego/enlace-de-prueba", {waitUntil:"domcontentloaded", timeout:15000});
      await page.getByRole("heading", {name:"Próximos Partidos", exact:true}).waitFor();
      const live = page.getByText("En vivo", {exact:true});
      assert(await live.isVisible());
      assert.equal(await live.evaluate(node => getComputedStyle(node).color), "rgb(180, 35, 24)");
      const animation = () => live.evaluate(node => getComputedStyle(node, "::before").animationName);
      await page.emulateMedia({media:"screen", reducedMotion:"no-preference"});
      assert.equal(await animation(), "game-role-live-pulse");
      await page.emulateMedia({media:"screen", reducedMotion:"reduce"});
      assert.equal(await animation(), "none");
      await page.emulateMedia({media:"print"});
      assert.equal(await live.isVisible(), false);
      await page.emulateMedia({media:"screen"});
      assert(await live.isVisible());
      assert(await page.getByText("Todavía no hay próximos partidos para esta jornada.").isVisible());
      assert(await page.getByText(/Jornada 9 del torneo/).isVisible());
      assert(await page.getByRole("heading", {name:"Tabla de Posiciones", exact:true}).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.goto(origin + "/#/rol-de-juego/enlace-eurocopa", {waitUntil:"domcontentloaded", timeout:15000});
      const euroBracket = page.getByRole("group", {name:"Llaves de liguilla"});
      await euroBracket.getByText("Pase directo", {exact:true}).first().waitFor();
      assert.equal(await euroBracket.getByText("Pase directo", {exact:true}).count(), 2);
      assert.equal(await euroBracket.getByText("8.º lugar", {exact:true}).count(), 0);
    }
    if (width === 320 || width === 390 || width === 1440) {
      await page.evaluate(() => localStorage.setItem("futsi_token", "roles-test"));
      await page.goto(origin + "/#/admin/inscripciones/game-roles", {waitUntil:"domcontentloaded", timeout:15000});
      await page.getByRole("heading", {name:"Roles de juego", exact:true, level:1}).waitFor();
      const menu = page.getByRole("navigation", {name:"Administración de inscripciones"});
      const menuButton = page.getByRole("button", {name:"Abrir secciones"});
      if (width < 1024) {
        assert((await menuButton.boundingBox()).height >= 44);
        await menuButton.click();
      }
      await menu.getByRole("button", {name:"Registrar", exact:true}).click();
      await page.waitForURL("**/#/admin/inscripciones/send");
      await page.getByRole("heading", {name:"Registrar", exact:true, level:1}).waitFor();

      if (width < 1024) await menuButton.click();
      await menu.getByRole("button", {name:"Matriz de equipos", exact:true}).click();
      await page.waitForURL("**/#/admin/inscripciones/game-roles");
      if (width < 1024) assert.equal(await menuButton.getAttribute("aria-expanded"), "false");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await tournamentSelect.selectOption("");
      if (width < 1024) await menuButton.click();
      await menu.getByRole("button", {name:"Horarios", exact:true}).click();
      await page.waitForURL("**/#/admin/inscripciones/game-roles-schedule");
      await page.getByRole("heading", {name:"Horarios", exact:true, level:1}).waitFor();
      assert.equal(await tournamentSelect.inputValue(), "");
      await tournamentSelect.selectOption("1");
      await page.getByRole("region", {name:"Horarios semanales"}).getByRole("button", {name:"Guardar horarios"}).waitFor();
      await page.reload({waitUntil:"domcontentloaded"});
      await page.getByRole("region", {name:"Horarios semanales"}).waitFor();
      assert.equal(await tournamentSelect.inputValue(), "1");

      identity = { id: 100, username: "ventanilla", role: "collaborator", section_permissions: ["player_enrollments_only"] };
      await page.reload({waitUntil:"domcontentloaded"});
      await page.waitForURL("**/#/admin/inscripciones/history");
      await page.getByRole("heading", {name:"Sábana", exact:true, level:1}).waitFor();
      if (width < 1024) await menuButton.click();
      await menu.getByRole("button", {name:"Registrar", exact:true}).waitFor();
      assert.equal(await menu.getByRole("button", {name:"Matriz de equipos", exact:true}).count(), 0);
      assert.equal(await menu.getByRole("button", {name:"Horarios", exact:true}).count(), 0);

      identity = { id: 101, username: "administracion", role: "admin", section_permissions: [] };
      await page.reload({waitUntil:"domcontentloaded"});
      await page.getByRole("heading", {name:"Sábana", exact:true, level:1}).waitFor();
      if (width < 1024) await menuButton.click();
      await menu.getByRole("button", {name:"Matriz de equipos", exact:true}).click();
      await page.getByRole("heading", {name:"Roles de juego", exact:true, level:1}).waitFor();
    }
    console.log(`Roles sin desplazamiento a ${width} × ${height}`);
    await page.close();
  }
} finally {
  await browser.close();
}
