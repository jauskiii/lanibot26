import { ActivityType } from 'discord.js';

// Botin tila (useampi, vaihtuu tasaisin väliajoin) ja profiilin kuvaus ("About me").
const TYPES = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};
// Rivin alkuun voi kirjoittaa tyypin: "Katsoo: CS2-finaalia"
const PREFIXES = { pelaa: 'playing', katsoo: 'watching', kuuntelee: 'listening', kilpailee: 'competing', tila: 'custom' };
const MIN_INTERVAL = 15; // s – Discord rajoittaa tilan vaihtoja

export function presenceService(ctx) {
  const settings = () => ctx.store.data.settings;
  let timer = null;
  let index = 0;

  /** Tilarivit asetuksista: uusi lista (presenceTexts) tai vanha yksittäinen presenceText. */
  function lines() {
    const s = settings();
    const list = Array.isArray(s.presenceTexts) && s.presenceTexts.length ? s.presenceTexts : [s.presenceText];
    return list.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 20);
  }

  /** {members} {mc} {teams} {servers} → nykyiset arvot. */
  async function fill(text) {
    if (!text.includes('{')) return text;
    const guild = ctx.guild;
    let mc = '–';
    if (text.includes('{mc}')) {
      const st = await ctx.services.minecraft?.status().catch(() => null);
      mc = st?.online ? `${st.players?.online ?? 0}/${st.players?.max ?? '?'}` : 'offline';
    }
    return text
      .replaceAll('{members}', String(guild?.memberCount ?? '–'))
      .replaceAll('{mc}', mc)
      .replaceAll('{teams}', String(ctx.store.data.teams.length))
      .replaceAll('{servers}', String(ctx.store.data.servers.length));
  }

  function parse(line) {
    const m = line.match(/^(pelaa|katsoo|kuuntelee|kilpailee|tila)\s*:\s*(.+)$/i);
    if (m) return { type: PREFIXES[m[1].toLowerCase()], text: m[2] };
    return { type: TYPES[settings().presenceType] !== undefined ? settings().presenceType : 'playing', text: line };
  }

  async function show(line) {
    const user = ctx.client?.user;
    if (!user) return;
    if (!line) { user.setPresence({ activities: [], status: 'online' }); return; }
    const { type, text } = parse(line);
    const filled = (await fill(text)).slice(0, 128);
    const activity = type === 'custom'
      ? { type: ActivityType.Custom, name: 'custom', state: filled }
      : { type: TYPES[type], name: filled };
    user.setPresence({ activities: [activity], status: 'online' });
  }

  /** (Uudelleen)käynnistää kierron asetusten mukaan. Kutsutaan käynnistyksessä ja asetusten tallennuksessa. */
  function start() {
    if (timer) clearInterval(timer);
    timer = null;
    const list = lines();
    index = 0;
    show(list[0]).catch((e) => ctx.log('warn', `Tilan asetus epäonnistui: ${e.message}`));
    const needsRefresh = list.some((l) => l.includes('{'));
    if (list.length > 1 || needsRefresh) {
      const seconds = Math.max(MIN_INTERVAL, Number(settings().presenceInterval) || 30);
      timer = setInterval(() => {
        const current = lines();
        if (!current.length) return;
        index = (index + 1) % current.length;
        show(current[index]).catch(() => {});
      }, seconds * 1000);
      timer.unref?.();
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** Profiilin kuvaus = sovelluksen kuvaus Developer Portalissa (max 400 merkkiä). */
  async function setDescription(description) {
    const app = ctx.client?.application;
    if (!app) throw new Error('Botti ei ole yhteydessä Discordiin');
    await app.edit({ description: String(description ?? '').slice(0, 400) });
    ctx.log('info', 'Botin kuvaus päivitetty');
  }

  async function getDescription() {
    const app = ctx.client?.application;
    if (!app) return null;
    await app.fetch().catch(() => {});
    return app.description ?? '';
  }

  return { start, stop, setDescription, getDescription, lines };
}
