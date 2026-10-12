// Server-only Open-Meteo + Supabase storage. Never expose SUPABASE_SECRET_KEY.
const SOURCE_URL='https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m&temperature_unit=celsius&timezone=Asia%2FSeoul';
const SIGNAL='open-meteo-seoul-temperature-2m';
const dateKST=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
 const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!base||!key)return res.status(503).json({error:'storage_not_configured'});
 const headers={apikey:key};
 const table=`${base.replace(/\/$/,'')}/rest/v1/weather_daily`;
 try{
  // GET is read-only: a public visitor cannot create or overwrite a daily record.
  const result=await fetch(`${table}?signal_id=eq.${encodeURIComponent(SIGNAL)}&select=signal_id,record_date,source_url,source_observed_at,normalized_value,unit,fetched_at&order=record_date.asc`,{headers,signal:AbortSignal.timeout(10000)});
  if(!result.ok)throw Error('storage_http_'+result.status);
  const rows=await result.json();
  const previous=rows.length>=2?rows.at(-2):null,current=rows.at(-1)||null;
  const delta=previous&&current&&previous.unit===current.unit?Number((current.normalized_value-previous.normalized_value).toFixed(2)):null;
  return res.status(200).json({rows,comparison:delta===null?null:{from:previous.record_date,to:current.record_date,delta,unit:current.unit}});
 }catch(e){return res.status(502).json({error:'storage_unavailable'});}
};
