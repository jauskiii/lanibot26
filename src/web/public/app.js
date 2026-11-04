// Liftup LAN – web-paneeli (vanilla JS, ei ulkoisia riippuvuuksia)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const view = $('#view');

// ---------------- Perusapuvälineet ----------------
async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Kirjaudu sisään'); }
  if (!res.ok) throw new Error(data.error || `Virhe ${res.status}`);
  return data;
}

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), err ? 7000 : 3500);
}

async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

const formData = (form) => {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi) (out[el.name] ||= []).push(...(el.checked ? [el.value] : []));
      else out[el.name] = el.checked;
    } else if (el.multiple) out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else out[el.name] = el.value;
  }
  return out;
};

const fmtTime = (iso) => new Date(iso).toLocaleString('fi-FI', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const uptime = (s) => (s > 86400 ? `${Math.floor(s / 86400)} pv ${Math.floor((s % 86400) / 3600)} h` : s > 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);

function modal(html, onSubmit) {
  const dlg = $('#modal');
  const body = $('#modal-body');
  body.innerHTML = html;
  body.onsubmit = async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const ok = await onSubmit(formData(body), e.submitter);
    if (ok !== false) dlg.close();
  };
  dlg.showModal();
  body.querySelector('input,textarea,select')?.focus();
}

function confirmModal(text, okLabel = 'Vahvista') {
  return new Promise((resolve) => {
    modal(`<h2>${esc(text)}</h2><div class="row"><button class="btn danger" value="ok">${esc(okLabel)}</button><button class="btn ghost" value="cancel">Peruuta</button></div>`, () => resolve(true));
    $('#modal').addEventListener('close', () => resolve(false), { once: true });
  });
}

// ---------------- Discord-tiedot (välimuisti) ----------------
let guild = null;
let status = null;
async function loadGuild(force = false) {
  if (guild && !force) return guild;
  try { guild = await api('GET', '/guild'); }
  catch { guild = { roles: [], channels: [], members: [], offline: true }; }
  return guild;
}

const channelOptions = (sel, empty = '— ei valittu —') =>
  `<option value="">${esc(empty)}</option>` +
  guild.channels.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>#${esc(c.name)}${c.parent ? ` · ${esc(c.parent)}` : ''}</option>`).join('');

