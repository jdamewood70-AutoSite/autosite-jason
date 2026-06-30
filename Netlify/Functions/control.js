// netlify/functions/control.js
// Reads/writes the three dashboard switches in shooter_control:
//   auto_mode  (master pipeline on/off)
//   mms_send   (MMS pitcher fire on/off)
//   email_send (email pitcher fire on/off)
//
//   GET  /.netlify/functions/control?territory=nashville
//        -> { ok:true, auto_mode, mms_send, email_send, daily_cap, email_daily_cap }
//   POST body {territory, field, value}   field in [auto_mode, mms_send, email_send]
//        -> { ok:true, [field]: value }
//
// ENV on this Netlify site: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const ALLOWED_FIELDS = ['auto_mode', 'mms_send', 'email_send'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '');

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return resp(500, { ok: false, error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on this site' });

  const enc = encodeURIComponent;
  const H = { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Content-Type': 'application/json' };

  try {
    if (event.httpMethod === 'GET') {
      const territory = (event.queryStringParameters && event.queryStringParameters.territory || 'nashville').toLowerCase();
      const r = await fetch(`${sbUrl}/rest/v1/shooter_control?territory=eq.${enc(territory)}&select=auto_mode,mms_send,email_send,daily_cap,email_daily_cap&limit=1`, { headers: H });
      const rows = await r.json();
      const row = (Array.isArray(rows) && rows[0]) ? rows[0] : {};
      return resp(200, {
        ok: true,
        auto_mode: !!row.auto_mode,
        mms_send: row.mms_send !== false,      // default true if column null
        email_send: row.email_send !== false,
        daily_cap: row.daily_cap ?? null,
        email_daily_cap: row.email_daily_cap ?? null,
      });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const territory = (body.territory || 'nashville').toLowerCase();
      const field = body.field;
      const value = !!body.value;

      if (!ALLOWED_FIELDS.includes(field)) {
        return resp(400, { ok: false, error: `field must be one of ${ALLOWED_FIELDS.join(', ')}` });
      }

      const patch = await fetch(`${sbUrl}/rest/v1/shooter_control?territory=eq.${enc(territory)}`, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=representation' },
        body: JSON.stringify({ [field]: value }),
      });
      let rows = await patch.json();

      // create the row if it didn't exist
      if (!Array.isArray(rows) || rows.length === 0) {
        const seed = { territory, auto_mode: false, mms_send: true, email_send: true, daily_cap: 30, email_daily_cap: 10 };
        seed[field] = value;
        const ins = await fetch(`${sbUrl}/rest/v1/shooter_control`, {
          method: 'POST', headers: { ...H, 'Prefer': 'return=representation' }, body: JSON.stringify(seed),
        });
        rows = await ins.json();
      }

      const row = (Array.isArray(rows) && rows[0]) ? rows[0] : { [field]: value };
      return resp(200, { ok: true, [field]: !!row[field] });
    }

    return resp(405, { ok: false, error: 'Use GET or POST' });
  } catch (err) {
    console.error('[control] error:', err);
    return resp(500, { ok: false, error: err.message || 'Server error' });
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}
