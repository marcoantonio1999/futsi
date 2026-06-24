import { useEffect, useState } from "react";
import { ApiError, apiFormRequest, apiRequest, downloadApiFile } from "../api";
import { emptyData } from "../appState";
import type { AppData, HistoricalDiscrepancyReport, HistoricalImport, PlayerAttendanceRecord, TabKey, User } from "../types";
import { loadAppDataForUser, loadSectionData, mergeAppData } from "./futsiDataLoaders";

export function useFutsiData() {
  const [token, setToken] = useState(() => localStorage.getItem("futsi_token") ?? "");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("futsi_token")));
  const [sectionLoading, setSectionLoading] = useState<TabKey | null>(null);
  const [activeSection, setActiveSection] = useState<TabKey>("dashboard");
  const [loadedSections, setLoadedSections] = useState<TabKey[]>([]);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [actionLoadingMessage, setActionLoadingMessage] = useState("");

  async function loadData(authToken = token, section = activeSection) {
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      if (!currentUser || !hasLoadedData) {
        const result = await loadAppDataForUser(authToken);
        setCurrentUser(result.user);
        setActiveSection(result.initialSection);
        setLoadedSections([result.initialSection]);
        setData(result.data);
        setHasLoadedData(true);
      } else {
        const patch = await loadSectionData(authToken, currentUser, section);
        setData((current) => mergeAppData(current, patch));
        setLoadedSections((current) => (current.includes(section) ? current : [...current, section]));
      }
    } catch (err) {
      const shouldLogout = err instanceof ApiError && err.status === 401 && err.path === "/auth/me/";
      setError(err instanceof Error ? err.message : "No se pudo cargar informacion.");
      if (shouldLogout) {
        localStorage.removeItem("futsi_token");
        setToken("");
        setCurrentUser(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadData(token);
  }, [token]);

  async function loadSection(section: TabKey, options: { force?: boolean; silent?: boolean } = {}) {
    if (!token || !currentUser) return;
    setActiveSection(section);
    if (!options.force && loadedSections.includes(section)) return;
    if (!options.silent) setSectionLoading(section);
    setError("");
    try {
      const patch = await loadSectionData(token, currentUser, section);
      setData((current) => mergeAppData(current, patch));
      setLoadedSections((current) => (current.includes(section) ? current : [...current, section]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la seccion.");
    } finally {
      if (!options.silent) setSectionLoading(null);
    }
  }

  function handleLogin(nextToken: string, user: User) {
    setLoading(true);
    setHasLoadedData(false);
    localStorage.setItem("futsi_token", nextToken);
    setToken(nextToken);
    setCurrentUser(null);
    setLoadedSections([]);
    void loadData(nextToken);
  }

  async function logout() {
    if (token) {
      await apiRequest<void>("/auth/logout/", token, { method: "POST" }).catch(() => undefined);
    }
    localStorage.removeItem("futsi_token");
    setToken("");
    setCurrentUser(null);
    setData(emptyData);
    setLoadedSections([]);
    setActiveSection("dashboard");
    setHasLoadedData(false);
  }

  async function createRecord(path: string, payload: unknown, success: string) {
    setMessage("");
    setError("");
    setActionLoadingMessage("Guardando...");
    try {
      await apiRequest(path, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage(success);
      await loadSection(activeSection, { force: true, silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function updateRecord(path: string, payload: unknown, success: string, loadingLabel = "Guardando cambios...") {
    setMessage("");
    setError("");
    setActionLoadingMessage(loadingLabel);
    try {
      await apiRequest(path, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setMessage(success);
      await loadSection(activeSection, { force: true, silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar.");
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function createAndReturn<T>(path: string, payload: unknown): Promise<T> {
    setMessage("");
    setError("");
    setActionLoadingMessage("Guardando...");
    try {
      const result = await apiRequest<T>(path, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadSection(activeSection, { force: true, silent: true });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      throw err;
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function uploadHistoricalImport(formData: FormData) {
    setMessage("");
    setError("");
    setActionLoadingMessage("Subiendo archivo...");
    try {
      const result = await apiFormRequest<HistoricalImport>("/historical-imports/preview/", token, formData);
      setData((current) => ({
        ...current,
        historicalImports: [result, ...current.historicalImports.filter((item) => item.id !== result.id)],
      }));
      const discrepancyReport = await apiRequest<HistoricalDiscrepancyReport>("/historical-imports/discrepancies/", token).catch(() => null);
      if (discrepancyReport) {
        setData((current) => ({ ...current, historicalDiscrepancies: discrepancyReport }));
      }
      setMessage("Excel analizado. Revisa el preview antes de firmar.");
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo analizar el Excel.");
      throw err;
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function commitHistoricalImport(importId: number, payload: unknown) {
    setMessage("");
    setError("");
    setActionLoadingMessage("Confirmando informacion...");
    try {
      const result = await apiRequest<HistoricalImport>(`/historical-imports/${importId}/commit/`, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage("Historico firmado y cargado a la base.");
      await loadSection(activeSection, { force: true, silent: true });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el historico.");
      throw err;
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function closeAttendanceSession(sessionId: number) {
    setMessage("");
    setError("");
    setActionLoadingMessage("Cerrando asistencia...");
    try {
      await apiRequest(`/attendance-sessions/${sessionId}/close/`, token, { method: "POST" });
      setMessage("Asistencia cerrada.");
      await loadSection(activeSection, { force: true, silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar la asistencia.");
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function postAction(path: string, success: string) {
    setMessage("");
    setError("");
    setActionLoadingMessage("Procesando...");
    try {
      await apiRequest(path, token, { method: "POST" });
      setMessage(success);
      await loadSection(activeSection, { force: true, silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la accion.");
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function updateProfile(payload: unknown) {
    setMessage("");
    setError("");
    setActionLoadingMessage("Actualizando perfil...");
    try {
      const updatedUser = await apiRequest<User>("/auth/me/", token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setCurrentUser(updatedUser);
      setMessage("Perfil actualizado.");
      await loadSection(activeSection, { force: true, silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el perfil.");
    } finally {
      setActionLoadingMessage("");
    }
  }

  async function updateMatchScore(matchId: number, payload: unknown) {
    const isCancel = Boolean(payload && typeof payload === "object" && "status" in payload && (payload as { status?: unknown }).status === "canceled");
    await updateRecord(`/matches/${matchId}/`, payload, "Partido actualizado.", isCancel ? "Cancelando partido..." : "Guardando partido...");
  }

  async function saveStudentAssessment(payload: unknown) {
    await createRecord("/student-assessments/", payload, "Evaluacion deportiva guardada.");
  }

  async function markAdultPlayer(payload: unknown) {
    await createAndReturn<PlayerAttendanceRecord>("/player-attendance-records/", payload);
  }

  async function downloadFile(path: string, filename: string) {
    setMessage("");
    setError("");
    setActionLoadingMessage("Preparando archivo...");
    try {
      await downloadApiFile(path, token, filename);
      setMessage("Archivo generado correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar el archivo.");
    } finally {
      setActionLoadingMessage("");
    }
  }

  return {
    token,
    currentUser,
    data,
    loading,
    sectionLoading,
    loadedSections,
    activeSection,
    hasLoadedData,
    message,
    error,
    actionLoadingMessage,
    loadData,
    loadSection,
    handleLogin,
    logout,
    createRecord,
    updateRecord,
    createAndReturn,
    uploadHistoricalImport,
    commitHistoricalImport,
    closeAttendanceSession,
    postAction,
    updateProfile,
    updateMatchScore,
    saveStudentAssessment,
    markAdultPlayer,
    downloadFile,
  };
}