const roleOptions = (sel, empty = '— ei valittu —') =>
  `<option value="">${esc(empty)}</option>` +
  guild.roles.filter((r) => !r.managed).map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>@${esc(r.name)}</option>`).join('');

const memberLabel = (m) => `${m.name} (@${m.username})`;
const memberDatalist = () =>
  `<datalist id="members">${guild.members.map((m) => `<option value="${esc(memberLabel(m))}"></option>`).join('')}</datalist>`;
const memberIdFromLabel = (val) => guild.members.find((m) => memberLabel(m) === val)?.id ?? val;

function offlineBanner() {
  if (status?.bot?.online && status?.guild) return '';
  const msg = status?.bot?.error || 'Botti ei ole yhteydessä Discordiin.';
  return `<div class="banner bad">⚠ ${esc(msg)} Discordiin liittyvät toiminnot eivät toimi ennen kuin yhteys on kunnossa.</div>`;
}

async function refreshStatus() {
  try {
    status = await api('GET', '/status');
    const pill = $('#bot-pill');
    if (status.bot.online && status.guild) { pill.className = 'pill ok'; pill.textContent = status.bot.tag; }
    else if (status.bot.online) { pill.className = 'pill warn'; pill.textContent = 'Ei palvelinta'; }
    else { pill.className = 'pill bad'; pill.textContent = 'Offline'; }
  } catch {}
  return status;
}

// ---------------- Näkymät ----------------
const views = {};

views.yleiskatsaus = async () => {
  await refreshStatus();
  const [logs] = await Promise.all([api('GET', '/logs')]);
  const s = status;
  const mc = s.minecraft;
  view.innerHTML = `
    <h1>Yleiskatsaus</h1>
    <p class="sub">Liftup LANien Discord-botti – käynnissä ${uptime(s.uptime)}</p>
    ${offlineBanner()}
    <div class="grid cols-4">
      <div class="card stat"><div class="label">Botti</div><div class="value">${s.bot.online ? 'Online' : 'Offline'}</div><div class="hint">${esc(s.bot.tag || '–')}</div></div>
      <div class="card stat"><div class="label">Discord</div><div class="value">${s.guild ? s.guild.members : '–'}</div><div class="hint">${esc(s.guild?.name || 'ei yhteyttä')} · jäsentä</div></div>
      <div class="card stat"><div class="label">Tiimit</div><div class="value">${s.teams}</div><div class="hint">${s.servers} serveriä · ${s.scheduled} ajastettua ilmoitusta</div></div>
      <div class="card stat"><div class="label">Minecraft</div><div class="value">${!mc.configured ? '–' : mc.online ? `${mc.players.online}/${mc.players.max}` : 'Offline'}</div><div class="hint">${!mc.configured ? 'ei määritetty' : esc(mc.address)}</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h2>Pikatoiminnot</h2>
        <div class="row">
          <a class="btn primary" href="#tiimit">Turnaustiimit</a>
          <a class="btn" href="#ilmoitukset">Uusi ilmoitus</a>
          <a class="btn" href="#serverit">Serverit &amp; IP:t</a>
          <a class="btn" href="#minecraft">MC-konsoli</a>
        </div>
      </div>
      <div class="card">
        <div class="row between"><h2>Viimeisimmät tapahtumat</h2><a href="#loki" class="small">Koko loki →</a></div>
        <div class="log">${logs.slice(0, 8).map(logRow).join('') || '<p class="empty">Ei tapahtumia.</p>'}</div>
      </div>
    </div>`;
};

const logRow = (l) => `<div><span class="t">${fmtTime(l.at)}</span><span class="lv-${l.level}">${l.level}</span><span>${esc(l.message)}</span></div>`;

// ---- Tiimit ----
views.tiimit = async () => {
  await Promise.all([refreshStatus(), loadGuild(true)]);
  const teams = await api('GET', '/teams');
  view.innerHTML = `
    <h1>Turnaustiimit</h1>
    <p class="sub">Tiimit ovat Discord-rooleja. Jäsenen lisääminen tässä antaa roolin heti.</p>
    ${offlineBanner()}
    <form id="gen" class="card toolbar">
      <label>Määrä<input name="count" type="number" min="1" max="32" value="4" style="width:80px"></label>
      <label>Etuliite<input name="prefix" value="Tiimi" style="width:140px"></label>
      <label class="check" style="align-self:end;margin-bottom:9px"><input type="checkbox" name="createChannels"> Omat kanavat</label>
      <button class="btn primary" style="align-self:end">Luo tiimit</button>
      <span class="spacer"></span>
      <button type="button" class="btn" data-a="new" style="align-self:end">+ Yksittäinen tiimi</button>
      <button type="button" class="btn" data-a="import" style="align-self:end">Tuo JSON</button>
    </form>
    ${memberDatalist()}
    <div class="grid cols-teams" id="teams">
      ${teams.map(teamCard).join('') || '<div class="card empty">Ei tiimejä. Luo esim. 4 tiimiä yllä olevalla lomakkeella.</div>'}
    </div>
    ${teams.length ? `<div class="toolbar" style="margin-top:24px"><span class="spacer"></span>
      <button class="btn" data-a="reset">Tyhjennä kaikki tiimit</button>
      <button class="btn danger" data-a="deleteAll">Poista kaikki tiimit ja roolit</button></div>` : ''}`;

  $('#gen').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    await act(e.submitter, () => api('POST', '/teams/generate', d), (r) => `Luotu ${r.length} tiimiä`);
    views.tiimit();
  };

  view.onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const id = b.closest('[data-team]')?.dataset.team;
    const team = teams.find((t) => t.id === id);
    switch (b.dataset.a) {
      case 'new':
        return modal(`<h2>Uusi tiimi</h2>
          <label>Nimi<input name="name" required></label>
          <label>Väri<input name="color" type="color" value="#c6f432"></label>
          <label>Käytä olemassa olevaa roolia (valinnainen)<select name="roleId">${roleOptions('', '— luo uusi rooli —')}</select></label>
          <label class="check"><input type="checkbox" name="createChannels"> Luo oma teksti- ja puhekanava</label>
          <div class="row"><button class="btn primary">Luo</button><button class="btn ghost" value="cancel">Peruuta</button></div>`,
          async (d, btn) => { const r = await act(btn, () => api('POST', '/teams', d), 'Tiimi luotu'); if (!r) return false; views.tiimit(); });
      case 'import':
        return modal(`<h2>Tuo tiimit (JSON)</h2>
          <p class="muted small">Sama muoto kuin turnausjärjestelmän rajapinnassa. Jäsenet: Discord-ID tai käyttäjänimi.</p>
          <textarea name="json" class="mono" style="min-height:200px">{
  "replace": true,
  "teams": [
    { "name": "Tiimi 1", "members": ["kayttaja1", "123456789012345678"] },
    { "name": "Tiimi 2", "members": [] }
  ]
}</textarea>
          <div class="row"><button class="btn primary">Tuo</button><button class="btn ghost" value="cancel">Peruuta</button></div>`,
          async (d, btn) => {
            let body;
            try { body = JSON.parse(d.json); } catch { toast('Virheellinen JSON', true); return false; }
            const r = await act(btn, () => api('POST', '/teams/import', body));
            if (!r) return false;
            const failed = r.flatMap((x) => x.failed.map((f) => `${x.team}: ${f.user}`));
            toast(`Tuotu ${r.length} tiimiä${failed.length ? ` – ei löytynyt: ${failed.join(', ')}` : ''}`, failed.length > 0);
            views.tiimit();
          });
      case 'edit':
        return modal(`<h2>Muokkaa tiimiä</h2>
          <label>Nimi<input name="name" value="${esc(team.name)}" required></label>
          <label>Väri<input name="color" type="color" value="${esc(team.color)}"></label>
          <div class="row"><button class="btn primary">Tallenna</button><button class="btn ghost" value="cancel">Peruuta</button></div>`,
          async (d, btn) => {
            const r = await act(btn, () => api('PATCH', `/teams/${id}`, d),
              (x) => (x.channelsRenaming ? 'Tallennettu – kanavat nimetään uudelleen (Discord rajoittaa: 2 nimenvaihtoa / 10 min)' : 'Tallennettu'));
            if (!r) return false;
            views.tiimit();
          });
      case 'bulk':
        return modal(`<h2>Lisää useita – ${esc(team.name)}</h2>
          <p class="muted small">Yksi per rivi (tai pilkuilla): käyttäjänimi, näyttönimi, @mention tai Discord-ID.</p>
          <textarea name="bulk" placeholder="pelaaja1&#10;pelaaja2&#10;123456789012345678"></textarea>
          <div class="row"><button class="btn primary">Lisää</button><button class="btn ghost" value="cancel">Peruuta</button></div>`,
          async (d, btn) => {
            const r = await act(btn, () => api('POST', `/teams/${id}/members`, { bulk: d.bulk }));
            if (!r) return false;
            toast(`Lisätty ${r.added.length}${r.failed.length ? ` · epäonnistui: ${r.failed.map((f) => `${f.user} (${f.reason})`).join(', ')}` : ''}`, r.failed.length > 0);
            views.tiimit();
          });
      case 'add': {
        const input = b.closest('form').querySelector('input');
        if (!input.value.trim()) return;
        const r = await act(b, () => api('POST', `/teams/${id}/members`, { users: [memberIdFromLabel(input.value.trim())] }));
        if (r?.failed.length) toast(r.failed[0].reason, true);
        else if (r) { toast('Lisätty'); views.tiimit(); }
        return;
      }
      case 'kick':
        await act(b, () => api('DELETE', `/teams/${id}/members/${b.dataset.user}`), 'Poistettu tiimistä');
        return views.tiimit();
      case 'clear':
        if (!(await confirmModal(`Poistetaanko kaikki jäsenet tiimistä ${team.name}?`, 'Tyhjennä'))) return;
        await act(b, () => api('POST', `/teams/${id}/clear`), (r) => `Poistettu ${r.cleared} jäsentä`);
        return views.tiimit();
      case 'delete':
        if (!(await confirmModal(`Poistetaanko tiimi ${team.name}${team.ownsRole ? ' ja sen rooli' : ''}?`, 'Poista'))) return;
        await act(b, () => api('DELETE', `/teams/${id}`), 'Tiimi poistettu');
        return views.tiimit();
      case 'reset':
        if (!(await confirmModal('Poistetaanko kaikki jäsenet kaikista tiimeistä? Tiimit ja roolit säilyvät.', 'Tyhjennä kaikki'))) return;
        await act(b, () => api('POST', '/teams/reset', {}), (r) => `Tyhjennetty (${r.cleared} roolia poistettu jäseniltä)`);
        return views.tiimit();
      case 'deleteAll':
        if (!(await confirmModal('Poistetaanko KAIKKI tiimit, botin luomat roolit ja tiimikanavat?', 'Poista kaikki'))) return;
        await act(b, () => api('POST', '/teams/reset', { deleteTeams: true }), 'Kaikki tiimit poistettu');
        return views.tiimit();
    }
  };
  view.onsubmit = (e) => {
    if (e.target.matches('.add-member')) { e.preventDefault(); e.target.querySelector('[data-a=add]').click(); }
  };
};

const teamCard = (t) => `
  <div class="card team" data-team="${t.id}" style="--team:${esc(t.color)}">
    <div class="team-head">
      <div><h3>${esc(t.name)}</h3>
        <div class="meta">${t.roleMissing ? '<span style="color:var(--danger)">rooli puuttuu Discordista</span>' : `@${esc(t.roleName || t.name)}`} · ${t.members.length} jäsentä${t.textChannelId ? ' · kanavat ✓' : ''}</div></div>
      <div class="row" style="gap:2px">
        <button class="btn ghost small" data-a="edit" title="Muokkaa">✎</button>
        <button class="btn ghost small" data-a="clear" title="Tyhjennä">⌫</button>
        <button class="btn ghost small danger" data-a="delete" title="Poista">✕</button>
      </div>
    </div>
    <div class="chips">${t.members.map((m) => `<span class="chip"><img src="${esc(m.avatar)}" alt="" loading="lazy"><span title="@${esc(m.username)}">${esc(m.name)}</span><button class="icon-btn" data-a="kick" data-user="${m.id}" title="Poista">✕</button></span>`).join('') || '<span class="empty">Ei jäseniä</span>'}</div>
    <form class="add-member row" style="flex-wrap:nowrap">
      <input list="members" placeholder="Hae jäsen…" aria-label="Lisää jäsen">
      <button type="button" class="btn small" data-a="add">Lisää</button>
    </form>
    <button class="btn ghost small" data-a="bulk" style="justify-self:start">+ Lisää useita kerralla</button>
  </div>`;

// ---- Ilmoitukset ----
const PRESETS = {
  turnaus: { title: '🏆 Turnaus alkaa!', body: 'CS2-turnaus alkaa 15 minuutin päästä. Tiimit, kokoontukaa omille puhekanaville!', color: '#f1c40f', mention: 'everyone' },
  serverit: { title: '🖥️ Pelipalvelimet ovat auki', body: 'Liity alla olevilla osoitteilla. Ongelmissa pingaa ylläpitoa.', color: '#5865f2', mention: 'here' },
  tauko: { title: '🍕 Ruokatauko', body: 'Ruoka on valmis! Tauko 30 min.', color: '#e67e22', mention: 'here' },
  ottelu: { title: '⚔️ Seuraava ottelu', body: '**Tiimi 1** vs **Tiimi 2**\nAlkaa klo 18:00 – serveri alla.', color: '#e74c3c', mention: 'none' },
};

views.ilmoitukset = async () => {
  await Promise.all([refreshStatus(), loadGuild(true)]);
  const [servers, settings, ann] = await Promise.all([api('GET', '/servers'), api('GET', '/settings'), api('GET', '/announcements')]);
  view.innerHTML = `
    <h1>Ilmoitukset</h1>
    <p class="sub">Lähetä ilmoitus botin nimissä – esim. serverien IP:t, turnauksen alku tai ruokatauko. Voit myös ajastaa.</p>
    ${offlineBanner()}
    <div class="grid cols-2">
      <form id="ann" class="card stack">
        <div class="row"><span class="muted small">Pohjat:</span>
          ${Object.entries({ turnaus: 'Turnaus alkaa', serverit: 'Serverit auki', ottelu: 'Ottelu', tauko: 'Ruokatauko' }).map(([k, v]) => `<button type="button" class="btn small ghost" data-preset="${k}">${v}</button>`).join('')}
        </div>
        <div class="form-grid">
          <label>Kanava<select name="channelId" required>${channelOptions(settings.announceChannelId, '— valitse kanava —')}</select></label>
          <label>Pingaus<select name="mention"><option value="none">Ei pingiä</option><option value="here">@here</option><option value="everyone">@everyone</option>${guild.roles.filter((r) => !r.managed).map((r) => `<option value="${r.id}">@${esc(r.name)}</option>`).join('')}</select></label>
        </div>
        <label>Otsikko<input name="title" maxlength="256"></label>
        <label>Teksti (Discord-markdown toimii)<textarea name="body" maxlength="4000"></textarea></label>
        ${servers.length ? `<fieldset class="card" style="background:var(--bg);padding:12px"><legend class="muted small">Liitä serverien osoitteet</legend><div class="row">${servers.map((s) => `<label class="check"><input type="checkbox" name="serverIds" value="${s.id}" data-multi="1"> ${esc(s.name)}</label>`).join('')}</div></fieldset>` : '<p class="muted small">Lisää pelipalvelimia Serverit-sivulla, niin voit liittää IP:t ilmoitukseen yhdellä klikkauksella.</p>'}
        <div class="form-grid">
          <label>Väri<input type="color" name="color" value="#5865f2"></label>
          <label>Kuva-URL (valinnainen)<input name="image" type="url" placeholder="https://…"></label>
          <label>Ajasta (valinnainen)<input type="datetime-local" name="sendAt"></label>
        </div>
        <label class="check"><input type="checkbox" name="pin"> Kiinnitä viesti kanavalle</label>
        <div class="row"><button class="btn primary" id="send-btn">Lähetä nyt</button><span class="muted small" id="sched-hint"></span></div>
      </form>
      <div class="stack">
        <div class="card"><h2>Esikatselu</h2><div class="preview" id="preview"></div></div>
        <div class="card"><h2>Ajastetut</h2>
          ${ann.scheduled.length ? `<div class="table-wrap"><table><tbody>${ann.scheduled.map((s) => `<tr><td>${fmtTime(s.sendAt)}</td><td>${esc(s.title || s.body?.slice(0, 40) || '–')}</td><td class="actions"><button class="btn small danger" data-cancel="${s.id}">Peru</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Ei ajastettuja ilmoituksia.</p>'}
        </div>
        <div class="card"><h2>Lähetetyt</h2>
          ${ann.history.length ? `<div class="table-wrap"><table><tbody>${ann.history.slice(0, 10).map((h) => `<tr><td class="muted small">${fmtTime(h.sentAt)}</td><td>#${esc(h.channelName)}</td><td><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title || '(ei otsikkoa)')}</a></td><td class="muted small">${esc(h.by)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Ei vielä lähetettyjä.</p>'}
        </div>
      </div>
    </div>`;

  const form = $('#ann');
  const renderPreview = () => {
    const d = formData(form);
    const mention = d.mention === 'none' ? '' : d.mention === 'here' || d.mention === 'everyone' ? `@${d.mention}` : `@${guild.roles.find((r) => r.id === d.mention)?.name ?? ''}`;
    const sel = servers.filter((s) => (d.serverIds || []).includes(s.id));
    $('#preview').innerHTML = `${mention ? `<div style="margin-bottom:6px"><span class="mention">${esc(mention)}</span></div>` : ''}
      <div class="embed" style="--embed:${esc(d.color)}">
        ${d.title ? `<div class="et">${esc(d.title)}</div>` : ''}
        ${d.body ? `<div class="ed">${esc(d.body)}</div>` : ''}
        ${sel.map((s) => `<div class="ef"><b>${esc(s.name)}</b><code>${esc(s.port ? `${s.address}:${s.port}` : s.address)}</code>${s.password ? ` · salasana <code>${esc(s.password)}</code>` : ''}${s.note ? `<div>${esc(s.note)}</div>` : ''}</div>`).join('')}
        <div class="foot">Liftup LAN</div>
      </div>`;
    $('#send-btn').textContent = d.sendAt ? 'Ajasta' : 'Lähetä nyt';
  };
  form.oninput = renderPreview;
  renderPreview();

  view.onclick = async (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) {
      const v = PRESETS[p.dataset.preset];
      for (const [k, val] of Object.entries(v)) form.elements[k].value = val;
      if (p.dataset.preset === 'serverit' || p.dataset.preset === 'ottelu') $$('input[name=serverIds]', form).forEach((c) => { c.checked = p.dataset.preset === 'serverit'; });
      return renderPreview();
    }
    const c = e.target.closest('[data-cancel]');
    if (c) { await act(c, () => api('DELETE', `/announcements/${c.dataset.cancel}`), 'Peruttu'); views.ilmoitukset(); }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    d.serverIds ||= [];
    if (d.sendAt) d.sendAt = new Date(d.sendAt).toISOString();
    else delete d.sendAt;
    if (!d.image) delete d.image;
    const r = await act(e.submitter, () => api('POST', '/announcements', d), d.sendAt ? 'Ilmoitus ajastettu' : 'Ilmoitus lähetetty');
    if (r) views.ilmoitukset();
  };
};

// ---- Serverit ----
views.serverit = async (editId) => {
  await Promise.all([refreshStatus(), loadGuild()]);
  const [servers, settings] = await Promise.all([api('GET', '/servers'), api('GET', '/settings')]);
  const editing = servers.find((s) => s.id === editId) || {};
  view.innerHTML = `
    <h1>Pelipalvelimet</h1>
    <p class="sub">Näkyvät komennoilla <code>/serverit</code> ja <code>/ip</code>, ilmoituksissa ja automaattisesti päivittyvässä serverilistassa.</p>
    <div class="grid cols-2">
      <div class="card">
        <h2>Palvelimet</h2>
        ${servers.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Nimi</th><th>Osoite</th><th>Tila</th><th></th></tr></thead>
          <tbody>${servers.map((s) => `<tr data-id="${s.id}">
            <td><b>${esc(s.name)}</b><div class="muted small">${esc(s.game || '')}${s.listed === false ? ' · piilotettu listalta' : ''}</div></td>
            <td class="mono">${esc(s.port ? `${s.address}:${s.port}` : s.address)}${s.password ? `<div class="muted small">🔑 ${esc(s.password)}</div>` : ''}</td>
            <td>${s.pteroId && status.ptero ? `<span class="pill" data-state="${s.id}">…</span>` : '<span class="muted small">–</span>'}</td>
            <td class="actions">
              ${s.pteroId && status.ptero ? `<button class="btn small" data-power="start">▶</button><button class="btn small" data-power="restart">↻</button><button class="btn small danger" data-power="stop">■</button>` : ''}
              <button class="btn small" data-a="edit">Muokkaa</button>
              <button class="btn small danger" data-a="del">✕</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="empty">Ei palvelimia. Lisää esim. CS2- ja Minecraft-serveri.</p>'}
      </div>
      <div class="stack">
        <form id="srv" class="card form-grid">
          <h2 class="full">${editing.id ? 'Muokkaa palvelinta' : 'Lisää palvelin'}</h2>
          <label>Nimi<input name="name" required value="${esc(editing.name)}" placeholder="CS2 Turnaus"></label>
          <label>Peli<input name="game" list="games" value="${esc(editing.game)}" placeholder="CS2"></label>
          <datalist id="games"><option value="CS2"><option value="Minecraft"><option value="Valorant"><option value="Rocket League"><option value="Muu"></datalist>
          <label>Osoite / IP<input name="address" required value="${esc(editing.address)}" placeholder="10.0.0.20" class="mono"></label>
          <label>Portti<input name="port" type="number" value="${esc(editing.port)}" placeholder="27015"></label>
          <label>Salasana<input name="password" value="${esc(editing.password)}"></label>
          <label>Liittymiskomento<input name="connect" value="${esc(editing.connect)}" placeholder="connect 10.0.0.20:27015" class="mono"></label>
          <label class="full">Lisätieto<input name="note" value="${esc(editing.note)}" placeholder="esim. versio 1.21, modipaketti…"></label>
          <label>Pterodactyl-tunniste<input name="pteroId" value="${esc(editing.pteroId)}" placeholder="esim. 1a2b3c4d" ${status.ptero ? '' : 'disabled title="PTERO_URL/PTERO_API_KEY puuttuu"'}></label>
          <label class="check" style="align-self:end;margin-bottom:9px"><input type="checkbox" name="listed" ${editing.listed !== false ? 'checked' : ''}> Näytä serverilistassa</label>
          <div class="row full"><button class="btn primary">${editing.id ? 'Tallenna' : 'Lisää'}</button>${editing.id ? '<button type="button" class="btn ghost" data-a="cancel">Peruuta</button>' : ''}</div>
        </form>
        <form id="list" class="card stack">
          <h2>Automaattinen serverilista</h2>
          <p class="muted small" style="margin:0">Botti pitää valitulla kanavalla yhtä viestiä, joka päivittyy aina kun serverit muuttuvat.</p>
          <label>Kanava<select name="serverListChannelId">${channelOptions(settings.serverListChannelId, '— pois päältä —')}</select></label>
          <div class="row"><button class="btn">Tallenna</button><button type="button" class="btn ghost" data-a="refreshList">Päivitä viesti nyt</button></div>
        </form>
      </div>
    </div>`;

  $('#srv').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const r = await act(e.submitter, () => (editing.id ? api('PUT', `/servers/${editing.id}`, d) : api('POST', '/servers', d)), 'Tallennettu');
    if (r) views.serverit();
  };
  $('#list').onsubmit = async (e) => {
    e.preventDefault();
    await act(e.submitter, () => api('PUT', '/settings', formData(e.target)), 'Serverilistan kanava tallennettu');
  };
  view.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.closest('tr')?.dataset.id;
    if (b.dataset.a === 'edit') return views.serverit(id);
    if (b.dataset.a === 'cancel') return views.serverit();
    if (b.dataset.a === 'refreshList') return act(b, () => api('POST', '/servers/list-message'), (r) => (r.url ? 'Serverilista päivitetty' : 'Valitse ensin kanava'));
    if (b.dataset.a === 'del') {
      if (!(await confirmModal('Poistetaanko palvelin?', 'Poista'))) return;
      await act(b, () => api('DELETE', `/servers/${id}`), 'Poistettu');
      return views.serverit();
    }
    if (b.dataset.power) {
      await act(b, () => api('POST', `/servers/${id}/power`, { signal: b.dataset.power }), `Komento lähetetty: ${b.dataset.power}`);
      setTimeout(loadPteroStates, 2500);
    }
  };
  const loadPteroStates = () => $$('[data-state]').forEach(async (el) => {
    try {
      const st = await api('GET', `/servers/${el.dataset.state}/ptero`);
      el.className = `pill ${st.state === 'running' ? 'ok' : st.state === 'offline' ? 'bad' : 'warn'}`;
      el.textContent = st.state + (st.memoryMb ? ` · ${st.memoryMb} MB` : '');
    } catch (err) { el.className = 'pill bad'; el.textContent = 'virhe'; el.title = err.message; }
  });
  loadPteroStates();
};

// ---- Minecraft ----
views.minecraft = async () => {
  await Promise.all([refreshStatus(), loadGuild()]);
  const mc = await api('GET', '/minecraft');
  const st = mc.status;
  const m = mc.settings;
  view.innerHTML = `
    <h1>Minecraft</h1>
    <p class="sub">Tilan seuranta, whitelist ja konsoli RCONin kautta. Pelaajat voivat lisätä itsensä komennolla <code>/mc whitelist</code>.</p>
    <div class="grid cols-2">
      <div class="card">
        <div class="row between"><h2>Tila</h2><span class="pill ${!st.configured ? '' : st.online ? 'ok' : 'bad'}">${!st.configured ? 'ei määritetty' : st.online ? `online · ${st.latency} ms` : 'offline'}</span></div>
        ${st.online ? `<div class="stat"><div class="value">${st.players.online}/${st.players.max}</div><div class="hint">pelaajaa · ${esc(st.version)} · <span class="mono">${esc(st.address)}</span></div></div>
          ${st.motd ? `<p class="muted small">${esc(st.motd)}</p>` : ''}
          <div class="chips" style="margin-top:10px">${st.players.sample.map((p) => `<span class="chip" style="padding:3px 10px">${esc(p)}</span>`).join('') || '<span class="empty">Ei pelaajia</span>'}</div>`
          : `<p class="muted">${st.configured ? `Ei vastausta osoitteesta <span class="mono">${esc(st.address)}</span>: ${esc(st.error)}` : 'Aseta palvelimen osoite alla.'}</p>`}
      </div>
      <div class="card stack">
        <h2>Whitelist &amp; viesti peliin</h2>
        <form id="wl" class="row" style="flex-wrap:nowrap"><input name="name" placeholder="Minecraft-nimi" required><button class="btn primary">Whitelistaa</button></form>
        <form id="say" class="row" style="flex-wrap:nowrap"><input name="message" placeholder="Viesti kaikille pelaajille" required><button class="btn">Lähetä</button></form>
      </div>
      <div class="card stack full" style="grid-column:1/-1">
        <h2>Konsoli (RCON)</h2>
        <div class="console" id="console"><span class="muted">Komennot ajetaan palvelimella. Esim. list, time set day, weather clear.</span>\n</div>
        <form id="cmd" class="row" style="flex-wrap:nowrap"><input name="command" class="mono" placeholder="list" required autocomplete="off"><button class="btn primary">Aja</button></form>
        <div class="row">${['list', 'time set day', 'weather clear', 'whitelist list', 'save-all'].map((c) => `<button class="btn small ghost" data-cmd="${c}">${c}</button>`).join('')}</div>
      </div>
      <form id="mcset" class="card form-grid" style="grid-column:1/-1">
        <h2 class="full">Yhteysasetukset</h2>
        <label>Osoite${mc.envOverrides.host ? ' (MC_HOST ympäristössä ohittaa)' : ''}<input name="host" value="${esc(m.host)}" class="mono" placeholder="10.0.0.30"></label>
        <label>Peliportti<input name="port" type="number" value="${esc(m.port)}"></label>
        <label>RCON-portti<input name="rconPort" type="number" value="${esc(m.rconPort)}"></label>
        <label>RCON-salasana${mc.envOverrides.rconPassword ? ' (asetettu ympäristössä)' : ''}<input name="rconPassword" type="password" value="${esc(m.rconPassword)}" ${mc.envOverrides.rconPassword ? 'disabled' : ''}></label>
        <label>Tilaviestin kanava<select name="statusChannelId">${channelOptions(m.statusChannelId)}</select></label>
        <label class="check" style="align-self:end;margin-bottom:9px"><input type="checkbox" name="statusEnabled" ${m.statusEnabled ? 'checked' : ''}> Päivitä tilaviestiä minuutin välein</label>
        <label class="check full"><input type="checkbox" name="allowSelfWhitelist" ${m.allowSelfWhitelist ? 'checked' : ''}> Kaikki saavat käyttää <code>/mc whitelist</code> (muuten vain ylläpito)</label>
        <div class="full"><button class="btn primary">Tallenna</button></div>
        <p class="full muted small" style="margin:0">server.properties: <code>enable-rcon=true</code>, <code>rcon.port=25575</code>, <code>rcon.password=…</code>. Pterodactylissa RCON-portille tarvitaan oma allokaatio, jos botti on eri koneella.</p>
      </form>
    </div>`;

  const out = $('#console');
  const run = async (command, btn) => {
    out.insertAdjacentHTML('beforeend', `<span class="cmd">&gt; ${esc(command)}</span>\n`);
    try { const r = await api('POST', '/minecraft/command', { command }); out.insertAdjacentText('beforeend', `${r.output || '(ei tulostetta)'}\n`); }
    catch (e) { out.insertAdjacentHTML('beforeend', `<span style="color:var(--danger)">${esc(e.message)}</span>\n`); }
    out.scrollTop = out.scrollHeight;
    if (btn) btn.disabled = false;
  };
  $('#cmd').onsubmit = (e) => { e.preventDefault(); const i = e.target.elements.command; run(i.value); i.value = ''; };
  view.onclick = (e) => { const b = e.target.closest('[data-cmd]'); if (b) { b.disabled = true; run(b.dataset.cmd, b); } };
  $('#wl').onsubmit = async (e) => { e.preventDefault(); const r = await act(e.submitter, () => api('POST', '/minecraft/whitelist', formData(e.target))); if (r) { toast(r.output || 'Lisätty'); e.target.reset(); } };
  $('#say').onsubmit = async (e) => { e.preventDefault(); if (await act(e.submitter, () => api('POST', '/minecraft/say', formData(e.target)), 'Viesti lähetetty')) e.target.reset(); };
  $('#mcset').onsubmit = async (e) => { e.preventDefault(); if (await act(e.submitter, () => api('PUT', '/minecraft', formData(e.target)), 'Tallennettu')) views.minecraft(); };
};

// ---- Valvonta ----
views.valvonta = async () => {
  await Promise.all([refreshStatus(), loadGuild(true)]);
  const [mod, settings] = await Promise.all([api('GET', '/moderation'), api('GET', '/settings')]);
  const userName = (id) => guild.members.find((m) => m.id === id)?.name;
  view.innerHTML = `
    <h1>Valvonta</h1>
    <p class="sub">Automaattinen moderointi, varoitukset ja modiloki. Ylläpito (Manage Messages -oikeus) ja poikkeusroolit ohitetaan automaattisesti.</p>
    ${offlineBanner()}
    <div class="grid cols-2">
      <form id="mod" class="card form-grid">
        <h2 class="full">Automod</h2>
        <label class="check full"><input type="checkbox" name="enabled" ${mod.enabled ? 'checked' : ''}> <b>Automod päällä</b></label>
        <label class="check"><input type="checkbox" name="blockInvites" ${mod.blockInvites ? 'checked' : ''}> Estä Discord-kutsut</label>
        <label class="check"><input type="checkbox" name="blockLinks" ${mod.blockLinks ? 'checked' : ''}> Estä kaikki linkit</label>
        <label class="full">Kielletyt sanat (yksi per rivi)<textarea name="bannedWords">${esc(mod.bannedWords.join('\n'))}</textarea></label>
        <label class="check full"><input type="checkbox" name="spamEnabled" ${mod.spamEnabled ? 'checked' : ''}> Spämmisuoja</label>
        <label>Max viestiä<input type="number" name="spamMaxMessages" value="${mod.spamMaxMessages}" min="2"></label>
        <label>Aikaikkuna (s)<input type="number" name="spamWindowSeconds" value="${mod.spamWindowSeconds}" min="1"></label>
        <label>Spämmääjän hiljennys (min)<input type="number" name="spamTimeoutMinutes" value="${mod.spamTimeoutMinutes}" min="0"></label>
        <label>Hiljennys joka N:nnestä varoituksesta<input type="number" name="warnThreshold" value="${mod.warnThreshold}" min="0"></label>
        <label>Varoitushiljennys (min)<input type="number" name="warnTimeoutMinutes" value="${mod.warnTimeoutMinutes}" min="1"></label>
        <label class="full">Poikkeusroolit (Ctrl/Cmd = useita)<select name="exemptRoleIds" multiple size="5">${guild.roles.filter((r) => !r.managed).map((r) => `<option value="${r.id}" ${mod.exemptRoleIds.includes(r.id) ? 'selected' : ''}>@${esc(r.name)}</option>`).join('')}</select></label>
        <label class="full">Modiloki-kanava<select name="modLogChannelId">${channelOptions(settings.modLogChannelId, '— ei lokikanavaa —')}</select></label>
        <div class="full"><button class="btn primary">Tallenna</button></div>
      </form>
      <div class="stack">
        <form id="warn" class="card stack">
          <h2>Anna varoitus</h2>
          ${memberDatalist()}
          <label>Jäsen<input name="user" list="members" required placeholder="Hae jäsen…"></label>
          <label>Syy<input name="reason" required></label>
          <div><button class="btn">Varoita</button></div>
        </form>
        <div class="card">
          <h2>Varoitukset (${mod.warnings.length})</h2>
          ${mod.warnings.length ? `<div class="table-wrap"><table><tbody>${mod.warnings.slice(0, 50).map((w) => `<tr><td><b>${esc(userName(w.userId) || w.userTag)}</b><div class="muted small">${fmtTime(w.at)} · ${esc(w.by)}</div></td><td>${esc(w.reason)}</td><td class="actions"><button class="icon-btn" data-del="${w.id}" title="Poista">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Ei varoituksia.</p>'}
        </div>
      </div>
    </div>`;

  $('#mod').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const { modLogChannelId, ...modCfg } = d;
    await act(e.submitter, async () => { await api('PUT', '/moderation', modCfg); await api('PUT', '/settings', { modLogChannelId }); }, 'Valvonta-asetukset tallennettu');
  };
  $('#warn').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const r = await act(e.submitter, () => api('POST', '/moderation/warn', { userId: memberIdFromLabel(d.user), reason: d.reason }), (x) => `Varoitettu (${x.count}. varoitus)`);
    if (r) views.valvonta();
  };
  view.onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (b) { await act(b, () => api('DELETE', `/moderation/warnings/${b.dataset.del}`), 'Varoitus poistettu'); views.valvonta(); }
  };
};

// ---- Loki ----
views.loki = async () => {
  const lvl = sessionStorage.getItem('loglevel') || '';
  const logs = await api('GET', `/logs${lvl ? `?level=${lvl}` : ''}`);
  view.innerHTML = `
    <h1>Loki</h1>
    <p class="sub">Botin tapahtumat (viimeiset 500 tallennetaan).</p>
    <div class="toolbar">
      <select id="lvl" style="width:auto"><option value="">Kaikki</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>
      <button class="btn" id="reload">Päivitä</button>
    </div>
    <div class="card log">${logs.map(logRow).join('') || '<p class="empty">Ei tapahtumia.</p>'}</div>`;
  $('#lvl').value = lvl;
  $('#lvl').onchange = (e) => { sessionStorage.setItem('loglevel', e.target.value); views.loki(); };
  $('#reload').onclick = () => views.loki();
};

// ---- Asetukset ----
views.asetukset = async () => {
  await Promise.all([refreshStatus(), loadGuild(true)]);
  const s = await api('GET', '/settings');
  const origin = location.origin;
  view.innerHTML = `
    <h1>Asetukset</h1>
    <p class="sub">Salaisuudet (botin token, salasanat) asetetaan ympäristömuuttujilla – ne eivät näy täällä.</p>
    ${offlineBanner()}
    <div class="grid cols-2">
      <form id="set" class="card form-grid">
        <h2 class="full">Yleiset</h2>
        <label class="full">Ilmoitusten oletuskanava<select name="announceChannelId">${channelOptions(s.announceChannelId)}</select></label>
        <label>Tervetulokanava<select name="welcomeChannelId">${channelOptions(s.welcomeChannelId, '— ei tervetuloviestiä —')}</select></label>
        <label>Automaattinen rooli liittyessä<select name="autoRoleId">${roleOptions(s.autoRoleId, '— ei roolia —')}</select></label>
        <label class="full">Tervetuloviesti <span class="small">({user}, {name}, {server})</span><textarea name="welcomeMessage" style="min-height:70px">${esc(s.welcomeMessage)}</textarea></label>
        <label>Botin tilateksti ("Pelaa …")<input name="presenceText" value="${esc(s.presenceText)}"></label>
        <label>Tiimikanavien kategoria<input name="teamCategoryName" value="${esc(s.teamCategoryName)}"></label>
        <label class="check full"><input type="checkbox" name="exclusiveTeams" ${s.exclusiveTeams ? 'checked' : ''}> Jäsen voi kuulua vain yhteen tiimiin (siirto poistaa vanhan tiimiroolin)</label>
        <div class="full"><button class="btn primary">Tallenna</button></div>
      </form>
      <div class="stack">
        <div class="card stack">
          <h2>Slash-komennot</h2>
          <p class="muted small" style="margin:0">Rekisteröidään automaattisesti käynnistyksessä. Jos komennot eivät näy Discordissa, rekisteröi uudelleen.</p>
          <div><button class="btn" id="reg">Rekisteröi komennot</button></div>
          <p class="muted small" style="margin:0"><code>/tiimi</code> <code>/serverit</code> <code>/ip</code> <code>/mc</code> <code>/varoita</code> <code>/varoitukset</code> <code>/hiljennä</code> <code>/siivoa</code> <code>/ilmoita</code></p>
        </div>
        <div class="card stack">
          <h2>Rajapinta (turnausjärjestelmä)</h2>
          <p class="small" style="margin:0">API-token: ${status.apiTokenSet ? '<span class="pill ok">asetettu</span>' : '<span class="pill bad">ei asetettu (API_TOKEN)</span>'}</p>
          <pre class="console" style="height:auto">curl -X POST ${esc(origin)}/api/teams/import \\
  -H "Authorization: Bearer $API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"replace":true,"teams":[
    {"name":"Tiimi 1","members":["1234…","pelaaja2"]}]}'</pre>
          <p class="muted small" style="margin:0">Kaikki paneelin rajapinnat (/api/…) toimivat samalla tokenilla, esim. <code>POST /api/announcements</code>.</p>
        </div>
      </div>
    </div>`;
  $('#set').onsubmit = async (e) => { e.preventDefault(); await act(e.submitter, () => api('PUT', '/settings', formData(e.target)), 'Asetukset tallennettu'); };
  $('#reg').onclick = (e) => act(e.target, () => api('POST', '/commands/register'), (r) => `Rekisteröity ${r.count} komentoa`);
};

// ---------------- Reititys & kirjautuminen ----------------
async function route() {
  const name = location.hash.slice(1) || 'yleiskatsaus';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  view.onclick = null;
  view.onsubmit = null;
  try { await (views[name] || views.yleiskatsaus)(); }
  catch (e) { if (e.message !== 'Kirjaudu sisään') view.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

async function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await route();
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('POST', '/login', formData(e.target));
    e.target.reset();
    guild = null;
    showApp();
  } catch (err) { $('#login-error').textContent = err.message; }
};

$('#logout').onclick = async () => { await api('POST', '/logout').catch(() => {}); showLogin(); };
window.addEventListener('hashchange', route);
setInterval(() => { if (!$('#app').classList.contains('hidden')) refreshStatus(); }, 30_000);

// Käynnistys: tarkista onko istunto voimassa
api('GET', '/status').then(() => showApp()).catch(() => showLogin());
