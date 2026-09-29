// login.mjs
//
// Round 106: the sign-in endpoint for the shared team password (see netlify/edge-functions/
// auth-gate.mjs for the gate itself and the full explanation). Checks the submitted password
// against SITE_PASSWORD, and on success sets a signed session cookie and redirects back to "/".
// On failure, redirects back to "/?error=1" so the gate can show a "wrong password" message.
//
// Required environment variables (same ones the edge gate uses - set once in Netlify site
// settings -> Environment variables):
//   SITE_PASSWORD   - the one shared password the sales team enters to sign in
//   SESSION_SECRET  - any long random string, used to sign the session cookie

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

function redirect(location, extraHeaders = {}) {
  return new Response(null, { status: 303, headers: { Location: location, ...extraHeaders } });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return redirect('/');
  }

  const sitePassword = process.env.SITE_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!sitePassword || !secret) {
    return new Response(
      '<h1>Sign-in is not configured yet</h1><p>Set SITE_PASSWORD and SESSION_SECRET in Netlify site settings &rarr; Environment variables, then redeploy.</p>',
      { status: 500, headers: { 'content-type': 'text/html' } }
    );
  }

  let submitted = '';
  const contentType = req.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await req.text();
      submitted = new URLSearchParams(body).get('password') || '';
    } else if (contentType.includes('application/json')) {
      const body = await req.json();
      submitted = body.password || '';
    } else {
      const form = await req.formData();
      submitted = form.get('password') || '';
    }
  } catch {
    submitted = '';
  }

  if (submitted !== sitePassword) {
    return redirect('/?error=1');
  }

  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const sig = await hmac(secret, exp);
  const cookieValue = encodeURIComponent(`${exp}.${sig}`);
  const cookie = `${COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; HttpOnly; Secure; SameSite=Lax`;

  return redirect('/', { 'Set-Cookie': cookie });
};
