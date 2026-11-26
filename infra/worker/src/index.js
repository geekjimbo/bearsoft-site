// bearsoft-connect: a stateless Cloudflare Worker that turns "Continue with GitHub"
// on bearsoft.ai into one row in a Google Sheet (via Apps Script) and an email to Jimmy.
//
// Routes
//   GET /auth/github/start?linkedin=&note=&cv=   -> 302 to GitHub authorize
//   GET /auth/github/callback?code=&state=       -> fetch profile, POST to Apps Script, 302 to bearsoft.ai/#thanks
//   GET /health                                   -> "ok"
//
// It stores nothing. The optional LinkedIn URL and note ride the OAuth round trip in a signed,
// HttpOnly, 10-minute cookie bound to the OAuth `state` (so they never pass through GitHub's URLs).
// The GitHub token is used for two API calls and dropped. No personal data is logged.
//
// Secrets (wrangler secret put …): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, COOKIE_SECRET, SHEET_WEBHOOK_URL, SHEET_SECRET
// Vars (wrangler.toml): SITE_URL

import {
  COOKIE_NAME, COOKIE_MAX_AGE, cleanInputs, randomToken, pkceChallenge,
  seal, unseal, readCookie, pickEmail, profileRow, firstName,
} from './lib.js';

const GH_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GH_TOKEN = 'https://github.com/login/oauth/access_token';
const GH_API = 'https://api.github.com';
const UA = 'bearsoft-connect';

function redirect(location, cookie) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (cookie) h.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers: h });
}
const cookieHeader = (value, maxAge) =>
  `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
const clearCookie = () => cookieHeader('', 0);

function siteUrl(env, hash, name) {
  const u = new URL(env.SITE_URL || 'https://bearsoft.ai/');
  if (name) u.searchParams.set('n', name);
  u.hash = hash;
  return u.toString();
}

async function start(request, env) {
  const url = new URL(request.url);
  const extra = cleanInputs(url.searchParams);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const sealed = await seal({ s: state, v: verifier, t: Date.now(), ...extra }, env.COOKIE_SECRET);

  const gh = new URL(GH_AUTHORIZE);
  gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', `${url.origin}/auth/github/callback`);
  gh.searchParams.set('scope', 'read:user user:email');
  gh.searchParams.set('state', state);
  gh.searchParams.set('allow_signup', 'false');
  gh.searchParams.set('code_challenge', await pkceChallenge(verifier));
  gh.searchParams.set('code_challenge_method', 'S256');
  return redirect(gh.toString(), cookieHeader(sealed, COOKIE_MAX_AGE));
}

async function callback(request, env) {
  const url = new URL(request.url);
  const fail = (why) => {
    console.log(JSON.stringify({ evt: 'join_failed', why })); // reason only, never personal data
    return redirect(siteUrl(env, 'error'), clearCookie());
  };
  if (url.searchParams.get('error')) return fail('denied_or_github_error');

  const ctx = await unseal(readCookie(request.headers.get('Cookie'), COOKIE_NAME), env.COOKIE_SECRET);
  if (!ctx) return fail('no_cookie');
  if (Date.now() - ctx.t > COOKIE_MAX_AGE * 1000) return fail('expired');
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || state !== ctx.s || !code) return fail('bad_state');

  // 1. code -> token
  const tokRes = await fetch(GH_TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/github/callback`,
      code_verifier: ctx.v,
    }),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return fail('token_exchange');

  // 2. profile + emails, then drop the token
  const gh = (path) => fetch(`${GH_API}${path}`, {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  const [uRes, eRes] = await Promise.all([gh('/user'), gh('/user/emails')]);
  if (!uRes.ok) return fail('github_user');
  const user = await uRes.json();
  const emails = eRes.ok ? await eRes.json() : [];
  const row = profileRow(user, pickEmail(emails, user.email), ctx);

  // 3. hand off to Apps Script (Sheet row + email to Jimmy)
  const hook = await fetch(env.SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.SHEET_SECRET, kind: 'engineer', row }),
    redirect: 'follow',
  });
  const out = await hook.json().catch(() => ({}));
  if (!hook.ok || !out.ok) return fail('sheet_webhook');

  return redirect(siteUrl(env, 'thanks', firstName(user)), clearCookie());
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    try {
      if (pathname === '/auth/github/start') return await start(request, env);
      if (pathname === '/auth/github/callback') return await callback(request, env);
      if (pathname === '/health') return new Response('ok');
      return redirect(siteUrl(env, 'join-apply'));
    } catch (err) {
      console.log(JSON.stringify({ evt: 'join_failed', why: 'exception', msg: String(err && err.message).slice(0, 200) }));
      return redirect(siteUrl(env, 'error'), clearCookie());
    }
  },
};
