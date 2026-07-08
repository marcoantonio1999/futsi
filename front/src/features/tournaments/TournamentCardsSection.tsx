import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Site, Team, Tournament } from "../../types";
import { StatusPill } from "../../components/views/shared";
import { billingLabel } from "./utils";

type TournamentCardItem = {
  tournament: Tournament;
  teams: Team[];
  registrations: unknown[];
  matches: unknown[];
  liveCount: number;
  top?: { team_name?: string | null } | null;
};

type TournamentCardsSectionProps = {
  sites: Site[];
  tournamentCardsCount: number;
  filteredTournamentCardsCount: number;
  visibleTournamentCards: TournamentCardItem[];
  selectedTournamentId?: number;
  page: number;
  pageCount: number;
  search: string;
  siteFilter: string;
  statusFilter: string;
  billingFilter: string;
  onBillingFilterChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSearchChange: (value: string) => void;
  onSelectTournament: (id: string) => void;
  onSiteFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
};

export function TournamentCardsSection({
  sites,
  tournamentCardsCount,
  filteredTournamentCardsCount,
  visibleTournamentCards,
  selectedTournamentId,
  page,
  pageCount,
  search,
  siteFilter,
  statusFilter,
  billingFilter,
  onBillingFilterChange,
  onPageChange,
  onSearchChange,
  onSelectTournament,
  onSiteFilterChange,
  onStatusFilterChange,
}: TournamentCardsSectionProps) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h3 className="font-semibold">Torneos activos</h3>
          <p className="text-xs text-zinc-500">{filteredTournamentCardsCount} de {tournamentCardsCount} torneos</p>
        </div>
        <div className="flex gap-2">
          <PageButton disabled={page === 0} label="Torneos anteriores" onClick={() => onPageChange(Math.max(0, page - 1))}><ChevronLeft size={16} /></PageButton>
          <span className="grid h-8 min-w-14 place-items-center rounded-md bg-zinc-100 px-2 text-xs font-semibold text-zinc-600">{page + 1}/{pageCount}</span>
          <PageButton disabled={page >= pageCount - 1} label="Mas torneos" onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}><ChevronRight size={16} /></PageButton>
        </div>
      </div>

      <div className="grid min-w-0 gap-2 border-b border-zinc-100 px-4 py-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(0,150px)_minmax(0,130px)_minmax(0,160px)]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
          <input className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-600" placeholder="Buscar torneo o sede" value={search} onChange={(event) => onSearchChange(event.target.value)} />
        </label>
        <select className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-600" value={siteFilter} onChange={(event) => onSiteFilterChange(event.target.value)}>
          <option value="all">Todas las sedes</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
        <select className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-600" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
          <option value="active">Activos</option>
          <option value="inactive">Cerrados</option>
          <option value="all">Todos</option>
        </select>
        <select className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-600" value={billingFilter} onChange={(event) => onBillingFilterChange(event.target.value)}>
          <option value="all">Todos los cobros</option>
          <option value="weekly_match">Pago semanal</option>
          <option value="full_tournament">Torneo completo</option>
        </select>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        {visibleTournamentCards.map(({ tournament, teams, registrations, matches, liveCount, top }) => (
          <button key={tournament.id} className={`min-h-[158px] rounded-md border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selectedTournamentId === tournament.id ? "border-emerald-700 bg-emerald-50" : "border-zinc-200 bg-white"}`} onClick={() => onSelectTournament(String(tournament.id))} type="button">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-zinc-500">{tournament.starts_on || "sin fecha"} - {billingLabel(tournament.billing_type)}</p>
                <h3 className="mt-1 line-clamp-2 font-semibold">{tournament.name}</h3>
              </div>
              <StatusPill label={tournament.is_active ? "Activo" : "Cerrado"} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-xs">
              <CardMetric label="Eq." value={teams.length} />
              <CardMetric label="Ninos" value={registrations.length} />
              <CardMetric label="Juegos" value={matches.length} />
              <CardMetric label="Act." value={liveCount} />
            </div>
            <p className="mt-2 truncate text-xs text-zinc-500">Lider: <span className="font-medium text-zinc-900">{top?.team_name || "pendiente"}</span></p>
          </button>
        ))}
        {visibleTournamentCards.length === 0 && <p className="col-span-full text-sm text-zinc-500">No hay torneos con esos filtros.</p>}
      </div>
    </div>
  );
}

function PageButton({ children, disabled, label, onClick }: { children: React.ReactNode; disabled: boolean; label: string; onClick: () => void }) {
  return <button className="grid size-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={disabled} onClick={onClick} type="button" aria-label={label}>{children}</button>;
}

function CardMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md bg-zinc-50 p-1.5"><p className="text-sm font-bold">{value}</p><p>{label}</p></div>;
}
