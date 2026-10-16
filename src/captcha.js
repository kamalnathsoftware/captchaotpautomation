const crypto = require('crypto');

// Captcha challenges are solved by a human operator through the UI (or by any
// external solver that calls the API). The automation just waits for the answer.
class CaptchaQueue {
  constructor() { this.tasks = new Map(); this.waiters = new Map(); }
  create({ appId = null, type = 'image', image = null, hint = '', sitekey = null, pageUrl = null, ttlMs = 180000 }) {
    const t = { id: crypto.randomUUID(), appId, type, image, hint, sitekey, pageUrl,
      status: 'pending', answer: null, createdAt: Date.now(), expiresAt: Date.now() + ttlMs };
    this.tasks.set(t.id, t);
    return t;
  }
  get(id) { this.sweep(); return this.tasks.get(id) || null; }
  list(status) { this.sweep(); return [...this.tasks.values()].filter((t) => !status || t.status === status); }
  solve(id, answer) {
    const t = this.get(id);
    if (!t) return null;
    if (t.status !== 'pending') return t;
    t.status = 'solved'; t.answer = String(answer); t.solvedAt = Date.now();
    return t;
  }
  reject(id) { const t = this.get(id); if (t && t.status === 'pending') t.status = 'rejected'; return t; }
  sweep() {
    const now = Date.now();
    for (const t of this.tasks.values()) {
      if (t.status === 'pending' && t.expiresAt < now) t.status = 'expired';
      if (now - t.createdAt > 3600000) this.tasks.delete(t.id);
    }
  }
  async wait(id, { pollMs = 500 } = {}) {
    for (;;) {
      const t = this.get(id);
      if (!t) throw new Error('Captcha task vanished');
      if (t.status === 'solved') return t.answer;
      if (t.status !== 'pending') throw Object.assign(new Error(`Captcha ${t.status}`), { code: 'CAPTCHA_' + t.status.toUpperCase() });
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

module.exports = { CaptchaQueue };
