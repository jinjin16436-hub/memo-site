/* classroom.js - v1.2.29
 * v1.2.29: 화면 높이에 맞춰 일정 카드의 윗부분을 첫 화면 아래로 배치.\n * v1.2.28: 급식/시간표 좌우 배치와 카드 높이 조정은 HTML/CSS만 변경.
 * 공개 읽기 전용 교실 모드. 기존 app.js와 Worker 코드를 수정하지 않습니다.
 * KST 16:35 시간표/급식 전환 및 선택과목·수업 장소·과목별 수행/숙제 배지를 유지.
 */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const text=(id,value)=>{const e=$(id);if(e)e.textContent=value;};
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg=window.firebaseConfig, uid=window.PUBLIC_UID, proxy=String(window.NEIS_PROXY_BASE||'').replace(/\/+$/,'');
const school='부광고등학교', grade='2', classNm='2';
const weekdays=['일','월','화','수','목','금','토'];
// 일정은 기본적으로 스크롤해야 보이도록 첫 화면 아래에 놓습니다.
function adjustUpcomingGap(){
 const daily=document.querySelector('.daily-grid');
 const upcoming=document.querySelector('.upcoming-panel');
 if(!daily||!upcoming)return;
 // 현재 보이는 브라우저 높이를 기준으로 계산하며, 시간표가 길면 추가 간격을 만들지 않습니다.
 const bottom=daily.getBoundingClientRect().bottom;
 const viewport=window.innerHeight||document.documentElement.clientHeight;
 const minimumGap=18;
 const extra=Math.max(minimumGap,Math.ceil(viewport-bottom+12));
 document.documentElement.style.setProperty('--upcoming-gap',extra+'px');
}
window.addEventListener('resize',adjustUpcomingGap);
const classTimes=[['08:50','09:40'],['09:50','10:40'],['10:50','11:40'],['11:50','12:40'],['13:40','14:30'],['14:40','15:30'],['15:45','16:35']];
let db, classRows=[],classDateKey='',lastDataDate='',lastRender=0,refreshing=false;
let subjectRules=[],locationRules=[],overrides=[],tasks=[],homeworks=[],upcoming=[];
const formatDate=d=>`${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
const ymd=d=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function koreaParts(now=new Date()){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
 return Object.fromEntries(p.map(v=>[v.type,Number(v.value)]));
}
function autoDate(now=new Date()){
 const p=koreaParts(now),target=new Date(p.year,p.month-1,p.day,12);
 if(p.hour>16||(p.hour===16&&p.minute>=35))target.setDate(target.getDate()+1);
 if(target.getDay()===6)target.setDate(target.getDate()+2);
 else if(target.getDay()===0)target.setDate(target.getDate()+1);
 return target;
}
function sameKoreaDay(date,parts){return date.getFullYear()===parts.year&&date.getMonth()+1===parts.month&&date.getDate()===parts.day}
function updateClock(){
 const p=koreaParts();
 text('classDate',`${p.year}년 ${p.month}월 ${p.day}일 ${weekdays[new Date(p.year,p.month-1,p.day).getDay()]}요일`);
 text('classClock',`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}`);
 renderNextClass(p);
}
function nextPeriod(parts){
 if(!classRows.length||!sameKoreaDay(autoDate(),parts))return null;
 const minutes=parts.hour*60+parts.minute;
 for(const r of classRows){
  const period=Number(r.PERIO||r.ORD),start=classTimes[period-1];
  if(!start)continue;
  const [sh,sm]=start[0].split(':').map(Number),[eh,em]=start[1].split(':').map(Number);
  if(minutes<=eh*60+em)return{period,minutes,start:sh*60+sm,end:eh*60+em};
 }
 return null;
}
function renderNextClass(parts=koreaParts()){
 const info=nextPeriod(parts);
 document.querySelectorAll('.period').forEach(e=>e.classList.toggle('active',!!info&&Number(e.dataset.period)===info.period));
 if(!classRows.length){text('nextClass','오늘 표시할 수업이 없습니다.');return;}
 if(!sameKoreaDay(autoDate(),parts)){text('nextClass','다음 수업일 시간표를 표시하고 있습니다.');return;}
 if(!info){text('nextClass','오늘 수업이 종료되었습니다.');return;}
 const row=classRows.find(r=>Number(r.PERIO||r.ORD)===info.period);
 const name=row?.ITRT_CNTNT||row?.SUBJECT||row?.TI_NM||'과목 정보 없음';
 const remaining=info.start-(parts.hour*60+parts.minute);
 text('nextClass',remaining>0?`다음 수업 · ${info.period}교시 ${name} · ${remaining}분 후 시작`:`현재 수업 · ${info.period}교시 ${name}`);
}
const col=path=>db.collection(`users/${uid}/${path}`);
async function getDocs(path){
 const snap=await col(path).get();
 return snap.docs.map(x=>({id:x.id,...x.data()}));
}
const normalized=x=>String(x||'').trim().replace(/\s+/g,'').toLowerCase();
function matchesTask(items,date,period,subject){
 const target=normalized(subject);
 return items.some(t=>{
  if(normalized(t.subject)!==target)return false;
  const from=toDate(t.startDate||t.endDate),to=toDate(t.endDate||t.startDate);
  if(!from||!to||date<from||date>to)return false;
  const first=Number(t.periodStart||t.periodEnd||period),last=Number(t.periodEnd||t.periodStart||period);
  return period>=Math.min(first,last)&&period<=Math.max(first,last);
 });
}
function toDate(value){
 if(!value)return null;
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
  const [y,m,d]=value.split('-').map(Number);
  const date=new Date(y,m-1,d,12);
  return iso(date)===value?date:null;
 }
 const d=value.toDate?value.toDate():new Date(value);
 if(Number.isNaN(d.getTime()))return null;
 return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);
}
function badge(items,date,period,subject,label,cls){
 return matchesTask(items,date,period,subject)?`<span class="badge ${cls}">[${label}]</span>`:'';
}
function applyOverrides(rows,date){
 const result=rows.map(r=>({...r}));
 for(const item of overrides.filter(x=>x.date===iso(date))){
  const p=Number(item.period),index=result.findIndex(x=>Number(x.PERIO||x.ORD)===p);
  if(item.action==='delete'){if(index>=0)result.splice(index,1);continue;}
  if(!String(item.subject||'').trim())continue;
  const row={...(index>=0?result[index]:{}),PERIO:String(p),ITRT_CNTNT:item.subject,SUBJECT:item.subject,TI_NM:item.subject};
  if(index>=0)result[index]=row;else result.push(row);
 }
 return result.sort((a,b)=>Number(a.PERIO||a.ORD)-Number(b.PERIO||b.ORD));
}
function timetableHTML(row,date){
 const p=Number(row.PERIO||row.ORD),name=String(row.ITRT_CNTNT||row.SUBJECT||row.TI_NM||'과목 정보 없음');
 const alt=subjectRules.find(x=>x.enabled!==false&&x.baseSubject===name);
 const place=locationRules.find(x=>x.enabled!==false&&String(x.subject||'').trim()===name)?.location;
 const aName=String(alt?.alternateSubject||'');
 const time=classTimes[p-1]?.join('–')||'';
 return `<div class="period" data-period="${p}">
  <span class="period-number">${escapeHTML(p)}교시</span>
  <div class="period-body">
   <div class="period-name">${escapeHTML(name)}${badge(tasks,date,p,name,'수행','performance')}${badge(homeworks,date,p,name,'숙제','homework')}</div>
   ${place?`<div class="period-location">장소: ${escapeHTML(place)}</div>`:''}
   ${alt?`<div class="period-alternate">${escapeHTML(alt.moveClass||'이동수업')} · ${escapeHTML(aName)}${badge(tasks,date,p,aName,'수행','performance')}${badge(homeworks,date,p,aName,'숙제','homework')}</div>`:''}
  </div><span class="period-time">${time}</span></div>`;
}
function renderTimetable(rows,date){
 classRows=rows;classDateKey=iso(date);
 text('timetableDate',formatDate(date));
 $('timetableList').innerHTML=rows.length?rows.map(r=>timetableHTML(r,date)).join(''):'<div class="empty">해당 날짜에는 시간표가 없습니다.</div>';
 renderNextClass();
}
function mealPlain(str){return String(str||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').trim()}
function mealEntry(r){
 const dishes=mealPlain(r.DDISH_NM).split(/\n+/).map(line=>line.trim()).filter(Boolean).map(line=>{
  const nums=[...line.matchAll(/\((\d+(?:[.,]\s*\d+)*)\)/g)].flatMap(m=>m[1].split(/[.,]/).map(s=>s.trim()));
  return `<li>${escapeHTML(line.replace(/\(\d+(?:[.,]\s*\d+)*\)/g,'').trim())}${nums.length?` <small class="allergens">${escapeHTML(nums.join(', '))}</small>`:''}</li>`;
 }).join('');
 return `<article class="meal-entry"><h3>${escapeHTML(r.MMEAL_SC_NM||'급식')}</h3><ul>${dishes}</ul>${r.CAL_INFO?`<div class="calories">🔥 ${escapeHTML(mealPlain(r.CAL_INFO))}</div>`:''}</article>`;
}
async function workerFetch(endpoint,date,params=''){
 if(!proxy)throw Error('NEIS_PROXY_BASE가 설정되지 않았습니다.');
 const url=`${proxy}/api/${endpoint}?schoolName=${encodeURIComponent(school)}&ymd=${ymd(date)}${params}`;
 const res=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store'});
 const body=await res.json().catch(()=>{throw Error('NEIS 서버가 올바른 JSON을 반환하지 않았습니다.');});
 if(!res.ok||body.error)throw Error(body.error||`NEIS HTTP ${res.status}`);
 if(!Array.isArray(body.rows))throw Error('NEIS 응답 형식 오류');
 return body.rows;
}
function upcomingItems(){
 const todayParts=koreaParts(),today=new Date(todayParts.year,todayParts.month-1,todayParts.day,12);
 const labels={schedules:'일정',exams:'시험',tasks:'수행',homeworks:'숙제'};
 const entries=upcoming.flatMap(({cat,items})=>items.map(data=>({cat,data,end:toDate(data.endDate||data.startDate)})))
 .filter(e=>e.end&&e.end>=today).sort((a,b)=>a.end-b.end).slice(0,8);
 $('upcomingList').innerHTML=entries.length?entries.map(({cat,data,end})=>{
  const name=cat==='exams'?(data.name||'시험'):cat==='schedules'?(data.title||'일정'):[data.subject,data.content].filter(Boolean).join(' · ');
  const days=Math.round((end-today)/86400000);
  return `<div class="upcoming-item"><span class="upcoming-label">${labels[cat]} · ${days===0?'D-DAY':`D-${days}`}</span><div class="upcoming-title">${escapeHTML(name||labels[cat])}</div><div class="upcoming-date">${escapeHTML(formatDate(end))}</div></div>`;
 }).join(''):'<div class="empty">예정된 일정이 없습니다.</div>';
}
async function refresh(){
 if(refreshing)return;
 refreshing=true;
 const date=autoDate(),key=iso(date);
 text('refreshStatus','최신 정보를 불러오는 중...');
 text('timetableDate',formatDate(date));text('mealDate',formatDate(date));
 try{
  // 일부 Firestore/NEIS 요청이 실패해도 성공한 다른 영역은 표시합니다.
  const paths=['settings/timetableSubjects/items','settings/timetableLocations/items','settings/timetableOverrides/items','tasks/tasks/items','tasks/homeworks/items','tasks/schedules/items','tasks/exams/items'];
  const fetched=await Promise.allSettled(paths.map(getDocs));
  const success=(index,old=[])=>fetched[index].status==='fulfilled'?fetched[index].value:old;
  subjectRules=success(0,subjectRules);locationRules=success(1,locationRules);overrides=success(2,overrides);
  tasks=success(3,tasks);homeworks=success(4,homeworks);
  const cats=['schedules','exams','tasks','homeworks'],catIndexes=[5,6,3,4];
  upcoming=cats.map((cat,i)=>({cat,items:success(catIndexes[i],upcoming.find(x=>x.cat===cat)?.items||[])}));
  upcomingItems();
  const results=await Promise.allSettled([
   workerFetch('timetable',date,`&grade=${grade}&classNm=${classNm}`),
   workerFetch('meal',date)
  ]);
  if(results[0].status==='fulfilled')renderTimetable(applyOverrides(results[0].value,date),date);
  else{$('timetableList').innerHTML=`<div class="empty">시간표 조회 실패: ${escapeHTML(results[0].reason?.message||'오류')}</div>`;classRows=[];}
  if(results[1].status==='fulfilled')$('mealList').innerHTML=results[1].value.length?results[1].value.map(mealEntry).join(''):'<div class="empty">해당 날짜에는 급식 정보가 없습니다.</div>';
  else $('mealList').innerHTML=`<div class="empty">급식 조회 실패: ${escapeHTML(results[1].reason?.message||'오류')}</div>`;
  const failed=fetched.filter(x=>x.status==='rejected').length+results.filter(x=>x.status==='rejected').length;
  text('refreshStatus',failed?`일부 정보 조회 실패 (${failed}건)`:'최신 정보 표시 중');
  lastDataDate=key;lastRender=Date.now();
  adjustUpcomingGap();
 }catch(err){
  text('refreshStatus','조회 오류');
  $('upcomingList').innerHTML=`<div class="empty">데이터 조회 오류: ${escapeHTML(err.message)}</div>`;
 }finally{refreshing=false;}
}
$('fullscreenBtn').addEventListener('click',async()=>{
 try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}
 catch{ text('refreshStatus','전체 화면을 사용할 수 없습니다. F11을 이용하세요.');}
});
$('refreshBtn').addEventListener('click',refresh);
updateClock();setInterval(updateClock,1000);
requestAnimationFrame(adjustUpcomingGap);
if(!cfg||!uid){
 text('refreshStatus','Firebase 설정 오류');
 for(const id of ['timetableList','mealList','upcomingList'])$(id).innerHTML='<div class="empty">사이트 설정을 확인해주세요.</div>';
 return;
}
try{firebase.initializeApp(cfg);db=firebase.firestore();refresh();}
catch(err){text('refreshStatus',`초기화 오류: ${err.message}`);}
setInterval(()=>{
 const date=iso(autoDate());
 if(!refreshing&&(date!==lastDataDate||Date.now()-lastRender>=5*60*1000))refresh();
 // 5분마다 자동 동기화, 날짜 전환 시 재조회.
},30000);
})();
