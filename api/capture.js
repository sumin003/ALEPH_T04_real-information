'use strict';
const SOURCE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&timezone=Asia%2FSeoul';
const SIGNAL = 'open-meteo-seoul-temperature-2m';
function dateKST(iso) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function validateWeather(raw) {
  const c = raw?.current, u = raw?.current_units;
  if (raw?.timezone !== 'Asia/Seoul') return 'timezone';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c?.time || '')) return 'current_time';
  for (const field of ['temperature_2m','relative_humidity_2m','apparent_temperature','precipitation','weather_code','wind_speed_10m']) {
    if (!Number.isFinite(c?.[field])) return `field_${field}`;
  }
  if (!Number.isInteger(c.weather_code)) return 'weather_code_integer';
  for (const [field, unit] of Object.entries({
    temperature_2m:'°C', apparent_temperature:'°C',
    relative_humidity_2m:'%', precipitation:'mm', wind_speed_10m:'km/h'
  })) {
    if (u?.[field] !== unit) return `unit_${field}`;
  }
  return null;
}
function storageConfig() {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash ||
        !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) return null;
    return { base: url.origin, key };
  } catch { return null; }
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (req.method === 'GET' &&
      (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`))
    return res.status(401).json({ error: 'unauthorized' });
  if (req.method === 'POST') {
    try {
      const origin = new URL(req.headers.origin);
      if (!req.headers.host || origin.host !== req.headers.host ||
          origin.protocol !== 'https:')
        return res.status(403).json({ error: 'origin_not_allowed' });
    } catch {
      return res.status(403).json({ error: 'origin_not_allowed' });
    }
  }
  const config = storageConfig();
  if (!config) {
    console.error('[capture] configuration_invalid_or_missing');
    return res.status(503).json({ error: 'storage_not_configured' });
  }
  let stage = 'weather_request';
  try {
    const upstream = await fetch(SOURCE_URL, {
      signal: AbortSignal.timeout(12000), cache: 'no-store'
    });
    if (!upstream.ok) {
      console.error('[capture] weather_http_error', { status: upstream.status });
      return res.status(502).json({ error: 'capture_failed' });
    }
    stage = 'weather_response';
    const raw = await upstream.json();
    const invalidField = validateWeather(raw);
    if (invalidField) {
      console.error('[capture] weather_schema_error', { field: invalidField });
      return res.status(502).json({ error: 'capture_failed' });
    }
    const fetchedAt = new Date().toISOString();
    const reading = {
      signal_id: SIGNAL, record_date: dateKST(fetchedAt),
      source_url: SOURCE_URL, source_observed_at: raw.current.time + '+09:00',
      normalized_value: raw.current.temperature_2m, unit: '°C', fetched_at: fetchedAt
    };
    stage = 'storage_request';
    const table = new URL('/rest/v1/weather_daily', config.base);
    table.searchParams.set('on_conflict', 'signal_id,record_date');
    const saved = await fetch(table, {
      method: 'POST',
      headers: {
        apikey: config.key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(reading),
      signal: AbortSignal.timeout(10000)
    });
    if (!saved.ok) {
      console.error('[capture] storage_http_error', { status: saved.status });
      return res.status(502).json({ error: 'capture_failed' });
    }
    stage = 'storage_response';
    const rows = await saved.json();
    const stored = Array.isArray(rows) ? rows[0] : null;
    if (!stored || stored.record_date !== reading.record_date ||
        stored.normalized_value !== reading.normalized_value ||
        stored.unit !== reading.unit) {
      console.error('[capture] storage_mismatch');
      return res.status(502).json({ error: 'capture_failed' });
    }
    return res.status(200).json({ ok: true, raw, fetched_at: fetchedAt, daily: stored });
  } catch (error) {
    console.error('[capture] request_failed', {
      stage,
      type: error?.name === 'TimeoutError' ? 'timeout'
        : error?.name === 'SyntaxError' ? 'invalid_json' : 'request_or_schema_error'
    });
    return res.status(502).json({ error: 'capture_failed' });
  }
};
