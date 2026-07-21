const state = {
  activeTab: "live",
  selectedDate: new Date().toLocaleDateString("en-CA"),
  status: null,
  config: null,
  dashboard: null,
  toastTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Error HTTP ${response.status}`);
  return payload;
}

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.add("hidden"), 4500);
}

function localTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function stateLabel(value) {
  const labels = {
    stopped: "Detenido",
    starting: "Iniciando",
    loading_model: "Cargando modelo",
    benchmarking: "Midiendo equipo",
    running: "Activo",
    error: "Error",
  };
  return labels[value] || value || "Desconocido";
}

function updateChip(selector, ok, label, warning = false) {
  const element = $(selector);
  element.className = `status-chip ${ok ? "ok" : warning ? "warn" : "error"}`;
  element.innerHTML = `<i></i> ${escapeHtml(label)}`;
}

function renderStatus(status) {
  state.status = status;
  $("#site-name").textContent = `${status.site_name} - ${status.device_name}`;
  updateChip("#camera-chip", status.camera.connected, status.camera.connected ? "Camara activa" : "Camara sin video", Boolean(status.running));
  updateChip("#network-chip", status.online, status.online ? "Sincronizado" : "Trabajo offline", true);
  $("#offline-banner").classList.toggle("hidden", status.online || !status.running);
  $("#metric-engine").textContent = stateLabel(status.state);
  $("#metric-provider").textContent = status.last_error || status.provider;
  $("#metric-fps").textContent = `${Number(status.processing_fps).toFixed(1)} FPS`;
  $("#metric-target").textContent = `Objetivo ${Number(status.target_fps).toFixed(1)} FPS`;
  $("#metric-faces").textContent = Number(status.detected_faces).toLocaleString("es-MX");
  $("#metric-frames").textContent = `${Number(status.processed_frames).toLocaleString("es-MX")} frames`;
  $("#metric-pending").textContent = `${status.sync.pending} pendientes`;
  $("#metric-synced").textContent = `${status.sync.done} enviados`;
  $("#start-button").disabled = status.running;
  $("#stop-button").disabled = !status.running;
  $("#benchmark-button").disabled = !status.running || status.state === "benchmarking";
  renderBenchmark(status.benchmark, status.state);
  renderRecent(status.recent);
}

function renderBenchmark(result, currentState) {
  const element = $("#benchmark-result");
  if (currentState === "benchmarking") {
    element.textContent = "Midiendo la capacidad real del equipo. La deteccion se reanuda al terminar.";
    return;
  }
  if (!result || !result.samples) return;
  element.textContent = `${result.provider}: ${result.average_ms} ms por frame, capacidad ${result.capacity_fps} FPS, uso recomendado ${result.recommended_fps} FPS.`;
}

function renderRecent(rows = []) {
  $("#recent-count").textContent = rows.length;
  const container = $("#recent-list");
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">Esperando la primera deteccion.</div>';
    return;
  }
  container.innerHTML = rows.map((row) => {
    const imageKind = row.kind === "unknown" ? "unknown" : "presence";
    const image = `/api/images/${imageKind}/${encodeURIComponent(row.subject_key)}?v=${encodeURIComponent(row.seen_at)}`;
    const score = row.kind === "known" ? `${Math.max(0, row.similarity * 100).toFixed(0)}%` : "Revision";
    return `<article class="detection-item ${row.kind}">
      <img src="${image}" alt="Rostro de ${escapeHtml(row.name)}" onerror="this.style.visibility='hidden'" />
      <div><strong>${escapeHtml(row.name)}</strong><small>${localTime(row.seen_at)}</small></div>
      <span class="match-score">${score}</span>
    </article>`;
  }).join("");
}

function renderDashboard(payload) {
  state.dashboard = payload;
  const known = payload.known || [];
  const unknown = payload.unknown || [];
  $("#known-count").textContent = known.length;
  $("#unknown-count").textContent = unknown.length;
  $("#unknown-hits").textContent = `${unknown.reduce((sum, row) => sum + Number(row.detection_count || 0), 0)} apariciones`;
  $("#review-count").textContent = unknown.filter((row) => row.status !== "linked").length;
  $("#queue-count").textContent = payload.pending_sync || 0;
  renderKnownTable(known);
  renderUnknowns(unknown, payload.people || []);
}

function renderKnownTable(rows) {
  const body = $("#known-table");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-cell">Sin asistencias para esta fecha.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => {
    const grouping = row.group_name || row.team_name || "Sin grupo";
    const hasSession = Number(row.session_id) !== -1;
    const synced = Number(row.synced) === 1 && hasSession;
    const syncLabel = !hasSession ? "Sin sesion" : synced ? "Sincronizado" : "En cola";
    return `<tr>
      <td><div class="person-cell"><img class="person-photo" src="/api/images/person/${encodeURIComponent(row.person_key)}" alt="" onerror="this.src='/api/images/presence/${encodeURIComponent(row.person_key)}'" /><div><strong>${escapeHtml(row.name)}</strong><small>${row.person_type === "player" ? "Jugador adulto" : "Alumno"}</small></div></div></td>
      <td>${escapeHtml(grouping)}</td><td>${escapeHtml(row.session_label)}</td>
      <td>${localTime(row.first_seen_at)}</td><td>${localTime(row.last_seen_at)}</td>
      <td>${Number(row.detection_count).toLocaleString("es-MX")}</td>
      <td><span class="state-badge ${synced ? "" : "pending"}">${syncLabel}</span></td>
    </tr>`;
  }).join("");
}

function personOptions(people, selected = "") {
  const students = people.filter((row) => row.person_type === "student");
  const players = people.filter((row) => row.person_type === "player");
  const options = (rows) => rows.map((row) => `<option value="${escapeHtml(row.person_key)}" ${row.person_key === selected ? "selected" : ""}>${escapeHtml(row.name)}</option>`).join("");
  return `<option value="">Seleccionar persona...</option><optgroup label="Academia">${options(students)}</optgroup><optgroup label="Liga de adultos">${options(players)}</optgroup>`;
}

function renderUnknowns(rows, people) {
  const grid = $("#unknown-grid");
  if (!rows.length) {
    grid.innerHTML = '<div class="panel empty-state">Sin desconocidos para esta fecha.</div>';
    return;
  }
  grid.innerHTML = rows.map((row) => {
    const linked = row.status === "linked";
    const status = linked ? "Vinculado" : row.status === "consolidated" ? "Listo para revisar" : "Candidato";
    return `<article class="panel unknown-card" data-subject="${escapeHtml(row.subject_id)}">
      <img class="unknown-photo" src="/api/images/unknown/${encodeURIComponent(row.subject_id)}?v=${encodeURIComponent(row.last_seen_at)}" alt="${escapeHtml(row.temporary_name)}" />
      <div class="unknown-body"><div class="unknown-title"><strong>${escapeHtml(row.temporary_name)}</strong><span class="state-badge ${linked ? "" : "pending"}">${status}</span></div>
      <p>${Number(row.detection_count)} detecciones este dia<br />Primera: ${localTime(row.first_seen_at)} - Ultima: ${localTime(row.last_seen_at)}</p>
      <select class="unknown-person" ${linked ? "disabled" : ""}>${personOptions(people, row.linked_person_key || "")}</select>
      <button class="button primary link-unknown" type="button" ${linked ? "disabled" : ""}>${linked ? "Identidad confirmada" : "Confirmar identidad"}</button></div>
    </article>`;
  }).join("");
}

async function pollStatus() {
  try { renderStatus(await api("/api/status")); } catch (error) { showToast(error.message, true); }
}

async function pollDashboard() {
  try { renderDashboard(await api(`/api/dashboard?date=${state.selectedDate}`)); } catch (error) { showToast(error.message, true); }
}

async function loadConfig() {
  state.config = await api("/api/config");
  const form = $("#settings-form");
  Object.entries(state.config).forEach(([key, value]) => {
    if (form.elements[key] && key !== "station_token_configured") form.elements[key].value = value;
  });
  form.elements.station_token.value = "";
}

function setActiveTab(tab) {
  state.activeTab = tab;
  $$(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${tab}`));
  if (tab === "attendance") pollDashboard();
}

