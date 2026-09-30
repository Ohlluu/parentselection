const crypto = require('crypto');

// Validated in config.js, which the server checks before serving any route.
// Importing this file must not kill the process - on a serverless host that
// turns a missing variable into an unexplained 500.
const SECRET = process.env.SESSION_SECRET || '';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const COOKIE_NAME = 'pe_session';

// No 0/O or 1/I/L, so a code can't be misread off a printout or mistyped.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// Eight characters from a 31-letter alphabet is about 8.5e11 combinations.
// These codes live for the whole election rather than 15 minutes, so they
// need materially more entropy than a one-time password would.
function generateCode() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// Parents will type these off a phone screen, so accept any casing and ignore
// spaces and dashes: "k7p4 2wqm" and "K7P42WQM" both match "K7P4-2WQM".
function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function codesMatch(supplied, stored) {
  const a = Buffer.from(normalizeCode(supplied));
  const b = Buffer.from(normalizeCode(stored));
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Sessions are a signed cookie, not a database table, so the server keeps no
// record of who was signed in at what time.
function issueSession(payload) {
  const body = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function readSession(token) {
  if (!token || typeof token !== 'string') return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;

  const expected = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let body;
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!body.exp || Date.now() > body.exp) return null;
  return body;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return acc;
  }, {});
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`);
}

function sessionFromRequest(req) {
  return readSession(parseCookies(req)[COOKIE_NAME]);
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  generateCode,
  normalizeCode,
  codesMatch,
  normalizeEmail,
  issueSession,
  readSession,
  sessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
};
