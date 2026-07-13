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
  const [groupPrices, customerDeals, tempDeals, customerFlags, customerGlassPricing, customerPickFees, customerOffPremisePricing] = await Promise.all([
    s.get('groupPrices', { type: 'json' }),
    s.get('customerDeals', { type: 'json' }),
    s.get('tempDeals', { type: 'json' }),
    s.get('customerFlags', { type: 'json' }),
    s.get('customerGlassPricing', { type: 'json' }),
    s.get('customerPickFees', { type: 'json' }),
    s.get('customerOffPremisePricing', { type: 'json' }),
  ]);
  return {
    groupPrices: groupPrices || {},
    customerDeals: customerDeals || {},
    tempDeals: tempDeals || [],
    customerFlags: customerFlags || {},
    customerGlassPricing: customerGlassPricing || {},
    customerPickFees: customerPickFees || {},
    customerOffPremisePricing: customerOffPremisePricing || {},
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

    if (action === 'saveCustomerFlag') {
      // field is 'pricingUpdated', 'metWithCustomer' (booleans), or 'notes' (string)
      const { outletId, field, value, updatedBy } = payload;
      const current = (await s.get('customerFlags', { type: 'json' })) || {};
      const existing = current[outletId] || { pricingUpdated: false, metWithCustomer: false };
      current[outletId] = { ...existing, [field]: value, updatedBy, updatedAt: now };
      await s.setJSON('customerFlags', current);
      return json({ ok: true, customerFlags: current });
    }

    if (action === 'saveGlassSize') {
      // Glass sizes are shared across every beer for a customer.
      const { outletId, glassKey, sizeMl, updatedBy } = payload;
      const current = (await s.get('customerGlassPricing', { type: 'json' })) || {};
      const existingOutlet = current[outletId] || {};
      const sizes = { ...(existingOutlet.sizes || {}), [glassKey]: Number(sizeMl) };
      current[outletId] = { ...existingOutlet, sizes, updatedBy, updatedAt: now };
      await s.setJSON('customerGlassPricing', current);
      return json({ ok: true, customerGlassPricing: current });
    }

    if (action === 'saveGlassPrice') {
      // Glass retail prices (inc GST) are set per SKU (groupId).
      const { outletId, groupId, glassKey, price, updatedBy } = payload;
      const current = (await s.get('customerGlassPricing', { type: 'json' })) || {};
      const existingOutlet = current[outletId] || {};
      const prices = { ...(existingOutlet.prices || {}) };
      prices[groupId] = { ...(prices[groupId] || {}), [glassKey]: Number(price) };
      current[outletId] = { ...existingOutlet, prices, updatedBy, updatedAt: now };
      await s.setJSON('customerGlassPricing', current);
      return json({ ok: true, customerGlassPricing: current });
    }

    if (action === 'savePickFee') {
      // Optional, shared between the Venues and Off Premise calculators. unitType is 'keg' or
      // 'carton'; fee may be null to clear it back to "not set" (blank).
      const { outletId, unitType, fee, updatedBy } = payload;
      const current = (await s.get('customerPickFees', { type: 'json' })) || {};
      const existing = current[outletId] || {};
      current[outletId] = { ...existing, [unitType]: (fee === null || fee === undefined) ? null : Number(fee), updatedBy, updatedAt: now };
      await s.setJSON('customerPickFees', current);
      return json({ ok: true, customerPickFees: current });
    }

    if (action === 'saveCartonPackQty') {
      // Cans per carton — set per SKU group on the Product List Prices page, since each SKU
      // can genuinely come in a different carton size. Used by both margin calculators.
      const { groupId, cartonPackQty, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, cartonPackQty: Number(cartonPackQty), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveMultipackQty') {
      // Cans per multipack — set per SKU group (not per customer), since different beers can
      // come in different multipack sizes (e.g. a 4-pack vs a 6-pack).
      const { groupId, multipackQty, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, multipackQty: Number(multipackQty), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveCanSizeMl') {
      // mL per can — set per SKU group, for display/reference alongside carton math.
      const { groupId, canSizeMl, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, canSizeMl: Number(canSizeMl), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveOffPremisePrice') {
      // Carton/multipack/single retail prices (inc GST) are set per SKU (groupId). The
      // 'single' price is also shown on the Venues calculator for the same customer/SKU.
      const { outletId, groupId, priceType, price, updatedBy } = payload;
      const current = (await s.get('customerOffPremisePricing', { type: 'json' })) || {};
      const existingOutlet = current[outletId] || {};
      const prices = { ...(existingOutlet.prices || {}) };
      prices[groupId] = { ...(prices[groupId] || {}), [priceType]: Number(price) };
      current[outletId] = { ...existingOutlet, prices, updatedBy, updatedAt: now };
      await s.setJSON('customerOffPremisePricing', current);
      return json({ ok: true, customerOffPremisePricing: current });
    }

    return json({ error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
};
