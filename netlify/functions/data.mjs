// YMT Pricing CRM — shared data function
//
// Stores the live pricing data (list prices, customer deals, temporary
// deals) in Netlify Blobs, the small built-in database Netlify provides —
// no separate signup, API keys, or database service to configure.
//
// GET  /.netlify/functions/data          -> { groupPrices, customerDeals, tempDeals }
// POST /.netlify/functions/data          -> { action, payload } -> applies one change and
//                                            returns the updated slice of data
//
// Reference data (customers, products, SKU groups, sales history) is NOT
// stored here — it's baked directly into index.html and refreshed by
// redeploying the site with a new build, since it only changes weekly.

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'ymt-crm-pricing';

function store() {
  // "strong" consistency so a save is immediately visible to the next read,
  // important since multiple reps may be reading/writing within seconds of
  // each other.
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function readAll(s) {
  const [groupPrices, customerDeals, tempDeals] = await Promise.all([
    s.get('groupPrices', { type: 'json' }),
    s.get('customerDeals', { type: 'json' }),
    s.get('tempDeals', { type: 'json' }),
  ]);
  return {
    groupPrices: groupPrices || {},
    customerDeals: customerDeals || {},
    tempDeals: tempDeals || [],
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return json({ ok: true });
  }

  const s = store();

  if (req.method === 'GET') {
    return json(await readAll(s));
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, payload } = body || {};
  if (!action) return json({ error: 'Missing action' }, 400);
  const now = new Date().toISOString();

  try {
    if (action === 'saveGroupPrice') {
      const { groupId, listPrice, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, listPrice, updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'setGroupEnabled') {
      const { groupId, enabled, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, enabled: !!enabled, updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveCustomerDeal') {
      const { outletId, groupId, dealX, updatedBy } = payload;
      const current = (await s.get('customerDeals', { type: 'json' })) || {};
      const key = outletId + '|' + groupId;
      if (Number(dealX) === 0) {
        delete current[key];
      } else {
        current[key] = { dealX: Number(dealX), updatedBy, updatedAt: now };
      }
      await s.setJSON('customerDeals', current);
      return json({ ok: true, customerDeals: current });
    }

    if (action === 'bulkApplyDeal') {
      const { outletId, groupIds, dealX, updatedBy } = payload;
      const current = (await s.get('customerDeals', { type: 'json' })) || {};
      (groupIds || []).forEach((groupId) => {
        const key = outletId + '|' + groupId;
        if (Number(dealX) === 0) delete current[key];
        else current[key] = { dealX: Number(dealX), updatedBy, updatedAt: now };
      });
      await s.setJSON('customerDeals', current);
      return json({ ok: true, customerDeals: current });
    }

    if (action === 'saveTempDeal') {
      const { id, outletId, groupId, dealX, start, end, notes, updatedBy } = payload;
      const current = (await s.get('tempDeals', { type: 'json' })) || [];
      const newId = id || ('td_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((t) => t.id === newId);
      const rec = { id: newId, outletId, groupId, dealX: Number(dealX), start, end, notes: notes || '', updatedBy, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('tempDeals', current);
      return json({ ok: true, id: newId, tempDeals: current });
    }

    if (action === 'deleteTempDeal') {
      const { id } = payload;
      const current = (await s.get('tempDeals', { type: 'json' })) || [];
      const next = current.filter((t) => t.id !== id);
      await s.setJSON('tempDeals', next);
      return json({ ok: true, tempDeals: next });
    }

    return json({ error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
};
