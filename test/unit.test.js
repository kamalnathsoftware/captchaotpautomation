const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOtp, waitForOtp } = require('../src/otp');
const { totp, encrypt, decrypt } = require('../src/crypto');
const { chooseMethod } = require('../src/automation');
const { CaptchaQueue } = require('../src/captcha');

test('extractOtp handles common email wordings', () => {
  assert.equal(extractOtp('Your verification code is 482913. It expires in 10 minutes'), '482913');
  assert.equal(extractOtp('Use OTP: 7731 to sign in'), '7731');
  assert.equal(extractOtp('482913 is your Google verification code'), '482913');
  assert.equal(extractOtp('no code here'), null);
});

test('totp matches RFC 6238 vector', () => {
  // secret "12345678901234567890" in base32, T=59s => 94287082 (8 digits)
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000, 8), '94287082');
});

test('encrypt/decrypt roundtrip', () => {
  const e = encrypt('hunter2', 'k');
  assert.notEqual(e, 'hunter2');
  assert.equal(decrypt(e, 'k'), 'hunter2');
  assert.throws(() => decrypt(e, 'other'));
});

test('chooseMethod: no authenticator + google button => google', () => {
  assert.equal(chooseMethod({}, { hasGoogleButton: true }), 'google');
  assert.equal(chooseMethod({ totpSecret: 'X' }, { hasGoogleButton: true }), 'password');
  assert.equal(chooseMethod({}, { hasGoogleButton: false }), 'password');
  assert.equal(chooseMethod({ authMode: 'google', totpSecret: 'X' }, {}), 'google');
});

test('waitForOtp picks newest matching mail and times out otherwise', async () => {
  const now = Date.now();
  const provider = { fetchRecent: async () => [
    { from: 'a@x.com', subject: 'old', text: 'code 111111', date: new Date(now - 5000) },
    { from: 'noreply@app.com', subject: 'Your code', text: 'code 222222', date: new Date(now) }] };
  const r = await waitForOtp(provider, { from: 'app.com', timeoutMs: 100, intervalMs: 10 });
  assert.equal(r.code, '222222');
  await assert.rejects(waitForOtp(provider, { from: 'nobody', timeoutMs: 50, intervalMs: 10 }), { code: 'OTP_TIMEOUT' });
});

test('captcha queue solve/expire', async () => {
  const q = new CaptchaQueue();
  const t = q.create({});
  setTimeout(() => q.solve(t.id, 'abcd'), 20);
  assert.equal(await q.wait(t.id, { pollMs: 10 }), 'abcd');
  const e = q.create({ ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(q.wait(e.id, { pollMs: 5 }), { code: 'CAPTCHA_EXPIRED' });
});
