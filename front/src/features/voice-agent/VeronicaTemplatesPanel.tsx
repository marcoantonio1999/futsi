import { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { WhatsAppTemplatesPanel } from './WhatsAppTemplatesPanel';

export function VeronicaTemplatesPanel({ token }: { token: string }) {
  const [channels, setChannels] = useState<Array<{ channel: string; label: string }>>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    apiRequest<{ channels: Array<{ channel: string; label: string }> }>('/veronica/bulk/channels/', token, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setChannels(result.channels); setSelected(result.channels.at(-1)?.channel || ''); } })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'No se pudieron cargar las plantillas.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, retry]);
  const active = channels.find(channel => channel.channel === selected);
  return <section><h2 className="mb-4 text-2xl font-bold">Plantillas de WhatsApp</h2>
    {loading ? <div aria-busy="true" aria-label="Cargando plantillas"><i className="bulk-skeleton heading" /><i className="bulk-skeleton control" /></div> : error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Reintentar</button></div> : <>
      {channels.length > 1 && <label>Mis números<select value={selected} onChange={event => setSelected(event.target.value)}>{channels.map(channel => <option key={channel.channel} value={channel.channel}>{channel.label}</option>)}</select></label>}
      {active ? <WhatsAppTemplatesPanel key={selected} token={token} veronica channels={[{ business_address: active.channel, label: active.label }]} showChannelDetails={false} /> : <p>No hay plantillas disponibles.</p>}
    </>}
  </section>;
}
