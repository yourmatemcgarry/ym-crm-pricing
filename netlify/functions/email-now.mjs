// email-now.mjs - Round 142. Called from the Hub's "Email Reports" page.
//   POST { type: 'callReview'|'listings', action: 'preview'|'send', to?: [emails] }
//   preview -> { ok, subject, html }   send -> also emails it now (to `to`, else the saved recipients) and does NOT
//   touch the weekly "already sent" marker. Sits behind the same login gate as every other function.
import { buildReportEmail } from './lib/report-functions.mjs';
import { sendViaResend } from './lib/report-core.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'Invalid JSON body' }, 400); }
  if (!['callReview', 'listings'].includes(b.type)) return json({ error: 'Unknown report type' }, 400);
  try {
    const mail = await buildReportEmail(b.type, process.env, Date.now());
    if (b.action !== 'send') return json({ ok: true, subject: mail.subject, html: mail.html });
    const to = (Array.isArray(b.to) && b.to.length ? b.to : mail.settings[b.type].recipients).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    await sendViaResend({ to, subject: '[Test] ' + mail.subject, html: mail.html }, process.env);
    return json({ ok: true, subject: mail.subject, sentTo: to });
  } catch (err) { return json({ error: String(err.message || err) }, 500); }
};
