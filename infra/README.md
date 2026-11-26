# bearsoft.ai contact flows: infrastructure (not deployed)

Nothing in this folder is live yet. GitHub Pages serves only the static site at the repo root; `/infra` is source for two tiny services that Jimmy deploys once.

```
bearsoft.ai (GitHub Pages, static)
 ├─ #talk  Book a call ───────────▶ Google Calendar booking page (15 or 20 min)
 │         Chat on WhatsApp ──────▶ wa.me/50672210087 (pre-filled text)
 │         Prefer email? ─────────▶ mailto:jimmy@bearsoft.ai
 └─ #join-apply  Continue with GitHub (+ optional LinkedIn URL, 280-char note)
        │ GET /auth/github/start
        ▼
   Cloudflare Worker "bearsoft-connect" (infra/worker, free tier, stores nothing)
        │ OAuth with GitHub (scope read:user user:email, state + PKCE, signed 10-min cookie)
        │ GET /user, /user/emails → drop token
        │ POST JSON + shared secret
        ▼
   Google Apps Script web app (infra/apps-script) → row in "Bearsoft · Engineers" Sheet + email to jimmy@bearsoft.ai
        │
        ▼ 302 → https://bearsoft.ai/?n=<first name>#thanks   (or #error)
```

| Piece | Where | Cost |
|---|---|---|
| Static site, privacy.html | repo root → GitHub Pages | €0 |
| Worker | `infra/worker` → Cloudflare Workers (`*.workers.dev`, no DNS change) | €0 (free plan) |
| Intake | `infra/apps-script` → Google Apps Script bound to a Sheet | €0 (Workspace) |

No DNS changes at GoDaddy are needed. The Google Workspace email records are not touched.

## Feature flags (what is live right now)

As of 26 November 2026, the live site shows **Book a call** (the primary button, Google Calendar booking page), **Chat on WhatsApp**, and the email link on the customer side, and an **"Email us your GitHub & LinkedIn"** mailto button on the engineer side. **Continue with GitHub** stays in the markup but is switched off.

There are two switches in `index.html`:

1. **Flags** on the contact section: `<section … id="contact" data-booking="on" data-github="off">`
2. **URLs** in the `CONTACT_CONFIG` constant near the bottom of the file: `bookingUrl: 'https://calendar.app.google/zigT53HotYo2Ujdk9'` and `workerUrl: ''`

A feature shows only when **both** its flag is `"on"` **and** its URL is set. If either one is missing, the JavaScript forces the flag back to `off`. A half-configured feature therefore can never show a dead button.

| Flag | When `off` (now) | When `on` |
|---|---|---|
| `data-booking` | Book a call hidden; WhatsApp is the solid primary button; intro reads "Message us on WhatsApp…" | Book a call is primary (link from `bookingUrl`); WhatsApp goes back to the outlined button. **On now.** |
| `data-github` | GitHub panel, LinkedIn/note fields, consent line and the `#thanks`/`#error` messages hidden; shows the "Email us your GitHub & LinkedIn" mailto (`subject=Join Bearsoft`) | Continue with GitHub form posts to `workerUrl + /auth/github/start`; the mailto fallback is hidden |

The CSS classes that drive this are `.if-booking`, `.if-booking-off`, `.if-github` and `.if-github-off`.

### Switching features on

- **Booking:** done. The live site uses `https://calendar.app.google/zigT53HotYo2Ujdk9` and `data-booking="on"`.
- **GitHub:** finish steps 2–5, put `https://bearsoft-connect.<subdomain>.workers.dev` in `CONTACT_CONFIG.workerUrl`, and set `data-github="on"`.
- Then test on desktop and mobile before pushing to `main`.

## Setup steps that need Jimmy

Do them in this order. None of them needs a credit card.

1. **Booking page — done.** Google Calendar appointment schedule **"Bearsoft · Intro call"** is live at https://calendar.app.google/zigT53HotYo2Ujdk9.
   - It lives on **jimmy@thebearsoft.com** (`jimmy@bearsoft.ai` is an alias of that Workspace account, not a sign-in of its own).
   - Length: **20 minutes** (never 30). Hours: **Mon–Fri 8:00 AM–6:00 PM US Central** (time zone *Central Time – Chicago*).
   - 10-minute buffer, 24 h minimum notice, Google Meet on. Booking form includes "What are you trying to ship?"
   - The free Google plan allows only one booking page, so the old **"30 min with Jimmy"** page was converted into this one. Anyone with the old link now lands on the Bearsoft intro call.
   - The site has the link in `CONTACT_CONFIG.bookingUrl` and `data-booking="on"`.
