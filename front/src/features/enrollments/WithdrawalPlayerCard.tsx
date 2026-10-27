import { Input, Label } from '../../components/ui/enrollment-ui';
import { useState } from "react";
import { SanctionBadge, type SanctionSummary } from "./SanctionBadge";

export type WithdrawalPlayer = { id: number; name: string; is_delegate: boolean; has_photo: boolean; can_withdraw?: boolean; sanctions?: SanctionSummary[] };

export function WithdrawalPlayerCard({ player, endpoint, selected, onChange }: {
  player: WithdrawalPlayer; endpoint: string; selected: boolean; onChange: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return <Label className={`withdrawal-player-card${selected ? " is-selected" : ""}`}>
    <Input type="checkbox" checked={selected} disabled={player.can_withdraw === false || Boolean(player.sanctions?.length)} onChange={onChange} aria-label={`Dar de baja a ${player.name}`} />
    <span className="withdrawal-player-photo">{player.has_photo && !failed
      ? <img src={`${endpoint}photos/${player.id}/`} alt={`Foto de ${player.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <span>{failed ? "Foto no disponible" : "Sin foto"}</span>}</span>
    <span><strong>{player.name}</strong>{player.is_delegate && <small>Delegado</small>}<SanctionBadge sanctions={player.sanctions} />{player.can_withdraw === false && <small>No puede darse de baja hasta cumplir la sanción.</small>}</span>
  </Label>;
}
