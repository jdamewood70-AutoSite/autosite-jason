// netlify/functions/control.js
//
// The dashboard's on/off switches and the MMS pace panel both talk to this.
//   GET  /control?territory=nashville        -> returns that territory's settings row
//   POST /control  {territory, field, value} -> writes ONE whitelisted field
//
// Uses the SERVICE ROLE key (server-side only — never ship this key to the browser)
// so it bypasses RLS. Set these two in Netlify → Site settings → Environment variables:
//   SUPABASE_URL                 e.g. https://iplzsgxwqmrnbvtafagu.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    the service_role key from Supabase → Project → API
//
// Zero npm dependencies — plain fetch to the REST API.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Only these columns can be written from the dashboard. Anything else is rejected.
// (This is the whitelist. If you add a new control later, add its column name here.)
const ALLOWED = ['auto_mode', 'mms_send', 'email_send', 'daily_cap', 'off_day', 'pace_mode'];

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json'
};

function sb(path, opts = {}) {
  return fetch(SUPABASE_URL + '/rest/v1' + path, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
}

function resp(statusCode, obj) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    // ── READ: dashboard pulls current settings on load and to sync the pace panel ──
    if (event.httpMethod === 'GET') {
      const territory = (event.queryStringParameters || {}).territory;
      if (!territory) return resp(400, { ok: false, error: 'territory required' });

      const r = await sb('/shooter_control?territory=eq.' + encodeURIComponent(territory) +
        '&select=territory,auto_mode,mms_send,email_send,daily_cap,off_day,pace_mode');
      const rows = await r.json();
      // Return the fields at the top level — the dashboard reads d.auto_mode, d.daily_cap, etc.
      const row = (Array.isArray(rows) && rows[0]) ? rows[0] : { territory };
      return resp(200, row);
    }

    // ── WRITE: one field at a time, e.g. {territory:'nashville', field:'daily_cap', value:20} ──
    if (event.httpMethod === 'POST') {
      const { territory, field, value } = JSON.parse(event.body || '{}');
      if (!territory || !field) return resp(400, { ok: false, error: 'territory and field required' });
      if (!ALLOWED.includes(field)) return resp(400, { ok: false, error: 'field not allowed: ' + field });

      const row = { territory, [field]: value, updated_at: new Date().toISOString() };

      // Upsert so a brand-new territory gets its row created on the first toggle,
      // and existing rows just get the one field merged in.
      const r = await sb('/shooter_control?on_conflict=territory', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row)
      });
      const body = await r.text();
      if (!r.ok) return resp(r.status, { ok: false, error: body });

      return resp(200, { ok: true, territory, field, value });
    }

    return resp(405, { ok: false, error: 'method not allowed' });
  } catch (e) {
    return resp(500, { ok: false, error: String((e && e.message) || e) });
  }
};
