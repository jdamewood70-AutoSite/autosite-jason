// netlify/functions/territory-claim.js
// Claim a territory for an operator
// Called from operator dashboard
//
// REQUIRES env vars:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// POST body: {
//   territory_slug: "nashville-metro",
//   operator_id: "user_xxx" (Clerk ID),
//   operator_name: "Tricia Maple-Damewood"
// }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Use POST' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { territory_slug, operator_id, operator_name } = body;

    if (!territory_slug || !operator_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing territory_slug or operator_id' }),
      };
    }

    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_ANON_KEY;

    if (!sbUrl || !sbKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase config missing' }) };
    }

    // 1. Check if territory exists and is available
    const checkRes = await fetch(
      `${sbUrl}/rest/v1/territories?slug=eq.${territory_slug}&status=eq.available`,
      {
        headers: {
          'apikey': sbKey,
          'Authorization': `Bearer ${sbKey}`,
        },
      }
    );

    const existing = await checkRes.json();
    if (!checkRes.ok || !existing || existing.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Territory not available or does not exist' }),
      };
    }

    const territory = existing[0];

    // 2. Claim the territory
    const claimRes = await fetch(
      `${sbUrl}/rest/v1/territories?slug=eq.${territory_slug}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': sbKey,
          'Authorization': `Bearer ${sbKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          claimed_by: operator_id,
          operator_name: operator_name || 'Unnamed Operator',
          status: 'claimed',
          claimed_at: new Date().toISOString(),
        }),
      }
    );

    const result = await claimRes.json();

    if (!claimRes.ok) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: result.message || 'Failed to claim territory' }),
      };
    }

    console.log(`[territory-claim] ${operator_name} claimed ${territory_slug}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        territory: {
          slug: territory.slug,
          name: territory.name,
          price: territory.price,
          claimed_by: operator_id,
          status: 'claimed',
        },
      }),
    };
  } catch (err) {
    console.error('[territory-claim] Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Claim failed' }),
    };
  }
};
