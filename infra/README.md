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

## Placeholders in the site

`index.html` has two placeholders, each in the `CONTACT_CONFIG` constant near the bottom of the file and in one fallback `href`/`action` (so it also works without JavaScript). Replace both occurrences of each:

| Placeholder | Replace with |
|---|---|
| `https://calendar.app.google/REPLACE_WITH_BOOKING_LINK` | the Google Calendar booking page link (step 1) |
| `REPLACE_WITH_CF_SUBDOMAIN` | your Cloudflare workers.dev subdomain (step 3) |

`grep -n REPLACE_WITH index.html` must return nothing before merging.

## Setup steps that need Jimmy

Do them in this order. None of them needs a credit card.

1. **Booking page (Google Calendar, jimmy@bearsoft.ai).** In Calendar, create an *Appointment schedule* named **"Bearsoft · Intro call"**.
   - Length: **15 or 20 minutes** (never 30).
   - Hours: **TBD**. Placeholder is **Mon–Fri 9:00–13:00 US Eastern**.
   - Suggested: 10-minute buffer, at least 24 h notice, Google Meet on.
   - Booking form: name, email, and one question: "What are you trying to ship?"
   - Title and description must say **Bearsoft** only.
   - Copy the booking page link and paste it into `index.html` (two places, see above).
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
   - Optional: add a monthly time-driven trigger for `purgeOld`, which handles 24-month retention.
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
6. **Point the site at the Worker.** Replace `REPLACE_WITH_CF_SUBDOMAIN` in `index.html` (two places). Make sure the OAuth App callback URL matches exactly.
7. **WhatsApp Business (recommended).** Move +506 7221 0087 to the free WhatsApp Business app.
   - Profile name: **Bearsoft**.
   - Set a greeting message, an away message, and business hours that match the booking page.
   - The site uses a plain `wa.me` link. No Meta script or pixel is added.
8. **Test end to end** on desktop and on a phone:
   - Booking works.
   - WhatsApp opens the app on mobile and WhatsApp Web on desktop.
   - Continue with GitHub lands on `#thanks`, a row appears in the Sheet, and the alert email arrives.
   - Cancelling on GitHub lands on `#error`.

## Before merging to `main` (flagged)

- **GDPR Art. 27:** Bearsoft Inc is a US controller that offers services to people in the EU. Check whether it must appoint an EU representative. If so, add the representative's details to `privacy.html` in EN and ES (there's a TODO comment in the file).
- **Google Fonts:** the site loads fonts from `fonts.googleapis.com`, which sends visitors' IP addresses to Google. Self-hosting the three font families would avoid this. Otherwise, mention Google Fonts in `privacy.html`.
- **Footer line "We build Sovereign by Design."** This is existing copy, unchanged by this branch. It names the credo house, so it relates to Open decision #5 and the house rule.
- **`<meta name="robots" content="noindex">`** is set on `index.html` and `privacy.html`. Remove it when the site should be indexed.
- **Placeholders:** `grep REPLACE_WITH index.html` must return nothing.

## Local checks

```bash
cd infra/worker && npm test          # 12 tests: input validation, signed cookie, PKCE, happy path, failures
python3 -m http.server 8765          # from the repo root, then open http://localhost:8765/#talk
```
