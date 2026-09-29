// logout.mjs
//
// Round 106: clears the shared-password session cookie (see netlify/edge-functions/auth-gate.mjs)
// and sends the browser back to "/", where the gate will show the sign-in form again.

const COOKIE_NAME = 'ymt_session';

export default async (req) => {
  const expired = `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': expired } });
};
