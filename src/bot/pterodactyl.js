import { HttpError } from '../context.js';

// Valinnainen: serverien virtatoiminnot ja tila Pterodactylin Client API:n kautta.
// PTERO_URL=https://panel.esimerkki.fi  PTERO_API_KEY=ptlc_...
export function pteroService(ctx) {
  const enabled = () => Boolean(ctx.config.pteroUrl && ctx.config.pteroApiKey);

  async function request(path, { method = 'GET', body } = {}) {
    if (!enabled()) throw new HttpError(400, 'Pterodactyl-integraatio ei ole käytössä (PTERO_URL / PTERO_API_KEY)');
    const res = await fetch(`${ctx.config.pteroUrl}/api/client${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${ctx.config.pteroApiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, `Pterodactyl vastasi ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function state(identifier) {
    const r = await request(`/servers/${encodeURIComponent(identifier)}/resources`);
    const a = r?.attributes ?? {};
    return {
      state: a.current_state,
      cpu: a.resources?.cpu_absolute,
      memoryMb: a.resources?.memory_bytes ? Math.round(a.resources.memory_bytes / 1048576) : null,
    };
  }

  async function power(identifier, signal) {
    if (!['start', 'stop', 'restart', 'kill'].includes(signal)) throw new HttpError(400, 'Tuntematon komento');
    await request(`/servers/${encodeURIComponent(identifier)}/power`, { method: 'POST', body: { signal } });
    ctx.log('info', `Pterodactyl: ${signal} → ${identifier}`);
  }

  return { enabled, state, power };
}
