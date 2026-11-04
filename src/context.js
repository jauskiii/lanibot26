export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_LOGS = 500;

/** Yhteinen tila, jonka kaikki palvelut jakavat. */
export function createContext(config, store) {
  const ctx = {
    config,
    store,
    client: null,
    startedAt: Date.now(),
    discordError: '',
    services: {},

    log(level, message, meta) {
      const entry = { at: new Date().toISOString(), level, message, ...(meta ? { meta } : {}) };
      store.data.logs.unshift(entry);
      if (store.data.logs.length > MAX_LOGS) store.data.logs.length = MAX_LOGS;
      store.save();
      const line = `[${entry.at}] ${level.toUpperCase()} ${message}`;
      if (level === 'error') console.error(line);
      else console.log(line);
    },

    get guild() {
      if (!ctx.client?.isReady()) return null;
      return ctx.client.guilds.cache.get(config.guildId) ?? null;
    },

    requireGuild() {
      const g = ctx.guild;
      if (!g) {
        throw new HttpError(503, ctx.discordError || 'Botti ei ole yhteydessä Discordiin (tarkista DISCORD_TOKEN ja GUILD_ID).');
      }
      return g;
    },
  };
  return ctx;
}
