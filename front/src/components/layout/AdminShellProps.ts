import type { AppData, HistoricalImport, TabKey, ThemeMode, User } from "../../types";

export type AdminShellProps = {
  token: string;
  user: User;
  data: AppData;
  theme: ThemeMode;
  loading: boolean;
  sectionLoading: TabKey | null;
  loadedSections: TabKey[];
  message: string;
  error: string;
  onToggleTheme: () => void;
  onLoadSection: (section: TabKey, options?: { force?: boolean; silent?: boolean }) => Promise<void>;
  onLogout: () => void;
  onCreateRecord: (path: string, payload: unknown, success: string) => Promise<void>;
  onUpdateRecord: (path: string, payload: unknown, success: string) => Promise<void>;
  onCreateAndReturn: <T>(path: string, payload: unknown) => Promise<T>;
  onUploadHistoricalImport: (formData: FormData) => Promise<HistoricalImport>;
  onCommitHistoricalImport: (importId: number, payload: unknown) => Promise<HistoricalImport>;
  onCloseAttendanceSession: (sessionId: number) => Promise<void>;
  onPostAction: (path: string, success: string) => Promise<void>;
  onDownloadFile: (path: string, filename: string) => Promise<void>;
  onUpdateMatchScore: (matchId: number, payload: unknown) => Promise<void>;
  onSaveStudentAssessment: (payload: unknown) => Promise<void>;
  onMarkAdultPlayer: (payload: unknown) => Promise<void>;
};
