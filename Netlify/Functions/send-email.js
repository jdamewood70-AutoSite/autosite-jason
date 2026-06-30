// netlify/functions/send-email.js
// One email engine for the whole operation — Resend-backed.
// Tricia's dashboard AND any other caller send through this single function,
// so there's one sending reputation, one place to maintain, one auth setup.
//
// REQUEST (JSON): { to, subject, html, text?, from?, replyTo? }
//   to       -> recipient email (string or array)
//   subject  -> subject line
//   html     -> HTML body
//   from     -> optional. Defaults to DEFAULT_FROM below. Pass one of the
//               approved from-addresses to send "as" Tricia / Jason / the team.
//   replyTo  -> optional. Where replies should land.
//
// RESPONSE: { ok:true, id } | { ok:false, error }
//
// REQUIRES env var on THIS Netlify site (autosite-tricia):
//   RESEND_API_KEY   -> your Resend API key (re_...)
//
// All three from-addresses must be on a domain you've VERIFIED in Resend.

const FROM = {
  tricia: 'Tricia Maple-Damewood <tricia@autosite.website>',
  team:   'The AutoSite Team <hello@autosite.website>',
  jason:  'Jason <jason@autosite.website>',
};
const DEFAULT_FROM = FROM.team;

// Only allow sending from addresses on your own domain (stops the function
// being abused to spoof other senders).
const ALLOWED_DOMAIN = 'autosite.website';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '');
  if (event.httpMethod !== 'POST') return resp(405, { ok: false, error: 'Use POST' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return resp(500, { ok: false, error: 'RESEND_API_KEY not set on this site' });

  try {
    const body = JSON.parse(event.body || '{}');
    const to = body.to;
    const subject = body.subject;
    const html = body.html;
    const text = body.text;
    let from = body.from || DEFAULT_FROM;
    const replyTo = body.replyTo;

    if (!to || !subject || (!html && !text)) {
      return resp(400, { ok: false, error: 'Need to, subject, and html (or text)' });
    }

    // Guard: from-address must be on your domain.
    if (!from.includes('@' + ALLOWED_DOMAIN) && !from.includes('.' + ALLOWED_DOMAIN)) {
      from = DEFAULT_FROM;
    }

    const payload = {
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
    };
    if (html) payload.html = html;
    if (text) payload.text = text;
    if (replyTo) payload.reply_to = replyTo;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[send-email] Resend error:', JSON.stringify(data));
      return resp(r.status, { ok: false, error: data?.message || 'Resend send failed' });
    }

    return resp(200, { ok: true, id: data.id || null });
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Resend request timed out' : (err.message || 'Server error');
    console.error('[send-email] error:', msg);
    return resp(500, { ok: false, error: msg });
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}
