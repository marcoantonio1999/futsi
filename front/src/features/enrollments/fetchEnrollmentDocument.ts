import {API_URL} from '../../api';

/** Authorize with the API, then fetch R2 directly without forwarding our auth token. */
export async function fetchEnrollmentDocument(endpoint: string, token: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(API_URL + endpoint + (endpoint.includes('?') ? '&' : '?') + 'delivery=direct', {
    headers: {Authorization: 'Token ' + token}, signal, referrerPolicy: 'no-referrer',
  });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) return response;
  const target = await response.json();
  const url = new URL(target.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('Destino privado no válido.');
  return fetch(url.href, {signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'});
}
