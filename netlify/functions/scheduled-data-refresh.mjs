// scheduled-data-refresh.mjs
//
// Round 104: fully automated weekly data refresh. Runs on Netlify's cron scheduler (see the
// [functions."scheduled-data-refresh"] block in netlify.toml), connects to the FTP/SFTP mailbox
// OnTap pushes the weekly outlet/product/sales exports into, and — if a genuinely newer export has
// landed since the last run — rebuilds CRM_DATA and publishes it, with no human step in between.
//
// This reuses the exact same merge-aware pipeline (netlify_datarefresh.js's
// buildCrmDataWithCarryForward) that every manual weekly refresh has used since Round 84, and the
// exact same "commit a new index.html to GitHub, let Netlify auto-deploy" publish mechanism that
// refresh-data.mjs uses for the in-app Data Refresh tool — this function is a second caller of that
// same idea, not a new data path.
//
// The pure logic (sanity checks, CRM_DATA extraction/splicing, file-matching) lives in
// ./lib/refresh-helpers.mjs so it can be unit-tested (verify_scheduled_refresh.mjs) without needing
// the "basic-ftp" package installed or any real network/FTP/GitHub access. Everything in this file
// is I/O: talking to FTP, GitHub, and an optional alert webhook.
//
// ---------------------------------------------------------------------------------------------
// Required environment variables (set in Netlify site settings -> Environment variables):
//
//   FTP_HOST            - hostname of the FTP/SFTP mailbox (e.g. ftp.drivehq.com)
//   FTP_USER            - FTP username
//   FTP_PASSWORD        - FTP password. Never type this into chat/AI tools - set directly in Netlify.
//   FTP_PORT            - optional, defaults to 21 (990 if FTP_SECURE=implicit)
//   FTP_SECURE          - optional: "true" (explicit FTPS, default), "implicit" (implicit FTPS),
//                         or "false" (plain unencrypted FTP - not recommended)
//   FTP_REMOTE_DIR      - optional, defaults to "/" - the folder OnTap uploads into
//
//   GITHUB_TOKEN        - same GitHub Personal Access Token used by refresh-data.mjs
//   GITHUB_REPO         - "owner/repo", e.g. "yourmatesbrewing/sales-hub"
//   GITHUB_BRANCH       - optional, defaults to "main"
//   GITHUB_FILE_PATH    - optional, defaults to "index.html"
//
//   ALERT_WEBHOOK_URL   - optional. If set, a small JSON summary is POSTed here after every run
//                         (success, skipped, or failed) - point this at a Slack/Teams/Zapier/Make
//                         webhook so a bad or missing export gets noticed without checking Netlify
//                         function logs by hand. Safe to leave unset.
//
// ---------------------------------------------------------------------------------------------
// How a run decides what to do:
//   1. Connect to the FTP mailbox, list files, and find the most recently modified file whose name
//      contains "outlet", "prod", and "sales" (case-insensitive) respectively - matching the
//      YMT_Outlet/YMT_Prod/YMT_SalesYYYYMMDD.csv naming OnTap already uses.
//   2. If any of the 3 categories has no file at all, stop - nothing to do yet (not an error).
//   3. Download all 3, decoded as latin-1 (the CSVs are ISO-8859-1, same as every prior refresh).
//   4. Fetch the currently-published CRM_DATA from GitHub (via the Git Data/Blobs API, which -
//      unlike the plain Contents API - handles the ~7-8MB file size correctly) and parse it as the
//      "previous" dataset for carry-forward merging.
//   5. Run DataRefresh.buildCrmDataWithCarryForward(outletCsv, productCsv, salesCsv, previous).
//   6. Sanity-check the result exactly as every manual refresh has: salesDataFrom must not roll
//      forward (no history lost) and salesDataTo must advance or stay the same. If either check
//      fails, or the outlet count looks implausibly low, DO NOT publish - alert instead.
//   7. If salesDataTo did not advance at all, there's no new data yet this run (e.g. OnTap hasn't
//      uploaded this week's file, or it's a byte-identical re-upload of one already processed) -
//      skip quietly, this is expected most days, not an error.
//   8. Otherwise, commit the refreshed dataset to GitHub exactly as refresh-data.mjs does (splice
//      between the /* CRM_DATA_START */ ... /* CRM_DATA_END */ sentinel markers). Netlify's
//      GitHub-connected auto-deploy then republishes the site, typically within 1-2 minutes.
// ---------------------------------------------------------------------------------------------

import { Client as FtpClient } from 'basic-ftp';
import { Writable } from 'node:stream';
import { sanityCheckCrmData, extractCrmDataFromHtml, spliceCrmDataIntoHtml, findLatestMatch } from './lib/refresh-helpers.mjs';

const GITHUB_API = 'https://api.github.com';

