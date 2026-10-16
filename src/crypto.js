const crypto = require('crypto');

// AES-256-GCM for secrets at rest (passwords, TOTP seeds, IMAP creds).
function keyFrom(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(plain, secret) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decrypt(blob, secret) {
  if (!blob) return '';
  if (!blob.startsWith('enc:')) return blob;
  const raw = Buffer.from(blob.slice(4), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

// RFC 6238 TOTP (SHA1, 6 digits, 30s) - for apps that DO have an authenticator.
function base32Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/[\s=-]/g, '').toUpperCase()) {
    const v = alpha.indexOf(ch);
    if (v < 0) throw new Error('Invalid base32 TOTP secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

function totp(secret, now = Date.now(), digits = 6, step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / step)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

module.exports = { encrypt, decrypt, totp };
