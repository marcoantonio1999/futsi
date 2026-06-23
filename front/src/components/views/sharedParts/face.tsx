import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Camera,
  Check,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Upload,
  Shield,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Metric } from "../../cards/Metric";
import { CollectionFunnel } from "../../charts/CollectionFunnel";
import { FinancialAxisChart } from "../../charts/FinancialAxisChart";
import { FinancialComboChart } from "../../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../../charts/StudentStatusDonut";
import { apiRequest, API_URL } from "../../../api";
import { roleLabels, statusLabels } from "../../../appState";
import { money } from "../../../utils/format";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../../types";
import { SelectInput } from "./metrics";


const nativeShell = Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

export function FaceAttendanceCard({
  activeSession,
  roster,
  disabled,
  onRecognize,
}: {
  activeSession: AttendanceSession | null;
  roster: Student[];
  disabled: boolean;
  onRecognize: (payload: unknown) => Promise<FaceRecognitionResponse>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [working, setWorking] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [lastAttempt, setLastAttempt] = useState<FaceRecognitionResponse["attempt"] | null>(null);
  const [engineStatus, setEngineStatus] = useState<{ deepface_available: boolean; engine: string; detail?: string } | null>(null);
  const [recognitionState, setRecognitionState] = useState<"idle" | "processing" | "success" | "failed">("idle");

  async function startCamera() {
    setCameraError("");
    setRecognitionState("idle");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError("No se pudo abrir la camara. En local usa http://127.0.0.1:5173 o permite camara en el navegador.");
    }
  }

  function stopCamera() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  async function capture() {
    setCameraError("");
    setResultMessage("");
    setRecognitionState("processing");
    if (!activeSession) {
      setCameraError("Primero crea o selecciona una sesion.");
      setRecognitionState("failed");
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    setWorking(true);
    try {
      if (!video || !canvas || !cameraOn) {
        const response = await onRecognize({ session: activeSession.id, student: selectedStudent || undefined });
        setLastAttempt(response.attempt);
        setResultMessage(faceResultText(response));
        setRecognitionState(response.attempt.matched && response.attendance ? "success" : "failed");
        return;
      }
      const sourceWidth = video.videoWidth || 640;
      const sourceHeight = video.videoHeight || 480;
      const maxSide = 640;
      const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);
      const context = canvas.getContext("2d");
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.72);
      const response = await onRecognize({
        session: activeSession.id,
        image,
        student: selectedStudent || undefined,
      });
      setLastAttempt(response.attempt);
      setResultMessage(faceResultText(response));
      setRecognitionState(response.attempt.matched && response.attendance ? "success" : "failed");
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "No se pudo procesar el pase de lista.");
      setRecognitionState("failed");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    const token = localStorage.getItem("futsi_token");
    if (!token) return;
    apiRequest<{ deepface_available: boolean; engine: string; detail?: string }>("/face-attendance/recognize/", token)
      .then(setEngineStatus)
      .catch(() => setEngineStatus(null));
  }, []);

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Camera size={16} /> Pasar lista con camara
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Toma una foto y marca asistencia automaticamente. Para demo puedes forzar el alumno.
      </p>
      {engineStatus && (
        <p className={`mt-2 rounded-md px-3 py-2 text-sm ${engineStatus.deepface_available ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"}`}>
          Motor activo: {engineStatus.deepface_available ? "DeepFace real disponible" : `Demo/mock (${engineStatus.detail || "DeepFace no disponible"})`}
        </p>
      )}
      <div className="relative mt-3 overflow-hidden rounded-md border border-zinc-200 bg-zinc-950">
        <video ref={videoRef} className="mirror-camera aspect-video w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div
            className={`h-[58%] w-[42%] rounded-[42%] border-4 transition-colors ${
              recognitionState === "success"
                ? "border-emerald-400 shadow-[0_0_0_999px_rgba(16,185,129,0.10)]"
                : recognitionState === "failed"
                  ? "border-red-500 shadow-[0_0_0_999px_rgba(239,68,68,0.10)]"
                  : "border-sky-400 shadow-[0_0_0_999px_rgba(14,165,233,0.10)]"
            }`}
          />
        </div>
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-zinc-950/70 px-2 py-1 text-xs font-medium text-white">
          {recognitionState === "processing" ? "Reconociendo..." : recognitionState === "success" ? "Acceso reconocido" : recognitionState === "failed" ? "Sin coincidencia" : "Centra el rostro"}
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
      {cameraError && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{cameraError}</p>}
      {resultMessage && <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{resultMessage}</p>}
      {lastAttempt && (
        <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <p><span className="font-semibold">Motor:</span> {lastAttempt.engine === "deepface" ? "DeepFace real" : "Demo/mock"}</p>
          <p><span className="font-semibold">Alumno:</span> {lastAttempt.student_name || "Sin coincidencia"}</p>
          <p><span className="font-semibold">Confianza:</span> {Math.round(Number(lastAttempt.confidence || 0) * 100)}%</p>
          {lastAttempt.notes && <p className="mt-1">{lastAttempt.notes}</p>}
        </div>
      )}
      <SelectInput label="Forzar alumno para demo" className="mt-3" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)}>
        <option value="">Reconocer automaticamente</option>
        {roster.map((student) => (
          <option key={student.id} value={student.id}>
            {student.full_name}
          </option>
        ))}
      </SelectInput>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button type="button" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={startCamera}>
          Abrir camara
        </button>
        <button type="button" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={stopCamera}>
          Apagar
        </button>
        <button type="button" disabled={disabled || working} className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950" onClick={capture}>
          {working ? "Procesando..." : "Pasar lista"}
        </button>
      </div>
    </div>
  );
}

export function faceResultText(response: FaceRecognitionResponse) {
  const attempt = response.attempt;
  const engine = attempt.engine === "deepface" ? "DeepFace" : "modo demo";
  if (!attempt.matched || !response.attendance) {
    return `Procesado con ${engine}, sin coincidencia confiable.`;
  }
  return `Listo. ${attempt.student_name || "Alumno"} quedo presente usando ${engine}.`;
}

