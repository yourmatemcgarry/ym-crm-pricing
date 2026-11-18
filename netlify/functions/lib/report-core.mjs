// GENERATED from build/r142_core.js - do not edit here.
// Pure helpers (no globals) shared VERBATIM by the app (Lost Listings page) and the server-side weekly email
// (netlify/functions/lib/report-core.mjs is generated from this block by build_r142.py) so the page and the emails can
// never disagree about what a lost / new listing is.
//   listing  = one customer + one SKU group (outletId|groupId)
//   order    = any day with positive volume for that listing in dailyVolume (free stock counts, same as the rest of the app)
//   lost     = kegs: >= 30 days since last order; cartons: >= 90 days since last order. Stays lost until it is re-ordered.
//   new      = the listing's FIRST order in the data falls inside the window.
const LR_THRESHOLD_DAYS = { KEGS: 30, CARTONS: 90 };
function lrDayIdx(epochIso, iso) { return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(epochIso + 'T00:00:00Z')) / 86400000); }
function lrIdxToIso(epochIso, idx) { return new Date(Date.parse(epochIso + 'T00:00:00Z') + idx * 86400000).toISOString().slice(0, 10); }
// dailyVolume: { "outletId|groupId": [dayIdx, litres, dayIdx, litres, ...] }; bucketOfGroup(gid) -> 'KEGS'|'CARTONS'|null
// eligible(outletId) -> boolean. Returns { rows, lastAny } where rows is every listing with at least one order.
function lrComputeListings(dailyVolume, bucketOfGroup, eligible, asOfIdx) {
  const rows = [], lastAny = {};
  for (const key in dailyVolume) {
    const sep = key.indexOf('|'); const oid = key.slice(0, sep), gid = key.slice(sep + 1);
    const bucket = bucketOfGroup(gid); if (!bucket || !eligible(oid)) continue;
    const arr = dailyVolume[key];
    let first = null, last = null, days = 0;
    for (let i = 0; i < arr.length; i += 2) {
      const d = arr[i], v = arr[i + 1];
      if (!(v > 0) || d > asOfIdx) continue;
      if (first === null || d < first) first = d;
      if (last === null || d > last) last = d;
      days++;
    }
    if (last === null) continue;
    let vol12 = 0; // litres in the 365 days up to and including the last order = how big this listing was
    for (let i = 0; i < arr.length; i += 2) { const d = arr[i], v = arr[i + 1]; if (v > 0 && d <= last && d > last - 365) vol12 += v; }
    if (lastAny[oid] === undefined || last > lastAny[oid]) lastAny[oid] = last;
    const thr = LR_THRESHOLD_DAYS[bucket];
    rows.push({ oid, gid, bucket, firstIdx: first, lastIdx: last, orderDays: days, vol12: Math.round(vol12), daysSince: asOfIdx - last, lostIdx: last + thr, lost: asOfIdx - last >= thr });
  }
  return { rows, lastAny };
}
function lrLostRows(rows) { return rows.filter(r => r.lost); }
// Listings that CROSSED the lost threshold in the last `days` days (e.g. 7 = this week's newly lost).
function lrNewlyLost(rows, asOfIdx, days) { return rows.filter(r => r.lost && r.lostIdx > asOfIdx - days && r.lostIdx <= asOfIdx); }
// Listings whose first-ever order fell in the last `days` days.
function lrNewListings(rows, asOfIdx, days) { return rows.filter(r => r.firstIdx > asOfIdx - days && r.firstIdx <= asOfIdx); }

export { LR_THRESHOLD_DAYS, lrDayIdx, lrIdxToIso, lrComputeListings, lrLostRows, lrNewlyLost, lrNewListings };

