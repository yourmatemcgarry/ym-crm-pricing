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
  const [groupPrices, customerDeals, tempDeals, customerFlags, customerGlassPricing, customerPickFees, customerOffPremisePricing, rsmTargets, activations, trucks, orders, deliveryRuns, manualOutlets, customerDeliveryDetails] = await Promise.all([
    s.get('groupPrices', { type: 'json' }),
    s.get('customerDeals', { type: 'json' }),
    s.get('tempDeals', { type: 'json' }),
    s.get('customerFlags', { type: 'json' }),
    s.get('customerGlassPricing', { type: 'json' }),
    s.get('customerPickFees', { type: 'json' }),
    s.get('customerOffPremisePricing', { type: 'json' }),
    s.get('rsmTargets', { type: 'json' }),
    s.get('activations', { type: 'json' }),
    s.get('trucks', { type: 'json' }),
    s.get('orders', { type: 'json' }),
    s.get('deliveryRuns', { type: 'json' }),
    s.get('manualOutlets', { type: 'json' }),
    s.get('customerDeliveryDetails', { type: 'json' }),
  ]);
  return {
    groupPrices: groupPrices || {},
    customerDeals: customerDeals || {},
    tempDeals: tempDeals || [],
    customerFlags: customerFlags || {},
    customerGlassPricing: customerGlassPricing || {},
    customerPickFees: customerPickFees || {},
    customerOffPremisePricing: customerOffPremisePricing || {},
    rsmTargets: rsmTargets || {},
    activations: activations || [],
    trucks: trucks || [],
    orders: orders || [],
    deliveryRuns: deliveryRuns || [],
    manualOutlets: manualOutlets || {},
    customerDeliveryDetails: customerDeliveryDetails || {},
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

    if (action === 'saveRsmTarget') {
      // field is one of: totalVolumeTarget, kegVolumeTarget, cartonVolumeTarget,
      // kegListingsTarget, cartonListingsTarget. value may be null to clear it (back to blank).
      const { rsm, quarterKey, field, value, updatedBy } = payload;
      const current = (await s.get('rsmTargets', { type: 'json' })) || {};
      const key = rsm + '|' + quarterKey;
      const existing = current[key] || {};
      if (value === null || value === undefined) {
        const updated = { ...existing };
        delete updated[field];
        current[key] = { ...updated, updatedBy, updatedAt: now };
      } else {
        current[key] = { ...existing, [field]: Number(value), updatedBy, updatedAt: now };
      }
      await s.setJSON('rsmTargets', current);
      return json({ ok: true, rsmTargets: current });
    }

    if (action === 'saveActivation') {
      const { id, outletId, productType, activationType, start, end, dealX, bonusStock, pos, consumerPricing, groupId, tempDealId, updatedBy } = payload;
      const current = (await s.get('activations', { type: 'json' })) || [];
      const newId = id || ('act_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((a) => a.id === newId);
      const rec = {
        id: newId, outletId, productType, activationType, start, end,
        dealX: Number(dealX) || 0, bonusStock: bonusStock || '', pos: pos || '', consumerPricing: consumerPricing || '',
        groupId: groupId || null, tempDealId: tempDealId || null,
        updatedBy, updatedAt: now,
      };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('activations', current);
      return json({ ok: true, id: newId, activations: current });
    }

    if (action === 'deleteActivation') {
      const { id } = payload;
      const current = (await s.get('activations', { type: 'json' })) || [];
      const next = current.filter((a) => a.id !== id);
      await s.setJSON('activations', next);
      return json({ ok: true, activations: next });
    }

    if (action === 'saveWeightKg') {
      // Weight per sale unit (per keg, or per carton) — used by the Orders/Delivery tools to
      // work out a load's total weight and check it against a truck's capacity.
      const { groupId, weightKg, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, weightKg: Number(weightKg), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveTruck') {
      const { id, name, maxWeightKg, updatedBy } = payload;
      const current = (await s.get('trucks', { type: 'json' })) || [];
      const newId = id || ('truck_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((t) => t.id === newId);
      const rec = { id: newId, name, maxWeightKg: Number(maxWeightKg), updatedBy, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('trucks', current);
      return json({ ok: true, id: newId, trucks: current });
    }

    if (action === 'deleteTruck') {
      const { id } = payload;
      const current = (await s.get('trucks', { type: 'json' })) || [];
      const next = current.filter((t) => t.id !== id);
      await s.setJSON('trucks', next);
      return json({ ok: true, trucks: next });
    }

    if (action === 'saveOrder') {
      // The whole order record (lines[], delivery{}, etc.) is sent as one object — simpler and
      // less error-prone than flattening a deeply nested shape into individual args. The server
      // just assigns an id if it's new and upserts by id, same pattern as everywhere else.
      const { order } = payload;
      const current = (await s.get('orders', { type: 'json' })) || [];
      const newId = order.id || ('ord_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((o) => o.id === newId);
      const rec = { ...order, id: newId, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('orders', current);
      return json({ ok: true, id: newId, orders: current });
    }

    if (action === 'deleteOrder') {
      const { id } = payload;
      const current = (await s.get('orders', { type: 'json' })) || [];
      const next = current.filter((o) => o.id !== id);
      await s.setJSON('orders', next);
      return json({ ok: true, orders: next });
    }

    if (action === 'saveRun') {
      // Same whole-object upsert pattern as saveOrder.
      const { run } = payload;
      const current = (await s.get('deliveryRuns', { type: 'json' })) || [];
      const newId = run.id || ('run_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((r) => r.id === newId);
      const rec = { ...run, id: newId, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('deliveryRuns', current);
      return json({ ok: true, id: newId, deliveryRuns: current });
    }

    if (action === 'deleteRun') {
      const { id } = payload;
      const current = (await s.get('deliveryRuns', { type: 'json' })) || [];
      const next = current.filter((r) => r.id !== id);
      await s.setJSON('deliveryRuns', next);
      return json({ ok: true, deliveryRuns: next });
    }

    if (action === 'saveManualOutlet') {
      // Customers added before they have any sales history — keyed by outlet ID (either a real
      // ID the rep already knows, e.g. from a licensing/POS system, or an auto-generated
      // placeholder from the client if not). Dictionary-keyed like groupPrices/customerFlags,
      // since the id IS the key — no separate "assign a new id" step needed like orders/runs.
      const { outlet } = payload;
      const current = (await s.get('manualOutlets', { type: 'json' })) || {};
      current[outlet.id] = { ...outlet, updatedAt: now };
      await s.setJSON('manualOutlets', current);
      return json({ ok: true, id: outlet.id, manualOutlets: current });
    }

    if (action === 'deleteManualOutlet') {
      const { id } = payload;
      const current = (await s.get('manualOutlets', { type: 'json' })) || {};
      delete current[id];
      await s.setJSON('manualOutlets', current);
      return json({ ok: true, manualOutlets: current });
    }

    if (action === 'saveDeliveryDetails') {
      // Access notes/on-site contact/preferred timing per customer — dictionary-keyed by outlet
      // ID like customerFlags/manualOutlets. Saved as one whole record per "Save" click (not
      // per-field), matching the batch-save UX on the Customer Summary page.
      const { outletId, accessNotes, contactName, contactPhone, preferredDay, preferredWindow, updatedBy } = payload;
      const current = (await s.get('customerDeliveryDetails', { type: 'json' })) || {};
      const isBlank = !accessNotes && !contactName && !contactPhone && !preferredWindow && (!preferredDay || preferredDay === 'Any day');
      if (isBlank) delete current[outletId];
      else current[outletId] = { accessNotes, contactName, contactPhone, preferredDay, preferredWindow, updatedBy, updatedAt: now };
      await s.setJSON('customerDeliveryDetails', current);
      return json({ ok: true, customerDeliveryDetails: current });
    }

    return json({ error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
};
