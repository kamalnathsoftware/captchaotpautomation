# Login Automation Hub

A Node.js server + web UI that connects your applications through an API and automates sign-in:

| Need | How it's handled |
|---|---|
| **OTP from email** | Reads your own mailbox over IMAP (Gmail app password works), extracts the newest code, fills it in. Also exposed as `GET /api/otp`. |
| **Captcha** | Queued in the UI (**Captcha queue** tab). The automation screenshots the captcha, a human types the answer, the run continues. Any external solver can use `POST /api/captcha` + `/solve`. |
| **No authenticator, Google login present** | Auto mode: authenticator (TOTP) if a secret is stored → else *Sign in with Google* if the page has that button → else password. Google's emailed/typed verification code is read from the mailbox. |
| **App connections** | `POST /api/apps` with login URL + CSS selectors; run with `POST /api/apps/:id/login`; poll `GET /api/jobs/:id`. |

## Run
```bash
npm install
ADMIN_TOKEN=choose-a-long-token npm start     # http://localhost:3000
```
Env: `ADMIN_TOKEN` (API/UI bearer token), `SECRET_KEY` (encrypts stored passwords/TOTP seeds; otherwise a key file is generated in `data/`), `PORT`, `HOST` (default 127.0.0.1), `HEADLESS=false` to watch the browser, `CHROMIUM_PATH` for a custom Chromium (install one with `npx playwright-core install chromium`).

## Notes / limits
- Captchas are **not** auto-bypassed, and no bot-detection evasion is included. Image captchas are answered by a person in the UI. For reCAPTCHA/hCaptcha widgets run with `HEADLESS=false`: a person solves the real widget in the browser window and the run resumes. For sites you own, use the vendor test keys or disable the captcha in staging; for others, use their official API.
- Google may block automated sign-in or show extra prompts (device confirmation, "unusual activity"); the Google flow is best-effort. Use only with accounts you own and sites whose terms permit automation.
- Secrets are encrypted at rest; keep the server on localhost or behind HTTPS.
- `npm test` runs unit tests and a browser e2e (mock site with captcha + emailed OTP).
