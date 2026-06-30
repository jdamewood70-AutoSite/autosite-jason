// netlify/functions/enrich-lead.js
// Enrich a business lead with Hunter.io email + site quality score

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Use POST' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { business_name, domain } = body;

    if (!business_name || !domain) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing business_name or domain' }),
      };
    }

    const hunterKey = process.env.HUNTER_API_KEY;
    if (!hunterKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Hunter API key missing' }) };
    }

    // Step 1: Find email via Hunter.io
    let email = null;
    let hunterConfidence = 0;
    try {
      const hunterRes = await fetch(
        `https://api.hunter.io/v2/email-finder?domain=${domain}&company=${encodeURIComponent(business_name)}&api_key=${hunterKey}`
      );
      const hunterData = await hunterRes.json();
      if (hunterData.data && hunterData.data.email) {
        email = hunterData.data.email;
        hunterConfidence = hunterData.data.confidence || 0;
      }
    } catch (err) {
      console.warn('Hunter.io error:', err);
    }

    // Step 2: Check if domain exists + score quality
    let hasSite = false;
    let siteQuality = 0;
    try {
      const siteRes = await fetch(`https://${domain}`, { method: 'HEAD', timeout: 5000 });
      if (siteRes.ok || siteRes.status === 200) {
        hasSite = true;
        // Simple scoring: if they respond with 200, they have a site
        siteQuality = 50; // Baseline for "has a site"
      }
    } catch (err) {
      // Site doesn't exist or can't reach it
      hasSite = false;
      siteQuality = 0;
    }

    // If they DO have a site, check for basic indicators of quality
    // (This is simplified — could expand with scraping)
    if (hasSite) {
      // Assume if they maintain a site, it's probably decent
      // Real scoring would check for SSL, page load time, mobile-friendly, etc.
      siteQuality = 50; // "Has a functioning site"
    } else {
      // No site = HOT LEAD
      siteQuality = 100; // Highest priority
    }

    // Return enriched data
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        business_name,
        domain,
        email: email || null,
        email_confidence: hunterConfidence,
        has_site: hasSite,
        site_quality_score: siteQuality,
        pitch_priority: !hasSite ? 'HOT' : hasSite && !email ? 'WARM' : 'COLD',
        enriched_at: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('[enrich-lead] Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Server error' }),
    };
  }
};
