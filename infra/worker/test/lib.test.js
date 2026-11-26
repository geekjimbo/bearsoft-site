import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanInputs, seal, unseal, pickEmail, readCookie, firstName, profileRow, pkceChallenge } from '../src/lib.js';

test('cleanInputs keeps a valid LinkedIn URL and caps the note', () => {
  const p = new URLSearchParams({ linkedin: 'https://www.linkedin.com/in/ana-perez/', note: 'x'.repeat(400), cv: '2026-11-v1' });
  const r = cleanInputs(p);
  assert.equal(r.linkedin, 'https://www.linkedin.com/in/ana-perez/');
  assert.equal(r.note.length, 280);
  assert.equal(r.cv, '2026-11-v1');
});
test('cleanInputs drops non-LinkedIn URLs and odd consent versions', () => {
  const r = cleanInputs(new URLSearchParams({ linkedin: 'https://evil.example/in/x', cv: '<script>' }));
  assert.equal(r.linkedin, '');
  assert.equal(r.cv, '');
});
test('seal/unseal round-trips and rejects tampering', async () => {
  const t = await seal({ s: 'abc', note: 'hola' }, 'k1');
  assert.deepEqual(await unseal(t, 'k1'), { s: 'abc', note: 'hola' });
  assert.equal(await unseal(t, 'k2'), null);
  assert.equal(await unseal(t.slice(0, -2) + 'AA', 'k1'), null);
  assert.equal(await unseal('garbage', 'k1'), null);
});
test('pickEmail prefers primary verified, ignores unverified', () => {
  assert.equal(pickEmail([{ email: 'a@x.com', verified: false, primary: true }, { email: 'b@x.com', verified: true, primary: false }]), 'b@x.com');
  assert.equal(pickEmail([{ email: 'p@x.com', verified: true, primary: true }]), 'p@x.com');
  assert.equal(pickEmail([], 'public@x.com'), 'public@x.com');
});
test('readCookie finds the named cookie', () => {
  assert.equal(readCookie('a=1; __Host-bs_oauth=xyz.sig; b=2', '__Host-bs_oauth'), 'xyz.sig');
  assert.equal(readCookie(null, 'x'), null);
});
test('firstName is short and safe', () => {
  assert.equal(firstName({ name: 'Ana <b>Pérez</b>' }), 'Ana');
  assert.equal(firstName({ login: 'octocat' }), 'octocat');
});
test('profileRow only carries promised fields', () => {
  const row = profileRow({ login: 'o', name: 'O', hireable: true, site_admin: true, node_id: 'n' }, 'o@x.com', { linkedin: '', note: 'hi', cv: 'v1' });
  assert.equal(row.hireable, 'yes');
  assert.ok(!('site_admin' in row) && !('node_id' in row));
});
test('pkceChallenge is base64url(SHA-256(verifier)) (cross-checked with Python hashlib)', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K9uhvUcVlUeL5fZ5UwSo0fgKYw'), 'maYMHCrfRMS7psdruUP_hBraLbchbHkeWmgZ9VvDyHI');
});
