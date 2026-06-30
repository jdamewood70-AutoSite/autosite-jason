// netlify/functions/claim-territory-stripe.js
// Claim a territory + create Stripe checkout
// Email determines if free (jason@/tricia@) or paid

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Use POST' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { territory_slug, territory_name, territory_price, email, operator_name } = body;

    if (!territory_slug || !email || territory_price === undefined) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing territory_slug, email, or territory_price' }),
      };
    }

    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_ANON_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!sbUrl || !sbKey || !stripeKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Config missing' }) };
    }

    // Check if territory is available
    const checkRes = await fetch(
      `${sbUrl}/rest/v1/territories?slug=eq.${territory_slug}&status=eq.available`,
      { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
    );
    const territories = await checkRes.json();
    if (!territories || territories.length === 0) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Territory not available' }) };
    }
    const territory = territories[0];

    // Determine if free user (Jason or Tricia)
    const isFreeUser = email.includes('jason@') || email.includes('tricia@');

    // Create Stripe session using proper API format
    const stripeBody = new URLSearchParams();
    stripeBody.append('payment_method_types[]', 'card');
    stripeBody.append('mode', 'subscription');
    stripeBody.append('customer_email', email);
    stripeBody.append('success_url', `https://autosite-tricia.netlify.app/?claimed=${territory_slug}`);
    stripeBody.append('cancel_url', `https://autosite-tricia.netlify.app/`);
    stripeBody.append('line_items[0][price_data][currency]', 'usd');
    stripeBody.append('line_items[0][price_data][product_data][name]', territory_name);
    stripeBody.append('line_items[0][price_data][product_data][description]', `Territory claim - ${territory_name}`);
    stripeBody.append('line_items[0][price_data][unit_amount]', Math.round(territory_price * 100));
    stripeBody.append('line_items[0][price_data][recurring][interval]', 'month');
    stripeBody.append('line_items[0][quantity]', '1');
    stripeBody.append('metadata[territory_slug]', territory_slug);
    stripeBody.append('metadata[territory_name]', territory_name);
    stripeBody.append('metadata[email]', email);
    stripeBody.append('metadata[operator_name]', operator_name || email);

    // Add coupon if free user
    if (isFreeUser) {
      stripeBody.append('discounts[0][coupon]', 'dyXYFcVo');
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: stripeBody,
    });

    const stripeData = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error('Stripe error:', stripeData);
      return { statusCode: 400, body: JSON.stringify({ error: stripeData.error?.message || 'Stripe failed' }) };
    }

    const checkoutUrl = stripeData.url;

    // Mark territory as claimed in Supabase
    const claimRes = await fetch(`${sbUrl}/rest/v1/territories?slug=eq.${territory_slug}`, {
      method: 'PATCH',
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'claimed',
        claimed_by: email,
        claimed_at: new Date().toISOString(),
      }),
    });

    if (!claimRes.ok) {
      console.warn('Supabase update failed (but Stripe session created)');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        checkoutUrl,
        isFreeUser,
        message: isFreeUser ? 'Free claim - no payment needed!' : 'Redirecting to payment...',
      }),
    };
  } catch (err) {
    console.error('[claim-territory-stripe] Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Server error' }),
    };
  }
};
