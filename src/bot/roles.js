import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { HttpError } from '../context.js';
import { newId } from '../store.js';

const PREFIX = 'lrole';
const STYLES = { blue: ButtonStyle.Primary, grey: ButtonStyle.Secondary, green: ButtonStyle.Success, red: ButtonStyle.Danger };
const hexToInt = (hex) => Number.parseInt(String(hex || '#5865f2').replace('#', ''), 16) || 0x5865f2;
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 90) || 'kanava';

/**
 * Roolipaneelit: viesti, jonka napeista jäsen ottaa/poistaa roolin itselleen
 * (esim. CS2, Minecraft, Bingo, Tetris → pääsy pelin kanaville).
 * Lisäksi jäsenten roolien käsin hallinta web-paneelista.
 */
export function roleService(ctx) {
  const data = () => ctx.store.data;
  if (!Array.isArray(data().rolePanels)) data().rolePanels = [];

  // ---- Roolien turvallisuustarkistus ----
  function assignable(guild, roleId) {
    const role = guild.roles.cache.get(roleId);
    if (!role) throw new HttpError(404, 'Roolia ei löytynyt');
    if (role.id === guild.id) throw new HttpError(400, '@everyone-roolia ei voi jakaa');
    if (role.managed) throw new HttpError(400, `Rooli @${role.name} on integraation hallinnoima, sitä ei voi jakaa`);
    if (role.position >= guild.members.me.roles.highest.position) {
      throw new HttpError(403, `Rooli @${role.name} on botin roolin yläpuolella – siirrä botin rooli ylemmäs Discordin roolilistassa`);
    }
    return role;
  }

  // ---- Uuden roolin (ja halutessa kanavan) luonti ----
  async function createRole({ name, color, createChannel = false, channelCategoryId = '' }) {
    const guild = ctx.requireGuild();
    name = String(name || '').trim();
    if (!name) throw new HttpError(400, 'Roolin nimi puuttuu');
    if (guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `Rooli @${name} on jo olemassa`);
    const role = await guild.roles.create({ name, colors: { primaryColor: hexToInt(color) }, mentionable: true, reason: 'Liftup-botti: roolipaneelin rooli' });
    let channel = null;
    if (createChannel) {
      channel = await guild.channels.create({
        name: slug(name),
        type: ChannelType.GuildText,
        parent: channelCategoryId || undefined,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
        ],
        reason: 'Liftup-botti: roolin oma kanava',
      });
    }
    ctx.log('info', `Rooli luotu: @${role.name}${channel ? ` + #${channel.name}` : ''}`);
    return { id: role.id, name: role.name, color: role.hexColor, channelId: channel?.id ?? null, channelName: channel?.name ?? null };
  }

  // ---- Paneelit ----
  function cleanPanel(input, guild) {
    const options = (Array.isArray(input.options) ? input.options : [])
      .filter((o) => o?.roleId)
      .slice(0, 25)
      .map((o) => ({ roleId: String(o.roleId), label: String(o.label || '').trim().slice(0, 80), emoji: String(o.emoji || '').trim().slice(0, 40), style: STYLES[o.style] ? o.style : 'grey' }));
    if (!options.length) throw new HttpError(400, 'Lisää vähintään yksi rooli');
    if (new Set(options.map((o) => o.roleId)).size !== options.length) throw new HttpError(400, 'Sama rooli on listalla kahdesti');
    for (const o of options) {
      const role = assignable(guild, o.roleId);
      if (!o.label) o.label = role.name;
    }
    return {
      channelId: String(input.channelId || ''),
      title: String(input.title || 'Valitse roolit').slice(0, 256),
      body: String(input.body || '').slice(0, 4000),
      color: input.color || '#5865f2',
      mode: input.mode === 'single' ? 'single' : 'toggle',
      options,
    };
  }

  function messagePayload(panel) {
    const guild = ctx.guild;
    const lines = panel.options.map((o) => `${o.emoji ? `${o.emoji} ` : ''}**${o.label}** → <@&${o.roleId}>`);
    const hint = panel.mode === 'single' ? '*Voit valita yhden kerrallaan – uusi valinta korvaa edellisen.*' : '*Paina nappia ottaaksesi roolin, paina uudestaan poistaaksesi.*';
    const embed = new EmbedBuilder()
      .setTitle(panel.title)
      .setColor(hexToInt(panel.color))
      .setDescription([panel.body, lines.join('\n'), hint].filter(Boolean).join('\n\n').slice(0, 4096))
      .setFooter({ text: guild ? `Liftup LAN • ${guild.name}` : 'Liftup LAN' });

    const rows = [];
    panel.options.forEach((o, idx) => {
      if (idx % 5 === 0) rows.push(new ActionRowBuilder());
      const btn = new ButtonBuilder().setCustomId(`${PREFIX}:${panel.id}:${o.roleId}`).setLabel(o.label).setStyle(STYLES[o.style] ?? ButtonStyle.Secondary);
      if (o.emoji) {
        const custom = o.emoji.match(/^<a?:\w+:(\d+)>$/);
        btn.setEmoji(custom ? { id: custom[1] } : o.emoji);
      }
      rows.at(-1).addComponents(btn);
    });
    return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
  }

  async function publish(panel) {
    const guild = ctx.requireGuild();
    const channel = guild.channels.cache.get(panel.channelId);
    if (!channel?.isTextBased()) throw new HttpError(400, 'Valitse tekstikanava paneelille');
    const payload = messagePayload(panel);
    if (panel.messageId && panel.publishedChannelId === panel.channelId) {
      const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
      if (msg) { await msg.edit(payload); panel.url = msg.url; return panel; }
    }
    // Kanava vaihtui tai viesti poistettu → poista vanha ja lähetä uusi
    if (panel.messageId && panel.publishedChannelId) {
      const old = guild.channels.cache.get(panel.publishedChannelId);
      await old?.messages.delete(panel.messageId).catch(() => {});
    }
    const msg = await channel.send(payload);
    panel.messageId = msg.id;
    panel.publishedChannelId = channel.id;
    panel.url = msg.url;
    return panel;
  }

  function getPanel(id) {
    const p = data().rolePanels.find((x) => x.id === id);
    if (!p) throw new HttpError(404, 'Roolipaneelia ei löytynyt');
    return p;
  }

  async function createPanel(input) {
    const guild = ctx.requireGuild();
    const panel = { id: newId(), ...cleanPanel(input, guild), messageId: '', publishedChannelId: '', createdAt: new Date().toISOString() };
    await publish(panel);
    data().rolePanels.push(panel);
    ctx.store.save();
    ctx.log('info', `Roolipaneeli julkaistu: ${panel.title} (${panel.options.length} roolia)`);
    return panel;
  }

  async function updatePanel(id, input) {
    const guild = ctx.requireGuild();
    const panel = getPanel(id);
    Object.assign(panel, cleanPanel({ ...panel, ...input }, guild));
    await publish(panel);
    ctx.store.save();
    ctx.log('info', `Roolipaneeli päivitetty: ${panel.title}`);
    return panel;
  }

  async function deletePanel(id) {
    const panel = getPanel(id);
    const guild = ctx.guild;
    if (guild && panel.messageId) {
      await guild.channels.cache.get(panel.publishedChannelId)?.messages.delete(panel.messageId).catch(() => {});
    }
    data().rolePanels = data().rolePanels.filter((p) => p.id !== id);
    ctx.store.save();
    ctx.log('info', `Roolipaneeli poistettu: ${panel.title}`);
  }

  function listPanels() {
    const guild = ctx.guild;
    return data().rolePanels.map((p) => ({
      ...p,
      channelName: guild?.channels.cache.get(p.channelId)?.name ?? null,
      options: p.options.map((o) => {
        const role = guild?.roles.cache.get(o.roleId);
        return { ...o, roleName: role?.name ?? null, members: role?.members.size ?? 0, missing: Boolean(guild && !role) };
      }),
    }));
  }

  // ---- Napin painallus ----
  async function onButton(i) {
    const [, panelId, roleId] = i.customId.split(':');
    const panel = data().rolePanels.find((p) => p.id === panelId);
    const option = panel?.options.find((o) => o.roleId === roleId);
    // Hyväksytään vain paneeliin tallennetut roolit – customId:hen ei luoteta sellaisenaan.
    if (!panel || !option) return i.reply({ content: 'Tämä roolipaneeli ei ole enää käytössä.', flags: MessageFlags.Ephemeral });

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    let role;
    try { role = assignable(i.guild, roleId); }
    catch (err) { return i.editReply(`❌ ${err.message}`); }
    const member = await i.guild.members.fetch(i.user.id);

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Liftup-botti: roolipaneeli');
      ctx.log('info', `Roolipaneeli: ${member.user.tag} poisti @${role.name}`);
      return i.editReply(`➖ Rooli **${role.name}** poistettu.`);
    }
    const removed = [];
    if (panel.mode === 'single') {
      const others = panel.options.map((o) => o.roleId).filter((r) => r !== role.id && member.roles.cache.has(r));
      if (others.length) {
        await member.roles.remove(others, 'Liftup-botti: roolipaneeli (vain yksi)');
        removed.push(...others.map((r) => i.guild.roles.cache.get(r)?.name).filter(Boolean));
      }
    }
    await member.roles.add(role, 'Liftup-botti: roolipaneeli');
    ctx.log('info', `Roolipaneeli: ${member.user.tag} otti @${role.name}`);
    return i.editReply(`✅ Sait roolin **${role.name}**.${removed.length ? ` (poistettu: ${removed.join(', ')})` : ''}`);
  }

  // ---- Jäsenten roolit käsin ----
  async function memberInfo(userId) {
    const guild = ctx.requireGuild();
    const m = await guild.members.fetch(userId).catch(() => null);
    if (!m) throw new HttpError(404, 'Jäsentä ei löytynyt');
    const top = guild.members.me.roles.highest.position;
    return {
      id: m.id,
      name: m.displayName,
      username: m.user.username,
      avatar: m.displayAvatarURL({ size: 128 }),
      joinedAt: m.joinedAt?.toISOString() ?? null,
      roles: [...m.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, editable: !r.managed && r.position < top })),
    };
  }

  /** Anna rooli yhdelle tai monelle: input = ID / nimi / lista (rivit tai pilkut). */
  async function giveRole(roleId, input) {
    const guild = ctx.requireGuild();
    const role = assignable(guild, roleId);
    const { ids, unresolved } = ctx.services.teams.resolveUsers(guild, input);
    const added = [];
    const failed = unresolved.map((u) => ({ user: u, reason: 'Käyttäjää ei löytynyt palvelimelta' }));
    for (const uid of ids) {
      try {
        const m = guild.members.cache.get(uid) ?? (await guild.members.fetch(uid));
        if (!m.roles.cache.has(role.id)) await m.roles.add(role, 'Liftup-botti: web-paneeli');
        added.push({ id: m.id, name: m.displayName });
      } catch (err) {
        failed.push({ user: uid, reason: err.message });
      }
    }
    if (added.length) ctx.log('info', `@${role.name} annettu: ${added.map((a) => a.name).join(', ')}`);
    return { added, failed, role: role.name };
  }

  async function takeRole(userId, roleId) {
    const guild = ctx.requireGuild();
    const role = assignable(guild, roleId);
    const m = await guild.members.fetch(userId).catch(() => null);
    if (!m) throw new HttpError(404, 'Jäsentä ei löytynyt');
    await m.roles.remove(role, 'Liftup-botti: web-paneeli');
    ctx.log('info', `@${role.name} poistettu: ${m.displayName}`);
  }

  return { createRole, createPanel, updatePanel, deletePanel, listPanels, onButton, memberInfo, giveRole, takeRole, isPanelButton: (id) => id.startsWith(`${PREFIX}:`) };
}
