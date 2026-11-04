import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { buildCommands, buildGlobalCommands, commandHandler } from './commands.js';

export async function registerCommands(ctx) {
  const guild = ctx.requireGuild();
  const cmds = await guild.commands.set(buildCommands());
  let global = 0;
  try {
    // Globaali /liftup: tästä tulee profiiliin "Supports Commands" (ja Active Developer -merkin edellytys).
    global = (await ctx.client.application.commands.set(buildGlobalCommands())).size;
  } catch (err) {
    ctx.log('warn', `Globaalin /liftup-komennon rekisteröinti epäonnistui: ${err.message}`);
  }
  ctx.log('info', `Slash-komennot rekisteröity (${cmds.size} palvelimelle, ${global} globaali)`);
  return cmds.size + global;
}

export function setPresence(ctx) {
  const text = ctx.store.data.settings.presenceText;
  ctx.client?.user?.setPresence({ activities: text ? [{ name: text, type: ActivityType.Playing }] : [], status: 'online' });
}

export async function startBot(ctx) {
  if (!ctx.config.discordToken) {
    ctx.discordError = 'DISCORD_TOKEN puuttuu – botti ei ole kirjautunut.';
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // etuoikeutettu: ota käyttöön Developer Portalissa
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // etuoikeutettu: tarvitaan automodiin
    ],
  });
  ctx.client = client;

  const { moderation, announce, minecraft } = ctx.services;

  client.once(Events.ClientReady, async (c) => {
    ctx.log('info', `Kirjauduttu: ${c.user.tag}`);
    const guild = c.guilds.cache.get(ctx.config.guildId);
    if (!guild) {
      ctx.discordError = `Botti ei ole palvelimella ${ctx.config.guildId}. Kutsu botti palvelimelle tai korjaa GUILD_ID.`;
      ctx.log('error', ctx.discordError);
      return;
    }
    ctx.discordError = '';
    try {
      await guild.members.fetch(); // jäsenlista välimuistiin (haku nimellä web-paneelissa)
      await registerCommands(ctx);
    } catch (err) {
      ctx.log('error', `Käynnistys palvelimella epäonnistui: ${err.message}`);
    }
    setPresence(ctx);
    minecraft.start();
    announce.updateServerList().catch(() => {});
  });

  client.on(Events.InteractionCreate, commandHandler(ctx));
  client.on(Events.MessageCreate, (m) => moderation.onMessage(m).catch((e) => ctx.log('error', `Automod: ${e.message}`)));
  client.on(Events.GuildMemberAdd, (m) => moderation.onMemberAdd(m).catch(() => {}));
  client.on(Events.GuildMemberRemove, (m) => moderation.onMemberRemove(m).catch(() => {}));
  client.on(Events.Error, (e) => ctx.log('error', `Discord: ${e.message}`));
  client.on(Events.ShardDisconnect, () => ctx.log('warn', 'Yhteys Discordiin katkesi, yhdistetään uudelleen…'));

  setInterval(() => announce.tick().catch((e) => ctx.log('error', `Ajastin: ${e.message}`)), 15_000);

  try {
    await client.login(ctx.config.discordToken);
  } catch (err) {
    ctx.discordError =
      /disallowed intents/i.test(err.message)
        ? 'Discord hylkäsi intentit: ota "Server Members Intent" ja "Message Content Intent" käyttöön Developer Portalissa (Bot-välilehti).'
        : `Kirjautuminen Discordiin epäonnistui: ${err.message}`;
    ctx.log('error', ctx.discordError);
  }
}
