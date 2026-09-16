// refresh-helpers.mjs
//
// Pure, side-effect-free helpers used by scheduled-data-refresh.mjs. Split into their own file
// (rather than living inline in scheduled-data-refresh.mjs) purely so they can be unit-tested
// without needing the "basic-ftp" package installed or any real network/FTP/GitHub access - see
// verify_scheduled_refresh.mjs. None of these functions perform I/O.

export const REQUIRED_CRM_DATA_KEYS = ['meta', 'outlets', 'products', 'groups', 'groupOrder', 'groupSummary', 'outletSummary', 'dailyVolume', 'familyGroups', 'vipContactsSeed'];

export function sanityCheckCrmData(obj, previous) {
  if (!obj || typeof obj !== 'object') return 'rebuilt payload is not a JSON object';
  for (const k of REQUIRED_CRM_DATA_KEYS) {
    if (!(k in obj)) return `rebuilt payload is missing required key "${k}"`;
  }
  if (!obj.meta || !obj.meta.salesDataFrom || !obj.meta.salesDataTo) return 'rebuilt payload.meta is missing salesDataFrom/salesDataTo';
  const outletCount = Object.keys(obj.outlets || {}).length;
  if (outletCount < 100) return `rebuilt payload has only ${outletCount} outlets - looks far too low, refusing to publish (safety threshold: 100)`;
  if (previous?.meta?.salesDataFrom && obj.meta.salesDataFrom > previous.meta.salesDataFrom) {
    return `salesDataFrom rolled forward (${previous.meta.salesDataFrom} -> ${obj.meta.salesDataFrom}) - this would lose sales history, refusing to publish`;
  }
  if (previous?.meta?.salesDataTo && obj.meta.salesDataTo < previous.meta.salesDataTo) {
    return `salesDataTo went backwards (${previous.meta.salesDataTo} -> ${obj.meta.salesDataTo}) - refusing to publish`;
  }
  return null; // ok
}

export function extractCrmDataFromHtml(html) {
  const startMarker = '/* CRM_DATA_START */';
  const endMarker = '/* CRM_DATA_END */';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('Could not find CRM_DATA_START/CRM_DATA_END markers in the live file - it may predate the sentinel format.');
  }
  const between = html.slice(startIdx + startMarker.length, endIdx);
  // between looks like: "\nconst CRM_DATA = { ... };\n"
  const eq = between.indexOf('=');
  let jsonText = between.slice(eq + 1).trim();
  if (jsonText.endsWith(';')) jsonText = jsonText.slice(0, -1);
  return JSON.parse(jsonText);
}

export function spliceCrmDataIntoHtml(html, rebuiltCrmDataObj) {
  const startMarker = '/* CRM_DATA_START */';
  const endMarker = '/* CRM_DATA_END */';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('Could not find CRM_DATA_START/CRM_DATA_END markers in the live file.');
  }
  const before = html.slice(0, startIdx + startMarker.length);
  const after = html.slice(endIdx);
  return before + '\nconst CRM_DATA = ' + JSON.stringify(rebuiltCrmDataObj) + ';\n' + after;
}

// files: array of { name, modifiedAt } (matches basic-ftp's FileInfo shape closely enough).
// substrings: lowercase substrings to match against the filename (case-insensitive), e.g. ['outlet'].
// Returns the most-recently-modified .csv match, or null if none found.
export function findLatestMatch(files, substrings) {
  const lower = substrings.map((s) => s.toLowerCase());
  const matches = files.filter((f) => {
    const name = f.name.toLowerCase();
    return lower.some((s) => name.includes(s)) && name.endsWith('.csv');
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.modifiedAt?.getTime() || 0) - (a.modifiedAt?.getTime() || 0));
  return matches[0];
}
