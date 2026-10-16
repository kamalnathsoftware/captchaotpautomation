const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./crypto');

const SECRET_FIELDS = ['password', 'totpSecret'];

// Tiny JSON-file store. Secret fields are encrypted at rest.
class Store {
  constructor(file, secret) {
    this.file = file;
    this.secret = secret;
    this.data = { apps: {}, mailbox: null };
    if (file && fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
  listApps() { return Object.values(this.data.apps).map((a) => this.redact(a)); }
  getApp(id, { withSecrets = false } = {}) {
    const a = this.data.apps[id];
    if (!a) return null;
    if (!withSecrets) return this.redact(a);
    const out = { ...a };
    for (const f of SECRET_FIELDS) out[f] = decrypt(a[f], this.secret);
    return out;
  }
  upsertApp(input, id = null) {
    id = id || input.id || crypto.randomUUID();
    const prev = this.data.apps[id] || {};
    const next = { ...prev, ...input, id };
    for (const f of SECRET_FIELDS) {
      // empty/undefined secret on update keeps the stored one
      if (input[f]) next[f] = encrypt(input[f], this.secret);
      else next[f] = prev[f] || '';
    }
    this.data.apps[id] = next;
    this.save();
    return this.redact(next);
  }
  deleteApp(id) { const ok = delete this.data.apps[id]; this.save(); return ok; }
  redact(a) {
    const out = { ...a };
    for (const f of SECRET_FIELDS) { out[`has_${f}`] = !!a[f]; delete out[f]; }
    return out;
  }
  getMailbox({ withSecrets = false } = {}) {
    const m = this.data.mailbox;
    if (!m) return null;
    if (withSecrets) return { ...m, pass: decrypt(m.pass, this.secret) };
    const { pass, ...rest } = m;
    return { ...rest, has_pass: !!pass };
  }
  setMailbox(m) {
    const prev = this.data.mailbox || {};
    this.data.mailbox = { ...prev, ...m, pass: m.pass ? encrypt(m.pass, this.secret) : prev.pass || '' };
    this.save();
    return this.getMailbox();
  }
}

module.exports = { Store };
