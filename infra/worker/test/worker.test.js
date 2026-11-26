import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  SITE_URL: 'https://bearsoft.ai/', GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'csec',
  COOKIE_SECRET: 'cookie-secret', SHEET_WEBHOOK_URL: 'https://script.example/exec', SHEET_SECRET: 'shh',
};
const W = 'https://bearsoft-connect.test.workers.dev';

async function startFlow() {
  const res = await worker.fetch(new Request(`${W}/auth/github/start?linkedin=${encodeURIComponent('https://www.linkedin.com/in/ana/')}&note=hola&cv=2026-11-v1`), env);
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('scope'), 'read:user user:email');
  assert.equal(loc.searchParams.get('redirect_uri'), `${W}/auth/github/callback`);
  assert.ok(!loc.search.includes('hola'), 'note must not travel through GitHub URLs');
  const cookie = res.headers.get('Set-Cookie').split(';')[0];
  return { state: loc.searchParams.get('state'), cookie };
}

test('happy path: start -> callback -> Sheet webhook -> #thanks', async () => {
  const { state, cookie } = await startFlow();
  let posted;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes('access_token')) return Response.json({ access_token: 'tok' });
    if (url.endsWith('/user')) return Response.json({ login: 'ana', name: 'Ana Pérez', public_repos: 12, hireable: true });
    if (url.endsWith('/user/emails')) return Response.json([{ email: 'ana@x.com', verified: true, primary: true }]);
    if (url === env.SHEET_WEBHOOK_URL) { posted = JSON.parse(init.body); return Response.json({ ok: true }); }
    throw new Error('unexpected ' + url);
  };
  const res = await worker.fetch(new Request(`${W}/auth/github/callback?code=c&state=${state}`, { headers: { Cookie: cookie } }), env);
  assert.equal(res.headers.get('Location'), 'https://bearsoft.ai/?n=Ana#thanks');
  assert.equal(posted.secret, 'shh');
  assert.equal(posted.row.email, 'ana@x.com');
  assert.equal(posted.row.linkedin_url, 'https://www.linkedin.com/in/ana/');
  assert.equal(posted.row.note, 'hola');
  assert.equal(posted.row.consent_version, '2026-11-v1');
  assert.ok(!JSON.stringify(posted).includes('tok'), 'token must not be forwarded');
});

test('state mismatch -> #error', async () => {
  const { cookie } = await startFlow();
  const res = await worker.fetch(new Request(`${W}/auth/github/callback?code=c&state=nope`, { headers: { Cookie: cookie } }), env);
  assert.equal(res.headers.get('Location'), 'https://bearsoft.ai/#error');
});

test('user denies on GitHub -> #error', async () => {
  const res = await worker.fetch(new Request(`${W}/auth/github/callback?error=access_denied`), env);
  assert.equal(res.headers.get('Location'), 'https://bearsoft.ai/#error');
});

test('Sheet webhook failure -> #error, not a silent success', async () => {
  const { state, cookie } = await startFlow();
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('access_token')) return Response.json({ access_token: 'tok' });
    if (url.endsWith('/user')) return Response.json({ login: 'ana' });
    if (url.endsWith('/user/emails')) return Response.json([]);
    return Response.json({ ok: false }, { status: 500 });
  };
  const res = await worker.fetch(new Request(`${W}/auth/github/callback?code=c&state=${state}`, { headers: { Cookie: cookie } }), env);
  assert.equal(res.headers.get('Location'), 'https://bearsoft.ai/#error');
});
