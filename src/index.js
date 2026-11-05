import { config, validateConfig } from './config.js';
import { Store } from './store.js';
import { createContext } from './context.js';
import { teamService } from './bot/teams.js';
import { announceService } from './bot/announce.js';
import { minecraftService } from './bot/minecraft.js';
import { moderationService } from './bot/moderation.js';
import { pteroService } from './bot/pterodactyl.js';
import { roleService } from './bot/roles.js';
import { presenceService } from './bot/presence.js';
import { startBot } from './bot/client.js';
import { startWeb } from './web/server.js';

const store = new Store(config.dataDir);
const ctx = createContext(config, store);

ctx.services.teams = teamService(ctx);
ctx.services.announce = announceService(ctx);
ctx.services.minecraft = minecraftService(ctx);
ctx.services.moderation = moderationService(ctx);
ctx.services.ptero = pteroService(ctx);
ctx.services.roles = roleService(ctx);
ctx.services.presence = presenceService(ctx);

ctx.log('info', 'Liftup-botti käynnistyy…');
validateConfig(ctx.log);

const server = startWeb(ctx);
startBot(ctx);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  ctx.log('info', `Sammutetaan (${signal})…`);
  try { store.flush(); } catch {}
  server.close();
  await ctx.client?.destroy().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => ctx.log('error', `Käsittelemätön virhe: ${err?.message ?? err}`));

// Pterodactyl lähettää stop-komennon stdiniin ("^C" muunnetaan SIGINTiksi, mutta varmuuden vuoksi):
if (!process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { if (/^(stop|exit|quit)\s*$/i.test(String(d).trim())) shutdown('stdin'); });
  process.stdin.on('error', () => {});
}
