import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDatedMessageTrend } from "../src/features/voice-agent/communicationsSummaryModel.ts";

const bundle = await build({ stdin: { contents: 'export { CommunicationsNav } from "./src/features/voice-agent/CommunicationsNav"; export { AuditPeriodPicker, qualityWeekStart, lastCompletedQualityWeek } from "./src/features/voice-agent/AuditPeriodPicker";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic" });
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { CommunicationsNav, AuditPeriodPicker, qualityWeekStart, lastCompletedQualityWeek } = loaded.exports;

test("audit navigation exposes three distinct nested subsections", () => {
  const html = renderToStaticMarkup(React.createElement(CommunicationsNav, { section: "chat-quality", canReview: true, onSelect() {} }));
  for (const name of ["Auditoría de WhatsApp", "Resumen", "Calidad de chats", "Histórico de primera respuesta"]) assert.ok(html.includes(name), name);
  assert.match(html, /aria-current="page" aria-label="Calidad de chats"/);
});
test("history presets include daily, four-day, weekly and thirty-day filters", () => {
  const html = renderToStaticMarkup(React.createElement(AuditPeriodPicker, { days: 30, start: "2026-09-14", onStartChange() {} }));
  for (const value of [1, 4, 7, 30]) assert.ok(html.includes(`value="${value}"`));
  assert.ok(html.includes("2026-10-13"));
});
test("quality keeps its own weekly selector without daily or monthly options", () => {
  const html = renderToStaticMarkup(React.createElement(AuditPeriodPicker, { weeklyQuality: true, days: 7, start: "2026-10-04", onStartChange() {} }));
  assert.ok(html.includes("2026-10-10"));
  assert.ok(html.includes("Elegir semana de calidad"));
  assert.ok(!html.includes("<select"));
  assert.equal(qualityWeekStart(new Date("2026-10-13T12:00:00")), "2026-10-11");
  assert.equal(new Date(lastCompletedQualityWeek() + "T12:00:00").getDay(), 0);
});
test("the chart limits data to the selected dates and does not flag emoji acknowledgements", () => {
  const rows = buildDatedMessageTrend([{ messages: [
    { id: 1, direction: "inbound", body: "Información", created_at: "2026-10-12T18:00:00Z" },
    { id: 2, direction: "outbound", body: "Claro", created_at: "2026-10-12T18:01:00Z" },
    { id: 3, direction: "inbound", body: "😊", created_at: "2026-10-12T18:02:00Z" },
    { id: 4, direction: "inbound", body: "Una pregunta nueva", created_at: "2026-10-13T18:00:00Z" },
  ] }], "2026-10-12", 1);
  assert.equal(rows.length, 24);
  assert.equal(rows.reduce((n, row) => n + row.received, 0), 2);
  assert.equal(rows.reduce((n, row) => n + row.waiting, 0), 0);
});
