import { useEffect, useState } from "react";
import { ApiError, apiFormRequest, apiRequest, downloadApiFile } from "../api";
import { emptyData } from "../appState";
import type { AppData, HistoricalDiscrepancyReport, HistoricalImport, PlayerAttendanceRecord, User } from "../types";
import { loadAppDataForUser } from "./futsiDataLoaders";

export function useFutsiData() {
  const [token, setToken] = useState(() => localStorage.getItem("futsi_token") ?? "");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadData(authToken = token) {
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      const result = await loadAppDataForUser(authToken);
      setCurrentUser(result.user);
      setData(result.data);
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

  useEffect(() => {
    if (!token || !currentUser) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadData(token);
      }
    }, 12000);
    return () => window.clearInterval(interval);
  }, [token, currentUser?.id]);

  function handleLogin(nextToken: string, user: User) {
    localStorage.setItem("futsi_token", nextToken);
    setToken(nextToken);
    setCurrentUser(user);
  }

  async function logout() {
    if (token) {
      await apiRequest<void>("/auth/logout/", token, { method: "POST" }).catch(() => undefined);
    }
    localStorage.removeItem("futsi_token");
    setToken("");
    setCurrentUser(null);
    setData(emptyData);
  }

  async function createRecord(path: string, payload: unknown, success: string) {
    setMessage("");
    setError("");
    try {
      await apiRequest(path, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage(success);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  async function updateRecord(path: string, payload: unknown, success: string) {
    setMessage("");
    setError("");
    try {
      await apiRequest(path, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setMessage(success);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar.");
    }
  }

  async function createAndReturn<T>(path: string, payload: unknown): Promise<T> {
    setMessage("");
    setError("");
    try {
      const result = await apiRequest<T>(path, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadData();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      throw err;
    }
  }

  async function uploadHistoricalImport(formData: FormData) {
    setMessage("");
    setError("");
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
    }
  }

  async function commitHistoricalImport(importId: number, payload: unknown) {
    setMessage("");
    setError("");
    try {
      const result = await apiRequest<HistoricalImport>(`/historical-imports/${importId}/commit/`, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage("Historico firmado y cargado a la base.");
      await loadData();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el historico.");
      throw err;
    }
  }

  async function closeAttendanceSession(sessionId: number) {
    setMessage("");
    setError("");
    try {
      await apiRequest(`/attendance-sessions/${sessionId}/close/`, token, { method: "POST" });
      setMessage("Asistencia cerrada.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar la asistencia.");
    }
  }

  async function postAction(path: string, success: string) {
    setMessage("");
    setError("");
    try {
      await apiRequest(path, token, { method: "POST" });
      setMessage(success);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la accion.");
    }
  }

  async function updateProfile(payload: unknown) {
    setMessage("");
    setError("");
    try {
      const updatedUser = await apiRequest<User>("/auth/me/", token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setCurrentUser(updatedUser);
      setMessage("Perfil actualizado.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el perfil.");
    }
  }

  async function updateMatchScore(matchId: number, payload: unknown) {
    await updateRecord(`/matches/${matchId}/`, payload, "Marcador actualizado.");
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
    try {
      await downloadApiFile(path, token, filename);
      setMessage("Archivo generado correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar el archivo.");
    }
  }

  return {
    token,
    currentUser,
    data,
    loading,
    message,
    error,
    loadData,
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
