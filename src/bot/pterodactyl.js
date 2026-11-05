import { HttpError } from '../context.js';

// Valinnainen: serverien virtatoiminnot ja tila Pterodactylin Client API:n kautta.
// PTERO_URL=http://192.168.1.5  PTERO_API_KEY=ptlc_...  (Client API -avain, ei Application API)
export function pteroService(ctx) {
  const enabled = () => Boolean(ctx.config.pteroUrl && ctx.config.pteroApiKey);

  async function request(path, { method = 'GET', body } = {}) {
    if (!enabled()) throw new HttpError(400, 'Pterodactyl-integraatio ei ole käytössä (PTERO_URL / PTERO_API_KEY)');
    if (ctx.config.pteroApiKey.startsWith('ptla_')) {
      throw new HttpError(400, 'PTERO_API_KEY on Application API -avain (ptla_). Tarvitaan Client API -avain (ptlc_): paneelin oikea yläkulma → Account → API Credentials.');
    }
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
      const hint = res.status === 401 ? ' – API-avain on väärä tai poistettu.'
        : res.status === 403 ? ' – avaimen käyttäjällä ei ole oikeutta tähän serveriin.'
        : res.status === 404 ? ' – serveriä ei löytynyt: tarkista Pterodactyl-tunniste (8 merkin lyhyt ID paneelin osoitteesta /server/xxxxxxxx tai serverin nimi).'
        : '';
      throw new HttpError(502, `Pterodactyl vastasi ${res.status}${hint} ${text.slice(0, 160)}`.trim());
    }
    return res.status === 204 ? null : res.json();
  }

  // Tunnisteeksi kelpaa lyhyt ID (esim. 1a2b3c4d), koko UUID tai serverin nimi paneelissa (esim. "Minecraft").
  const isId = (s) => /^[0-9a-f]{8}$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const nameCache = new Map();
  async function resolve(identifier) {
    const key = String(identifier || '').trim();
    if (!key) throw new HttpError(400, 'Pterodactyl-tunniste puuttuu');
    if (isId(key)) return key;
    if (nameCache.has(key.toLowerCase())) return nameCache.get(key.toLowerCase());
    // Adminin avaimella "admin-all" listaa kaikki serverit; muuten vain omat.
    let list = await request('?type=admin-all&per_page=100').catch(() => null);
    if (!list?.data?.length) list = await request('?per_page=100');
    const hit = (list?.data ?? []).find((s) => String(s.attributes?.name ?? '').toLowerCase() === key.toLowerCase());
    if (!hit) throw new HttpError(404, `Pterodactylista ei löytynyt serveriä nimeltä "${key}". Käytä serverin lyhyttä ID:tä (paneelin osoitteesta /server/xxxxxxxx).`);
    nameCache.set(key.toLowerCase(), hit.attributes.identifier);
    return hit.attributes.identifier;
  }

  async function state(identifier) {
    const r = await request(`/servers/${encodeURIComponent(await resolve(identifier))}/resources`);
    const a = r?.attributes ?? {};
    return {
      state: a.current_state,
      cpu: a.resources?.cpu_absolute,
      memoryMb: a.resources?.memory_bytes ? Math.round(a.resources.memory_bytes / 1048576) : null,
    };
  }

  async function power(identifier, signal) {
    if (!['start', 'stop', 'restart', 'kill'].includes(signal)) throw new HttpError(400, 'Tuntematon komento');
    await request(`/servers/${encodeURIComponent(await resolve(identifier))}/power`, { method: 'POST', body: { signal } });
    ctx.log('info', `Pterodactyl: ${signal} → ${identifier}`);
  }

  return { enabled, state, power };
}
