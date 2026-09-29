// netlify/edge-functions/auth-gate.mjs
//
// Round 106: password-gates the entire Sales Hub behind one shared team password. Runs at the
// edge, in front of every request - the static site AND every Netlify Function (data.mjs,
// refresh-data.mjs) - so none of it is reachable without a valid session cookie. The one
// exception is the scheduled data refresh (see below), which Netlify's own cron invokes directly
// and never carries a browser session.
//
// Required environment variables (Netlify site settings -> Environment variables -> add):
//   SITE_PASSWORD   - the one shared password the sales team enters to sign in
//   SESSION_SECRET  - any long random string (e.g. generate one at random) used to sign the
//                     session cookie so it can't be forged by editing it in the browser
// Both must be set for sign-in to work. If either is missing this deliberately fails CLOSED
// (shows a setup message, refuses access) rather than silently letting everyone in.
//
// How it works: on successful login (POST /.netlify/functions/login, see login.mjs) the browser
// gets a cookie containing an expiry timestamp plus an HMAC-SHA256 signature of that timestamp,
// signed with SESSION_SECRET. Every subsequent request, this function recomputes the signature
// and checks it matches and hasn't expired - no server-side session storage needed at all.

const COOKIE_NAME = 'ymt_session';
const SESSION_DAYS = 30;

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function isValidSession(cookieHeader, secret) {
  if (!cookieHeader) return false;
  const found = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='));
  if (!found) return false;
  const value = decodeURIComponent(found.slice(COOKIE_NAME.length + 1));
  const dot = value.lastIndexOf('.');
  if (dot < 0) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  const expected = await hmac(secret, exp);
  return expected === sig;
}

function loginPageHtml(errorMsg) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Mates Sales Hub - Sign in</title>
<style>
  body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#0f1720;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{background:#1a2430;padding:36px 40px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.4);width:320px}
  h1{font-size:19px;margin:0 0 4px;color:#f5a623}
  p.sub{margin:0 0 20px;color:#9aa5b1;font-size:13px}
  input{width:100%;padding:11px;margin-bottom:14px;border-radius:6px;border:1px solid #2c3a4a;background:#0f1720;color:#eee;box-sizing:border-box;font-size:15px}
  button{width:100%;padding:11px;border-radius:6px;border:none;background:#f5a623;color:#111;font-weight:600;cursor:pointer;font-size:15px}
  button:hover{background:#ffb84d}
  .err{color:#ff6b6b;margin-bottom:14px;font-size:13px}
</style></head><body>
<div class="card">
  <h1>Your Mates Sales Hub</h1>
  <p class="sub">Enter the team password to continue</p>
  ${errorMsg ? `<div class="err">${errorMsg}</div>` : ''}
  <form method="POST" action="/.netlify/functions/login">
    <input type="password" name="password" placeholder="Team password" autofocus required>
    <button type="submit">Sign in</button>
  </form>
</div>
</body></html>`;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.pathname;

  // Let the login/logout endpoints through untouched - people need to be able to reach them
  // whether or not they're currently signed in.
  if (path === '/.netlify/functions/login' || path === '/.netlify/functions/logout') {
    return;
  }
  // Never gate the scheduled data refresh - Netlify's own cron calls this directly, with no
  // browser and no cookie, so gating it would silently break the weekly automation.
  if (path === '/.netlify/functions/scheduled-data-refresh') {
    return;
  }

  const secret = Netlify.env.get('SESSION_SECRET');
  const sitePassword = Netlify.env.get('SITE_PASSWORD');
  if (!secret || !sitePassword) {
    return new Response(
      '<h1>Sign-in is not configured yet</h1><p>Set SITE_PASSWORD and SESSION_SECRET in Netlify site settings &rarr; Environment variables, then redeploy.</p>',
      { status: 500, headers: { 'content-type': 'text/html' } }
    );
  }

  const authed = await isValidSession(request.headers.get('cookie'), secret);
  if (authed) {
    return; // pass through to the real site or function
  }

  const err = url.searchParams.get('error') === '1' ? 'Wrong password - try again.' : null;
  return new Response(loginPageHtml(err), { status: 401, headers: { 'content-type': 'text/html' } });
};

export const config = { path: '/*' };
