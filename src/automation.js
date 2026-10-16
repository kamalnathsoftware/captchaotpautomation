const fs = require('fs');
const path = require('path');
const { totp } = require('./crypto');
const { waitForOtp } = require('./otp');

// Decide how to sign in. Authenticator (TOTP) is used when configured;
// otherwise "Sign in with Google" if the app offers it; otherwise plain password.
function chooseMethod(app, { hasGoogleButton }) {
  if (app.authMode && app.authMode !== 'auto') return app.authMode;
  if (app.has_totpSecret || app.totpSecret) return 'password';
  if (hasGoogleButton) return 'google';
  return 'password';
}

const GOOGLE = {
  email: 'input[type=email], #identifierId',
  password: 'input[type=password][name=Passwd], input[type=password]',
  next: '#identifierNext, #passwordNext, button:has-text("Next")',
  code: 'input[name=totpPin], input[type=tel], input[name=idvPin]',
};

class Runner {
  constructor({ captcha, mailProvider, sessionsDir, launch, log }) {
    Object.assign(this, { captcha, mailProvider, sessionsDir, log: log || (() => {}) });
    this.launch = launch || (async () => {
      const { chromium } = require('playwright-core');
      return chromium.launch({ headless: process.env.HEADLESS !== 'false',
        executablePath: process.env.CHROMIUM_PATH || undefined,
        // Chromium refuses to start sandboxed as root (typical in containers)
        args: process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : [] });
    });
  }

  async solveCaptchaIfPresent(page, app, ctx = page) {
    const sel = app.selectors || {};
    if (!sel.captchaImage || !(await page.locator(sel.captchaImage).first().isVisible().catch(() => false))) return false;
    this.log('Captcha detected - queued for operator');
    const png = await page.locator(sel.captchaImage).first().screenshot();
    const task = this.captcha.create({ appId: app.id, type: 'image', image: png.toString('base64'),
      hint: `Captcha for ${app.name}`, pageUrl: page.url() });
    const answer = await this.captcha.wait(task.id);
    await page.fill(sel.captchaInput, answer);
    this.log('Captcha answer filled');
    return true;
  }

  async fillOtpFromMail(page, input, app) {
    this.log('Waiting for OTP email...');
    const { code } = await waitForOtp(this.mailProvider(), {
      from: app.otpSender, subject: app.otpSubject, since: new Date(Date.now() - 90000) });
    await page.fill(input, code);
    this.log('OTP filled from email');
  }

  async googleFlow(page, app) {
    const sel = app.selectors || {};
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
      page.click(sel.googleButton),
    ]);
    const g = popup || page;
    await g.waitForSelector(GOOGLE.email, { timeout: 20000 });
    await g.fill(GOOGLE.email, app.googleEmail || app.username);
    await g.click(GOOGLE.next);
    await g.waitForSelector(GOOGLE.password, { timeout: 20000 });
    await g.fill(GOOGLE.password, app.password);
    await g.click(GOOGLE.next);
    // Google may challenge with an emailed/typed code
    const challenge = await g.waitForSelector(GOOGLE.code, { timeout: 8000 }).catch(() => null);
    if (challenge) {
      if (app.has_totpSecret || app.totpSecret) await g.fill(GOOGLE.code, totp(app.totpSecret));
      else await this.fillOtpFromMail(g, GOOGLE.code, { ...app, otpSender: app.otpSender || 'google' });
      await g.click(GOOGLE.next);
    }
    this.log('Google sign-in submitted');
  }

  async passwordFlow(page, app) {
    const sel = app.selectors;
    await page.fill(sel.username, app.username);
    await page.fill(sel.password, app.password);
    await this.solveCaptchaIfPresent(page, app);
    await page.click(sel.submit);
    if (sel.otp && await page.locator(sel.otp).first().isVisible({ timeout: 5000 }).catch(() => false)) {
      if (app.totpSecret) { await page.fill(sel.otp, totp(app.totpSecret)); this.log('TOTP filled'); }
      else await this.fillOtpFromMail(page, sel.otp, app);
      if (sel.otpSubmit) await page.click(sel.otpSubmit);
    }
  }

  async login(app) {
    const sel = app.selectors || {};
    const browser = await this.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(app.loginUrl, { waitUntil: 'domcontentloaded' });
      const hasGoogleButton = !!sel.googleButton &&
        await page.locator(sel.googleButton).first().isVisible().catch(() => false);
      const method = chooseMethod(app, { hasGoogleButton });
      this.log(`Auth method: ${method}`);
      if (method === 'google') await this.googleFlow(page, app);
      else await this.passwordFlow(page, app);
      if (sel.success) await page.waitForSelector(sel.success, { timeout: 30000 });
      else await page.waitForLoadState('networkidle').catch(() => {});
      if (this.sessionsDir) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
        await context.storageState({ path: path.join(this.sessionsDir, `${app.id}.json`), indexedDB: false });
      }
      this.log('Login verified');
      return { method, url: page.url() };
    } finally { await browser.close(); }
  }
}

module.exports = { Runner, chooseMethod };
