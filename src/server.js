const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Store } = require('./store');
const { CaptchaQueue } = require('./captcha');
const { ImapMailProvider, waitForOtp } = require('./otp');
const { Runner } = require('./automation');
const { totp } = require('./crypto');

function createApp({ store, captcha = new CaptchaQueue(), token, mailProviderFactory, runnerFactory, sessionsDir }) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const jobs = new Map();
  const mailProvider = mailProviderFactory || (() => {
    const m = store.getMailbox({ withSecrets: true });
    if (!m) throw Object.assign(new Error('Mailbox not configured'), { status: 400 });
    return new ImapMailProvider(m);
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', (req, res, next) => {
    const h = req.get('authorization') || '';
    const a = Buffer.from(h.replace(/^Bearer\s+/i, '')), b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) =>
    res.status(e.status || (e.code === 'OTP_TIMEOUT' ? 408 : 500)).json({ error: e.message }));

  // ---- Connected applications ----
  app.get('/api/apps', (req, res) => res.json(store.listApps()));
  app.post('/api/apps', (req, res) => {
    if (!req.body.name || !req.body.loginUrl) return res.status(400).json({ error: 'name and loginUrl required' });
    res.status(201).json(store.upsertApp(req.body));
  });
  app.put('/api/apps/:id', (req, res) => {
    if (!store.getApp(req.params.id)) return res.status(404).json({ error: 'Not found' });
    res.json(store.upsertApp(req.body, req.params.id));
  });
  app.delete('/api/apps/:id', (req, res) => res.json({ deleted: store.deleteApp(req.params.id) }));

  // Current authenticator code for an app (only if a TOTP secret is stored)
  app.get('/api/apps/:id/totp', (req, res) => {
    const a = store.getApp(req.params.id, { withSecrets: true });
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!a.totpSecret) return res.status(404).json({ error: 'No authenticator configured' });
    res.json({ code: totp(a.totpSecret), expiresInSec: 30 - (Math.floor(Date.now() / 1000) % 30) });
  });

  // ---- Mailbox + OTP ----
  app.get('/api/mailbox', (req, res) => res.json(store.getMailbox()));
  app.put('/api/mailbox', (req, res) => res.json(store.setMailbox(req.body)));
  // Block until an OTP email arrives. Query: from, subject, timeout (sec)
  app.get('/api/otp', wrap(async (req, res) => {
    const timeoutMs = Math.min(Number(req.query.timeout || 60), 180) * 1000;
    const r = await waitForOtp(mailProvider(), { from: req.query.from, subject: req.query.subject,
      since: new Date(Date.now() - Number(req.query.maxAge || 120) * 1000), timeoutMs,
      intervalMs: Number(process.env.OTP_POLL_MS || 4000) });
    res.json(r);
  }));

  // ---- Captcha queue ----
  app.post('/api/captcha', (req, res) => res.status(201).json(captcha.create(req.body)));
  app.get('/api/captcha', (req, res) => res.json(captcha.list(req.query.status)));
  app.get('/api/captcha/:id', (req, res) => {
    const t = captcha.get(req.params.id);
    t ? res.json(t) : res.status(404).json({ error: 'Not found' });
  });
  app.post('/api/captcha/:id/solve', (req, res) => {
    if (!req.body.answer) return res.status(400).json({ error: 'answer required' });
    const t = captcha.solve(req.params.id, req.body.answer);
    t ? res.json(t) : res.status(404).json({ error: 'Not found' });
  });
  app.post('/api/captcha/:id/reject', (req, res) => {
    const t = captcha.reject(req.params.id);
    t ? res.json(t) : res.status(404).json({ error: 'Not found' });
  });

  // ---- Automation jobs ----
  app.post('/api/apps/:id/login', (req, res) => {
    const a = store.getApp(req.params.id, { withSecrets: true });
    if (!a) return res.status(404).json({ error: 'Not found' });
    const job = { id: crypto.randomUUID(), appId: a.id, status: 'running', log: [], startedAt: Date.now() };
    jobs.set(job.id, job);
    const push = (m) => job.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    const runner = runnerFactory ? runnerFactory(push) :
      new Runner({ captcha, mailProvider, sessionsDir, log: push });
    runner.login({ ...a, has_totpSecret: !!a.totpSecret }).then(
      (r) => { job.status = 'success'; job.result = r; },
      (e) => { job.status = 'failed'; job.error = e.message; push(`Failed: ${e.message}`); });
    res.status(202).json(job);
  });
  app.get('/api/jobs', (req, res) => res.json([...jobs.values()].reverse().slice(0, 50)));
  app.get('/api/jobs/:id', (req, res) => {
    const j = jobs.get(req.params.id);
    j ? res.json(j) : res.status(404).json({ error: 'Not found' });
  });

  return app;
}

if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  let token = process.env.ADMIN_TOKEN;
  if (!token) { token = crypto.randomBytes(18).toString('hex'); console.log(`No ADMIN_TOKEN set. Temporary token: ${token}`); }
  // Encryption key: env var, else a generated key persisted next to the data (mode 600)
  const fs = require('fs');
  const keyFile = path.join(dataDir, '.secret');
  let secret = process.env.SECRET_KEY;
  if (!secret) {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    secret = fs.readFileSync(keyFile, 'utf8');
  }
  const store = new Store(path.join(dataDir, 'db.json'), secret);
  const port = process.env.PORT || 3000;
  createApp({ store, token, sessionsDir: path.join(dataDir, 'sessions') })
    .listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Open http://localhost:${port}`));
}

module.exports = { createApp };
