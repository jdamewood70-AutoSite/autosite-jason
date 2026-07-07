// netlify/functions/customer-stats.js
// Returns COUNTS ONLY from the customers table — no PII ever reaches the browser.
// Dashboard tiles (Customers, Sites Live) read from this instead of the local
// manual "mark customer" system, so they reflect real Stripe conversions.
//
// ENV on this Netlify site: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

exports.handler = async () => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on this site' }) };
  }

  const H = { apikey: sbKey, Authorization: 'Bearer ' + sbKey };

  try {
    // Pull only the two columns we need to count on — no PII (no email/phone/stripe ids).
    const r = await fetch(
      `${sbUrl}/rest/v1/customers?select=plan_status,site_url&limit=10000`,
      { headers: H }
    );
    const rows = await r.json();

    // Surface a real failure instead of masking it as "0 customers"
    if (!r.ok || !Array.isArray(rows)) {
      console.error('[customer-stats] Supabase query failed:', r.status, JSON.stringify(rows));
      return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: 'Supabase query failed — check keys on this site', detail: rows }) };
    }

    // "Active" = a live paying/ trialing subscription. Exclude canceled/unpaid.
    const ACTIVE = ['active', 'trialing', 'past_due']; // past_due still counts as a customer (billing hiccup, not gone)
    const DEAD   = ['canceled', 'cancelled', 'incomplete_expired', 'unpaid'];

    const total     = rows.length;
    const active    = rows.filter(c => {
      const s = (c.plan_status || '').toLowerCase();
      if (DEAD.includes(s)) return false;
      // count anything not explicitly dead; treat null/unknown as active-ish so a
      // real customer never silently vanishes from the count over a status typo
      return true;
    }).length;
    const sitesLive = rows.filter(c => c.site_url && String(c.site_url).trim()).length;

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, total, active, sitesLive }),
    };
  } catch (e) {
    console.error('[customer-stats] error:', e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: e.message || 'Server error' }) };
  }
};
