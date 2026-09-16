// ===================== Data Refresh: CSV -> CRM_DATA pipeline (JS port of aggregate13.py) =====================
// Pure, side-effect-free port of the in-scope portion (lines 1-347) of aggregate13.py — outlets,
// products/groups, sales aggregation, group summary, outlet summary, daily volume, and meta.
// Deliberately does NOT touch the out-of-scope Excel/contacts logic (aggregate13.py lines 349-591):
// familyGroups / vipContactsSeed / outlet email+contact+familyGroup enrichment are not produced
// here — in the live tool those are carried forward unchanged from the previously-loaded dataset.
//
// Plain script, no ES module import/export syntax (same convention as netlify_part1-4.js) so this
// file can be loaded directly in a browser (functions hung off the DataRefresh namespace below).
// It also works under Node via `require()` for verification — see verify_datarefresh.js.
//
// All functions here are pure: they take already-decoded CSV text (strings) in and return plain
// data out. Nothing here reads files or touches the DOM — in the browser the caller is expected to
// get the text via FileReader.readAsText(file, 'iso-8859-1') (the CSVs are latin-1 encoded, same as
// aggregate13.py's `encoding='latin-1'` — NOT utf-8, this matters for names/addresses with special
// characters like en-dashes).

(function (root) {
  'use strict';

  // ---------- Python round() port (round-half-to-even on the TRUE binary value of the double) ----------
  // Python's round(x, n) is NOT the same as JS's naive `Math.round(x * 10**n) / 10**n`: ties are
  // resolved to the nearest EVEN digit (banker's rounding), and — critically — "ties" are decided
  // against the double's exact binary value, not its printed decimal form. We reproduce that exactly
  // using BigInt arithmetic on the IEEE-754 bit pattern rather than approximating with epsilon
  // comparisons, so this matches CPython's `round()` bit-for-bit for every input we exercise here
  // (ndigits is always a small non-negative integer in this pipeline: 0, 1, 2, or 3).
  function pyRound(x, ndigits) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    if (x === 0) return 0;
    const neg = x < 0;
    const ax = Math.abs(x);

    // Decompose the double into integer mantissa m and binary exponent e such that ax === m * 2^e,
    // exactly (m is the 53-bit significand including the implicit leading bit for normal numbers).
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setFloat64(0, ax);
    const hi = dv.getUint32(0);
    const lo = dv.getUint32(4);
    const expBits = (hi >>> 20) & 0x7ff;
    const mantHi = hi & 0xfffff;
    let m, e;
    if (expBits === 0) {
      // Subnormal — not expected for this dataset's values, handled for completeness.
      m = BigInt(mantHi) * 4294967296n + BigInt(lo);
      e = -1074;
    } else {
      m = (BigInt(mantHi) | 0x100000n) * 4294967296n + BigInt(lo); // implicit leading 1 bit
      e = expBits - 1075;
    }

    const nd = BigInt(ndigits);
    // ax * 10^ndigits == m * 2^e * 10^ndigits == m * 5^ndigits * 2^(e+ndigits)
    const k = BigInt(e) + nd;
    let result; // BigInt: round-half-even(ax * 10^ndigits)

    if (k >= 0n) {
      // ax already has an exact terminating decimal expansion with <= ndigits digits after the
      // point (the scaled value is already an integer) — no rounding needed, return ax unchanged.
      return neg ? -ax : ax;
    } else {
      const p = -k; // > 0
      const pow5 = 5n ** nd;
      const num = m * pow5;
      const den = 1n << p; // 2^p
      const q = num / den;
      const r = num % den;
      const twice = r * 2n;
      if (twice < den) {
        result = q;
      } else if (twice > den) {
        result = q + 1n;
      } else {
        // exact tie — round to even
        result = (q % 2n === 0n) ? q : q + 1n;
      }
    }

    const pow10 = Math.pow(10, ndigits);
    const val = Number(result) / pow10;
    return neg ? -val : val;
  }

  // ---------- CSV parsing (quote-aware, handles \r\n and \n, embedded commas/quotes) ----------
  function parseCsv(text) {
    if (text.length && text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM if present
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    const n = text.length;
    let i = 0;
    let sawAnyFieldInRow = false;

    function pushField() {
      row.push(field);
      field = '';
      sawAnyFieldInRow = true;
    }
    function pushRow() {
      pushField();
      rows.push(row);
      row = [];
      sawAnyFieldInRow = false;
    }

    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += c;
        i += 1;
        continue;
      } else {
        if (c === '"') {
          inQuotes = true;
          i += 1;
          continue;
        }
        if (c === ',') {
          pushField();
          i += 1;
          continue;
        }
        if (c === '\r') {
          if (text[i + 1] === '\n') i += 1;
          pushRow();
          i += 1;
          continue;
        }
        if (c === '\n') {
          pushRow();
          i += 1;
          continue;
        }
        field += c;
        i += 1;
        continue;
      }
    }
    // Trailing field/row (file may or may not end with a newline).
    if (field !== '' || sawAnyFieldInRow || row.length > 0) {
      pushRow();
    }
    // Drop a single fully-empty trailing row (e.g. from a trailing newline at EOF).
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
      rows.pop();
    }

    if (!rows.length) return [];
    const header = rows[0];
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const rawRow = rows[r];
      if (rawRow.length === 1 && rawRow[0] === '') continue; // stray blank line
      const obj = {};
      for (let c = 0; c < header.length; c++) {
        // Mirror csv.DictReader: a column present-but-empty on the line is '' (not missing);
        // a genuinely short row pads missing trailing columns with '' too (DictReader's restval
        // default is None, but every row in these exports is comma-padded to full width, so in
        // practice '' is the correct default either way for this pipeline's `x or 0`-style checks).
        obj[header[c]] = c < rawRow.length ? rawRow[c] : '';
      }
      out.push(obj);
    }
    return out;
  }

  // ---------- date helpers ----------
  // Parses 'DD-MM-YYYY' (e.g. "21-06-2023") into a UTC-midnight timestamp (ms), matching Python's
  // naive `datetime.strptime(s, '%d-%m-%Y')` used purely for ordering/day-diff/formatting — using
  // UTC avoids any local-timezone/DST bugs shifting day boundaries.
  function parseDateDMY(s) {
    if (!s) return null;
    const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s.trim());
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ms = Date.UTC(year, month - 1, day);
    // Validate round-trip (rejects e.g. 31-02-2024) to match strptime's strictness.
    const d = new Date(ms);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return ms;
  }
  function fmtDateISO(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  // Inverse of fmtDateISO — parses 'YYYY-MM-DD' (as already stored in meta/outletSummary/
  // groupSummary date fields) back into the same UTC-midnight ms timestamp used everywhere else
  // in this file. Round 84: needed so the historical merge can compare old ISO date strings
  // against newly-parsed sales rows without a lossy round-trip through Date's local timezone.
  function parseISOToMs(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  function minNonNullStr(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return a < b ? a : b;
  }
  function maxNonNullStr(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return a > b ? a : b;
  }
  const MS_PER_DAY = 86400000;

  function numOr0(s) {
    // Mirrors Python's `float(x or 0)`: '' (falsy) -> 0, any non-empty string -> Number(that string).
    if (!s) return 0;
    const v = Number(s);
    return isNaN(v) ? 0 : v;
  }

  // ---------- OUTLETS ----------
  function buildOutlets(outletRows) {
    let allOutletsCount = 0;
    const outlets = {};
    const volumeStreamCounts = {};
    const ownerGroupCounts = {};
    for (const row of outletRows) {
      allOutletsCount += 1;
      const oid = row['OTDOutletId'];
      const vs = row['Segment3'];
      const og = row['Segment8'];
      volumeStreamCounts[vs] = (volumeStreamCounts[vs] || 0) + 1;
      ownerGroupCounts[og] = (ownerGroupCounts[og] || 0) + 1;
      outlets[oid] = {
        id: oid,
        name: row['OTDOutletNameSuburb'],
        license: row['OTDOutletLicenseNo'],
        majorGroup: row['OTDLastMajorGroup'],
        banner: row['OTDLastBanner'],
        address: row['OTDOutletAddress'],
        suburb: row['OTDOutletSuburb'],
        state: row['OTDOutletState'],
        postcode: row['OTDOutletPostCode'],
        phone: row['OTDOutletPhoneNumber'],
        rsm: row['CustZoneDesc'],
        custType: row['Segment5'],
        segCalled: row['Segment4'],
        volumeStream: row['Segment3'],
        zone: row['Segment7'],
        segRegion: row['Segment6'],
        ownerGroup: row['Segment8'],
        geoTier: row['Segment9'],
        segVenueType: row['Segment10'],
        excluded: row['ExcludeOutlet'] === '1',
      };
    }
    let salesTeamCount = 0;
    for (const oid in outlets) if (outlets[oid].volumeStream === 'Sales Team') salesTeamCount++;
    return { outlets, allOutletsCount, salesTeamCount, volumeStreamCounts, ownerGroupCounts };
  }

  // ---------- PRODUCTS + GROUPS ----------
  const CORE_ORDER = ['Your Mates Dave', 'Your Mates Donnie', 'Your Mates Lager', 'Your Mates Larry Jr', 'Your Mates Larry', 'Your Mates Sally', 'Your Mates Tilly'];

  function shortLabel(subbrand) {
    if (subbrand.indexOf('Your Mates ') === 0) return subbrand.slice('Your Mates '.length);
    return subbrand;
  }

  function formatOf(row) {
    if (row['LFPackType'] === 'Keg') {
      let size = null;
      const f = parseFloat(row['LFUnitSize']);
      if (!isNaN(f) && row['LFUnitSize'] !== '' && row['LFUnitSize'] !== null && row['LFUnitSize'] !== undefined) size = f;
      if (size === 30000.0) return 'Keg30L';
      return 'Keg';
    }
    return 'Pack';
  }

  const FORMAT_LABEL = { Keg30L: '30L Keg', Keg: '50L Keg', Pack: 'Carton' };
  const FORMAT_BUCKET = { Keg30L: 'KEGS', Keg: 'KEGS', Pack: 'CARTONS' };

  function gidSlug(subbrand) {
    return subbrand.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function buildProductsAndGroups(productRows) {
    const products = {};
    for (const row of productRows) {
      const pid = row['LFProductNo'];
      products[pid] = {
        id: pid,
        desc: row['LFProductDesc'],
        shortDesc: row['LFGIMSRptDesc'],
        group: row['LFGroupDesc'],
        dept: row['LFDeptDesc'],
        cat: row['LFCatDesc'],
        brand: row['LFBrand'],
        subbrand: row['LFSubbrand'],
        unitSizeMl: row['LFUnitSize'],
        packQty: row['LFPackQty'] ? parseInt(row['LFPackQty'], 10) : 1,
        packType: row['LFPackType'],
      };
    }

    // group_members: keyed by (gid, subbrand, fmt) composite, preserving first-seen insertion order
    // — mirrors Python's defaultdict(list) built while iterating raw_products in CSV row order.
    const groupMembersOrder = [];
    const groupMembersMap = {}; // compositeKey -> {gid, subbrand, fmt, members: []}
    for (const row of productRows) {
      const subbrand = row['LFSubbrand'];
      const fmt = formatOf(row);
      const gid = gidSlug(subbrand) + '_' + fmt;
      const key = gid + ' ' + subbrand + ' ' + fmt;
      let entry = groupMembersMap[key];
      if (!entry) {
        entry = { gid, subbrand, fmt, members: [] };
        groupMembersMap[key] = entry;
        groupMembersOrder.push(key);
      }
      entry.members.push(row['LFProductNo']);
    }

    const groups = {};
    for (const key of groupMembersOrder) {
      const { gid, subbrand, fmt, members } = groupMembersMap[key];
      const packQtySet = new Set(members.map((pid) => products[pid].packQty));
      const packQtys = Array.from(packQtySet).sort((a, b) => a - b);
      let refKegLitres = null;
      let refPackQty, saleUnitLabel;
      if (fmt === 'Pack') {
        refPackQty = packQtys.includes(16) ? 16 : packQtys[0];
        saleUnitLabel = `${refPackQty}-pack carton`;
      } else {
        refPackQty = 1;
        saleUnitLabel = 'keg';
        let kegSizesMl = members.map((pid) => parseFloat(products[pid].unitSizeMl)).filter((s) => !isNaN(s) && s > 0);
        if (kegSizesMl.length) {
          const refMl = kegSizesMl.includes(49500.0) ? 49500.0 : kegSizesMl[0];
          refKegLitres = pyRound(refMl / 1000.0, 2);
        }
      }
      groups[gid] = {
        id: gid,
        subbrand,
        label: shortLabel(subbrand),
        format: fmt,
        formatLabel: FORMAT_LABEL[fmt],
        bucket: FORMAT_BUCKET[fmt],
        isCore: CORE_ORDER.indexOf(subbrand) !== -1,
        members,
        packQtys,
        refPackQty,
        saleUnitLabel,
        kegLitres: refKegLitres,
      };
    }

    function subbrandRank(subbrand) {
      const idx = CORE_ORDER.indexOf(subbrand);
      if (idx !== -1) return [0, idx, ''];
      return [1, 0, subbrand];
    }
    function sortKey(g) {
      const bucketRank = g.bucket === 'KEGS' ? 0 : 1;
      const fmtRank = g.format === 'Keg30L' ? 0 : 1;
      const sb = subbrandRank(g.subbrand);
      return [bucketRank, sb[0], sb[1], sb[2], fmtRank];
    }
    function cmpTuple(a, b) {
      for (let i = 0; i < a.length; i++) {
        const av = a[i], bv = b[i];
        if (av === bv) continue;
        if (typeof av === 'string' || typeof bv === 'string') {
          return av < bv ? -1 : av > bv ? 1 : 0;
        }
        return av - bv;
      }
      return 0;
    }
    const groupOrder = Object.keys(groups)
      .map((gid) => groups[gid])
      .sort((a, b) => cmpTuple(sortKey(a), sortKey(b)))
      .map((g) => g.id);

    const productToGroup = {};
    for (const gid in groups) {
      for (const pid of groups[gid].members) productToGroup[pid] = gid;
    }

    return { products, groups, groupOrder, productToGroup };
  }

  // ---------- SALES ----------
  // Round 84: `prevData` (optional 5th param) is how sales history now accumulates across
  // refreshes instead of being replaced by whatever window the current OnTap export happens to
  // cover (OnTap only ever exports a trailing ~36 months — refreshing without a merge silently
  // drops anything older than that window, a little more each time). See buildPrevDataForMerge
  // for its shape ({ dailyVolume, groupSummary, outletSummary, epochDateMs, salesDataToMs,
  // totalValidPaidLines, totalValidPaidLinesAll }). Passing prevData=null/undefined reproduces the
  // exact pre-Round-84 single-batch behavior (used by verify_datarefresh.js Part 1 and any other
  // caller that doesn't have a previous dataset yet).
  function buildSalesAggregates(salesRows, outlets, products, productToGroup, prevData) {
    const rowsBuffer = [];
    let maxDate = null;
    let minDate = null;
    let nRows = 0;

    const hasOwn = Object.prototype.hasOwnProperty;
    for (const row of salesRows) {
      nRows += 1;
      if (!hasOwn.call(outlets, row['OTDOutletId'])) continue;
      const d = parseDateDMY(row['InvoiceDate']);
      if (d === null) continue;
      if (maxDate === null || d > maxDate) maxDate = d;
      if (minDate === null || d < minDate) minDate = d;
      rowsBuffer.push([row, d]);
    }

    const cutoff = maxDate === null ? null : maxDate - 365 * MS_PER_DAY;

    // Round 84: epochDate is now the FIXED historical floor, not just this batch's own min date —
    // it only ever moves EARLIER (when a previous dataset's own accumulated epoch reaches further
    // back than this batch's min date), never later, so the merge below can preserve every day
    // we've ever seen rather than resetting to whatever the newest export's rolling window covers.
    const prevEpochMs = prevData && typeof prevData.epochDateMs === 'number' ? prevData.epochDateMs : null;
    const epochDate = minDate !== null
      ? (prevEpochMs !== null ? Math.min(prevEpochMs, minDate) : minDate)
      : prevEpochMs;
    // Day index (relative to epochDate) at which THIS batch's own coverage begins. Anything
    // preserved from the previous dataset at or after this index falls inside the new export's
    // window and is fully superseded by the fresh computation below (so a corrected/restated
    // invoice still applies); anything strictly before it is outside the new export's window
    // entirely (OnTap simply doesn't include it) and is preserved untouched.
    const newWindowStartDayIdx = minDate !== null ? Math.round((minDate - epochDate) / MS_PER_DAY) : null;

    // tx: "oid|gid" -> array of [d, pricePerSaleableUnit, dollars, units, invoiceNo, pid, packQty]
    // — every valid (dollars>0) priced sale found in THIS batch only (merged into groupSummary,
    // with history, further below).
    const tx = {};
    const txOrder = [];
    // outletTotals: oid -> accumulator, only created on first units>0 row for that outlet (mirrors
    // Python's defaultdict(...) which only materializes an entry when first accessed/written).
    // Round 84: also tracks inc* — the portion of this batch's activity that's genuinely NEW since
    // the previous refresh (date strictly after that outlet's old lastDate), used to accumulate
    // lifetime totals without double-counting the overlapping window.
    const outletTotals = {};
    const outletTotalsOrder = [];
    // dailyVolume: "oid|gid" -> { dayIndex: litres } — this batch's own days only (pre-window
    // history from prevData is merged in separately, below), keyed relative to the (possibly
    // earlier-than-this-batch) epochDate established above.
    const dailyVolume = {};
    const dailyVolumeOrder = [];

    let nValid = 0;
    let nValidSalesTeam = 0;
    // Round 84: cumulative-since-last-refresh counters, gated on date > prevData.salesDataToMs so
    // a valid line already counted in a previous refresh's totalValidPaidLines is never recounted.
    let nValidSinceLast = 0;
    let nValidSalesTeamSinceLast = 0;
    const prevSalesDataToMs = prevData && typeof prevData.salesDataToMs === 'number' ? prevData.salesDataToMs : null;

    function newOutletAcc() {
      return {
        revenue: 0, units: 0, lastDate: null, firstDate: null, txCount: 0,
        t12mRevenue: 0, t12mUnits: 0, lastWhouse: null,
        // Round 62: every distinct date this outlet placed a YMT-warehouse (direct delivery)
        // order, not just the earliest — needed to detect reactivations after a 13-week gap. See
        // the ymtOnboardDates comment below and build_crm_data22.py's module docstring.
        ymtDates: new Set(),
        // Round 84: portion of revenue/units/txCount genuinely new since this outlet's previous
        // lastDate — accumulated per-row, see the outlet_summary merge below.
        incRevenue: 0, incUnits: 0, incTxCount: 0,
      };
    }
    // Zero accumulator for an outlet with no activity in THIS batch at all (e.g. currently
    // dormant) — lets the outlet_summary merge below use one uniform code path instead of
    // special-casing "no new data" separately from "some new data".
    function emptyOutletAcc() {
      return { revenue: 0, units: 0, lastDate: null, firstDate: null, txCount: 0, t12mRevenue: 0, t12mUnits: 0, lastWhouse: null, ymtDates: new Set(), incRevenue: 0, incUnits: 0, incTxCount: 0 };
    }

    for (const [row, d] of rowsBuffer) {
      const oid = row['OTDOutletId'];
      const pid = row['LFProductNo'];
      const gid = hasOwn.call(productToGroup, pid) ? productToGroup[pid] : null;

      const dollarsStr = row['DollarsExcWETExcGST'];
      const unitsStr = row['UnitSupplied'];
      const dollars = numOr0(dollarsStr);
      const units = numOr0(unitsStr);
      // (Python's try/except around float() only fails on genuinely non-numeric text, which
      // doesn't occur in these exports; numOr0 already returns 0 for blank fields same as
      // `float(x or 0)`, so there's no separate failure path to skip the row here.)

      if (units > 0) {
        let ot = outletTotals[oid];
        if (!ot) {
          ot = newOutletAcc();
          outletTotals[oid] = ot;
          outletTotalsOrder.push(oid);
        }
        ot.revenue += dollars;
        ot.units += units;
        ot.txCount += 1;
        const whouse = row['Whouse'] || null;
        if (ot.lastDate === null || d > ot.lastDate) {
          ot.lastDate = d;
          ot.lastWhouse = whouse;
        }
        if (ot.firstDate === null || d < ot.firstDate) ot.firstDate = d;
        if (whouse === 'YMT') {
          ot.ymtDates.add(d);
        }
        if (d >= cutoff) {
          ot.t12mRevenue += dollars;
          ot.t12mUnits += units;
        }
        const oldOutletEntry = prevData && prevData.outletSummary ? prevData.outletSummary[oid] : null;
        const oldOutletLastMs = oldOutletEntry && oldOutletEntry.lastDate ? parseISOToMs(oldOutletEntry.lastDate) : null;
        if (oldOutletLastMs === null || d > oldOutletLastMs) {
          ot.incRevenue += dollars;
          ot.incUnits += units;
          ot.incTxCount += 1;
        }

        if (gid) {
          if (dollars > 0) {
            nValid += 1;
            const isSalesTeam = outlets[oid].volumeStream === 'Sales Team';
            if (isSalesTeam) nValidSalesTeam += 1;
            if (prevSalesDataToMs === null || d > prevSalesDataToMs) {
              nValidSinceLast += 1;
              if (isSalesTeam) nValidSalesTeamSinceLast += 1;
            }
            const productPackQty = products[pid].packQty || 1;
            const pricePerSaleableUnit = (dollars / units) * productPackQty;
            const key = oid + '|' + gid;
            if (!tx[key]) { tx[key] = []; txOrder.push(key); }
            tx[key].push([d, pricePerSaleableUnit, dollars, units, row['InvoiceNo'], pid, productPackQty]);
          }

          let unitSizeMl = parseFloat(products[pid].unitSizeMl);
          if (isNaN(unitSizeMl)) unitSizeMl = 0.0;
          const litres = unitSizeMl > 0 ? units * (unitSizeMl / 1000.0) : 0.0;
          const dayIdx = Math.round((d - epochDate) / MS_PER_DAY);

          const dvKey = oid + '|' + gid;
          let dv = dailyVolume[dvKey];
          if (!dv) { dv = {}; dailyVolume[dvKey] = dv; dailyVolumeOrder.push(dvKey); }
          dv[dayIdx] = (dv[dayIdx] || 0) + litres;
        }
      }
    }

    // ---- dailyVolume: layer this batch's fresh days on top of preserved pre-window history ----
    // Seed every key from the previous dataset's dailyVolume (remapped onto the possibly-earlier
    // epochDate established above), keeping only the days strictly before this batch's own
    // coverage begins (newWindowStartDayIdx). Everything at or after that index was already fully
    // (re)computed fresh above, so this never collides with — or double-counts against — it.
    if (prevData && prevData.dailyVolume) {
      const offsetDays = prevEpochMs !== null ? Math.round((prevEpochMs - epochDate) / MS_PER_DAY) : 0;
      for (const key in prevData.dailyVolume) {
        const oid = splitKey(key)[0];
        if (!hasOwn.call(outlets, oid)) continue; // outlet no longer exists at all — drop (matches pre-existing convention)
        const flat = prevData.dailyVolume[key];
        for (let i = 0; i < flat.length; i += 2) {
          const dayIdxAbs = flat[i] + offsetDays;
          if (newWindowStartDayIdx === null || dayIdxAbs < newWindowStartDayIdx) {
            let dv = dailyVolume[key];
            if (!dv) { dv = {}; dailyVolume[key] = dv; dailyVolumeOrder.push(key); }
            dv[dayIdxAbs] = flat[i + 1];
          }
        }
      }
    }

    // ---- group_summary: merge each outlet+SKU combo's price/order history with its previous record ----
    function mergeRecentLists(oldRecent, newRecentDesc) {
      const combined = (oldRecent || []).concat(newRecentDesc || []);
      const seen = new Set();
      const deduped = [];
      for (const r of combined) {
        const k = r.date + '|' + r.invoice + '|' + r.productId;
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(r);
      }
      // ISO 'YYYY-MM-DD' date strings sort correctly lexicographically — descending (most recent
      // first), matching the existing "recent" convention.
      deduped.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      return deduped.slice(0, 25);
    }

    const groupSummary = {};
    const prevGroupSummary = (prevData && prevData.groupSummary) || {};
    const allGroupSummaryKeys = new Set(txOrder);
    for (const key in prevGroupSummary) allGroupSummaryKeys.add(key);
    for (const key of allGroupSummaryKeys) {
      const [oid, gid] = splitKey(key);
      if (!hasOwn.call(outlets, oid)) continue; // outlet no longer exists at all — drop
      const rawList = tx[key];
      const old = hasOwn.call(prevGroupSummary, key) ? prevGroupSummary[key] : null;

      if (!rawList || !rawList.length) {
        // No activity for this combo in THIS batch at all — preserve the previous record exactly
        // (still true, just not refreshed this round; e.g. a customer who hasn't reordered a SKU
        // recently should still show its last known price, not lose all pricing history).
        if (old) groupSummary[key] = old;
        continue;
      }

      const sorted = rawList.slice().sort((a, b) => a[0] - b[0]);
      const oldLastMs = old && old.lastDate ? parseISOToMs(old.lastDate) : null;
      // Only count transactions strictly newer than what the previous refresh already knew about
      // — anything at/before old.lastDate was already reflected in old.txCount/minPrice/maxPrice,
      // so re-adding it here would double-count.
      const newOnly = oldLastMs !== null ? sorted.filter((r) => r[0] > oldLastMs) : sorted;
      const mergedTxCount = (old ? old.txCount : 0) + newOnly.length;
      const newOnlyPrices = newOnly.map((r) => r[1]);
      const mergedMinPrice = old
        ? (newOnlyPrices.length ? Math.min(old.minPrice, Math.min.apply(null, newOnlyPrices)) : old.minPrice)
        : Math.min.apply(null, sorted.map((r) => r[1]));
      const mergedMaxPrice = old
        ? (newOnlyPrices.length ? Math.max(old.maxPrice, Math.max.apply(null, newOnlyPrices)) : old.maxPrice)
        : Math.max.apply(null, sorted.map((r) => r[1]));
      const newFirstDateStr = fmtDateISO(sorted[0][0]);
      const mergedFirstDate = old ? minNonNullStr(old.firstDate, newFirstDateStr) : newFirstDateStr;

      const newLastRow = sorted[sorted.length - 1];
      const newLastIsNewer = oldLastMs === null || newLastRow[0] >= oldLastMs;
      const finalLastPrice = newLastIsNewer ? pyRound(newLastRow[1], 2) : old.lastPrice;
      const finalLastDate = newLastIsNewer ? fmtDateISO(newLastRow[0]) : old.lastDate;
      const finalLastUnits = newLastIsNewer ? newLastRow[3] : old.lastUnits;
      const finalLastInvoice = newLastIsNewer ? newLastRow[4] : old.lastInvoice;
      const finalLastProductId = newLastIsNewer ? newLastRow[5] : old.lastProductId;
      const finalLastPackQty = newLastIsNewer ? newLastRow[6] : old.lastPackQty;

      // Capped at 25 (not just a handful) so the Customer Details Sales Journal has real
      // trace-back depth — matches aggregate14.py's Python pipeline (kept in sync).
      const recentNew = sorted.slice(Math.max(0, sorted.length - 25)).slice().reverse().map((r) => ({
        date: fmtDateISO(r[0]), price: pyRound(r[1], 2), units: r[3], invoice: r[4], productId: r[5], packQty: r[6],
      }));
      const mergedRecent = old ? mergeRecentLists(old.recent, recentNew) : recentNew;

      groupSummary[key] = {
        outletId: oid,
        groupId: gid,
        lastPrice: finalLastPrice,
        lastDate: finalLastDate,
        lastUnits: finalLastUnits,
        lastInvoice: finalLastInvoice,
        lastProductId: finalLastProductId,
        lastPackQty: finalLastPackQty,
        txCount: mergedTxCount,
        minPrice: pyRound(mergedMinPrice, 2),
        maxPrice: pyRound(mergedMaxPrice, 2),
        firstDate: mergedFirstDate,
        recent: mergedRecent,
      };
    }

    // ---- outlet_summary: merge lifetime totals + onboarding-date history ----
    const outletSummary = {};
    const prevOutletSummary = (prevData && prevData.outletSummary) || {};
    const allOutletSummaryIds = new Set(outletTotalsOrder);
    for (const oid in prevOutletSummary) allOutletSummaryIds.add(oid);
    for (const oid of allOutletSummaryIds) {
      if (!hasOwn.call(outlets, oid)) continue; // outlet no longer exists at all — drop
      const ot = outletTotals[oid] || emptyOutletAcc();
      const old = hasOwn.call(prevOutletSummary, oid) ? prevOutletSummary[oid] : null;

      const mergedRevenue = pyRound((old ? old.totalRevenue : 0) + ot.incRevenue, 2);
      const mergedUnits = pyRound((old ? old.totalUnits : 0) + ot.incUnits, 1);
      const mergedTxCount = (old ? old.txCount : 0) + ot.incTxCount;
      const newFirstDateStr = ot.firstDate !== null ? fmtDateISO(ot.firstDate) : null;
      const newLastDateStr = ot.lastDate !== null ? fmtDateISO(ot.lastDate) : null;
      const mergedFirstDate = old ? minNonNullStr(old.firstDate, newFirstDateStr) : newFirstDateStr;
      const mergedLastDate = old ? maxNonNullStr(old.lastDate, newLastDateStr) : newLastDateStr;
      // lastWhouse should reflect whichever side actually produced mergedLastDate.
      const mergedLastWhouse = (newLastDateStr !== null && newLastDateStr === mergedLastDate) ? ot.lastWhouse : (old ? old.lastWhouse : null);

      // Round 84: ymtDatesAll persists the FULL set of individual YMT order dates ever seen (not
      // just the already-collapsed onboarding markers), so ymtOnboardDates/firstYmtDate can be
      // recomputed correctly from the complete accumulated history on every refresh. Datasets from
      // before this field existed fall back to their old ymtOnboardDates as a best-effort seed —
      // an accepted one-time gap (any earlier individual YMT dates that already rolled out of
      // every export before this fix shipped can't be recovered), but everything from here forward
      // accumulates permanently.
      const oldYmtDatesAllIso = old ? (old.ymtDatesAll || old.ymtOnboardDates || []) : [];
      const allYmtMsSet = new Set(oldYmtDatesAllIso.map(parseISOToMs));
      for (const dte of ot.ymtDates) allYmtMsSet.add(dte);
      const allYmtMsSorted = Array.from(allYmtMsSet).sort((a, b) => a - b);
      // Round 62: "onboarding" dates for the Direct Delivery Customers Onboarded KPI — the
      // first-ever YMT order, plus every subsequent YMT order that follows a gap of more than 91
      // days (13 weeks) with no YMT order in between — now computed over the full accumulated
      // history rather than just this batch's own window.
      const ymtOnboardDatesMs = [];
      let prevYmtDate = null;
      for (const dte of allYmtMsSorted) {
        if (prevYmtDate === null || (dte - prevYmtDate) / MS_PER_DAY > 91) {
          ymtOnboardDatesMs.push(dte);
        }
        prevYmtDate = dte;
      }

      outletSummary[oid] = {
        totalRevenue: mergedRevenue,
        totalUnits: mergedUnits,
        txCount: mergedTxCount,
        // t12m* always reflects a fresh trailing-365-day window ending at THIS export's max date —
        // if the outlet had zero activity anywhere in this batch's own ~36-month window, its
        // trailing 12 months is definitively 0 (never falls back to a stale old t12m figure, which
        // would be relative to a different "now").
        t12mRevenue: pyRound(ot.t12mRevenue, 2),
        t12mUnits: pyRound(ot.t12mUnits, 1),
        firstDate: mergedFirstDate,
        lastDate: mergedLastDate,
        lastWhouse: mergedLastWhouse,
        firstYmtDate: allYmtMsSorted.length ? fmtDateISO(allYmtMsSorted[0]) : null,
        ymtOnboardDates: ymtOnboardDatesMs.map(fmtDateISO),
        ymtDatesAll: allYmtMsSorted.map(fmtDateISO),
      };
    }

    // ---- daily_volume_out: flat [day, litres, day, litres, ...] sorted by day ascending ----
    const dailyVolumeOut = {};
    for (const key of dailyVolumeOrder) {
      const days = dailyVolume[key];
      if (!days) continue;
      const dayIdxs = Object.keys(days).map(Number).sort((a, b) => a - b);
      const flat = [];
      for (const dIdx of dayIdxs) {
        flat.push(dIdx);
        flat.push(pyRound(days[dIdx], 3));
      }
      dailyVolumeOut[key] = flat;
    }

    const outletGroupCombosSalesTeam = Object.keys(groupSummary).filter((key) => outlets[splitKey(key)[0]].volumeStream === 'Sales Team').length;

    return {
      groupSummary, outletSummary, dailyVolumeOut,
      nRows, nValid, nValidSalesTeam,
      maxDate, minDate, epochDate,
      outletGroupCombosSalesTeam,
      outletGroupCombosAll: Object.keys(groupSummary).length,
      // Round 84: cumulative-since-first-merge line counts (see buildCrmData's meta assembly) —
      // the old cumulative total (if any) plus only the lines from this batch strictly newer than
      // what the previous refresh already counted.
      cumulativeValidSalesTeam: (prevData ? prevData.totalValidPaidLines : 0) + nValidSalesTeamSinceLast,
      cumulativeValidAll: (prevData ? prevData.totalValidPaidLinesAll : 0) + nValidSinceLast,
    };
  }

  function splitKey(key) {
    const idx = key.indexOf('|');
    return [key.slice(0, idx), key.slice(idx + 1)];
  }

  // ---------- top-level ----------
  // Round 84: shapes a previousCrmData object (the full CRM_DATA blob from the prior refresh) into
  // the compact `prevData` shape buildSalesAggregates expects. Returns null if there's no previous
  // dataset (first-ever build, or callers like verify_datarefresh.js Part 1 that intentionally test
  // single-batch behavior) — buildSalesAggregates treats null exactly like the pre-Round-84 code
  // path (no merge, current-batch-only, same as always).
  function buildPrevDataForMerge(previousCrmData) {
    if (!previousCrmData) return null;
    const m = previousCrmData.meta || {};
    return {
      dailyVolume: previousCrmData.dailyVolume || {},
      groupSummary: previousCrmData.groupSummary || {},
      outletSummary: previousCrmData.outletSummary || {},
      epochDateMs: m.epochDate ? parseISOToMs(m.epochDate) : null,
      salesDataToMs: m.salesDataTo ? parseISOToMs(m.salesDataTo) : null,
      salesDataTo: m.salesDataTo || null,
      totalValidPaidLines: typeof m.totalValidPaidLines === 'number' ? m.totalValidPaidLines : 0,
      totalValidPaidLinesAll: typeof m.totalValidPaidLinesAll === 'number' ? m.totalValidPaidLinesAll : 0,
    };
  }

  // Round 84: new optional 4th param `previousCrmData` — when supplied, sales history (dailyVolume,
  // groupSummary, outletSummary) accumulates on top of it instead of being replaced by whatever
  // trailing window the current OnTap Sales export happens to cover. Omitting it (existing 3-arg
  // call sites, e.g. verify_datarefresh.js Part 1) reproduces the exact prior single-batch behavior.
  function buildCrmData(outletCsvText, productCsvText, salesCsvText, previousCrmData) {
    const outletRows = parseCsv(outletCsvText);
    const productRows = parseCsv(productCsvText);
    const salesRows = parseCsv(salesCsvText);

    const { outlets, allOutletsCount, salesTeamCount, volumeStreamCounts, ownerGroupCounts } = buildOutlets(outletRows);
    const { products, groups, groupOrder, productToGroup } = buildProductsAndGroups(productRows);
    const prevData = buildPrevDataForMerge(previousCrmData);
    const sales = buildSalesAggregates(salesRows, outlets, products, productToGroup, prevData);

    const meta = {
      // Round 84: salesDataFrom is now the accumulated historical floor (sales.epochDate), not just
      // this batch's own min date — it only moves earlier over time as more history is merged in,
      // never forward, so the "Sales history X – Y" UI copy reflects everything actually retained.
      salesDataFrom: sales.epochDate !== null ? fmtDateISO(sales.epochDate) : null,
      // salesDataTo falls back to the previous dataset's own salesDataTo in the (extremely unlikely)
      // case this batch's Sales CSV yields no valid dated rows at all, rather than going null.
      salesDataTo: sales.maxDate !== null ? fmtDateISO(sales.maxDate) : (prevData ? prevData.salesDataTo : null),
      epochDate: sales.epochDate !== null ? fmtDateISO(sales.epochDate) : null,
      // Round 84: cumulative across all refreshes to date (see buildSalesAggregates), not just this
      // batch's own count — kept consistent with salesDataFrom now also being a cumulative floor.
      totalValidPaidLines: sales.cumulativeValidSalesTeam,
      outletGroupCombos: sales.outletGroupCombosSalesTeam,
      totalValidPaidLinesAll: sales.cumulativeValidAll,
      outletGroupCombosAll: sales.outletGroupCombosAll,
      outletsTotal: allOutletsCount,
      outletsKept: salesTeamCount,
      outletsByVolumeStream: volumeStreamCounts,
      outletsByOwnerGroup: ownerGroupCounts,
      generatedAt: formatGeneratedAt(new Date()),
    };

    return {
      meta,
      outlets,
      products,
      groups,
      groupOrder,
      groupSummary: sales.groupSummary,
      outletSummary: sales.outletSummary,
      dailyVolume: sales.dailyVolumeOut,
    };
  }

  function formatGeneratedAt(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${h}:${mi}`;
  }

  // ---------- contact-info carry-forward (aggregate13.py lines 349-591 out-of-scope substitute) ----------
  // The live tool (netlify_part4.js ~line 2911, outletContactInfo) resolves an outlet's email/
  // familyGroup as: prefer a live Netlify-Blobs-saved override (customerDeliveryDetails[outletId])
  // if one exists, else fall back to outlets[id].email / outlets[id].familyGroup baked into
  // CRM_DATA. Those baked values originate from aggregate13.py's out-of-scope Excel/contacts import
  // (lines 349-591), which is NOT reproduced by this pure-CSV port. Without carrying them forward,
  // every outlet lacking a live blob override would silently lose its fallback contact info on each
  // refresh. mergeContactOverlay reproduces that baked-fallback layer by copying forward exactly the
  // 3 overlay fields (email, email2, familyGroup) from the previous dataset's matching outlet id.
  const CONTACT_OVERLAY_FIELDS = ['email', 'email2', 'familyGroup'];

  function isNonEmpty(v) {
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  // Mutates nothing — returns a NEW outlets object. For every outlet id in newOutlets, if the same
  // id exists in previousOutlets and has any of email/email2/familyGroup set (non-empty), those
  // exact fields (and only those fields) are copied onto the corresponding newOutlets record. All
  // other fields (name/address/rsm/etc.) always come from newOutlets (the fresh CSV-derived data),
  // never from previousOutlets. Ids present only in previousOutlets are dropped (no orphans). Ids
  // new in newOutlets with no match in previousOutlets are left without overlay fields, same as the
  // base pipeline's output for brand-new outlets. Safe (no throw) if previousOutlets is null/undefined
  // or missing a given id.
  function mergeContactOverlay(newOutlets, previousOutlets) {
    const merged = {};
    const prev = previousOutlets || {};
    for (const oid in newOutlets) {
      const base = Object.assign({}, newOutlets[oid]);
      const prevOutlet = Object.prototype.hasOwnProperty.call(prev, oid) ? prev[oid] : null;
      if (prevOutlet) {
        for (const f of CONTACT_OVERLAY_FIELDS) {
          if (isNonEmpty(prevOutlet[f])) base[f] = prevOutlet[f];
        }
      }
      merged[oid] = base;
    }
    return merged;
  }

  // Orchestrator: builds the fresh CRM data from the 3 CSVs via buildCrmData, then layers the
  // contact-info carry-forward on top (email/email2/familyGroup per-outlet via mergeContactOverlay),
  // then copies familyGroups and vipContactsSeed verbatim from previousCrmData since those two
  // top-level keys are never derived from the 3 CSVs at all. Returns an object with all 10 CRM_DATA
  // keys: meta, outlets, products, groups, groupOrder, groupSummary, outletSummary, dailyVolume,
  // familyGroups, vipContactsSeed.
  function buildCrmDataWithCarryForward(outletCsvText, productCsvText, salesCsvText, previousCrmData) {
    // Round 84: previousCrmData is now threaded into buildCrmData too (not just used below for the
    // contact-overlay/familyGroups carry-forward) — this is the single change that makes the live
    // in-app Data Refresh tool (netlify_part4.js's drRebuildPreview, the only call site of this
    // function) automatically accumulate sales history instead of replacing it on every refresh.
    const fresh = buildCrmData(outletCsvText, productCsvText, salesCsvText, previousCrmData);
    const prev = previousCrmData || {};
    const outlets = mergeContactOverlay(fresh.outlets, prev.outlets);
    return {
      meta: fresh.meta,
      outlets,
      products: fresh.products,
      groups: fresh.groups,
      groupOrder: fresh.groupOrder,
      groupSummary: fresh.groupSummary,
      outletSummary: fresh.outletSummary,
      dailyVolume: fresh.dailyVolume,
      familyGroups: prev.familyGroups,
      vipContactsSeed: prev.vipContactsSeed,
    };
  }

  const DataRefresh = {
    pyRound,
    parseCsv,
    parseDateDMY,
    fmtDateISO,
    buildOutlets,
    buildProductsAndGroups,
    buildSalesAggregates,
    buildPrevDataForMerge,
    buildCrmData,
    mergeContactOverlay,
    buildCrmDataWithCarryForward,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataRefresh;
  } else {
    root.DataRefresh = DataRefresh;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