// ===================== REPORT LOGIC (server) =====================
// Builds the two weekly emails from CRM_DATA (read from the published index.html) + the shared blobs.
//   callReview : previous Mon-Sun, calls logged per RSM with notes, vs weekly target, plus Journey Planner venues
//                planned for that week that have no call logged.
//   listings   : new listings (first-ever order in the last 7 days) and lost listings (crossed the keg-30 / carton-90 day
//                line in the last 7 days; total still-lost counts shown too). Dismissed listings are excluded.
export const DEFAULT_EMAIL_SETTINGS = {
  callReview: { enabled: true, recipients: [], dayOfWeek: 1, hour: 7 },   // 1 = Monday, hour in Brisbane time (AEST, no DST)
  listings:   { enabled: true, recipients: [], dayOfWeek: 1, hour: 7 },
  callReviewRsms: ['Josh Pitts', 'Kayla Miller'],
  defaultWeeklyCallTarget: 25,
  lastSent: { callReview: '', listings: '' },
};
export function mergeEmailSettings(s) {
  const d = DEFAULT_EMAIL_SETTINGS; s = s || {};
  return {
    callReview: Object.assign({}, d.callReview, s.callReview || {}),
    listings: Object.assign({}, d.listings, s.listings || {}),
    callReviewRsms: Array.isArray(s.callReviewRsms) ? s.callReviewRsms : d.callReviewRsms.slice(),
    defaultWeeklyCallTarget: Number(s.defaultWeeklyCallTarget) > 0 ? Number(s.defaultWeeklyCallTarget) : d.defaultWeeklyCallTarget,
    lastSent: Object.assign({}, d.lastSent, s.lastSent || {}),
  };
}

