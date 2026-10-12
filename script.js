'use strict';
const API_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&timezone=Asia%2FSeoul';
const STORAGE_KEY = 'weather-log-card1-weather-v2';
const LIVE_SIGNAL = 'open-meteo-seoul-temperature-2m';
function upsertDaily(rows,reading){
 const key=reading.signal_id+'|'+reading.record_date;
 const next=rows.map(x=>({...x}));const i=next.findIndex(x=>x.signal_id+'|'+x.record_date===key);
 if(i>=0)next[i]={...reading,record_id:next[i].record_id};
 else next.push({...reading,record_id:key});
 return next.sort((a,b)=>a.record_date.localeCompare(b.record_date));
}
async function renderDaily(){
 const body=document.getElementById('dailyRows');if(!body)return;
 try{
  const response=await fetch('/api/daily',{cache:'no-store'});if(!response.ok)throw Error('서버 저장소 연결 대기');
  const data=await response.json();body.replaceChildren();
  document.getElementById('dailyCount').textContent=data.rows.length+'건';
  for(const row of data.rows.slice().reverse()){
   const tr=document.createElement('tr');
   for(const value of [row.record_date,row.normalized_value+' '+row.unit,row.source_observed_at,row.fetched_at,row.source_url]){
    const td=document.createElement('td');td.textContent=value;tr.append(td);
   }body.append(tr);
  }
  if(!data.rows.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=6;td.textContent='서버에 저장된 실제 날씨 기록이 없습니다.';tr.append(td);body.append(tr);}
  const cmp=document.getElementById('dailyComparison');if(cmp)cmp.textContent=data.comparison?`전일 대비 ${data.comparison.delta>0?'+':''}${data.comparison.delta} ${data.comparison.unit}`:'서로 다른 KST 날짜 2건이 저장되면 변화가 표시됩니다.';
 }catch(e){body.innerHTML='';const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='서버 기록 조회 대기: '+e.message;tr.append(td);body.append(tr);}
}

