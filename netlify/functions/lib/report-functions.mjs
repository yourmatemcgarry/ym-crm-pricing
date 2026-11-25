// Shared I/O for the weekly email functions: load CRM_DATA from the published index.html (GitHub Git Data API - the
// plain Contents API returns an empty body for files this large) + the shared Netlify Blobs, then build/send reports.
import { getStore } from '@netlify/blobs';
import { extractCrmDataFromHtml } from './refresh-helpers.mjs';
import { buildContext, buildEmail, sendViaResend, mergeEmailSettings, brisbaneNow, isDue } from './report-core.mjs';

const STORE_NAME = 'ymt-crm-pricing';
export const reportStore = () => getStore({ name: STORE_NAME, consistency: 'strong' });

async function gh(path, token) {
  const res = await fetch('https://api.github.com' + path, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ymt-sales-hub-weekly-emails' } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${(body && body.message) || ''}`);
  return body;
}
let _crmCache = null; // { at, crm } - reused within a warm function instance for up to 10 minutes
export async function loadCrmData(env) {
  if (_crmCache && Date.now() - _crmCache.at < 600000) return _crmCache.crm;
  const { GITHUB_TOKEN, GITHUB_REPO } = env; const branch = env.GITHUB_BRANCH || 'main'; const file = env.GITHUB_FILE_PATH || 'index.html';
  if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error('GITHUB_TOKEN / GITHUB_REPO are not set (the same variables the data refresh uses).');
  const ref = await gh(`/repos/${GITHUB_REPO}/git/refs/heads/${encodeURIComponent(branch)}`, GITHUB_TOKEN);
  const commit = await gh(`/repos/${GITHUB_REPO}/git/commits/${ref.object.sha}`, GITHUB_TOKEN);
  const tree = await gh(`/repos/${GITHUB_REPO}/git/trees/${commit.tree.sha}?recursive=1`, GITHUB_TOKEN);
  const entry = (tree.tree || []).find(e => e.path === file); if (!entry) throw new Error('Could not find ' + file + ' in the repo.');
  const blob = await gh(`/repos/${GITHUB_REPO}/git/blobs/${entry.sha}`, GITHUB_TOKEN);
  const html = Buffer.from(blob.content, blob.encoding || 'base64').toString('utf8');
  const crm = extractCrmDataFromHtml(html);
  _crmCache = { at: Date.now(), crm };
  return crm;
}
export async function loadBlobs(s) {
  const keys = ['callNotes', 'journeyPlans', 'jpRsmSettings', 'customerRsmOverrides', 'rsmZoneOverrides', 'postcodeZoneOverrides', 'lostListingDismissals', 'manualOutlets', 'emailSettings', 'salesProspects'];
  const vals = await Promise.all(keys.map(k => s.get(k, { type: 'json' })));
  const out = {}; keys.forEach((k, i) => { out[k] = vals[i]; });
  return out;
}
export async function buildReportEmail(type, env, nowMs, s) {
  const store = s || reportStore();
  const [crm, blobs] = await Promise.all([loadCrmData(env), loadBlobs(store)]);
  const ctx = buildContext(crm, blobs);
  const now = brisbaneNow(nowMs);
  return { ...buildEmail(type, ctx, now.iso), settings: ctx.settings };
}
// Hourly tick: send whichever reports are due (Brisbane day + hour reached, not yet sent today).
export async function runDueReports(env, nowMs) {
  const store = reportStore();
  const raw = await store.get('emailSettings', { type: 'json' });
  const settings = mergeEmailSettings(raw);
  const now = brisbaneNow(nowMs);
  const results = [];
  for (const type of ['callReview', 'listings']) {
    if (!isDue(settings[type], settings.lastSent[type], now)) { results.push({ type, sent: false, reason: 'not due' }); continue; }
    try {
      const mail = await buildReportEmail(type, env, nowMs, store);
      await sendViaResend({ to: settings[type].recipients, subject: mail.subject, html: mail.html }, env);
      settings.lastSent[type] = now.iso;
      await store.setJSON('emailSettings', Object.assign({}, raw || {}, { lastSent: settings.lastSent }));
      results.push({ type, sent: true, to: settings[type].recipients.length });
    } catch (err) { console.error('weekly-emails', type, err); results.push({ type, sent: false, error: String(err.message || err) }); }
  }
  return results;
}
