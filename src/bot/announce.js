import { EmbedBuilder } from 'discord.js';
import { HttpError } from '../context.js';
import { newId } from '../store.js';

const GAME_ICONS = { cs2: '🔫', cs: '🔫', minecraft: '⛏️', mc: '⛏️', valorant: '🎯', lol: '🏆', rocketleague: '🚗', muu: '🎮' };
export const gameIcon = (g) => GAME_ICONS[String(g || '').toLowerCase().replace(/\s+/g, '')] ?? '🎮';

export function serverLine(s) {
  const addr = s.port ? `${s.address}:${s.port}` : s.address;
  const parts = [`\`${addr}\``];
  if (s.password) parts.push(`salasana: \`${s.password}\``);
  if (s.connect) parts.push(`\`${s.connect}\``);
  if (s.note) parts.push(s.note);
  return parts.join('\n');
}

export function announceService(ctx) {
  const data = () => ctx.store.data;

  function buildEmbed({ title, body, color, serverIds = [], image }) {
    const embed = new EmbedBuilder()
      .setColor(Number.parseInt(String(color || '#5865f2').replace('#', ''), 16) || 0x5865f2)
      .setTimestamp(new Date());
    if (title) embed.setTitle(String(title).slice(0, 256));
    if (body) embed.setDescription(String(body).slice(0, 4000));
    if (image) embed.setImage(image);
    const servers = data().servers.filter((s) => serverIds.includes(s.id));
    for (const s of servers.slice(0, 25)) {
      embed.addFields({ name: `${gameIcon(s.game)} ${s.name}`.slice(0, 256), value: serverLine(s).slice(0, 1024) });
    }
    embed.setFooter({ text: 'Liftup LAN' });
    return embed;
  }

  function mentionContent(mention) {
    if (!mention || mention === 'none') return { content: undefined, allowedMentions: { parse: [] } };
    if (mention === 'everyone') return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
    if (mention === 'here') return { content: '@here', allowedMentions: { parse: ['everyone'] } };
    return { content: `<@&${mention}>`, allowedMentions: { roles: [mention] } };
  }

  /** Kanavat: channelIds-lista (uusi) tai yksittäinen channelId (vanha/API), muuten oletuskanava. */
  function resolveChannelIds(input) {
    const ids = [...new Set([...(Array.isArray(input.channelIds) ? input.channelIds : []), input.channelId].filter(Boolean))];
    if (!ids.length && data().settings.announceChannelId) ids.push(data().settings.announceChannelId);
    if (!ids.length) throw new HttpError(400, 'Valitse vähintään yksi kanava (tai aseta oletuskanava asetuksista)');
    if (ids.length > 25) throw new HttpError(400, 'Enintään 25 kanavaa kerralla');
    return ids;
  }

  async function send(input) {
    const guild = ctx.requireGuild();
    const channelIds = resolveChannelIds(input);
    if (!input.title && !input.body && !(input.serverIds || []).length) throw new HttpError(400, 'Ilmoitus on tyhjä');

    const embed = buildEmbed(input);
    // "team" = pingaa kullakin tiimikanavalla sen tiimin roolia
    const mentionFor = (channelId) => {
      if (input.mention !== 'team') return mentionContent(input.mention);
      const team = data().teams.find((t) => t.textChannelId === channelId);
      return team?.roleId ? mentionContent(team.roleId) : mentionContent('none');
    };
    const sent = [];
    const failed = [];
    for (const channelId of channelIds) {
      const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
      if (!channel?.isTextBased()) { failed.push({ channelId, reason: 'Kanavaa ei löytynyt tai se ei ole tekstikanava' }); continue; }
      try {
        const { content, allowedMentions } = mentionFor(channelId);
        const msg = await channel.send({ content, embeds: [embed], allowedMentions });
        if (input.pin) await msg.pin().catch(() => {});
        sent.push({ channelId, channelName: channel.name, messageId: msg.id, url: msg.url });
      } catch (err) {
        failed.push({ channelId, channelName: channel.name, reason: err.code === 50013 ? 'Botilta puuttuu oikeus kirjoittaa kanavalle' : err.message });
      }
    }
    if (!sent.length) throw new HttpError(400, `Ilmoitusta ei voitu lähettää: ${failed.map((f) => `${f.channelName ? `#${f.channelName}` : f.channelId}: ${f.reason}`).join('; ')}`);

    const record = {
      id: newId(),
      title: input.title || '',
      channelName: sent.map((s) => s.channelName).join(', '),
      url: sent[0].url,
      messages: sent,
      sentAt: new Date().toISOString(),
      by: input.by || 'web',
    };
    data().announcements.history.unshift(record);
    data().announcements.history.length = Math.min(data().announcements.history.length, 50);
    ctx.store.save();
    ctx.log('info', `Ilmoitus lähetetty ${sent.map((s) => `#${s.channelName}`).join(', ')}: ${record.title || '(ei otsikkoa)'}`);
    for (const f of failed) ctx.log('warn', `Ilmoitus epäonnistui ${f.channelName ? `#${f.channelName}` : f.channelId}: ${f.reason}`);
    return { ...record, failed };
  }

  function schedule(input) {
    const at = new Date(input.sendAt);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'Virheellinen ajankohta');
    if (at.getTime() < Date.now() - 60_000) throw new HttpError(400, 'Ajankohta on menneisyydessä');
    input.channelIds = resolveChannelIds(input);
    delete input.channelId;
    const item = { ...input, id: newId(), sendAt: at.toISOString(), createdAt: new Date().toISOString() };
    data().announcements.scheduled.push(item);
    data().announcements.scheduled.sort((a, b) => a.sendAt.localeCompare(b.sendAt));
    ctx.store.save();
    ctx.log('info', `Ilmoitus ajastettu ${at.toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' })}: ${input.title || ''}`);
    return item;
  }

  function cancel(id) {
    const before = data().announcements.scheduled.length;
    data().announcements.scheduled = data().announcements.scheduled.filter((s) => s.id !== id);
    if (before === data().announcements.scheduled.length) throw new HttpError(404, 'Ajastettua ilmoitusta ei löytynyt');
    ctx.store.save();
  }

  async function tick() {
    if (!ctx.guild) return;
    const now = Date.now();
    const due = data().announcements.scheduled.filter((s) => new Date(s.sendAt).getTime() <= now);
    for (const item of due) {
      data().announcements.scheduled = data().announcements.scheduled.filter((s) => s.id !== item.id);
      try {
        await send({ ...item, by: 'ajastus' });
      } catch (err) {
        ctx.log('error', `Ajastettu ilmoitus epäonnistui (${item.title}): ${err.message}`);
      }
    }
    if (due.length) ctx.store.save();
  }

  /** Pysyvä "serverilista"-viesti, joka päivittyy aina kun serverit muuttuvat. */
  function serverListEmbed() {
    const servers = data().servers.filter((s) => s.listed !== false);
    const embed = new EmbedBuilder()
      .setTitle('🖥️ Pelipalvelimet')
      .setColor(0x5865f2)
      .setFooter({ text: 'Päivittyy automaattisesti • Liftup LAN' })
      .setTimestamp(new Date());
    if (!servers.length) embed.setDescription('Ei palvelimia vielä.');
    for (const s of servers.slice(0, 25)) embed.addFields({ name: `${gameIcon(s.game)} ${s.name}`, value: serverLine(s).slice(0, 1024) });
    return embed;
  }

  async function updateServerList() {
    const s = data().settings;
    const guild = ctx.guild;
    if (!guild || !s.serverListChannelId) return null;
    const channel = guild.channels.cache.get(s.serverListChannelId);
    if (!channel?.isTextBased()) return null;
    const payload = { embeds: [serverListEmbed()] };
    if (s.serverListMessageId) {
      const msg = await channel.messages.fetch(s.serverListMessageId).catch(() => null);
      if (msg) { await msg.edit(payload); return msg.url; }
    }
    const msg = await channel.send(payload);
    s.serverListMessageId = msg.id;
    ctx.store.save();
    return msg.url;
  }

  return { buildEmbed, send, schedule, cancel, tick, serverListEmbed, updateServerList };
}
