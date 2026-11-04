import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ChannelType } from 'discord.js';
import { HttpError } from '../context.js';
import { newId } from '../store.js';
import { registerCommands, setPresence } from '../bot/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

export function startWeb(ctx) {
  const app = express();
  const { teams, announce, minecraft, moderation, ptero } = ctx.services;
  const sessions = new Map(); // token -> expiresAt
  const loginAttempts = new Map(); // ip -> { count, until }

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/healthz', (req, res) => res.json({ ok: true, discord: Boolean(ctx.guild) }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

  // ---------- Kirjautuminen ----------
  const cookieToken = (req) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('lb_session='))?.slice(11);

  function authed(req) {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer && ctx.config.apiToken && safeEqual(bearer, ctx.config.apiToken)) return 'api';
    const tok = cookieToken(req);
    const exp = tok && sessions.get(tok);
    if (exp && exp > Date.now()) return 'web';
    if (tok) sessions.delete(tok);
    return null;
  }

  app.post('/api/login', (req, res) => {
    const ip = req.ip;
    const att = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (att.until > Date.now()) return res.status(429).json({ error: 'Liian monta yritystä, odota hetki.' });
    if (!ctx.config.adminPassword) return res.status(503).json({ error: 'ADMIN_PASSWORD ei ole asetettu palvelimelle.' });
    if (!safeEqual(req.body?.password ?? '', ctx.config.adminPassword)) {
      att.count += 1;
      if (att.count >= 5) { att.until = Date.now() + 60_000; att.count = 0; }
      loginAttempts.set(ip, att);
      ctx.log('warn', `Epäonnistunut kirjautuminen web-paneeliin (${ip})`);
      return res.status(401).json({ error: 'Väärä salasana' });
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const maxAge = ctx.config.sessionHours * 3600;
    sessions.set(token, Date.now() + maxAge * 1000);
    const secure = req.secure ? '; Secure' : '';
    res.set('Set-Cookie', `lb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
    ctx.log('info', `Kirjautuminen web-paneeliin (${ip})`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const tok = cookieToken(req);
    if (tok) sessions.delete(tok);
    res.set('Set-Cookie', 'lb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    const who = authed(req);
    if (!who) return res.status(401).json({ error: 'Kirjaudu sisään' });
    req.who = who;
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => { if (!res.headersSent) res.json(r ?? { ok: true }); }).catch(next);

  // ---------- Tila & Discord-tiedot ----------
  app.get('/api/status', wrap(async () => {
    const g = ctx.guild;
    return {
      bot: { online: Boolean(ctx.client?.isReady()), tag: ctx.client?.user?.tag ?? null, avatar: ctx.client?.user?.displayAvatarURL() ?? null, error: ctx.discordError || null },
      guild: g ? { id: g.id, name: g.name, icon: g.iconURL(), members: g.memberCount } : null,
      teams: ctx.store.data.teams.length,
      servers: ctx.store.data.servers.length,
      scheduled: ctx.store.data.announcements.scheduled.length,
      minecraft: await minecraft.status(),
      ptero: ptero.enabled(),
      uptime: Math.round((Date.now() - ctx.startedAt) / 1000),
      apiTokenSet: Boolean(ctx.config.apiToken),
    };
  }));

  app.get('/api/guild', wrap(() => {
    const g = ctx.requireGuild();
    const me = g.members.me;
    return {
      botTopRole: me?.roles.highest.position ?? 0,
      roles: [...g.roles.cache.values()].filter((r) => r.id !== g.id).sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position, managed: r.managed })),
      channels: [...g.channels.cache.values()]
        .filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type))
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name ?? '' })),
      members: [...g.members.cache.values()].filter((m) => !m.user.bot)
        .map((m) => ({ id: m.id, name: m.displayName, username: m.user.username, avatar: m.displayAvatarURL({ size: 64 }) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    };
  }));

  app.post('/api/commands/register', wrap(async () => ({ count: await registerCommands(ctx) })));

  // ---------- Asetukset ----------
  const SETTINGS_KEYS = ['announceChannelId', 'modLogChannelId', 'welcomeChannelId', 'welcomeMessage', 'autoRoleId', 'serverListChannelId', 'presenceText', 'exclusiveTeams', 'teamCategoryName'];
  app.get('/api/settings', wrap(() => ctx.store.data.settings));
  app.put('/api/settings', wrap(async (req) => {
    const s = ctx.store.data.settings;
    const prevList = s.serverListChannelId;
    Object.assign(s, pick(req.body || {}, SETTINGS_KEYS));
    if (prevList !== s.serverListChannelId) s.serverListMessageId = '';
    ctx.store.save();
    setPresence(ctx);
    if (s.serverListChannelId) await announce.updateServerList().catch(() => {});
    return s;
  }));

  // ---------- Tiimit ----------
  app.get('/api/teams', wrap(() => teams.list()));
  app.post('/api/teams', wrap((req) => teams.create(req.body || {})));
  app.post('/api/teams/generate', wrap((req) => teams.generate(req.body || {})));
  app.post('/api/teams/import', wrap((req) => teams.importTeams(req.body || {})));
  app.post('/api/teams/reset', wrap((req) => teams.resetAll(req.body || {})));
  app.patch('/api/teams/:id', wrap((req) => teams.update(req.params.id, req.body || {})));
  app.delete('/api/teams/:id', wrap((req) => teams.remove(req.params.id, { deleteRole: req.query.keepRole !== '1', deleteChannels: true })));
  app.post('/api/teams/:id/members', wrap((req) => teams.addMembers(req.params.id, req.body?.users ?? req.body?.bulk ?? [])));
  app.delete('/api/teams/:id/members/:userId', wrap((req) => teams.removeMember(req.params.id, req.params.userId)));
  app.post('/api/teams/:id/clear', wrap(async (req) => ({ cleared: await teams.clear(req.params.id) })));

  // ---------- Pelipalvelimet ----------
  const SERVER_KEYS = ['name', 'game', 'address', 'port', 'password', 'connect', 'note', 'pteroId', 'listed'];
  const cleanServer = (b) => {
    const s = pick(b || {}, SERVER_KEYS);
    if (s.port !== undefined) s.port = s.port === '' || s.port === null ? '' : Number(s.port) || '';
    return s;
  };
  app.get('/api/servers', wrap(() => ctx.store.data.servers));
  app.post('/api/servers', wrap(async (req) => {
    const s = { id: newId(), listed: true, ...cleanServer(req.body) };
    if (!s.name || !s.address) throw new HttpError(400, 'Nimi ja osoite vaaditaan');
    ctx.store.data.servers.push(s);
    ctx.store.save();
    ctx.log('info', `Palvelin lisätty: ${s.name} (${s.address})`);
    await announce.updateServerList().catch(() => {});
    return s;
  }));
  app.put('/api/servers/:id', wrap(async (req) => {
    const s = ctx.store.data.servers.find((x) => x.id === req.params.id);
    if (!s) throw new HttpError(404, 'Palvelinta ei löytynyt');
    Object.assign(s, cleanServer(req.body));
    ctx.store.save();
    await announce.updateServerList().catch(() => {});
    return s;
  }));
  app.delete('/api/servers/:id', wrap(async (req) => {
    ctx.store.data.servers = ctx.store.data.servers.filter((x) => x.id !== req.params.id);
    ctx.store.save();
    await announce.updateServerList().catch(() => {});
  }));
  app.post('/api/servers/list-message', wrap(async () => ({ url: await announce.updateServerList() })));
  app.get('/api/servers/:id/ptero', wrap((req) => {
    const s = ctx.store.data.servers.find((x) => x.id === req.params.id);
    if (!s?.pteroId) throw new HttpError(400, 'Palvelimelle ei ole asetettu Pterodactyl-tunnistetta');
    return ptero.state(s.pteroId);
  }));
  app.post('/api/servers/:id/power', wrap(async (req) => {
    const s = ctx.store.data.servers.find((x) => x.id === req.params.id);
    if (!s?.pteroId) throw new HttpError(400, 'Palvelimelle ei ole asetettu Pterodactyl-tunnistetta');
    await ptero.power(s.pteroId, req.body?.signal);
  }));

  // ---------- Ilmoitukset ----------
  const ANNOUNCE_KEYS = ['channelId', 'title', 'body', 'color', 'mention', 'serverIds', 'pin', 'image', 'sendAt'];
  app.get('/api/announcements', wrap(() => ctx.store.data.announcements));
  app.post('/api/announcements', wrap((req) => {
    const input = pick(req.body || {}, ANNOUNCE_KEYS);
    input.serverIds = Array.isArray(input.serverIds) ? input.serverIds : [];
    input.by = req.who === 'api' ? 'api' : 'web';
    return input.sendAt ? announce.schedule(input) : announce.send(input);
  }));
  app.delete('/api/announcements/:id', wrap((req) => announce.cancel(req.params.id)));

  // ---------- Minecraft ----------
  const MC_KEYS = ['host', 'port', 'rconPort', 'rconPassword', 'statusEnabled', 'statusChannelId', 'allowSelfWhitelist'];
  app.get('/api/minecraft', wrap(async () => {
    const m = ctx.store.data.minecraft;
    return {
      settings: { ...m, rconPassword: m.rconPassword ? '••••••' : '' },
      envOverrides: { host: Boolean(ctx.config.mcHost), rconPassword: Boolean(ctx.config.mcRconPassword) },
      status: await minecraft.status({ fresh: true }),
    };
  }));
  app.put('/api/minecraft', wrap(async (req) => {
    const m = ctx.store.data.minecraft;
    const body = pick(req.body || {}, MC_KEYS);
    if (body.rconPassword === '••••••') delete body.rconPassword;
    const prevChannel = m.statusChannelId;
    Object.assign(m, body);
    if (prevChannel !== m.statusChannelId) m.statusMessageId = '';
    ctx.store.save();
    await minecraft.updateStatusMessage().catch(() => {});
    return { ok: true };
  }));
  app.post('/api/minecraft/command', wrap(async (req) => {
    const out = await minecraft.rcon(req.body?.command);
    ctx.log('info', `MC-komento (web): ${req.body?.command}`);
    return { output: out };
  }));
  app.post('/api/minecraft/whitelist', wrap(async (req) => ({ output: await minecraft.whitelist(req.body?.name, 'web') })));
  app.post('/api/minecraft/say', wrap(async (req) => ({ output: await minecraft.say(req.body?.message) })));

  // ---------- Valvonta ----------
  const MOD_KEYS = ['enabled', 'bannedWords', 'blockInvites', 'blockLinks', 'exemptRoleIds', 'spamEnabled', 'spamMaxMessages', 'spamWindowSeconds', 'spamTimeoutMinutes', 'warnThreshold', 'warnTimeoutMinutes'];
  app.get('/api/moderation', wrap(() => ctx.store.data.moderation));
  app.put('/api/moderation', wrap((req) => {
    const m = ctx.store.data.moderation;
    const body = pick(req.body || {}, MOD_KEYS);
    for (const k of ['spamMaxMessages', 'spamWindowSeconds', 'spamTimeoutMinutes', 'warnThreshold', 'warnTimeoutMinutes']) {
      if (body[k] !== undefined) body[k] = Math.max(0, Number(body[k]) || 0);
    }
    if (typeof body.bannedWords === 'string') body.bannedWords = body.bannedWords.split(/\n|,/).map((w) => w.trim()).filter(Boolean);
    Object.assign(m, body);
    ctx.store.save();
    ctx.log('info', 'Valvonta-asetukset päivitetty');
    return m;
  }));
  app.post('/api/moderation/warn', wrap((req) => moderation.warn(req.body?.userId, 'web-paneeli', req.body?.reason)));
  app.delete('/api/moderation/warnings/:id', wrap((req) => moderation.deleteWarning(req.params.id)));

  // ---------- Loki ----------
  app.get('/api/logs', wrap((req) => {
    const lvl = req.query.level;
    return ctx.store.data.logs.filter((l) => !lvl || l.level === lvl).slice(0, 300);
  }));

  // ---------- Virheet ----------
  app.use('/api', (req, res) => res.status(404).json({ error: 'Tuntematon rajapinta' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === 50013 ? 403 : 500);
    const message = err.code === 50013 ? 'Botilta puuttuu Discord-oikeus tähän toimintoon' : err.message;
    if (status >= 500 && status !== 503) ctx.log('error', `API ${req.method} ${req.path}: ${err.message}`);
    res.status(status).json({ error: message });
  });

  const server = app.listen(ctx.config.webPort, ctx.config.webHost, () => {
    ctx.log('info', `Web-paneeli käynnissä: http://${ctx.config.webHost}:${ctx.config.webPort}`);
  });
  return server;
}
