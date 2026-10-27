import { Button, Dialog, Label, NativeSelect } from '../../components/ui/enrollment-ui';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiRequest } from '../../api';
import './changeDelegate.css';

type Candidate = { id: number; name: string; is_delegate?: boolean };

export function ChangeDelegate({ teamId, teamName, players, token, onClose, onChanged }: {
  teamId: number; teamName: string; players: Candidate[]; token: string;
  onClose: () => void; onChanged: (id: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const current = players.find(player => player.is_delegate);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const result = await apiRequest<{ id: number }>(`/player-enrollments/teams/${teamId}/delegate/`, token, {
        method: 'POST', body: JSON.stringify({ enrollment_id: Number(selected) }),
      });
      onChanged(result.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cambiar el delegado.');
    } finally { saving.current = false; setBusy(false); }
  }
  return <Dialog ref={dialog} className="change-delegate-dialog no-print" aria-labelledby="change-delegate-title"
    onCancel={event => { event.preventDefault(); if (!saving.current) onClose(); }}>
    <form onSubmit={submit}>
      <header><div><h2 id="change-delegate-title">Cambiar delegado</h2><p>{teamName}</p></div>
        <Button type="button" aria-label="Cerrar" disabled={busy} onClick={onClose}><X size={20} /></Button></header>
      <div className="change-delegate-body">
        <p>Delegado actual: <strong>{current?.name || 'Sin delegado'}</strong></p>
        <Label>Nuevo delegado<NativeSelect required value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
          <option value="">Selecciona un jugador</option>
          {players.filter(player => !player.is_delegate).map(player => <option key={player.id} value={player.id}>{player.name}</option>)}
        </NativeSelect></Label>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer><Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="primary" disabled={busy || !selected}>{busy ? 'Guardando…' : 'Confirmar cambio'}</Button></footer>
    </form>
  </Dialog>;
}
