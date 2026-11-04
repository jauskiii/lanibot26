import net from 'node:net';
import { EmbedBuilder } from 'discord.js';
import { Rcon } from 'rcon-client';
import { HttpError } from '../context.js';

// ---- Minecraft Server List Ping (Java 1.7+) ilman ulkoisia kirjastoja ----
function varInt(n) {
  const out = [];
  n >>>= 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function readVarInt(buf, offset) {
  let result = 0, shift = 0, pos = offset;
  while (true) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: result, size: pos - offset };
    shift += 7;
    if (shift > 35) throw new Error('VarInt liian pitkä');
  }
}

const packet = (id, payload) => {
  const body = Buffer.concat([varInt(id), payload]);
  return Buffer.concat([varInt(body.length), body]);
};

const mcString = (s) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varInt(b.length), b]);
};

export function pingMinecraft(host, port = 25565, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    const fail = (err) => { sock.destroy(); reject(err); };
    sock.setTimeout(timeoutMs, () => fail(new Error('Aikakatkaisu')));
    sock.on('error', fail);
    sock.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      sock.write(packet(0x00, Buffer.concat([varInt(767), mcString(host), portBuf, varInt(1)])));
      sock.write(packet(0x00, Buffer.alloc(0)));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarInt(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        let off = len.size;
        const id = readVarInt(buf, off); off += id.size;
        const strLen = readVarInt(buf, off); off += strLen.size;
        const json = JSON.parse(buf.subarray(off, off + strLen.value).toString('utf8'));
        sock.end();
        resolve({ ...json, latency: Date.now() - started });
      } catch (err) {
        fail(err);
      }
    });
  });
}

const motdText = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.replace(/§./g, '');
  return ((d.text || '') + (d.extra || []).map(motdText).join('')).replace(/§./g, '');
};

// ---- Palvelu ----
export function minecraftService(ctx) {
  const cfg = () => {
    const m = ctx.store.data.minecraft;
    return {
      ...m,
      host: ctx.config.mcHost || m.host,
      port: ctx.config.mcPort || Number(m.port) || 25565,
      rconPort: ctx.config.mcRconPort || Number(m.rconPort) || 25575,
      rconPassword: ctx.config.mcRconPassword || m.rconPassword,
    };
  };

  let cache = { at: 0, value: null };
  let timer = null;

  async function status({ fresh = false } = {}) {
    const c = cfg();
    if (!c.host) return { configured: false, online: false };
    if (!fresh && cache.value && Date.now() - cache.at < 15_000) return cache.value;
    let value;
    try {
      const r = await pingMinecraft(c.host, c.port);
      value = {
        configured: true,
        online: true,
        address: c.port === 25565 ? c.host : `${c.host}:${c.port}`,
        version: r.version?.name ?? '',
        motd: motdText(r.description),
        players: { online: r.players?.online ?? 0, max: r.players?.max ?? 0, sample: (r.players?.sample ?? []).map((p) => p.name) },
        latency: r.latency,
      };
    } catch (err) {
      value = { configured: true, online: false, address: c.host, error: err.message };
    }
    cache = { at: Date.now(), value };
    return value;
  }

  async function rcon(command) {
    const c = cfg();
    if (!c.host || !c.rconPassword) throw new HttpError(400, 'RCON ei ole määritetty (osoite ja RCON-salasana tarvitaan)');
    command = String(command || '').replace(/[\r\n]+/g, ' ').trim().replace(/^\//, '');
    if (!command) throw new HttpError(400, 'Komento puuttuu');
    let client;
    try {
      client = await Rcon.connect({ host: c.host, port: c.rconPort, password: c.rconPassword, timeout: 5000 });
      const out = await client.send(command);
      return out.replace(/§./g, '');
    } catch (err) {
      throw new HttpError(502, `RCON-virhe: ${err.message}`);
    } finally {
      client?.end().catch(() => {});
    }
  }

  async function whitelist(nick, by = 'web') {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick || '')) throw new HttpError(400, 'Virheellinen Minecraft-nimi (3–16 merkkiä, A–Z, 0–9, _)');
    const out = await rcon(`whitelist add ${nick}`);
    ctx.log('info', `MC whitelist: ${nick} (${by}) → ${out}`);
    return out;
  }

  const say = (message) => rcon(`say ${String(message).slice(0, 200)}`);

  function statusEmbed(st) {
    const e = new EmbedBuilder().setTitle('⛏️ Minecraft-palvelin').setTimestamp(new Date()).setFooter({ text: 'Päivittyy minuutin välein' });
    if (!st.configured) return e.setColor(0x99aab5).setDescription('Ei määritetty.');
    if (!st.online) return e.setColor(0xe74c3c).setDescription(`🔴 **Offline**\n\`${st.address}\``);
    e.setColor(0x2ecc71).setDescription(`🟢 **Online** — \`${st.address}\`\n${st.motd || ''}`.trim())
      .addFields(
        { name: 'Pelaajat', value: `${st.players.online}/${st.players.max}`, inline: true },
        { name: 'Versio', value: st.version || '–', inline: true },
      );
    if (st.players.sample.length) e.addFields({ name: 'Paikalla', value: st.players.sample.slice(0, 30).join(', ').slice(0, 1024) });
    return e;
  }

  async function updateStatusMessage() {
    const m = ctx.store.data.minecraft;
    const guild = ctx.guild;
    if (!guild || !m.statusEnabled || !m.statusChannelId) return;
    const channel = guild.channels.cache.get(m.statusChannelId);
    if (!channel?.isTextBased()) return;
    const st = await status({ fresh: true });
    const payload = { embeds: [statusEmbed(st)] };
    if (m.statusMessageId) {
      const msg = await channel.messages.fetch(m.statusMessageId).catch(() => null);
      if (msg) return void (await msg.edit(payload).catch(() => {}));
    }
    const msg = await channel.send(payload);
    m.statusMessageId = msg.id;
    ctx.store.save();
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => updateStatusMessage().catch((e) => ctx.log('warn', `MC-tilaviesti: ${e.message}`)), 60_000);
    updateStatusMessage().catch(() => {});
  }

  return { status, rcon, whitelist, say, statusEmbed, updateStatusMessage, start };
}
