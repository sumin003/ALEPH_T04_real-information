'use strict';
// Node.js 18+ · 실제 배포의 /api/daily 응답을 검증한다.
// 사용: node tests/daily-storage.test.js https://alepht04real-information.vercel.app/
// 실제 날씨를 생성하거나 Supabase에 기록하지 않는다. 기록은 정상 수집으로 만들어야 한다.
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'https://alepht04real-information.vercel.app/';
const resultPath = path.join(__dirname, 'daily-storage-result.json');
const kst = 'Asia/Seoul';
function dateKST(value) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:kst,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
async function main() {
  const url = new URL('/api/daily', base);
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('invalid_protocol');
  const response = await fetch(url, {headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('daily_api_http_'+response.status);
  const data = await response.json();
  if (!Array.isArray(data.rows)) throw Error('invalid_daily_rows');
  const rows = data.rows;
  const dates = rows.map(r=>r.record_date);
  const unique = new Set(rows.map(r=>r.signal_id+'|'+r.record_date)).size===rows.length;
  const valid = rows.every(r=>typeof r.record_date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(r.record_date) && Number.isFinite(r.normalized_value) && r.unit==='°C');
  const date1 = '2026-10-12', date2 = '2026-10-13';
  const day1 = rows.filter(r=>r.record_date===date1);
  const day2 = rows.filter(r=>r.record_date===date2);
  // 일별 API는 최종 행만 보여준다. 하루 3회 실행 사실은 별도 실행 로그가 필요하다.
  const report = {
    test:'T04-C20-C21',data_type:'real',source:'Open-Meteo',storage:'Supabase',
    timezone:kst,checked_at:new Date().toISOString(),api:url.href,
    actual:{total_rows:rows.length,unique_signal_date_keys:unique,valid_rows:valid,stored_dates:dates,
      day_1_rows:day1.length,day_2_rows:day2.length,
      day_1_last_value:day1[0]?.normalized_value??null,day_2_last_value:day2[0]?.normalized_value??null},
    day_1:{date:date1,expected_runs:3,expected_rows:1,verified_run_count:null,
      status:day1.length===1&&unique?'pending_run_evidence':'pending_verification'},
    day_2:{date:date2,expected_runs:1,expected_total_rows:2,
      status:day2.length===1&&day1.length===1&&unique?'pending_run_evidence':'pending'},
    result:'PENDING',
    note:'일별 최종 상태만으로 동일 날짜 3회 실행 및 전후 행 수를 입증할 수 없습니다. 실행 시각과 각 실행 전후 행 수 증거를 별도로 확보한 뒤 PASS로 변경하세요.'
  };
  fs.writeFileSync(resultPath,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
main().catch(e=>{console.error('검증 실패:',e.message);process.exitCode=1;});
