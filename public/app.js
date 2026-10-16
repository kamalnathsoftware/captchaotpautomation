const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = sessionStorage.getItem('token');
if (!token) { token = prompt('Admin token (printed in the server console / ADMIN_TOKEN):') || ''; sessionStorage.setItem('token', token); }

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { sessionStorage.removeItem('token'); alert('Wrong token'); location.reload(); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const fail = (e) => alert(e.message);

document.querySelectorAll('#nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('main section').forEach((s) => s.classList.toggle('hidden', s.id !== b.dataset.t));
  render[b.dataset.t]();
});

const f = (id, label, val = '', type = 'text', ph = '') =>
  `<div><label>${label}</label><input id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}"></div>`;

const render = {
  async apps() {
    const apps = await api('/apps');
    $('#apps').innerHTML = `<div class="card"><h3>Connect an application</h3>
      <div class="grid">${f('a_name', 'Name')}${f('a_url', 'Login URL', '', 'url', 'https://app.example.com/login')}
      ${f('a_user', 'Username / email')}${f('a_pass', 'Password', '', 'password')}
      ${f('a_totp', 'Authenticator secret (optional, base32)', '', 'password')}
      <div><label>Auth method</label><select id="a_mode"><option value="auto">Auto (TOTP → Google → password)</option><option value="google">Google sign-in</option><option value="password">Password</option></select></div>
      ${f('a_sender', 'OTP email sender contains', '', 'text', 'no-reply@app.com')}${f('a_subject', 'OTP email subject contains')}</div>
      <label>CSS selectors (JSON): username, password, submit, otp, otpSubmit, googleButton, captchaImage, captchaInput, success</label>
      <textarea id="a_sel" rows="4">{"username":"#email","password":"#password","submit":"button[type=submit]","otp":"#otp","otpSubmit":"#otp-submit","googleButton":".google-signin","captchaImage":"#captcha-img","captchaInput":"#captcha","success":"#dashboard"}</textarea>
      <button class="p" id="a_save">Save application</button></div>
      ${apps.map((a) => `<div class="card"><div class="row"><div class="grow"><h3>${esc(a.name)}</h3>
        <div class="mut">${esc(a.loginUrl)} · ${esc(a.authMode || 'auto')} · authenticator: ${a.has_totpSecret ? '<span class="ok">yes</span>' : 'no'}</div></div>
        <button class="s" data-run="${a.id}">▶ Run login</button><button class="s" data-del="${a.id}">Delete</button></div>
        <pre class="hidden" id="log-${a.id}"></pre></div>`).join('') || '<p class="mut">No applications yet.</p>'}`;
    $('#a_save').onclick = async () => {
      try {
        await api('/apps', 'POST', { name: $('#a_name').value, loginUrl: $('#a_url').value, username: $('#a_user').value,
          password: $('#a_pass').value, totpSecret: $('#a_totp').value, authMode: $('#a_mode').value,
          otpSender: $('#a_sender').value, otpSubject: $('#a_subject').value, selectors: JSON.parse($('#a_sel').value) });
        render.apps();
      } catch (e) { fail(e); }
    };
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Delete?')) { await api('/apps/' + b.dataset.del, 'DELETE'); render.apps(); } });
    document.querySelectorAll('[data-run]').forEach((b) => b.onclick = async () => {
      try {
        const job = await api(`/apps/${b.dataset.run}/login`, 'POST');
        const pre = $('#log-' + b.dataset.run); pre.classList.remove('hidden');
        const t = setInterval(async () => {
          const j = await api('/jobs/' + job.id);
          pre.textContent = j.log.join('\n') + `\n[${j.status}]`;
          if (j.status !== 'running') clearInterval(t);
        }, 1000);
      } catch (e) { fail(e); }
    });
  },
  async captcha() {
    const list = await api('/captcha?status=pending');
    $('#cn').textContent = list.length ? `(${list.length})` : '';
    $('#captcha').innerHTML = list.map((t) => `<div class="card"><h3>${esc(t.hint || 'Captcha')}</h3>
      ${t.image ? `<img class="cap" src="data:image/png;base64,${t.image}">` : `<p class="mut">${esc(t.type)} ${esc(t.pageUrl || '')}</p>`}
      <div class="row"><input class="grow" id="ans-${t.id}" placeholder="Type what you see / paste token"><button class="p" data-solve="${t.id}">Submit</button><button class="s" data-rej="${t.id}">Skip</button></div></div>`).join('')
      || '<p class="mut">No pending captchas. This page refreshes automatically.</p>';
    document.querySelectorAll('[data-solve]').forEach((b) => b.onclick = async () => { try { await api(`/captcha/${b.dataset.solve}/solve`, 'POST', { answer: $('#ans-' + b.dataset.solve).value }); render.captcha(); } catch (e) { fail(e); } });
    document.querySelectorAll('[data-rej]').forEach((b) => b.onclick = async () => { await api(`/captcha/${b.dataset.rej}/reject`, 'POST'); render.captcha(); });
  },
  async otp() {
    const m = (await api('/mailbox')) || {};
    $('#otp').innerHTML = `<div class="card"><h3>Mailbox that receives OTP emails (IMAP)</h3>
      <p class="mut">Use your own mailbox. For Gmail enable IMAP and create an <b>App Password</b> (imap.gmail.com, port 993).</p>
      <div class="grid">${f('m_host', 'IMAP host', m.host || 'imap.gmail.com')}${f('m_port', 'Port', m.port || 993, 'number')}
      ${f('m_user', 'Email', m.user)}${f('m_pass', m.has_pass ? 'App password (saved - leave blank to keep)' : 'App password', '', 'password')}</div>
      <button class="p" id="m_save">Save</button></div>
      <div class="card"><h3>Test: fetch latest OTP</h3><div class="grid">${f('t_from', 'Sender contains')}${f('t_sub', 'Subject contains')}</div>
      <button class="p" id="t_go">Wait for OTP (60s)</button><pre id="t_out" class="hidden"></pre></div>`;
    $('#m_save').onclick = async () => { try { await api('/mailbox', 'PUT', { host: $('#m_host').value, port: +$('#m_port').value, user: $('#m_user').value, pass: $('#m_pass').value }); alert('Saved'); } catch (e) { fail(e); } };
    $('#t_go').onclick = async () => {
      const o = $('#t_out'); o.classList.remove('hidden'); o.textContent = 'Waiting for email…';
      try { const r = await api(`/otp?timeout=60&from=${encodeURIComponent($('#t_from').value)}&subject=${encodeURIComponent($('#t_sub').value)}`); o.textContent = JSON.stringify(r, null, 2); }
      catch (e) { o.textContent = e.message; }
    };
  },
  async jobs() {
    const j = await api('/jobs');
    $('#jobs').innerHTML = j.map((x) => `<div class="card"><div class="row"><b class="grow">${esc(x.appId)}</b><span class="${x.status === 'success' ? 'ok' : x.status === 'failed' ? 'bad' : ''}">${x.status}</span></div><pre>${esc(x.log.join('\n'))}</pre></div>`).join('') || '<p class="mut">No runs yet.</p>';
  },
  api() {
    const o = location.origin;
    $('#api').innerHTML = `<div class="card"><h3>API (send <code>Authorization: Bearer &lt;token&gt;</code>)</h3><pre>
GET  ${o}/api/otp?from=&lt;sender&gt;&amp;subject=&lt;text&gt;&amp;timeout=60   → {"code":"123456"}
GET  ${o}/api/apps/:id/totp                                  → {"code":"123456","expiresInSec":12}
POST ${o}/api/captcha   {"type":"image","image":"&lt;base64&gt;"}  → {"id":...}
GET  ${o}/api/captcha/:id                                    → status pending|solved, answer
POST ${o}/api/captcha/:id/solve   {"answer":"xk3p"}
POST ${o}/api/apps/:id/login                                 → job; poll GET /api/jobs/:id
GET/POST/PUT/DELETE ${o}/api/apps</pre></div>`;
  },
};
render.apps();
setInterval(async () => {
  try { const ids = (await api('/captcha?status=pending')).map((t) => t.id).join(',');
    const n = ids ? ids.split(',').length : 0; $('#cn').textContent = n ? `(${n})` : '';
    // re-render only when the queue changed, so a half-typed answer isn't wiped
    if (ids !== window.lastIds && !$('#captcha').classList.contains('hidden')) render.captcha();
    window.lastIds = ids; } catch {}
}, 4000);
