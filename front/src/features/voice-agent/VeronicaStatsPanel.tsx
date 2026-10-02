import { WhatsAppWeeklyStatsPanel } from './WhatsAppWeeklyStatsPanel';

export function VeronicaStatsPanel({ token, onOpenConversation }: { token: string; onOpenConversation: (id: number) => void }) {
  return <section><h2 className="mb-4 text-2xl font-bold">Mis estadísticas</h2><p className="comm-muted">Atención de tus conversaciones de reclutamiento, en tus dos números.</p><WhatsAppWeeklyStatsPanel token={token} value={null} endpoint="/veronica/weekly-stats/" scopeQuery="" showClassifications={false} onOpenConversation={onOpenConversation} /></section>;
}