const $ = id => document.getElementById(id);
const kst = iso => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(iso))+' KST';
const validTime = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
const conditions = code => {
 if(code===0)return ['맑음','☀️']; if(code===1)return ['대체로 맑음','🌤️']; if(code===2)return ['구름 조금','⛅']; if(code===3)return ['흐림','☁️'];
 if([45,48].includes(code))return ['안개','🌫️']; if([51,53,55,56,57].includes(code))return ['이슬비','🌦️']; if([61,63,65,66,67,80,81,82].includes(code))return ['비','🌧️']; if([71,73,75,77,85,86].includes(code))return ['눈','🌨️']; if([95,96,99].includes(code))return ['뇌우','⛈️']; return ['상태 정보 없음','🌡️'];
};
function validate(raw){
 const c=raw?.current,u=raw?.current_units;
 const keys=['temperature_2m','relative_humidity_2m','apparent_temperature','precipitation','weather_code','wind_speed_10m'];
 if(raw?.timezone!=='Asia/Seoul'||!validTime(c?.time)||!keys.every(k=>Number.isFinite(c?.[k]))||u?.temperature_2m!=='°C'||u?.apparent_temperature!=='°C'||u?.relative_humidity_2m!=='%'||u?.precipitation!=='mm'||u?.wind_speed_10m!=='km/h'||!Number.isInteger(c.weather_code))throw new Error('날씨 응답의 값·단위·시각이 올바르지 않습니다.');
}
function load(){try{const r=JSON.parse(localStorage.getItem(STORAGE_KEY));validate(r.raw);if(!Number.isFinite(Date.parse(r.fetchedAt))||r.temperature!==r.raw.current.temperature_2m)return null;return r;}catch{return null;}}
function show(r){
 const c=r.raw.current;const [label,icon]=conditions(c.weather_code);
 $('temperature').textContent=String(r.temperature);$('condition').textContent=label;$('weatherIcon').textContent=icon;
 $('humidity').textContent=`${c.relative_humidity_2m} %`;$('wind').textContent=`${c.wind_speed_10m} km/h`;$('precipitation').textContent=`${c.precipitation} mm`;$('feelsLike').textContent=`${c.apparent_temperature} °C`;
 $('sourceTime').textContent=c.time.replace('T',' ')+' KST';$('fetchTime').textContent=kst(r.fetchedAt);
 $('rawValue').textContent=`${c.temperature_2m} °C`;$('savedValue').textContent=`${r.temperature} °C`;$('screenValue').textContent=`${$('temperature').textContent} °C`;
 $('jsonOutput').textContent=JSON.stringify(r.raw,null,2);
 const ok=Object.is(c.temperature_2m,r.temperature)&&Object.is(r.temperature,Number($('temperature').textContent))&&r.raw.current_units.temperature_2m==='°C';
 $('matchBadge').textContent=ok?'✓ 세 값 일치':'⚠ 값 불일치';$('matchBadge').className='match-badge '+(ok?'success':'fail');$('auditNote').textContent=ok?'원자료·저장값·화면값과 단위가 일치합니다.':'원자료·저장값·화면값을 다시 확인하세요.';
}
async function refresh(){
 $('refreshBtn').disabled=true;$('status').textContent='조회 중';$('status').className='status';
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
 try{
  const response=await fetch('/api/capture',{method:'POST',signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error(`서버 조회/저장 실패 (HTTP ${response.status})`);
  const result=await response.json(),raw=result.raw;validate(raw);
  if(!result.ok||!result.daily||result.daily.normalized_value!==raw.current.temperature_2m||result.daily.unit!=='°C')throw new Error('서버 저장값 검증 실패');
  const record={temperature:raw.current.temperature_2m,fetchedAt:result.fetched_at,raw};
  localStorage.setItem(STORAGE_KEY,JSON.stringify(record));const saved=load();if(!saved)throw new Error('정상 응답 저장을 확인하지 못했습니다.');
  show(saved);await renderDaily();$('status').textContent='정상 조회 · 서버 저장 완료';$('description').textContent='Open-Meteo의 서울 현재 날씨입니다. 현재값은 관측값과 차이가 있을 수 있습니다.';
 }catch(e){$('status').textContent='조회 실패';$('status').className='status error';$('description').textContent=`새 조회 실패: ${e.name==='AbortError'?'응답 시간 초과':e.message}. 화면에 남은 값은 이전 저장값일 수 있습니다.`;}
 finally{clearTimeout(timeout);$('refreshBtn').disabled=false;}
}
$('refreshBtn').addEventListener('click',refresh);
const previous=load();if(previous){show(previous);$('status').textContent='이전 저장값';$('description').textContent='이전에 저장한 날씨입니다. 최신 정보를 조회하는 중입니다.';}
refresh();
renderDaily();

// 공식 공개 fixture는 실제 날씨 기록과 완전히 분리한다.
const FIXTURE_ROOT='./assets/studio-task-assets/t04-real-information-board/';
const fixtureFiles={normalA:'normal-d1-a',normalB:'normal-d1-b',normalD2:'normal-d2',timeout:'timeout',forbidden:'auth-401',rate_limit:'rate-429',offline:'offline',schema:'schema-break',recover:'recover-d2'};
const explanations={timeout:['외부 원천 응답 시간 초과','잠시 기다린 뒤 다시 시도하세요.'],auth:['외부 원천 401 접근 거절','원천 제공처의 접근 정책을 확인하세요. 이 사이트에는 로그인이 필요하지 않습니다.'],rate_limit:['외부 원천 호출 제한 (429)','요청을 반복하지 말고 제한 시간이 지난 뒤 다시 시도하세요.'],offline:['오프라인','네트워크 연결을 확인하고 다시 시도하세요.'],schema_error:['응답 형식 변경','제공처의 응답 필드 변경을 확인하고 다시 시도하세요.']};
const replay={state:null,history:[]};
function emptyReplay(){return {daily_readings:[],current_reading:null,status:null,last_comparison:{state:'insufficient',magnitude:null},last_run:null};}
function resetReplay(){replay.state=emptyReplay();replay.history=[];renderReplay('초기화 완료','D1-A → D1-B를 실행한 다음 실패를 시험하세요.');}
function replayDate(iso){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}
function validReading(r){const keys=['signal_id','normalized_value','unit','source_name','source_url','source_time','fetched_at','record_timezone','record_date'];if(!r||Object.keys(r).sort().join('|')!==keys.sort().join('|')||!Number.isFinite(r.normalized_value)||r.record_timezone!=='Asia/Seoul'||r.record_date!==replayDate(r.fetched_at)||!r.unit||!r.signal_id||!r.source_name||!r.source_url.startsWith('https://')||Number.isNaN(Date.parse(r.fetched_at))||(r.source_time!==null&&Number.isNaN(Date.parse(r.source_time))))throw Error('schema_error');}
function applyOfficialFixture(f){const s=replay.state,t=f.transport;let error=null;
 if(t.mode==='timeout')error='timeout';else if(t.mode==='offline')error='offline';else if([401,403].includes(t.status))error='auth';else if(t.status===429)error='rate_limit';else if(t.status>=200&&t.status<300){try{validReading(f.payload);}catch{error='schema_error';}}else error='schema_error';
 if(error){s.status={freshness:'stale',error_code:error};s.last_run={fixture_id:f.fixture_id,outcome:'error',error_code:error};return;}
 const r=f.payload;s.daily_readings=upsertDaily(s.daily_readings,{signal_id:r.signal_id,record_date:r.record_date,normalized_value:r.normalized_value,unit:r.unit,reading:r});
 s.daily_readings.sort((a,b)=>a.record_date.localeCompare(b.record_date));s.current_reading=r;s.status={freshness:'fresh',error_code:'none'};
 const prev=s.daily_readings.filter(x=>x.signal_id===r.signal_id&&x.record_date<r.record_date).at(-1);s.last_comparison=prev&&prev.unit===r.unit?{state:'comparable',magnitude:Math.abs(r.normalized_value-prev.normalized_value)}:{state:'insufficient',magnitude:null};s.last_run={fixture_id:f.fixture_id,outcome:'success',error_code:'none'};
}
function renderReplay(title,action){const s=replay.state,st=s.status;$('labState').textContent='상태: '+(st?.freshness||'대기');$('labError').textContent='error_code: '+(st?.error_code||'none');$('labMessage').textContent=title;$('labAction').textContent=action;$('labLast').textContent=s.current_reading?`${s.current_reading.normalized_value} ${s.current_reading.unit} (${s.current_reading.record_date} · 합성)`:'없음';$('labStale').textContent=st?.freshness==='stale'?'⚠ 오래된 값 (stale)':st?.freshness==='fresh'?'✓ fresh':'';$('labCount').textContent=s.daily_readings.length+'건';$('labDates').textContent=s.daily_readings.map(x=>x.record_date).join(', ');$('labRetry').hidden=st?.freshness!=='stale';$('labLog').textContent=JSON.stringify({history:replay.history,state:s},null,2);}
async function getFixture(key){const name=fixtureFiles[key];if(!name)throw Error('fixture 없음');const response=await fetch(`${FIXTURE_ROOT}fixtures/${name}.json`,{cache:'no-store'});if(!response.ok)throw Error('fixture HTTP '+response.status);return response.json();}
async function runReplay(key){try{const f=await getFixture(key);applyOfficialFixture(f);const s=replay.state,expected=f.expected;const actual={freshness:s.status.freshness,error_code:s.status.error_code,row_count:s.daily_readings.length,stored_value:s.current_reading?.normalized_value??null,delta:s.last_comparison.magnitude};const passed=Object.entries(actual).every(([k,v])=>v===expected[k]);replay.history.push({fixture_id:f.fixture_id,passed,actual,expected});const err=explanations[s.status.error_code];renderReplay(`${f.fixture_id} · ${passed?'PASS':'FAIL'} · ${err?err[0]:'정상 재생'}`,err?err[1]:'정상 데이터가 저장되었습니다.');}catch(e){renderReplay('fixture 로드 실패',`${e.message}. 로컬 서버에서 실행하고 파일 경로를 확인하세요.`);}}
async function failureSequence(key){resetReplay();await runReplay('normalA');await runReplay('normalB');await runReplay(key);}
async function recoverySequence(){resetReplay();await runReplay('normalA');await runReplay('normalB');await runReplay('timeout');}
let running=false;async function guard(fn){if(running)return;running=true;document.querySelectorAll('.lab button').forEach(b=>b.disabled=true);try{await fn();}finally{running=false;document.querySelectorAll('.lab button').forEach(b=>b.disabled=false);}}
document.querySelectorAll('[data-scenario]').forEach(button=>button.addEventListener('click',()=>guard(async()=>{const key=button.dataset.scenario;if(['normalA','normalB'].includes(key))await runReplay(key);else await failureSequence(key);})));$('recoverBtn').addEventListener('click',()=>guard(async()=>{await recoverySequence();await runReplay('recover');}));$('labRetry').addEventListener('click',()=>guard(async()=>await runReplay('recover')));
resetReplay();

// 카드 4: 공식 합성 시계로 같은 KST 날짜 3회, 다음 날짜 1회 검증.
// 합성 상태는 실제 Open-Meteo 일별 저장소와 절대로 섞이지 않는다.
async function runCard4Test(){
 const output=$('card4TestResult');$('card4TestBtn').disabled=true;
 try{
  const a=await getFixture('normalA'),b=await getFixture('normalB'),d=await getFixture('normalD2');
  const third=structuredClone(b);
  third.fixture_id='CARD4-SYNTHETIC-D1-C';
  third.payload.normalized_value=110;
  third.expected={...b.expected,stored_value:110};
  const sequence=[a,b,third,d],rows=[];
  let synthetic=[];
  for(const f of sequence){
   validReading(f.payload);
   const before=synthetic.length;
   synthetic=upsertDaily(synthetic,{signal_id:f.payload.signal_id,record_date:replayDate(f.virtual_now),normalized_value:f.payload.normalized_value,unit:f.payload.unit,reading:f.payload});
   const after=synthetic.length;
   rows.push({fixture:f.fixture_id,date:replayDate(f.virtual_now),before,after,value:f.payload.normalized_value});
  }
  // record_id는 합성 signal_id + KST 날짜로 고정한다.
  const ok=rows.map(x=>x.after).join(',')==='1,1,1,2'&&synthetic[0].normalized_value===110&&synthetic[1].normalized_value===120&&synthetic[0].record_id===a.payload.signal_id+'|2026-08-24';
  output.textContent=JSON.stringify({result:ok?'PASS':'FAIL',timezone:'Asia/Seoul',sequence:rows,final_rows:synthetic.map(({record_id,record_date,normalized_value})=>({record_id,record_date,normalized_value})),note:'합성 전용. 실제 날씨 기록에 저장하지 않음.'},null,2);
 }catch(e){output.textContent='검사 실패: '+e.message;}
 finally{$('card4TestBtn').disabled=false;}
}
$('card4TestBtn').addEventListener('click',runCard4Test);
