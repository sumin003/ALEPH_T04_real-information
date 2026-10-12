'use strict';
// Fixed public source, fetched on the server. Browser cannot submit or overwrite a value.
const SOURCE_URL='https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&timezone=Asia%2FSeoul';
const SIGNAL='open-meteo-seoul-temperature-2m';
function dateKST(iso){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function valid(raw){const c=raw?.current,u=raw?.current_units;const fields=['temperature_2m','relative_humidity_2m','apparent_temperature','precipitation','weather_code','wind_speed_10m'];return raw?.timezone==='Asia/Seoul'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c?.time||'')&&fields.every(k=>Number.isFinite(c?.[k]))&&Number.isInteger(c.weather_code)&&u?.temperature_2m==='°C'&&u?.apparent_temperature==='°C'&&u?.relative_humidity_2m==='%'&&u?.precipitation==='mm'&&u?.wind_speed_10m==='km/h';}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'method_not_allowed'});}
 // GET is exclusively for scheduled Vercel Cron; POST is a user-triggered server-side capture.
 if(req.method==='GET'&&(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({error:'unauthorized'});
 if(req.method==='POST'){
  // Reject cross-origin browser writes. This is defense-in-depth, not authentication.
  const origin=req.headers.origin,host=req.headers.host;
  if(!origin||!host||new URL(origin).host!==host)return res.status(403).json({error:'origin_not_allowed'});
 }
 const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!base||!key)return res.status(503).json({error:'storage_not_configured'});
 try{
  const r=await fetch(SOURCE_URL,{signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!r.ok)throw Error('upstream_http_'+r.status);
  const raw=await r.json();if(!valid(raw))throw Error('upstream_schema');
  const fetchedAt=new Date().toISOString();
  const reading={signal_id:SIGNAL,record_date:dateKST(fetchedAt),source_url:SOURCE_URL,source_observed_at:raw.current.time+'+09:00',normalized_value:raw.current.temperature_2m,unit:'°C',fetched_at:fetchedAt};
  const url=`${base.replace(/\/$/,'')}/rest/v1/weather_daily?on_conflict=signal_id,record_date`;
  const saved=await fetch(url,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(reading),signal:AbortSignal.timeout(10000)});
  if(!saved.ok)throw Error('storage_http_'+saved.status);
  const rows=await saved.json();const stored=rows[0];
  if(!stored||stored.record_date!==reading.record_date||stored.normalized_value!==reading.normalized_value||stored.unit!==reading.unit)throw Error('storage_mismatch');
  return res.status(200).json({ok:true,raw,fetched_at:fetchedAt,daily:stored});
 }catch(e){return res.status(502).json({error:'capture_failed'});}
};
