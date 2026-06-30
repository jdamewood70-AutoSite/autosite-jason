// netlify/functions/territories-list.js
// Get list of territories with filtering
// Called from operator dashboard / admin views
//
// REQUIRES env vars:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// GET params:
//   status=available|claimed|active|all (default: available)
//   state=TX|CA|OH (optional, filter by state)
//   tier=small|mid|large|metro (optional, filter by price tier)
//   claimed_by=user_xxx (optional, show operator's territories)
//   limit=100 (default: 100)
//   offset=0 (default: 0)

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Use GET' }) };
  }

  try {
    const query = event.queryStringParameters || {};
    const status = query.status || 'available';
    const state = query.state;
    const tier = query.tier;
    const claimedBy = query.claimed_by;
    const limit = Math.min(parseInt(query.limit) || 100, 500);
    const offset = parseInt(query.offset) || 0;

    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_ANON_KEY;

    if (!sbUrl || !sbKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase config missing' }) };
    }

    // Build query
    let url = `${sbUrl}/rest/v1/territories?`;
    const filters = [];

    if (status !== 'all') {
      filters.push(`status=eq.${status}`);
    }
    if (state) {
      filters.push(`state=eq.${state}`);
    }
    if (tier) {
      filters.push(`price_tier=eq.${tier}`);
    }
    if (claimedBy) {
      filters.push(`claimed_by=eq.${claimedBy}`);
    }

    url += filters.join('&');
    url += `&order=price.desc,name.asc&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
      },
    });

    const territories = await res.json();

    if (!res.ok) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: territories.message || 'Query failed' }),
      };
    }

    // Get total count (for pagination)
    const countUrl = `${sbUrl}/rest/v1/territories?${filters.join('&')}&select=id`;
    const countRes = await fetch(countUrl, {
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Prefer': 'count=exact',
      },
    });
    const total = parseInt(countRes.headers.get('content-range')?.split('/')[1]) || 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        territories,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      }),
    };
  } catch (err) {
    console.error('[territories-list] Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Query failed' }),
    };
  }
};
