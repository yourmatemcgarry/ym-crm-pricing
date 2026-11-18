// weekly-emails.mjs - Round 142. Hourly cron (see netlify.toml). Each tick checks the Email Reports settings saved in the Hub
// and sends the Monday call review / weekly listings email once its day + hour (Brisbane time) has been reached.
// Needs env vars: RESEND_API_KEY, EMAIL_FROM, plus the GITHUB_TOKEN / GITHUB_REPO already used by the data refresh.
import { runDueReports } from './lib/report-functions.mjs';

export default async () => {
  const results = await runDueReports(process.env, Date.now());
  console.log('weekly-emails:', JSON.stringify(results));
};