2. **GitHub OAuth App in the `bearsoft-ai` org.** First make sure `geekjimbo` is an **owner** of https://github.com/bearsoft-ai. Then go to Org → Settings → Developer settings → OAuth Apps → *New OAuth App* and enter:
   - Application name: **Bearsoft**
   - Homepage URL: `https://bearsoft.ai`
   - Authorization callback URL: `https://bearsoft-connect.<your-subdomain>.workers.dev/auth/github/callback` (the subdomain comes from step 3)
   - Upload the Bearsoft logo.
   - Click *Generate a new client secret*. Keep the Client ID and the secret for step 5. Never commit them or paste them in chat.
3. **Cloudflare account (free).** Sign up at dash.cloudflare.com and choose a workers.dev subdomain under Workers & Pages. There's no need to move DNS to Cloudflare. Then run:
   ```bash
   cd infra/worker && npm install && npx wrangler login
   ```
4. **Sheet + Apps Script.**
   - In Google Drive (jimmy@bearsoft.ai), create a Sheet named **"Bearsoft · Engineers"**.
   - Open Extensions → Apps Script. Paste `apps-script/Code.gs`. In Project Settings, enable "Show appsscript.json" and paste `apps-script/appsscript.json`.
   - In Project Settings → Script properties, set:
     - `SHARED_SECRET`: a long random string, for example from `openssl rand -base64 48`
     - `NOTIFY_EMAIL`: `jimmy@bearsoft.ai`
     - `RETENTION_DAYS`: `730`
   - Run `setup` once and authorize it.
   - Deploy → New deployment → **Web app**, Execute as *Me*, Who has access *Anyone*. Copy the `/exec` URL.
   - If the Workspace admin console blocks "Anyone" access for web apps, allow it for this script.
   - Optional: add a daily time-driven trigger for `purgeOld`, which handles 24-month retention.
5. **Secrets and deploy the Worker.** From `infra/worker`:
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put COOKIE_SECRET        # another long random string
   npx wrangler secret put SHEET_WEBHOOK_URL    # the Apps Script /exec URL
   npx wrangler secret put SHEET_SECRET         # same value as SHARED_SECRET in step 4
   npm test && npx wrangler deploy
   ```
   Check it with `curl https://bearsoft-connect.<subdomain>.workers.dev/health`, which should return `ok`.
6. **Point the site at the Worker and switch it on.** Set `CONTACT_CONFIG.workerUrl` and `data-github="on"` (see *Feature flags*). Make sure the OAuth App callback URL matches exactly.
7. **WhatsApp Business (recommended).** Move +506 7221 0087 to the free WhatsApp Business app.
   - Profile name: **Bearsoft**.
   - Set a greeting message, an away message, and business hours that match the booking page.
   - The site uses a plain `wa.me` link. No Meta script or pixel is added.
8. **Test end to end** on desktop and on a phone:
   - Booking works.
   - WhatsApp opens the app on mobile and WhatsApp Web on desktop.
   - Continue with GitHub lands on `#thanks`, a row appears in the Sheet, and the alert email arrives.
   - Cancelling on GitHub lands on `#error`.

## Decided

- Typefaces are self-hosted in `assets/fonts/`. The privacy notice states that no third-party font requests are made.
- Footer line: "We build Sovereign AI by Design."

## Still open (flagged)

- **GDPR Art. 27:** Bearsoft Inc is a US controller that offers services to people in the EU. Check whether it must appoint an EU representative. If so, add the representative's details to `privacy.html` in EN and ES (there's a TODO comment in the file).
- **`<meta name="robots" content="noindex">`** is set on `index.html` and `privacy.html`. Remove it when the site should be indexed.

## Local checks

```bash
cd infra/worker && npm test          # 12 tests: input validation, signed cookie, PKCE, happy path, failures
python3 -m http.server 8765          # from the repo root, then open http://localhost:8765/#talk
```
