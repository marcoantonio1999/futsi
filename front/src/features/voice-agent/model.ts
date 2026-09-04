import type { AppData, TrialAvailabilityRule, TrialBooking, TrialVisit, User, VoiceCall } from "../../types";

export type VoiceDashboardSection = "summary" | "bookings" | "calls" | "whatsapp" | "weekly-stats" | "availability" | "settings";

export type VoiceDashboardProps = {
  user: User;
  data: AppData;
  section: VoiceDashboardSection;
  onCreateRecord: (path: string, payload: unknown, success: string) => Promise<void>;
  onUpdateRecord: (path: string, payload: unknown, success: string) => Promise<boolean>;
  onCreateAndReturn: <T>(path: string, payload: unknown) => Promise<T>;
};

export type BookingActions = {
  onUpdateBooking: (booking: TrialBooking, payload: unknown) => Promise<void>;
  onUpdateVisit: (visit: TrialVisit, payload: unknown) => Promise<void>;
};

export type CallActions = {
  onReviewCall: (
    call: VoiceCall,
    payload: { review_outcome: "successful" | "unsuccessful"; failure_reason?: string },
  ) => Promise<VoiceCall>;
};

export type AvailabilityActions = {
  onCreateRule: (payload: unknown) => Promise<void>;
  onUpdateRule: (rule: TrialAvailabilityRule, payload: unknown) => Promise<void>;
};

const dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function formatDateTime(value?: string | null) {
  if (!value) return "Sin registro";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin registro" : dateTimeFormatter.format(date);
}

export function formatShortDate(value?: string | null) {
  if (!value) return "Por definir";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Por definir" : dateFormatter.format(date);
}

export function toDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function toIsoDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function formatDuration(seconds: number) {
  if (!seconds) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export const weekdayLabels = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-55 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-55 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-white";
