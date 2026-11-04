import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { HttpError } from '../context.js';
import { newId } from '../store.js';

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const LINK_RE = /https?:\/\/\S+/i;

export function moderationService(ctx) {
  const cfg = () => ctx.store.data.moderation;
  const spamTracker = new Map(); // userId -> timestamps[]

  function isExempt(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
    return cfg().exemptRoleIds.some((r) => member.roles.cache.has(r));
  }

  async function modLog({ title, description, color = 0xe67e22, fields = [] }) {
    const id = ctx.store.data.settings.modLogChannelId;
    const channel = id ? ctx.guild?.channels.cache.get(id) : null;
    if (!channel?.isTextBased()) return;
    const e = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp(new Date());
    if (description) e.setDescription(description.slice(0, 4000));
    if (fields.length) e.addFields(fields);
    await channel.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
  }

  async function timeout(member, minutes, reason) {
    if (!member?.moderatable) throw new HttpError(403, 'Bottia ei voi hiljentää tätä käyttäjää (rooli liian korkealla?)');
    await member.timeout(minutes * 60_000, reason);
    ctx.log('warn', `Hiljennetty ${member.user.tag} ${minutes} min: ${reason}`);
    await modLog({ title: '🔇 Hiljennys', description: `${member} hiljennettiin **${minutes} min**`, fields: [{ name: 'Syy', value: reason || '–' }] });
  }

  async function punishMessage(message, reason, { timeoutMinutes } = {}) {
    await message.delete().catch(() => {});
    const notice = await message.channel
      .send({ content: `${message.author}, viestisi poistettiin: ${reason}`, allowedMentions: { users: [message.author.id] } })
      .catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000);
    ctx.log('warn', `Automod: ${message.author.tag} #${message.channel.name}: ${reason}`);
    await modLog({
      title: '🛡️ Automod',
      description: `${message.author} kanavalla ${message.channel}`,
      fields: [
        { name: 'Syy', value: reason },
        { name: 'Viesti', value: (message.content || '(tyhjä)').slice(0, 1000) },
      ],
    });
    if (timeoutMinutes && message.member) await timeout(message.member, timeoutMinutes, `Automod: ${reason}`).catch(() => {});
  }

  async function onMessage(message) {
    const c = cfg();
    if (!c.enabled || message.author.bot || !message.inGuild()) return;
    if (message.guildId !== ctx.config.guildId) return;
    if (isExempt(message.member)) return;
    const text = message.content || '';
    const low = text.toLowerCase();

    const bad = c.bannedWords.find((w) => w && low.includes(w.toLowerCase()));
    if (bad) return punishMessage(message, 'kielletty sana');
    if (c.blockInvites && INVITE_RE.test(text)) return punishMessage(message, 'Discord-kutsulinkit eivät ole sallittuja');
    if (c.blockLinks && LINK_RE.test(text)) return punishMessage(message, 'linkit eivät ole sallittuja');

    if (c.spamEnabled) {
      const now = Date.now();
      const windowMs = c.spamWindowSeconds * 1000;
      const list = (spamTracker.get(message.author.id) || []).filter((t) => now - t < windowMs);
      list.push(now);
      spamTracker.set(message.author.id, list);
      if (list.length > c.spamMaxMessages) {
        spamTracker.delete(message.author.id);
        return punishMessage(message, `spämmäys (${list.length} viestiä / ${c.spamWindowSeconds} s)`, { timeoutMinutes: c.spamTimeoutMinutes });
      }
    }
  }

  async function warn(userId, modName, reason) {
    const guild = ctx.requireGuild();
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new HttpError(404, 'Käyttäjää ei löytynyt');
    const w = { id: newId(), userId, userTag: member.user.tag, by: modName, reason: reason || '–', at: new Date().toISOString() };
    cfg().warnings.unshift(w);
    ctx.store.save();
    const count = cfg().warnings.filter((x) => x.userId === userId).length;
    ctx.log('warn', `Varoitus ${member.user.tag} (${count}.) – ${w.reason} [${modName}]`);
    await member.send(`⚠️ Sait varoituksen palvelimella **${guild.name}**: ${w.reason}`).catch(() => {});
    await modLog({ title: '⚠️ Varoitus', description: `${member} sai varoituksen (${count}. kpl)`, fields: [{ name: 'Syy', value: w.reason }, { name: 'Antaja', value: modName }] });
    if (cfg().warnThreshold > 0 && count % cfg().warnThreshold === 0) {
      await timeout(member, cfg().warnTimeoutMinutes, `${count} varoitusta`).catch(() => {});
    }
    return { warning: w, count };
  }

  function warningsFor(userId) {
    return cfg().warnings.filter((w) => !userId || w.userId === userId);
  }

  function deleteWarning(id) {
    cfg().warnings = cfg().warnings.filter((w) => w.id !== id);
    ctx.store.save();
  }

  async function onMemberAdd(member) {
    if (member.guild.id !== ctx.config.guildId) return;
    const s = ctx.store.data.settings;
    if (s.autoRoleId) await member.roles.add(s.autoRoleId, 'Liftup-botti: automaattinen rooli').catch((e) => ctx.log('warn', `Autorooli epäonnistui: ${e.message}`));
    if (s.welcomeChannelId && s.welcomeMessage) {
      const ch = member.guild.channels.cache.get(s.welcomeChannelId);
      const text = s.welcomeMessage.replaceAll('{user}', `${member}`).replaceAll('{server}', member.guild.name).replaceAll('{name}', member.displayName);
      await ch?.send({ content: text, allowedMentions: { users: [member.id] } }).catch(() => {});
    }
    ctx.log('info', `Liittyi: ${member.user.tag}`);
    await modLog({ title: '📥 Liittyi', description: `${member} (${member.user.tag})`, color: 0x2ecc71 });
  }

  async function onMemberRemove(member) {
    if (member.guild.id !== ctx.config.guildId) return;
    ctx.log('info', `Poistui: ${member.user?.tag ?? member.id}`);
    await modLog({ title: '📤 Poistui', description: `${member.user?.tag ?? member.id}`, color: 0x99aab5 });
  }

  return { onMessage, onMemberAdd, onMemberRemove, warn, warningsFor, deleteWarning, timeout, modLog };
}
