const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/server');
const { Store } = require('../src/store');

const PAGE = `<html><body>
<form id=f onsubmit="return false">
<input id=email><input id=password type=password>
<img id=captcha-img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='30'%3E%3Ctext y='22' font-size='20'%3EQ7ZK%3C/text%3E%3C/svg%3E">
<input id=captcha><button type=submit id=go>Login</button></form>
<div id=otpbox style="display:none"><input id=otp><button id=otp-submit>Verify</button></div>
<div id=dashboard style="display:none">welcome</div>
<script>
go.onclick=()=>{ if(captcha.value!=='Q7ZK'||password.value!=='pw') return; f.style.display='none'; otpbox.style.display='block'; };
document.getElementById('otp-submit').onclick=()=>{ if(otp.value==='654321'){ otpbox.style.display='none'; dashboard.style.display='block'; } };
</script></body></html>`;

async function listen(app) {
  const s = http.createServer(app); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, url: `http://127.0.0.1:${s.address().port}` };
}
const call = async (base, p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

test('API auth + secret redaction + OTP endpoint', async () => {
  const store = new Store(null, 'k');
  const mail = { fetchRecent: async () => [{ from: 'x@app.com', subject: 'Code', text: 'Your code is 135790', date: new Date() }] };
  const { s, url } = await listen(createApp({ store, token: 'tok', mailProviderFactory: () => mail }));
  try {
    assert.equal((await fetch(url + '/api/apps')).status, 401);
    const c = await call(url, '/api/apps', 'POST', { name: 'A', loginUrl: 'http://x', password: 'pw', totpSecret: 'GEZDGNBVGY3TQOJQ' });
    assert.equal(c.status, 201);
    assert.equal(c.json.password, undefined);
    assert.equal(c.json.has_totpSecret, true);
    assert.match((await call(url, `/api/apps/${c.json.id}/totp`)).json.code, /^\d{6}$/);
    assert.equal((await call(url, '/api/otp?from=app.com&timeout=2')).json.code, '135790');
  } finally { s.close(); }
});

test('full login: captcha solved by operator via API, OTP read from mail', { timeout: 60000 }, async (t) => {
  let chromium;
  try { chromium = require('playwright-core').chromium; } catch { return t.skip('no playwright'); }
  const site = await listen((req, res) => res.end(PAGE));
  const store = new Store(null, 'k');
  const mail = { fetchRecent: async () => [{ from: 'no-reply@site.com', subject: 'Your code', text: 'Verification code: 654321', date: new Date() }] };
  const { s, url } = await listen(createApp({ store, token: 'tok', mailProviderFactory: () => mail }));
  try {
    const a = (await call(url, '/api/apps', 'POST', { name: 'Mock', loginUrl: site.url, username: 'me', password: 'pw', otpSender: 'site.com',
      selectors: { username: '#email', password: '#password', submit: '#go', otp: '#otp', otpSubmit: '#otp-submit',
        captchaImage: '#captcha-img', captchaInput: '#captcha', success: '#dashboard' } })).json;
    const job = (await call(url, `/api/apps/${a.id}/login`, 'POST')).json;
    // act as the human operator in the UI: wait for captcha, "read" the image, answer it
    let task;
    for (let i = 0; i < 60 && !task; i++) { task = (await call(url, '/api/captcha?status=pending')).json[0]; await new Promise((r) => setTimeout(r, 250)); }
    assert.ok(task && task.image, 'captcha queued with image');
    await call(url, `/api/captcha/${task.id}/solve`, 'POST', { answer: 'Q7ZK' });
    let j;
    for (let i = 0; i < 80; i++) { j = (await call(url, `/api/jobs/${job.id}`)).json; if (j.status !== 'running') break; await new Promise((r) => setTimeout(r, 250)); }
    assert.equal(j.status, 'success', JSON.stringify(j));
    assert.ok(j.log.some((l) => l.includes('OTP filled from email')));
  } finally { s.close(); site.s.close(); }
});