// ---------------- GitHub I/O ----------------

async function githubRequest(path, token, options = {}) {
  const res = await fetch(GITHUB_API + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ymt-sales-hub-scheduled-data-refresh',
      ...(options.headers || {}),
    },
  });
  let bodyJson = null;
  try { bodyJson = await res.json(); } catch (_err) { /* no body / not JSON */ }
  return { ok: res.ok, status: res.status, body: bodyJson };
}

// Files this size and up are truncated by the plain Contents API (content: ""), so the current
// live index.html (several MB, all CRM_DATA baked in) has to be read via the Git Data API instead:
// ref -> commit -> tree -> blob. This is the one meaningful difference from refresh-data.mjs, which
// only ever *writes* the file (and only needs the Contents API for its blob `sha`, which it returns
// even for large files) - reading the content back is new here.
async function fetchCurrentFileViaGitDataApi(repo, token, branch, filePath) {
  const refRes = await githubRequest(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token);
  if (!refRes.ok) throw new Error(`Could not read branch ref (status ${refRes.status}): ${refRes.body?.message || 'unknown error'}`);
  const commitSha = refRes.body.object.sha;

  const commitRes = await githubRequest(`/repos/${repo}/git/commits/${commitSha}`, token);
  if (!commitRes.ok) throw new Error(`Could not read commit (status ${commitRes.status}): ${commitRes.body?.message || 'unknown error'}`);
  const treeSha = commitRes.body.tree.sha;

  const treeRes = await githubRequest(`/repos/${repo}/git/trees/${treeSha}?recursive=1`, token);
  if (!treeRes.ok) throw new Error(`Could not read tree (status ${treeRes.status}): ${treeRes.body?.message || 'unknown error'}`);
  const entry = (treeRes.body.tree || []).find((e) => e.path === filePath);
  if (!entry) throw new Error(`Could not find ${filePath} in the repo tree on branch ${branch}`);

  const blobRes = await githubRequest(`/repos/${repo}/git/blobs/${entry.sha}`, token);
  if (!blobRes.ok) throw new Error(`Could not read blob (status ${blobRes.status}): ${blobRes.body?.message || 'unknown error'}`);
  const content = Buffer.from(blobRes.body.content, blobRes.body.encoding || 'base64').toString('utf8');

  // Also grab the Contents API's `sha` for this file specifically - that's the blob sha the PUT
  // step needs to prove we're updating the version we just read (not racing another writer).
  const contentsRes = await githubRequest(`/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`, token);
  if (!contentsRes.ok) throw new Error(`Could not read file metadata (status ${contentsRes.status}): ${contentsRes.body?.message || 'unknown error'}`);

  return { html: content, sha: contentsRes.body.sha };
}

async function postAlert(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Alerting is best-effort - never let a webhook failure mask the real result.
    console.error('scheduled-data-refresh: failed to post alert webhook:', err.message);
  }
}

// ---------------- FTP I/O ----------------

function bufferWritable() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  return { stream, getBuffer: () => Buffer.concat(chunks) };
}

async function downloadCsvLatin1(client, remoteDir, filename) {
  const { stream, getBuffer } = bufferWritable();
  await client.downloadTo(stream, remoteDir.replace(/\/$/, '') + '/' + filename);
  return getBuffer().toString('latin1');
}

// ---------------- main handler ----------------

