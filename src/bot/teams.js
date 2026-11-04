import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { HttpError } from '../context.js';
import { newId } from '../store.js';

const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ec407a', '#95a5a6', '#34495e', '#00bcd4', '#8bc34a'];

const hexToInt = (hex) => Number.parseInt(String(hex || '#99aab5').replace('#', ''), 16) || 0x99aab5;
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 90) || 'tiimi';

export function teamService(ctx) {
  const data = () => ctx.store.data;
  const settings = () => data().settings;

  function find(idOrName) {
    const key = String(idOrName).toLowerCase();
    return data().teams.find((t) => t.id === idOrName || t.name.toLowerCase() === key || t.roleId === idOrName);
  }

  function get(id) {
    const t = find(id);
    if (!t) throw new HttpError(404, 'Tiimiä ei löytynyt');
    return t;
  }

  async function ensureRole(guild, team) {
    if (team.roleId) {
      const existing = guild.roles.cache.get(team.roleId) ?? (await guild.roles.fetch(team.roleId).catch(() => null));
      if (existing) return existing;
    }
    const role = await guild.roles.create({
      name: team.name,
      colors: { primaryColor: hexToInt(team.color) },
      hoist: true,
      mentionable: true,
      reason: 'Liftup-botti: turnaustiimi',
    });
    team.roleId = role.id;
    team.ownsRole = true;
    return role;
  }

  async function ensureCategory(guild) {
    const s = settings();
    if (s.teamCategoryId) {
      const c = guild.channels.cache.get(s.teamCategoryId);
      if (c) return c;
    }
    const cat = await guild.channels.create({
      name: s.teamCategoryName || 'Turnaus',
      type: ChannelType.GuildCategory,
      reason: 'Liftup-botti: turnauskanavat',
    });
    s.teamCategoryId = cat.id;
    ctx.store.save();
    return cat;
  }

  async function ensureChannels(guild, team, role) {
    const cat = await ensureCategory(guild);
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect] },
    ];
    if (!team.textChannelId || !guild.channels.cache.has(team.textChannelId)) {
      const tc = await guild.channels.create({ name: slug(team.name), type: ChannelType.GuildText, parent: cat.id, permissionOverwrites: overwrites });
      team.textChannelId = tc.id;
    }
    if (!team.voiceChannelId || !guild.channels.cache.has(team.voiceChannelId)) {
      const vc = await guild.channels.create({ name: `🔊 ${team.name}`, type: ChannelType.GuildVoice, parent: cat.id, permissionOverwrites: overwrites });
      team.voiceChannelId = vc.id;
    }
  }

  async function create({ name, color, roleId, createChannels = false }) {
    const guild = ctx.requireGuild();
    name = String(name || '').trim();
    if (!name) throw new HttpError(400, 'Tiimin nimi puuttuu');
    if (find(name)) throw new HttpError(409, `Tiimi "${name}" on jo olemassa`);
    const team = {
      id: newId(),
      name,
      color: color || PALETTE[data().teams.length % PALETTE.length],
      roleId: roleId || '',
      ownsRole: false,
      textChannelId: '',
      voiceChannelId: '',
      createdAt: new Date().toISOString(),
    };
    const role = await ensureRole(guild, team);
    if (createChannels) await ensureChannels(guild, team, role);
    data().teams.push(team);
    ctx.store.save();
    ctx.log('info', `Tiimi luotu: ${team.name} (rooli ${role.name})`);
    return team;
  }

  async function generate({ count = 4, prefix = 'Tiimi', startAt = 1, createChannels = false }) {
    count = Math.min(Math.max(Number(count) || 0, 1), 32);
    const created = [];
    for (let i = 0; i < count; i++) {
      const name = `${prefix} ${Number(startAt) + i}`.trim();
      if (find(name)) continue;
      created.push(await create({ name, createChannels }));
    }
    return created;
  }

  async function update(id, { name, color }) {
    const guild = ctx.requireGuild();
    const team = get(id);
    const oldName = team.name;
    if (name && name.trim() !== team.name) {
      const clash = find(name.trim());
      if (clash && clash.id !== team.id) throw new HttpError(409, 'Saman niminen tiimi on jo olemassa');
      team.name = String(name).trim();
    }
    if (color) team.color = color;
    const role = await ensureRole(guild, team);
    await role.edit({ name: team.name, colors: { primaryColor: hexToInt(team.color) }, reason: 'Liftup-botti: tiimin muokkaus' });
    ctx.store.save();

    // Kanavien nimet perässä. Discord sallii vain 2 nimenvaihtoa / kanava / 10 min,
    // joten ajetaan taustalla, ettei web-paneeli jää odottamaan rajoituksen loppumista.
    let channelsRenaming = false;
    if (team.name !== oldName) {
      const renames = [
        [team.textChannelId, slug(team.name)],
        [team.voiceChannelId, `🔊 ${team.name}`],
      ]
        .map(([cid, newName]) => [guild.channels.cache.get(cid), newName])
        .filter(([ch, newName]) => ch && ch.name !== newName);
      if (renames.length) {
        channelsRenaming = true;
        Promise.all(renames.map(([ch, newName]) => ch.setName(newName, 'Liftup-botti: tiimi nimettiin uudelleen')))
          .then(() => ctx.log('info', `${oldName} → ${team.name}: kanavat nimetty uudelleen`))
          .catch((err) => ctx.log('error', `${team.name}: kanavien nimenvaihto epäonnistui: ${err.message}`));
      }
      ctx.log('info', `Tiimi nimetty uudelleen: ${oldName} → ${team.name}`);
    }
    return { ...team, channelsRenaming };
  }

  async function remove(id, { deleteRole = true, deleteChannels = true } = {}) {
    const guild = ctx.requireGuild();
    const team = get(id);
    if (deleteChannels) {
      for (const cid of [team.textChannelId, team.voiceChannelId]) {
        if (cid) await guild.channels.cache.get(cid)?.delete('Liftup-botti: tiimi poistettu').catch(() => {});
      }
    }
    const role = team.roleId ? guild.roles.cache.get(team.roleId) : null;
    if (role) {
      if (deleteRole && team.ownsRole) await role.delete('Liftup-botti: tiimi poistettu').catch(() => {});
      else await clear(team.id);
    }
    data().teams = data().teams.filter((t) => t.id !== team.id);
    ctx.store.save();
    ctx.log('info', `Tiimi poistettu: ${team.name}`);
  }

  /**
   * Muuttaa vapaamuotoisen listan (rivit/pilkut) jäsen-ID:iksi.
   * Hyväksyy: <@123>, 123456789012345678, käyttäjänimen, näyttönimen tai palvelinnimimerkin.
   */
  function resolveUsers(guild, input) {
    const tokens = (Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/))
      .map((t) => String(t).trim().replace(/^@/, ''))
      .filter(Boolean);
    const ids = new Set();
    const unresolved = [];
    const members = [...guild.members.cache.values()];
    for (const tok of tokens) {
      const mention = tok.match(/^<@!?(\d{17,20})>$/);
      if (mention) { ids.add(mention[1]); continue; }
      if (/^\d{17,20}$/.test(tok)) { ids.add(tok); continue; }
      const low = tok.toLowerCase();
      const hit =
        members.find((m) => m.user.username.toLowerCase() === low) ||
        members.find((m) => m.user.tag.toLowerCase() === low) ||
        members.find((m) => m.displayName.toLowerCase() === low) ||
        members.find((m) => (m.user.globalName || '').toLowerCase() === low);
      if (hit) ids.add(hit.id);
      else unresolved.push(tok);
    }
    return { ids: [...ids], unresolved };
  }

  async function addMembers(id, input) {
    const guild = ctx.requireGuild();
    const team = get(id);
    const role = await ensureRole(guild, team);
    const { ids, unresolved } = resolveUsers(guild, input);
    const added = [];
    const failed = unresolved.map((u) => ({ user: u, reason: 'Käyttäjää ei löytynyt palvelimelta' }));
    const otherRoleIds = settings().exclusiveTeams
      ? data().teams.filter((t) => t.id !== team.id && t.roleId).map((t) => t.roleId)
      : [];

    for (const uid of ids) {
      try {
        const member = guild.members.cache.get(uid) ?? (await guild.members.fetch(uid));
        const toRemove = otherRoleIds.filter((r) => member.roles.cache.has(r));
        if (toRemove.length) await member.roles.remove(toRemove, 'Liftup-botti: vaihtoi tiimiä');
        if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Liftup-botti: lisätty tiimiin');
        added.push({ id: member.id, name: member.displayName });
      } catch (err) {
        failed.push({ user: uid, reason: err.code === 50013 ? 'Botilta puuttuu oikeus (roolin pitää olla botin roolin alapuolella)' : err.message });
      }
    }
    ctx.store.save();
    if (added.length) ctx.log('info', `${team.name}: lisätty ${added.map((a) => a.name).join(', ')}`);
    return { added, failed };
  }

  async function removeMember(id, userId) {
    const guild = ctx.requireGuild();
    const team = get(id);
    if (!team.roleId) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.remove(team.roleId, 'Liftup-botti: poistettu tiimistä');
    ctx.log('info', `${team.name}: poistettu ${member?.displayName ?? userId}`);
  }

  async function clear(id) {
    const guild = ctx.requireGuild();
    const team = get(id);
    const role = team.roleId ? guild.roles.cache.get(team.roleId) : null;
    if (!role) return 0;
    const members = [...role.members.values()];
    for (const m of members) await m.roles.remove(role, 'Liftup-botti: tiimi tyhjennetty').catch(() => {});
    ctx.log('info', `${team.name}: tyhjennetty (${members.length} jäsentä)`);
    return members.length;
  }

  async function resetAll({ deleteTeams = false } = {}) {
    const teams = [...data().teams];
    let cleared = 0;
    for (const t of teams) {
      if (deleteTeams) await remove(t.id);
      else cleared += await clear(t.id);
    }
    return { cleared, deleted: deleteTeams ? teams.length : 0 };
  }

  /**
   * Turnausjärjestelmän tuonti:
   * { teams: [{ name, color?, members: ["discordId" | "käyttäjänimi"] }], replace?: true, createChannels?: false }
   */
  async function importTeams({ teams = [], replace = true, createChannels = false }) {
    if (!Array.isArray(teams) || !teams.length) throw new HttpError(400, 'teams-lista puuttuu');
    const result = [];
    for (const t of teams) {
      let team = find(t.name);
      if (!team) team = await create({ name: t.name, color: t.color, createChannels });
      else if (createChannels) await ensureChannels(ctx.requireGuild(), team, await ensureRole(ctx.requireGuild(), team));
      if (replace) await clear(team.id);
      const r = await addMembers(team.id, t.members || []);
      result.push({ team: team.name, ...r });
    }
    return result;
  }

  function list() {
    const guild = ctx.guild;
    return data().teams.map((t) => {
      const role = guild && t.roleId ? guild.roles.cache.get(t.roleId) : null;
      return {
        ...t,
        roleName: role?.name ?? null,
        roleMissing: Boolean(guild && t.roleId && !role),
        members: role
          ? [...role.members.values()].map((m) => ({ id: m.id, name: m.displayName, username: m.user.username, avatar: m.displayAvatarURL({ size: 64 }) }))
          : [],
      };
    });
  }

  return { list, find, get, create, generate, update, remove, addMembers, removeMember, clear, resetAll, importTeams, resolveUsers };
}
