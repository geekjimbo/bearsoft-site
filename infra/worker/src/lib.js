// Pure helpers, kept separate so they can be unit-tested with `node --test`.

export const NOTE_MAX = 280;
export const LINKEDIN_RE = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/;
export const COOKIE_NAME = '__Host-bs_oauth';
export const COOKIE_MAX_AGE = 600; // seconds

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
export function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}
export async function pkceChallenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
}

/** Validate the optional fields coming from the bearsoft.ai join panel. */
export function cleanInputs(params) {
  let linkedin = (params.get('linkedin') || '').trim();
  let note = (params.get('note') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const cv = (params.get('cv') || '').trim().slice(0, 32);
  if (linkedin && !LINKEDIN_RE.test(linkedin)) linkedin = '';
  if (note.length > NOTE_MAX) note = note.slice(0, NOTE_MAX);
  return { linkedin, note, cv: /^[\w.-]+$/.test(cv) ? cv : '' };
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
/** Sign a small JSON payload: base64url(json).base64url(hmac). */
export async function seal(obj, secret) {
  const body = b64url(enc.encode(JSON.stringify(obj)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
export async function unseal(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  if (!ok) return null;
  try { return JSON.parse(new TextDecoder().decode(b64urlDecode(body))); } catch { return null; }
}

export function readCookie(header, name) {
  for (const part of (header || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

/** Pick the primary verified email, else any verified one. */
export function pickEmail(emails, fallback) {
  if (Array.isArray(emails)) {
    const v = emails.filter(e => e && e.verified);
    const p = v.find(e => e.primary) || v.find(e => !/noreply\.github\.com$/.test(e.email)) || v[0];
    if (p) return p.email;
  }
  return fallback || '';
}

/** Only the fields we promise in the privacy notice. */
export function profileRow(user, email, extra) {
  return {
    login: user.login || '',
    name: user.name || '',
    email,
    company: user.company || '',
    location: user.location || '',
    blog: user.blog || '',
    bio: user.bio || '',
    public_repos: user.public_repos ?? '',
    followers: user.followers ?? '',
    hireable: user.hireable === true ? 'yes' : (user.hireable === false ? 'no' : ''),
    created_at: user.created_at || '',
    html_url: user.html_url || '',
    linkedin_url: extra.linkedin || '',
    note: extra.note || '',
    consent_version: extra.cv || '',
  };
}

export function firstName(user) {
  const n = (user.name || user.login || '').trim().split(/\s+/)[0] || '';
  return n.replace(/[^\p{L}\p{N}'-]/gu, '').slice(0, 40);
}
