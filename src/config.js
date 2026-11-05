// Ympäristömuuttujat. Salaisuudet (tokenit, salasanat) tulevat VAIN täältä,
// kaikki muu säädetään web-paneelista ja tallennetaan data/db.json -tiedostoon.

const env = process.env;

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  discordToken: env.DISCORD_TOKEN || '',
  guildId: env.GUILD_ID || '',

  // Pterodactyl antaa portin SERVER_PORT-muuttujassa (allokaatio).
  webPort: int(env.WEB_PORT || env.SERVER_PORT, 8080),
  webHost: env.WEB_HOST || '0.0.0.0',
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionHours: int(env.SESSION_HOURS, 12),

  // Ulkoisille järjestelmille (esim. turnausjärjestelmä): Authorization: Bearer <API_TOKEN>
  apiToken: env.API_TOKEN || '',

  dataDir: env.DATA_DIR || './data',

  // Minecraft – nämä voi asettaa myös paneelista; env voittaa jos annettu.
  mcHost: env.MC_HOST || '',
  mcPort: int(env.MC_PORT, 0),
  mcRconPort: int(env.MC_RCON_PORT, 0),
  mcRconPassword: env.MC_RCON_PASSWORD || '',

  // Valinnainen Pterodactyl-integraatio (Client API -avain, alkaa ptlc_)
  // "192.168.1.5" → "http://192.168.1.5": ilman http(s)://-alkua fetch ei osaa lukea osoitetta.
  pteroUrl: (() => { const u = (env.PTERO_URL || '').trim().replace(/\/+$/, ''); return u && !/^https?:\/\//i.test(u) ? `http://${u}` : u; })(),
  pteroApiKey: env.PTERO_API_KEY || '',
};

export function validateConfig(log) {
  const problems = [];
  if (!config.discordToken) problems.push('DISCORD_TOKEN puuttuu – botti ei kirjaudu Discordiin (web-paneeli toimii silti).');
  if (!config.guildId) problems.push('GUILD_ID puuttuu – botti ei tiedä, mitä Discord-palvelinta hallitaan.');
  if (!config.adminPassword) problems.push('ADMIN_PASSWORD puuttuu – web-paneeliin ei voi kirjautua ennen kuin se asetetaan.');
  else if (config.adminPassword.length < 10) problems.push('ADMIN_PASSWORD on lyhyt – käytä vähintään 10 merkkiä.');
  for (const p of problems) log('warn', p);
  return problems;
}
