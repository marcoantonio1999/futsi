import { Shield } from "lucide-react";

export type TournamentNotice = {
  title: string;
  detail: string;
};

export function TournamentNoticeModal({
  notice,
  tone,
  eyebrow,
  onClose,
}: {
  notice: TournamentNotice | null;
  tone: "emerald" | "amber";
  eyebrow: string;
  onClose: () => void;
}) {
  if (!notice) return null;
  const toneClass = tone === "emerald" ? "text-emerald-700" : "text-amber-700";
  const buttonClass = tone === "emerald" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700";
  const borderClass = tone === "emerald" ? "border-emerald-200" : "border-amber-200";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4">
      <div className={`w-full max-w-md rounded-2xl border bg-white p-6 shadow-2xl ${borderClass}`}>
        <div className={`flex items-center gap-3 ${toneClass}`}>
          <Shield size={20} />
          <p className="text-sm font-semibold uppercase tracking-wide">{eyebrow}</p>
        </div>
        <h3 className="mt-3 text-xl font-semibold text-zinc-950">{notice.title}</h3>
        <p className="mt-2 text-sm text-zinc-600">{notice.detail}</p>
        <div className="mt-5 flex justify-end">
          <button type="button" className={`rounded-md px-4 py-2 text-sm font-semibold text-white ${buttonClass}`} onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
