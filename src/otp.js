// Fetch one-time codes from the user's own mailbox (IMAP) and extract them.

function extractOtp(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ');
  const kw = /(?:code|otp|passcode|pin|verification|verify)[^0-9]{0,40}(\d{4,8})\b/i.exec(t);
  if (kw) return kw[1];
  const rev = /\b(\d{4,8})\b[^0-9]{0,20}(?:is your|as your)/i.exec(t);
  if (rev) return rev[1];
  const six = /\b(\d{6})\b/.exec(t);
  return six ? six[1] : null;
}

class ImapMailProvider {
  constructor(cfg) { this.cfg = cfg; }
  // Returns recent messages newer than `since` (Date) as {from, subject, text, date}
  async fetchRecent({ since }) {
    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');
    const c = this.cfg;
    const client = new ImapFlow({
      host: c.host, port: c.port || 993, secure: c.secure !== false,
      auth: { user: c.user, pass: c.pass }, logger: false,
    });
    await client.connect();
    const out = [];
    try {
      const lock = await client.getMailboxLock(c.folder || 'INBOX');
      try {
        const uids = await client.search({ since: new Date(since.getTime() - 86400000) }, { uid: true });
        for (const uid of (uids || []).slice(-25)) {
          const msg = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
          const date = msg.internalDate;
          if (date < since) continue;
          const p = await simpleParser(msg.source);
          out.push({ from: p.from?.text || '', subject: p.subject || '', text: p.text || '', date });
        }
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
    return out;
  }
}

// Polls the provider until a matching mail with an OTP arrives.
async function waitForOtp(provider, { from, subject, since = new Date(Date.now() - 60000),
  timeoutMs = 90000, intervalMs = 4000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  const match = (s, f) => !f || String(s).toLowerCase().includes(String(f).toLowerCase());
  let lastError;
  do {
    try {
      const msgs = await provider.fetchRecent({ since });
      msgs.sort((a, b) => b.date - a.date);
      for (const m of msgs) {
        if (!match(m.from, from) || !match(m.subject, subject)) continue;
        const code = extractOtp(`${m.subject}\n${m.text}`);
        if (code) return { code, from: m.from, subject: m.subject, receivedAt: m.date };
      }
    } catch (e) { lastError = e; }
    await sleep(intervalMs);
  } while (Date.now() < deadline);
  const err = new Error('Timed out waiting for OTP email' + (lastError ? `: ${lastError.message}` : ''));
  err.code = 'OTP_TIMEOUT';
  throw err;
}

module.exports = { extractOtp, waitForOtp, ImapMailProvider };