async function engineAction(action) {
  try {
    await api(`/api/engine/${action}`, { method: "POST", body: "{}" });
    showToast(action === "benchmark" ? "Prueba de rendimiento iniciada." : "Orden enviada al motor.");
    setTimeout(pollStatus, 350);
  } catch (error) { showToast(error.message, true); }
}

function bindEvents() {
  $$(".tab-button").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
  $("#start-button").addEventListener("click", () => engineAction("start"));
  $("#stop-button").addEventListener("click", () => engineAction("stop"));
  $("#benchmark-button").addEventListener("click", () => engineAction("benchmark"));
  $("#attendance-date").addEventListener("change", (event) => { state.selectedDate = event.target.value; pollDashboard(); });
  $("#settings-button").addEventListener("click", async () => {
    try { await loadConfig(); $("#settings-modal").classList.remove("hidden"); } catch (error) { showToast(error.message, true); }
  });
  ["#settings-close", "#settings-cancel"].forEach((selector) => $(selector).addEventListener("click", () => $("#settings-modal").classList.add("hidden")));
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#unknown-grid").addEventListener("click", linkUnknown);
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const numeric = new Set(["detector_size", "processing_width", "target_fps", "known_threshold", "unknown_threshold"]);
  const payload = {};
  for (const [key, value] of form.entries()) {
    if (key === "station_token" && !value) continue;
    payload[key] = numeric.has(key) ? Number(value) : value;
  }
  try {
    await api("/api/config", { method: "PATCH", body: JSON.stringify(payload) });
    $("#settings-modal").classList.add("hidden");
    showToast("Configuracion guardada. El motor se esta reiniciando.");
  } catch (error) { showToast(error.message, true); }
}

async function linkUnknown(event) {
  const button = event.target.closest(".link-unknown");
  if (!button) return;
  const card = button.closest(".unknown-card");
  const personKey = card.querySelector(".unknown-person").value;
  if (!personKey) { showToast("Selecciona la persona antes de confirmar.", true); return; }
  button.disabled = true;
  try {
    await api(`/api/unknowns/${encodeURIComponent(card.dataset.subject)}/link`, { method: "POST", body: JSON.stringify({ person_key: personKey }) });
    showToast("Identidad vinculada. Las apariciones quedaron en la cola de sincronizacion.");
    await pollDashboard();
  } catch (error) { button.disabled = false; showToast(error.message, true); }
}

async function initialize() {
  $("#attendance-date").value = state.selectedDate;
  bindEvents();
  await Promise.all([pollStatus(), pollDashboard()]);
  setInterval(pollStatus, 1500);
  setInterval(() => { if (state.activeTab === "attendance") pollDashboard(); }, 4000);
}

document.addEventListener("DOMContentLoaded", initialize);