// ---- Brisbane (AEST, UTC+10, no daylight saving) date helpers. Dates are handled as YYYY-MM-DD strings.
export function brisbaneNow(nowMs) { const d = new Date((nowMs == null ? Date.now() : nowMs) + 10 * 3600e3); return { iso: d.toISOString().slice(0, 10), dow: d.getUTCDay(), hour: d.getUTCHours() }; }
function addDaysIso(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function mondayIso(iso) { const dow = (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; return addDaysIso(iso, -dow); }
export function previousWeek(todayIso) { const m = addDaysIso(mondayIso(todayIso), -7); return { start: m, end: addDaysIso(m, 6) }; }
function fyQuarterOfIso(iso) { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const q = m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : m <= 3 ? 3 : 4; return { fy: m >= 7 ? y + 1 : y, q }; }
function quarterStartIso(fy, q) { const [y, m] = q === 1 ? [fy - 1, 7] : q === 2 ? [fy - 1, 10] : q === 3 ? [fy, 1] : [fy, 4]; return `${y}-${String(m).padStart(2, '0')}-01`; }
function quarterKeyOf(fy, q) { return `FY${String(fy).slice(-2)}-Q${q}`; }
export function fmtAu(iso) { if (!iso) return ''; const d = new Date(iso + 'T00:00:00Z'); return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---- RSM resolution: mirrors the app (pin -> zone override -> postcode DB zone RSM -> 'Sales MGR')
const pcNorm = pc => String(pc == null ? '' : pc).trim().replace(/^0+(?=\d)/, '');
const pcGet = (map, pc) => { const raw = String(pc == null ? '' : pc).trim(); if (!raw) return ''; return (map || {})[raw] || (map || {})[pcNorm(raw)] || ''; };
export function resolveRsm(o, c) {
  const pin = (c.customerRsmOverrides || {})[o.id]; if (pin) return pin;
  const zone = pcGet(c.postcodeZoneOverrides, o.postcode) || pcGet(c.crm.postcodeZoneSeed, o.postcode) || '';
  if (!zone) return 'Sales MGR';
  const def = (c.crm.zoneDefsSeed || {})[zone];
  let rsm = (c.rsmZoneOverrides || {})[zone] || (def && def.rsm) || '';
  if (!rsm || rsm === 'Unassigned') rsm = 'Sales MGR';
  return rsm;
}

export function buildContext(crm, blobs) {
  const b = blobs || {};
  const c = {
    crm, callNotes: b.callNotes || [], journeyPlans: b.journeyPlans || {}, jpRsmSettings: b.jpRsmSettings || {},
    customerRsmOverrides: b.customerRsmOverrides || {}, rsmZoneOverrides: b.rsmZoneOverrides || {}, postcodeZoneOverrides: b.postcodeZoneOverrides || {},
    lostDismissals: b.lostListingDismissals || {}, manualOutlets: b.manualOutlets || {}, settings: mergeEmailSettings(b.emailSettings),
  };
  c.epoch = crm.meta.epochDate;
  c.asOfIso = crm.meta.salesDataTo;
  c.asOf = lrDayIdx(c.epoch, c.asOfIso);
  c.rsmOf = {};
  Object.values(crm.outlets).forEach(o => { c.rsmOf[o.id] = resolveRsm(o, c); });
  return c;
}
const eligible = (c) => (oid) => { const o = c.crm.outlets[oid]; return !!o && o.volumeStream === 'Sales Team' && !o.excluded && o.custType !== 'Event'; };
const bucketOfGroup = (c) => (gid) => { const g = c.crm.groups[gid]; if (!g) return null; return g.bucket || (g.format === 'Pack' ? 'CARTONS' : 'KEGS'); };
function custName(c, oid) { const o = c.crm.outlets[oid] || c.manualOutlets[oid]; return o ? o.name : ('Customer ' + oid); }
function custSub(c, oid) { const o = c.crm.outlets[oid] || c.manualOutlets[oid]; return o ? [o.suburb, o.state].filter(Boolean).join(' ') : ''; }

// ---------------- listings report ----------------
export function listingsReport(c) {
  const { rows, lastAny } = lrComputeListings(c.crm.dailyVolume, bucketOfGroup(c), eligible(c), c.asOf);
  const live = r => !c.lostDismissals[r.oid + '|' + r.gid];
  const enrich = r => ({ oid: r.oid, gid: r.gid, customer: custName(c, r.oid), suburb: custSub(c, r.oid), rsm: c.rsmOf[r.oid] || 'Sales MGR', sku: (c.crm.groups[r.gid] || {}).label || r.gid, bucket: r.bucket,
    first: lrIdxToIso(c.epoch, r.firstIdx), last: lrIdxToIso(c.epoch, r.lastIdx), lostOn: lrIdxToIso(c.epoch, r.lostIdx), daysSince: r.daysSince, vol12: r.vol12,
    stillBuying: c.asOf - lastAny[r.oid] < 30 });
  const sortBig = (a, b) => b.vol12 - a.vol12;
  const newL = lrNewListings(rows, c.asOf, 7).map(enrich).sort((a, b) => a.rsm.localeCompare(b.rsm) || b.vol12 - a.vol12);
  const lostNow = lrNewlyLost(rows, c.asOf, 7).filter(live).map(enrich).sort((a, b) => a.rsm.localeCompare(b.rsm) || sortBig(a, b));
  const allLost = lrLostRows(rows).filter(live);
  return { asOfIso: c.asOfIso, windowFrom: lrIdxToIso(c.epoch, c.asOf - 6), newListings: newL, newlyLost: lostNow,
    totalLostKegs: allLost.filter(r => r.bucket === 'KEGS').length, totalLostCartons: allLost.filter(r => r.bucket === 'CARTONS').length };
}

// ---------------- call review ----------------
export function callReview(c, todayIso) {
  const wk = previousWeek(todayIso);
  const inWeek = n => n.visitDate >= wk.start && n.visitDate <= wk.end;
  const notes = c.callNotes.filter(inWeek);
  // venues planned in the Journey Planner for that week (the week can straddle two quarters -> check both plans)
  const planned = {}; // rsm -> { oid: {day} }
  const qs = new Map();
  [wk.start, wk.end].forEach(iso => { const q = fyQuarterOfIso(iso); qs.set(quarterKeyOf(q.fy, q.q), q); });
  qs.forEach((q, qk) => {
    const startMon = mondayIso(quarterStartIso(q.fy, q.q));
    const idx = Math.round((Date.parse(wk.start + 'T00:00:00Z') - Date.parse(startMon + 'T00:00:00Z')) / (7 * 86400000));
    if (idx < 0 || idx > 12) return;
    Object.keys(c.journeyPlans).forEach(rsm => {
      const plan = (c.journeyPlans[rsm] || {})[qk]; if (!plan || !plan.wkAssign) return;
      Object.keys(plan.wkAssign).forEach(oid => {
        let v = plan.wkAssign[oid]; if (typeof v === 'number') v = [v];
        if (!Array.isArray(v) || !v.includes(idx)) return;
        const wa = (plan.wAssign || {})[oid]; const day = wa && typeof wa === 'object' ? (wa[idx] !== undefined ? wa[idx] : (wa.weekIdx === idx ? wa.day : undefined)) : undefined;
        (planned[rsm] = planned[rsm] || {})[oid] = { day: typeof day === 'number' ? day : null };
      });
    });
  });
  const visitedBy = {}; // oid -> earliest visit date in week
  notes.forEach(n => { if (!visitedBy[n.outletId] || n.visitDate < visitedBy[n.outletId]) visitedBy[n.outletId] = n.visitDate; });
  const rsmSet = new Set(c.settings.callReviewRsms);
  notes.forEach(n => rsmSet.add(n.rsm || (c.rsmOf[n.outletId]) || 'Unknown'));
  Object.keys(planned).forEach(r => rsmSet.add(r));
  const per = [...rsmSet].filter(Boolean).map(rsm => {
    const mine = notes.filter(n => (n.rsm || c.rsmOf[n.outletId] || 'Unknown') === rsm).sort((a, b) => a.visitDate.localeCompare(b.visitDate) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const t = (c.jpRsmSettings[rsm] || {}).weeklyTarget;
    const target = Number(t) > 0 ? Number(t) : c.settings.defaultWeeklyCallTarget;
    const plan = Object.entries(planned[rsm] || {}).map(([oid, p]) => ({ oid, name: custName(c, oid), suburb: custSub(c, oid), plannedDay: p.day == null ? '' : DOW[p.day] || '', visitedOn: visitedBy[oid] || '' }));
    plan.sort((a, b) => a.name.localeCompare(b.name));
    return { rsm, target, count: mine.length, calls: mine.map(n => ({ date: n.visitDate, customer: custName(c, n.outletId), suburb: custSub(c, n.outletId), outcome: n.outcome || '', notes: n.notes || '', competitorNote: n.competitorNote || '', nextAction: n.nextAction || '' })),
      planned: plan, missed: plan.filter(p => !p.visitedOn) };
  }).sort((a, b) => a.rsm.localeCompare(b.rsm));
  return { weekStart: wk.start, weekEnd: wk.end, perRsm: per, totalCalls: per.reduce((s, r) => s + r.count, 0) };
}

// ---------------- email rendering (inline styles only - email clients strip <style>) ----------------
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const TH = 'text-align:left;padding:6px 8px;background:#1F3864;color:#fff;font-size:12px;';
const TD = 'padding:6px 8px;border-bottom:1px solid #e3e6ec;font-size:13px;vertical-align:top;';
const wrap = (title, sub, body) => `<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2330;max-width:900px;"><h2 style="margin:0 0 4px;color:#1F3864;">${esc(title)}</h2><div style="color:#667;font-size:13px;margin-bottom:14px;">${esc(sub)}</div>${body}<div style="color:#99a;font-size:11px;margin-top:20px;">Sent automatically by Your Mates Sales Hub.</div></div>`;
const table = (heads, rowsHtml) => `<table style="border-collapse:collapse;width:100%;margin:6px 0 16px;"><thead><tr>${heads.map(h => `<th style="${TH}">${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>`;

export function renderCallReview(r) {
  const body = r.perRsm.map(p => {
    const pct = p.target ? Math.round(100 * p.count / p.target) : 0; const colour = pct >= 100 ? '#1a7f37' : pct >= 70 ? '#b7791f' : '#c0392b';
    const calls = p.calls.length ? table(['Date', 'Customer', 'Outcome', 'Notes'], p.calls.map(n => `<tr><td style="${TD}white-space:nowrap;">${esc(fmtAu(n.date))}</td><td style="${TD}"><strong>${esc(n.customer)}</strong><br><span style="color:#667;font-size:12px;">${esc(n.suburb)}</span></td><td style="${TD}">${esc(n.outcome)}</td><td style="${TD}">${esc(n.notes).replace(/\n/g, '<br>')}${n.competitorNote ? `<br><em>Competitor: ${esc(n.competitorNote)}</em>` : ''}${n.nextAction ? `<br><strong>Next:</strong> ${esc(n.nextAction)}` : ''}</td></tr>`).join('')) : '<div style="color:#667;font-size:13px;margin:6px 0 14px;">No calls logged.</div>';
    const missedHtml = p.planned.length ? (p.missed.length ? table(['Planned venue', 'Planned day'], p.missed.map(m => `<tr><td style="${TD}"><strong>${esc(m.name)}</strong> <span style="color:#667;font-size:12px;">${esc(m.suburb)}</span></td><td style="${TD}">${esc(m.plannedDay || '-')}</td></tr>`).join('')) : '<div style="color:#1a7f37;font-size:13px;">Every planned venue was visited.</div>') : '<div style="color:#667;font-size:13px;">Nothing was planned in the Journey Planner for this week.</div>';
    return `<h3 style="margin:18px 0 4px;color:#1F3864;">${esc(p.rsm)}</h3>
      <div style="font-size:15px;margin-bottom:6px;"><strong style="color:${colour};">${p.count} calls</strong> vs weekly target of ${p.target} (${pct}%)</div>
      ${calls}
      <div style="font-size:13px;margin:4px 0;"><strong>Journey Plan:</strong> ${p.planned.length} venues planned, ${p.planned.length - p.missed.length} visited, <strong style="color:${p.missed.length ? '#c0392b' : '#1a7f37'};">${p.missed.length} not visited</strong></div>
      ${missedHtml}`;
  }).join('<hr style="border:none;border-top:1px solid #d5d9e2;margin:18px 0;">') || '<div>No activity found for this week.</div>';
  return { subject: `Weekly call review: ${fmtAu(r.weekStart)} - ${fmtAu(r.weekEnd)} (${r.totalCalls} calls)`, html: wrap('Weekly call review', `Week ${fmtAu(r.weekStart)} to ${fmtAu(r.weekEnd)}`, body) };
}
export function renderListings(r) {
  const row = (x, extra) => `<tr><td style="${TD}"><strong>${esc(x.customer)}</strong><br><span style="color:#667;font-size:12px;">${esc(x.suburb)}</span></td><td style="${TD}">${esc(x.rsm)}</td><td style="${TD}">${esc(x.sku)}<br><span style="color:#667;font-size:12px;">${x.bucket === 'KEGS' ? 'Keg' : 'Carton'}</span></td>${extra(x)}</tr>`;
  const newT = r.newListings.length ? table(['Customer', 'RSM', 'SKU', 'First order'], r.newListings.map(x => row(x, y => `<td style="${TD}">${esc(fmtAu(y.first))}</td>`)).join('')) : '<div style="color:#667;font-size:13px;margin-bottom:14px;">No new listings this week.</div>';
  const lostT = r.newlyLost.length ? table(['Customer', 'RSM', 'SKU', 'Last order', 'Days', 'Size (12m, L)', 'Customer'], r.newlyLost.map(x => row(x, y => `<td style="${TD}">${esc(fmtAu(y.last))}</td><td style="${TD}">${y.daysSince}</td><td style="${TD}">${y.vol12}</td><td style="${TD}">${y.stillBuying ? 'still buying other SKUs' : '<span style="color:#c0392b;">no orders in 30d</span>'}</td>`)).join('')) : '<div style="color:#667;font-size:13px;margin-bottom:14px;">No listings were newly lost this week.</div>';
  const body = `<h3 style="color:#1F3864;margin:8px 0 2px;">New listings (${r.newListings.length})</h3><div style="color:#667;font-size:12px;">First-ever order for the customer + SKU in the last 7 days.</div>${newT}
    <h3 style="color:#1F3864;margin:8px 0 2px;">Lost listings this week (${r.newlyLost.length})</h3><div style="color:#667;font-size:12px;">Kegs: 30 days with no order. Cartons: 90 days with no order. Listed when they crossed the line in the last 7 days.</div>${lostT}
    <div style="font-size:13px;">Still lost in total: <strong>${r.totalLostKegs}</strong> keg listings, <strong>${r.totalLostCartons}</strong> carton listings (see the Lost Listings page in the Hub).</div>`;
  return { subject: `Weekly listings: ${r.newListings.length} new, ${r.newlyLost.length} lost (data to ${fmtAu(r.asOfIso)})`, html: wrap('Weekly listings update', `Sales data to ${fmtAu(r.asOfIso)} (last 7 days: ${fmtAu(r.windowFrom)} to ${fmtAu(r.asOfIso)})`, body) };
}

// ---------------- sending (Resend) ----------------
export async function sendViaResend({ to, subject, html }, env) {
  const key = env.RESEND_API_KEY; if (!key) throw new Error('RESEND_API_KEY is not set in Netlify environment variables.');
  const from = env.EMAIL_FROM; if (!from) throw new Error('EMAIL_FROM is not set (e.g. "Your Mates Sales Hub <reports@yourmatesbrewing.com>").');
  if (!to || !to.length) throw new Error('No recipients configured.');
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, subject, html }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Resend error ' + res.status + ': ' + (body.message || JSON.stringify(body)));
  return body;
}
export function buildEmail(type, c, todayIso) {
  if (type === 'callReview') return renderCallReview(callReview(c, todayIso));
  if (type === 'listings') return renderListings(listingsReport(c));
  throw new Error('Unknown report type: ' + type);
}
// Is this report due right now (called hourly)? Brisbane day-of-week + hour reached + not already sent today.
export function isDue(setting, lastSentIso, now) { return !!setting.enabled && (setting.recipients || []).length > 0 && now.dow === Number(setting.dayOfWeek) && now.hour >= Number(setting.hour) && lastSentIso !== now.iso; }
