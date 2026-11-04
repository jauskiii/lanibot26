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

  /**
   * Kohteet: channelIds-lista / channelId, sekä teams-lista (tiimien nimet tai ID:t → niiden omat kanavat).
   * Tiimi ilman omaa kanavaa → ilmoitus oletuskanavalle ja sen rooli pingataan siellä.
   * Ei mitään → oletuskanava.
   */
  function resolveTargets(input) {
    const ids = [...(Array.isArray(input.channelIds) ? input.channelIds : []), input.channelId].filter(Boolean);
    const fallbackRoleIds = [];
    const notes = [];
    for (const name of Array.isArray(input.teams) ? input.teams : []) {
      const team = ctx.services.teams.find(String(name));
      if (!team) { notes.push({ team: name, reason: 'Tiimiä ei löytynyt botista (synkronoi tiimit ensin)' }); continue; }
      if (team.textChannelId) ids.push(team.textChannelId);
      else if (team.roleId) fallbackRoleIds.push(team.roleId);
    }
    if (fallbackRoleIds.length && data().settings.announceChannelId) ids.push(data().settings.announceChannelId);
    const unique = [...new Set(ids)];
    const askedTeams = Array.isArray(input.teams) && input.teams.length > 0;
    // Tiimeille osoitettu viesti ei valu hiljaa oletuskanavalle, jos tiimejä ei löytynyt.
    if (!unique.length && !askedTeams && data().settings.announceChannelId) unique.push(data().settings.announceChannelId);
    if (!unique.length) {
      if (askedTeams && notes.length) {
        throw new HttpError(400, `Tiimejä ei löytynyt botista: ${notes.map((n) => n.team).join(', ')}. Synkronoi tiimit Tourneysta ensin (Teams & players → Sync teams to Discord).`);
      }
      if (askedTeams && fallbackRoleIds.length) {
        throw new HttpError(400, 'Tiimeillä ei ole omia kanavia, eikä botille ole asetettu ilmoitusten oletuskanavaa. Aseta se botin paneelissa (Asetukset) tai synkronoi tiimit kanavien kanssa.');
      }
      throw new HttpError(400, 'Valitse vähintään yksi kanava (tai aseta oletuskanava asetuksista)');
    }
    if (unique.length > 25) throw new HttpError(400, 'Enintään 25 kanavaa kerralla');
    return { channelIds: unique, fallbackRoleIds, notes };
  }
  const resolveChannelIds = (input) => resolveTargets(input).channelIds;

  /** serverNames (esim. turnausjärjestelmän kentän nimi) → samannimiset palvelimet. */
  function resolveServerIds(input) {
    const ids = new Set(Array.isArray(input.serverIds) ? input.serverIds : []);
    for (const name of Array.isArray(input.serverNames) ? input.serverNames : []) {
      const s = data().servers.find((x) => x.name.toLowerCase() === String(name).trim().toLowerCase());
      if (s) ids.add(s.id);
    }
    return [...ids];
  }

  async function send(input) {
    const guild = ctx.requireGuild();
    const { channelIds, fallbackRoleIds, notes } = resolveTargets(input);
    input = { ...input, serverIds: resolveServerIds(input) };
    if (!input.title && !input.body && !input.serverIds.length) throw new HttpError(400, 'Ilmoitus on tyhjä');

    const embed = buildEmbed(input);
    // "team" = pingaa kullakin tiimikanavalla sen tiimin roolia (oletuskanavalla kanavattomien tiimien roolit)
    const mentionFor = (channelId) => {
      if (input.mention !== 'team') return mentionContent(input.mention);
      const team = data().teams.find((t) => t.textChannelId === channelId);
      if (team?.roleId) return mentionContent(team.roleId);
      if (fallbackRoleIds.length && channelId === data().settings.announceChannelId) {
        return { content: fallbackRoleIds.map((r) => `<@&${r}>`).join(' '), allowedMentions: { roles: fallbackRoleIds } };
      }
      return mentionContent('none');
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
    for (const n of notes) ctx.log('warn', `Ilmoitus: ${n.team}: ${n.reason}`);
    return { ...record, failed, notes };
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