export default async () => {
  const {
    FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_PORT, FTP_SECURE, FTP_REMOTE_DIR,
    GITHUB_TOKEN, GITHUB_REPO, ALERT_WEBHOOK_URL,
  } = process.env;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
  const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'index.html';
  const remoteDir = FTP_REMOTE_DIR || '/';

  const summary = { startedAt: new Date().toISOString() };

  try {
    if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
      throw new Error('FTP_HOST, FTP_USER and FTP_PASSWORD environment variables must all be set in Netlify site settings.');
    }
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      throw new Error('GITHUB_TOKEN and GITHUB_REPO environment variables must be set (same values used by refresh-data.mjs).');
    }

    // ---- 1. Connect to FTP and find the 3 newest matching files ----
    const client = new FtpClient(30_000);
    let outletCsv, productCsv, salesCsv, pickedNames;
    try {
      const secureMode = FTP_SECURE === 'false' ? false : (FTP_SECURE === 'implicit' ? 'implicit' : true);
      await client.access({
        host: FTP_HOST,
        user: FTP_USER,
        password: FTP_PASSWORD,
        port: FTP_PORT ? Number(FTP_PORT) : undefined,
        secure: secureMode,
        secureOptions: { rejectUnauthorized: true },
      });

      const files = await client.list(remoteDir);
      const outletFile = findLatestMatch(files, ['outlet']);
      const productFile = findLatestMatch(files, ['prod']);
      const salesFile = findLatestMatch(files, ['sales']);

      if (!outletFile || !productFile || !salesFile) {
        summary.status = 'skipped';
        summary.reason = `Could not find all 3 required files on the FTP server yet (outlet: ${outletFile ? 'found' : 'missing'}, product: ${productFile ? 'found' : 'missing'}, sales: ${salesFile ? 'found' : 'missing'}). This is expected if OnTap hasn't uploaded this week's export yet.`;
        client.close();
        console.log('scheduled-data-refresh: ' + summary.reason);
        await postAlert(ALERT_WEBHOOK_URL, summary);
        return new Response(JSON.stringify(summary), { status: 200 });
      }

      pickedNames = { outlet: outletFile.name, product: productFile.name, sales: salesFile.name };
      outletCsv = await downloadCsvLatin1(client, remoteDir, outletFile.name);
      productCsv = await downloadCsvLatin1(client, remoteDir, productFile.name);
      salesCsv = await downloadCsvLatin1(client, remoteDir, salesFile.name);
    } finally {
      client.close();
    }
    summary.filesUsed = pickedNames;

    // ---- 2. Load the currently-published dataset as the carry-forward base ----
    const { html: currentHtml, sha: currentSha } = await fetchCurrentFileViaGitDataApi(GITHUB_REPO, GITHUB_TOKEN, GITHUB_BRANCH, GITHUB_FILE_PATH);
    const previousCrmData = extractCrmDataFromHtml(currentHtml);

    // ---- 3. Rebuild via the same merge-aware pipeline every manual refresh has used since Round 84 ----
    const DataRefresh = (await import('./lib/netlify_datarefresh.js')).default;
    const rebuilt = DataRefresh.buildCrmDataWithCarryForward(outletCsv, productCsv, salesCsv, previousCrmData);

    // ---- 4. Sanity-check before touching anything ----
    const sanityError = sanityCheckCrmData(rebuilt, previousCrmData);
    if (sanityError) {
      summary.status = 'failed';
      summary.reason = sanityError;
      console.error('scheduled-data-refresh: ' + sanityError);
      await postAlert(ALERT_WEBHOOK_URL, summary);
      return new Response(JSON.stringify(summary), { status: 500 });
    }

    // ---- 5. No new data this run? Skip quietly (expected most days) ----
    if (previousCrmData?.meta?.salesDataTo && rebuilt.meta.salesDataTo <= previousCrmData.meta.salesDataTo) {
      summary.status = 'skipped';
      summary.reason = `No newer sales data found (salesDataTo still ${rebuilt.meta.salesDataTo}) - files on the FTP server haven't advanced since the last successful refresh.`;
      console.log('scheduled-data-refresh: ' + summary.reason);
      await postAlert(ALERT_WEBHOOK_URL, summary);
      return new Response(JSON.stringify(summary), { status: 200 });
    }

    // ---- 6. Publish: splice CRM_DATA between the sentinel markers and commit to GitHub ----
    const newHtml = spliceCrmDataIntoHtml(currentHtml, rebuilt);
    const outletCount = Object.keys(rebuilt.outlets || {}).length;
    const commitMessage = `Automated weekly data refresh: ${outletCount} outlets, sales ${rebuilt.meta.salesDataFrom} to ${rebuilt.meta.salesDataTo} (files: ${pickedNames.outlet}, ${pickedNames.product}, ${pickedNames.sales})`;

    const putRes = await githubRequest(`/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_FILE_PATH)}`, GITHUB_TOKEN, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(newHtml, 'utf8').toString('base64'),
        sha: currentSha,
        branch: GITHUB_BRANCH,
      }),
    });

    if (!putRes.ok) {
      throw new Error(`Could not commit updated ${GITHUB_FILE_PATH} to GitHub (status ${putRes.status}): ${putRes.body?.message || 'unknown error'}`);
    }

    summary.status = 'published';
    summary.outletCount = outletCount;
    summary.salesDataFrom = rebuilt.meta.salesDataFrom;
    summary.salesDataTo = rebuilt.meta.salesDataTo;
    summary.commitUrl = putRes.body?.commit?.html_url || null;
    console.log('scheduled-data-refresh: published successfully', summary);
    await postAlert(ALERT_WEBHOOK_URL, summary);
    return new Response(JSON.stringify(summary), { status: 200 });
  } catch (err) {
    summary.status = 'failed';
    summary.reason = err.message;
    console.error('scheduled-data-refresh: run failed:', err);
    await postAlert(ALERT_WEBHOOK_URL, summary);
    return new Response(JSON.stringify(summary), { status: 500 });
  }
};

// Cron schedule lives in netlify.toml ([functions."scheduled-data-refresh"].schedule) rather than
// here, so Christen can change how often it checks without touching code.
