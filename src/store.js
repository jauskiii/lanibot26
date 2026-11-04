import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const newId = () => crypto.randomBytes(5).toString('hex');

const defaults = () => ({
  version: 1,
  settings: {
    announceChannelId: '',
    modLogChannelId: '',
    welcomeChannelId: '',
    welcomeMessage: 'Tervetuloa {user} **{server}**-palvelimelle! 🎮',
    autoRoleId: '',
    serverListChannelId: '',
    serverListMessageId: '',
    presenceText: 'Liftup LAN',
    exclusiveTeams: true, // jäsen voi olla vain yhdessä turnaustiimissä kerrallaan
    teamCategoryId: '',
    teamCategoryName: 'Turnaus',
  },
  teams: [],
  servers: [],
  announcements: { scheduled: [], history: [] },
  moderation: {
    enabled: true,
    bannedWords: [],
    blockInvites: true,
    blockLinks: false,
    exemptRoleIds: [],
    spamEnabled: true,
    spamMaxMessages: 6,
    spamWindowSeconds: 8,
    spamTimeoutMinutes: 5,
    warnThreshold: 3,
    warnTimeoutMinutes: 30,
    warnings: [],
  },
  minecraft: {
    host: '',
    port: 25565,
    rconPort: 25575,
    rconPassword: '',
    statusEnabled: false,
    statusChannelId: '',
    statusMessageId: '',
    allowSelfWhitelist: true,
  },
  logs: [],
});

export class Store {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.file = path.join(this.dir, 'db.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.data = this.#load();
    this.timer = null;
  }

  #load() {
    const base = defaults();
    if (!fs.existsSync(this.file)) return base;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Yhdistä oletuksiin, jotta uudet kentät ilmestyvät päivityksissä.
      for (const [k, v] of Object.entries(base)) {
        if (raw[k] === undefined) raw[k] = v;
        else if (v && typeof v === 'object' && !Array.isArray(v)) raw[k] = { ...v, ...raw[k] };
      }
      return raw;
    } catch (err) {
      const backup = `${this.file}.broken-${Date.now()}`;
      fs.copyFileSync(this.file, backup);
      console.error(`[store] db.json oli rikki, varmuuskopio: ${backup}`, err);
      return base;
    }
  }

  /** Tallennus pienellä viiveellä, jotta useat muutokset kirjoitetaan kerralla. */
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
