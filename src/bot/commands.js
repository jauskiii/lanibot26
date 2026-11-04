import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { gameIcon, serverLine } from './announce.js';

const EPH = { flags: MessageFlags.Ephemeral };

export function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('tiimi')
      .setDescription('Turnaustiimien hallinta')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand((s) =>
        s.setName('lisää').setDescription('Lisää jäsen tiimiin')
          .addUserOption((o) => o.setName('jäsen').setDescription('Lisättävä jäsen').setRequired(true))
          .addStringOption((o) => o.setName('tiimi').setDescription('Tiimi').setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) =>
        s.setName('poista').setDescription('Poista jäsen tiimistä')
          .addUserOption((o) => o.setName('jäsen').setDescription('Poistettava jäsen').setRequired(true))
          .addStringOption((o) => o.setName('tiimi').setDescription('Tiimi').setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName('lista').setDescription('Näytä tiimit ja jäsenet'))
      .addSubcommand((s) =>
        s.setName('luo').setDescription('Luo tiimit kerralla (esim. Tiimi 1–4)')
          .addIntegerOption((o) => o.setName('määrä').setDescription('Montako tiimiä').setRequired(true).setMinValue(1).setMaxValue(32))
          .addStringOption((o) => o.setName('etuliite').setDescription('Nimen alku (oletus "Tiimi")'))
          .addBooleanOption((o) => o.setName('kanavat').setDescription('Luo jokaiselle oma teksti- ja puhekanava'))),

    new SlashCommandBuilder().setName('serverit').setDescription('Näytä LANien pelipalvelimet ja IP-osoitteet'),

    new SlashCommandBuilder()
      .setName('ip')
      .setDescription('Näytä yhden palvelimen osoite')
      .addStringOption((o) => o.setName('serveri').setDescription('Palvelin').setRequired(true).setAutocomplete(true)),

    new SlashCommandBuilder()
      .setName('mc')
      .setDescription('Minecraft-palvelin')
      .addSubcommand((s) => s.setName('status').setDescription('Onko serveri päällä ja ketä on paikalla'))
      .addSubcommand((s) =>
        s.setName('whitelist').setDescription('Lisää Minecraft-nimi whitelistille')
          .addStringOption((o) => o.setName('nimi').setDescription('Minecraft-käyttäjänimi').setRequired(true)))
      .addSubcommand((s) =>
        s.setName('komento').setDescription('Aja konsolikomento (vain ylläpito)')
          .addStringOption((o) => o.setName('komento').setDescription('esim. time set day').setRequired(true))),

    new SlashCommandBuilder()
      .setName('varoita')
      .setDescription('Anna käyttäjälle varoitus')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('jäsen').setDescription('Kenelle').setRequired(true))
      .addStringOption((o) => o.setName('syy').setDescription('Syy').setRequired(true)),

    new SlashCommandBuilder()
      .setName('varoitukset')
      .setDescription('Näytä käyttäjän varoitukset')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('jäsen').setDescription('Kenen').setRequired(true)),

    new SlashCommandBuilder()
      .setName('hiljennä')
      .setDescription('Hiljennä käyttäjä (timeout)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('jäsen').setDescription('Kuka').setRequired(true))
      .addIntegerOption((o) => o.setName('minuutit').setDescription('Kesto minuutteina').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption((o) => o.setName('syy').setDescription('Syy')),

    new SlashCommandBuilder()
      .setName('siivoa')
      .setDescription('Poista viimeisimmät viestit kanavalta')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) => o.setName('määrä').setDescription('1–100').setRequired(true).setMinValue(1).setMaxValue(100)),

    new SlashCommandBuilder()
      .setName('ilmoita')
      .setDescription('Lähetä nopea ilmoitus tälle kanavalle')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((o) => o.setName('teksti').setDescription('Ilmoituksen teksti').setRequired(true))
      .addStringOption((o) => o.setName('otsikko').setDescription('Otsikko'))
      .addBooleanOption((o) => o.setName('everyone').setDescription('Pingaa @everyone')),
  ].map((c) => c.toJSON());
}

