'use strict';
const SIGNAL = 'open-meteo-seoul-temperature-2m';
const safeStatus = status => Number.isInteger(status) ? status : null;
function storageConfig() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) return null;
  let url;
  try {
    url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash ||
        !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) return null;
  } catch { return null; }
  return { base: url.origin, key };
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const config = storageConfig();
  if (!config) {
    console.error('[daily] configuration_invalid_or_missing');
    return res.status(503).json({ error: 'storage_not_configured' });
  }
  let stage = 'storage_request';
  try {
    const table = new URL('/rest/v1/weather_daily', config.base);
    table.searchParams.set('signal_id', `eq.${SIGNAL}`);
    table.searchParams.set('select', 'signal_id,record_date,source_url,source_observed_at,normalized_value,unit,fetched_at');
    table.searchParams.set('order', 'record_date.asc');
    const result = await fetch(table, {
      headers: { apikey: config.key, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store'
    });
    if (!result.ok) {
      console.error('[daily] storage_http_error', { status: safeStatus(result.status) });
      return res.status(502).json({ error: 'storage_unavailable' });
    }
    stage = 'storage_response';
    const rows = await result.json();
    if (!Array.isArray(rows)) throw new Error('unexpected_rows');
    const previous = rows.length >= 2 ? rows.at(-2) : null;
    const current = rows.at(-1) || null;
    const delta = previous && current && previous.unit === current.unit
      ? Number((current.normalized_value - previous.normalized_value).toFixed(2)) : null;
    return res.status(200).json({
      rows,
      comparison: delta === null ? null : {
        from: previous.record_date, to: current.record_date, delta, unit: current.unit
      }
    });
  } catch (error) {
    console.error('[daily] request_failed', {
      stage,
      type: error?.name === 'TimeoutError' ? 'timeout'
        : error?.name === 'SyntaxError' ? 'invalid_json' : 'request_or_schema_error'
    });
    return res.status(502).json({ error: 'storage_unavailable' });
  }
};