export function commandHandler(ctx) {
  const { teams, announce, minecraft, moderation } = ctx.services;

  async function autocomplete(i) {
    const focused = i.options.getFocused(true);
    const q = String(focused.value).toLowerCase();
    let choices = [];
    if (focused.name === 'tiimi') choices = ctx.store.data.teams.map((t) => ({ name: t.name, value: t.id }));
    if (focused.name === 'serveri') choices = ctx.store.data.servers.map((s) => ({ name: `${s.name} (${s.game || 'peli'})`, value: s.id }));
    await i.respond(choices.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 25));
  }

  const handlers = {
    async tiimi(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'lista') {
        const list = teams.list();
        if (!list.length) return i.reply({ content: 'Ei tiimejä vielä.', ...EPH });
        const e = new EmbedBuilder().setTitle('🏆 Turnaustiimit').setColor(0xf1c40f);
        for (const t of list.slice(0, 25)) e.addFields({ name: `${t.name} (${t.members.length})`, value: t.members.map((m) => `<@${m.id}>`).join(' ').slice(0, 1024) || '–', inline: true });
        return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
      }
      if (sub === 'luo') {
        await i.deferReply(EPH);
        const created = await teams.generate({ count: i.options.getInteger('määrä'), prefix: i.options.getString('etuliite') || 'Tiimi', createChannels: i.options.getBoolean('kanavat') ?? false });
        return i.editReply(created.length ? `Luotu: ${created.map((t) => `<@&${t.roleId}>`).join(', ')}` : 'Kaikki tiimit olivat jo olemassa.');
      }
      const user = i.options.getUser('jäsen', true);
      const team = teams.find(i.options.getString('tiimi', true));
      if (!team) return i.reply({ content: 'Tiimiä ei löytynyt.', ...EPH });
      await i.deferReply(EPH);
      if (sub === 'lisää') {
        const r = await teams.addMembers(team.id, [user.id]);
        return i.editReply(r.added.length ? `✅ ${user} lisätty tiimiin **${team.name}**` : `❌ ${r.failed[0]?.reason ?? 'Ei onnistunut'}`);
      }
      if (sub === 'poista') {
        await teams.removeMember(team.id, user.id);
        return i.editReply(`✅ ${user} poistettu tiimistä **${team.name}**`);
      }
    },

    async serverit(i) {
      return i.reply({ embeds: [announce.serverListEmbed()] });
    },

    async ip(i) {
      const s = ctx.store.data.servers.find((x) => x.id === i.options.getString('serveri', true) || x.name.toLowerCase() === i.options.getString('serveri', true).toLowerCase());
      if (!s) return i.reply({ content: 'Palvelinta ei löytynyt.', ...EPH });
      return i.reply({ embeds: [new EmbedBuilder().setTitle(`${gameIcon(s.game)} ${s.name}`).setDescription(serverLine(s)).setColor(0x5865f2)] });
    },

    async mc(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'status') {
        await i.deferReply();
        return i.editReply({ embeds: [minecraft.statusEmbed(await minecraft.status({ fresh: true }))] });
      }
      if (sub === 'whitelist') {
        const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
        if (!ctx.store.data.minecraft.allowSelfWhitelist && !isAdmin) return i.reply({ content: 'Whitelistille lisääminen on vain ylläpidon käytössä.', ...EPH });
        await i.deferReply(EPH);
        const out = await minecraft.whitelist(i.options.getString('nimi', true), i.user.tag);
        return i.editReply(`⛏️ ${out || 'Lisätty.'}`);
      }
      if (sub === 'komento') {
        if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Vain ylläpitäjät.', ...EPH });
        await i.deferReply(EPH);
        const cmd = i.options.getString('komento', true);
        const out = await minecraft.rcon(cmd);
        ctx.log('info', `MC-komento (${i.user.tag}): ${cmd}`);
        return i.editReply(`\`\`\`\n${(out || '(ei tulostetta)').slice(0, 1900)}\n\`\`\``);
      }
    },

    async varoita(i) {
      await i.deferReply(EPH);
      const user = i.options.getUser('jäsen', true);
      const { count } = await moderation.warn(user.id, i.user.tag, i.options.getString('syy', true));
      return i.editReply(`⚠️ ${user} varoitettu. Varoituksia yhteensä: **${count}**`);
    },

    async varoitukset(i) {
      const user = i.options.getUser('jäsen', true);
      const list = moderation.warningsFor(user.id);
      if (!list.length) return i.reply({ content: `${user} ei ole saanut varoituksia.`, ...EPH });
      const lines = list.slice(0, 15).map((w) => `• <t:${Math.floor(new Date(w.at).getTime() / 1000)}:d> ${w.reason} — *${w.by}*`);
      return i.reply({ content: `**${user.username}: ${list.length} varoitusta**\n${lines.join('\n')}`, ...EPH, allowedMentions: { parse: [] } });
    },

    async hiljennä(i) {
      await i.deferReply(EPH);
      const member = await i.guild.members.fetch(i.options.getUser('jäsen', true).id);
      const min = i.options.getInteger('minuutit', true);
      await moderation.timeout(member, min, `${i.options.getString('syy') || 'Ei syytä'} (${i.user.tag})`);
      return i.editReply(`🔇 ${member} hiljennetty ${min} min.`);
    },

    async siivoa(i) {
      await i.deferReply(EPH);
      const deleted = await i.channel.bulkDelete(i.options.getInteger('määrä', true), true);
      ctx.log('info', `Siivous #${i.channel.name}: ${deleted.size} viestiä (${i.user.tag})`);
      return i.editReply(`🧹 Poistettu ${deleted.size} viestiä.`);
    },

    async ilmoita(i) {
      await i.deferReply(EPH);
      const r = await announce.send({
        channelId: i.channelId,
        title: i.options.getString('otsikko') || '',
        body: i.options.getString('teksti', true),
        mention: i.options.getBoolean('everyone') ? 'everyone' : 'none',
        by: i.user.tag,
      });
      return i.editReply(`📣 Lähetetty: ${r.url}`);
    },
  };

  return async function onInteraction(i) {
    if (i.guildId !== ctx.config.guildId) return;
    try {
      if (i.isAutocomplete()) return await autocomplete(i);
      if (!i.isChatInputCommand()) return;
      const h = handlers[i.commandName];
      if (h) await h(i);
    } catch (err) {
      ctx.log('error', `Komento /${i.commandName} epäonnistui: ${err.message}`);
      const msg = `❌ ${err.message}`;
      if (i.deferred || i.replied) await i.editReply(msg).catch(() => {});
      else if (i.isRepliable()) await i.reply({ content: msg, ...EPH }).catch(() => {});
    }
  };
}
