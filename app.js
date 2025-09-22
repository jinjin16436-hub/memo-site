/* =========================================================
 * app.js (Firebase compat)
 * - window.firebaseConfig 는 env.js에서 주입
 * - 시험(전용 폼: 과목 없음) / 수행 / 숙제 / 공지
 * - 레거시 경로도 함께 로딩
 * - 수정은 모달 팝업
 * ========================================================= */

/* ---------- Firebase 초기화 ---------- */
const cfg =
  (typeof window !== 'undefined' && window.firebaseConfig)
    ? window.firebaseConfig
    : (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);

if (!cfg) { alert('firebaseConfig가 로드되지 않았어요. env.js 순서를 확인해주세요.'); throw new Error('Missing firebaseConfig'); }

firebase.initializeApp(cfg);
const auth = firebase.auth();
const db   = firebase.firestore();

/* 관리자 UID */
const ADMIN_UIDS = ["vv0bADtWdqQUnqFMy8k01dhO13t2"];

/* 전역 */
let currentUser = null;
let isAdmin = false;

/* DOM */
const $ = q => document.querySelector(q);
const el = (tag, attrs={}, ...children)=>{
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k==='class') n.className=v;
    else if (k==='dataset') Object.assign(n.dataset,v);
    else if (k in n) n[k]=v;
    else n.setAttribute(k,v);
  });
  children.forEach(c=>n.appendChild(typeof c==='string'?document.createTextNode(c):c));
  return n;
};

/* 유틸 */
const todayISO = ()=>new Date().toISOString().slice(0,10);
const fmtDate  = (s)=>s||'';
function colorByDiff(diff){ if(diff===0)return'red'; if(diff<=2)return'orange'; if(diff<=7)return'yellow'; return'green'; }
function calcDday(start,end){
  if(!start && !end) return null;
  const today=new Date(todayISO());
  const s=start?new Date(start):null, e=end?new Date(end):null;
  if(s&&e){
    if(today<s){ const d=Math.ceil((s-today)/86400000); return {label:`D-${d}`,badge:colorByDiff(d)};}
    if(today>e) return null;
    return {label:'D-day',badge:'green'};
  }else if(s){
    if(today<s){ const d=Math.ceil((s-today)/86400000); return {label:`D-${d}`,badge:colorByDiff(d)};}
    if(today.toDateString()===s.toDateString()) return {label:'D-day',badge:'red'};
  }else if(e){
    if(today<e){ const d=Math.ceil((e-today)/86400000); return {label:`D-${d}`,badge:colorByDiff(d)};}
    if(today.toDateString()===e.toDateString()) return {label:'D-day',badge:'red'};
  }
  return null;
}

/* 맵퍼 */
function mapNoticeDoc(d){
  const title=d.title??d.subject??d.name??'(제목 없음)';
  const body =d.body ??d.text   ??d.content??'';
  const kind =d.kind ??'notice';
  let createdISO=todayISO();
  if(d.createdAt?.toDate) createdISO=d.createdAt.toDate().toISOString().slice(0,10);
  else if(typeof d.createdAt==='string') createdISO=d.createdAt;
  else if(d.created||d.date) createdISO=d.created||d.date;
  return {title,body,kind,createdISO};
}
function mapWorkDoc(d){
  return {
    subject   : d.subject ?? d.title ?? d.name ?? '(과목 없음)',
    text      : d.text    ?? d.content ?? '',
    detail    : d.detail  ?? d.desc ?? d.description ?? '',
    startDate : d.startDate ?? d.start ?? d.dateStart ?? d.date ?? null,
    endDate   : d.endDate   ?? d.end   ?? d.dateEnd   ?? null,
    period    : d.period ?? d.class ?? d.lesson ?? d.time ?? ''
  };
}

/* Firestore helpers */
const colRef = (c)=>db.collection('users').doc(currentUser.uid).collection(c);

/* Auth */
$('#loginBtn')?.addEventListener('click', async ()=>{
  const provider=new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
});
$('#logoutBtn')?.addEventListener('click', async ()=>auth.signOut());

auth.onAuthStateChanged(async (user)=>{
  currentUser=user||null;
  isAdmin=!!(user&&ADMIN_UIDS.includes(user.uid));

  const info=$('#userInfo'); if(info) info.textContent = user ? `${user.displayName||'사용자'} | UID ${user.uid}${isAdmin?' (관리자)':''}` : '로그아웃 상태';
  $('#loginBtn').style.display = user ? 'none' : '';
  $('#logoutBtn').style.display = user ? '' : 'none';

  clearAllLists();
  if(user) await loadAll();
});

/* 리스트 클리어/로드 */
function clearAllLists(){ ['#list_notice','#list_exam','#list_task','#list_homework'].forEach(s=>{const ul=$(s); if(ul) ul.innerHTML='';}); }
async function loadAll(){ await Promise.all([loadNotices(),loadExams(),loadTasks(),loadHomeworks()]); }

/* =====================================
   공지
   ===================================== */
async function loadNotices(){
  const ul=$('#list_notice'); if(!ul) return;
  ul.innerHTML='';
  let snap;
  try { snap=await colRef('notices').orderBy('createdAt','desc').get(); }
  catch { snap=await colRef('notices').get(); }
  snap.forEach(doc=>{
    const raw=doc.data(); raw.id=doc.id;
    ul.appendChild(renderNotice(raw));
  });
}
function kindClass(kind){ if(kind==='notice')return'kind-notice'; if(kind==='info')return'kind-info'; if(kind==='alert')return'kind-alert'; return''; }
function renderNotice(raw){
  const d=mapNoticeDoc(raw);
  const li=el('li',{class:`notice-card ${kindClass(d.kind)}`});
  li.append(
    el('div',{class:'notice-title'},d.title),
    el('pre',{},d.body),
    el('div',{class:'notice-meta'},`게시일: ${d.createdISO}`)
  );
  if(isAdmin) li.appendChild(editButtons('notices',raw.id,{title:d.title,body:d.body,kind:d.kind,createdAt:d.createdISO}));
  return li;
}

/* =====================================
   시험/수행/숙제 로딩(평면+레거시)
   ===================================== */
async function tryFlat(candidates){
  const all=[]; for(const c of candidates){
    try{ const snap=await colRef(c).get(); if(!snap.empty) all.push(...snap.docs.map(d=>({id:d.id,...d.data()}))); }catch{}
  } return all;
}
async function tryLegacy(catPlural){
  const cats=[catPlural, catPlural.replace(/s$/,'')];
  const all=[]; for(const c of cats){
    try{ const snap=await colRef('tasks').doc(c).collection('items').get(); if(!snap.empty) all.push(...snap.docs.map(d=>({id:d.id,...d.data()}))); }catch{}
  } return all;
}
function sortByWhen(items){
  items.sort((a,b)=>{
    const t=x=>{
      if(x.createdAt?.toDate) return x.createdAt.toDate().getTime();
      if(typeof x.createdAt==='string') return new Date(x.createdAt).getTime();
      if(x.startDate) return new Date(x.startDate).getTime();
      if(x.endDate) return new Date(x.endDate).getTime();
      return 0;
    };
    return t(b)-t(a);
  });
}
function renderWorkItem(raw,colname){
  const d=mapWorkDoc(raw);
  const li=el('li',{class:'task'});
  const dday=calcDday(d.startDate,d.endDate);
  const title=el('div',{class:'title'}, d.subject, dday?el('span',{class:`dday ${dday.badge}`},' ',dday.label):'');
  const content=el('pre',{},d.text);
  const detail=d.detail?el('pre',{},d.detail):null;
  const metaText=(d.startDate||d.endDate?`${fmtDate(d.startDate)} ~ ${fmtDate(d.endDate)}`:'') + (d.period?`${(d.startDate||d.endDate)?' · ':''}${d.period}`:'');
  const meta=metaText?el('div',{class:'meta'},metaText):null;
  li.append(title,content); if(detail) li.append(detail); if(meta) li.append(meta);
  if(isAdmin) li.appendChild(editButtons(colname,raw.id,{subject:d.subject,text:d.text,detail:d.detail,startDate:d.startDate,endDate:d.endDate,period:d.period}));
  return li;
}

/* 시험 */
async function loadExams(){
  const ul=$('#list_exam'); if(!ul) return; ul.innerHTML='';
  const merged=[...(await tryFlat(['exams','exam'])), ...(await tryLegacy('exams'))];
  if(!merged.length){ ul.innerHTML='<li class="task" style="opacity:.7">등록된 시험이 없습니다.</li>'; return; }
  sortByWhen(merged); merged.forEach(r=>ul.appendChild(renderWorkItem(r,'exams')));
}
/* 수행 */
async function loadTasks(){
  const ul=$('#list_task'); if(!ul) return; ul.innerHTML='';
  const merged=[...(await tryFlat(['tasks','task'])), ...(await tryLegacy('tasks'))];
  if(!merged.length){ ul.innerHTML='<li class="task" style="opacity:.7">등록된 수행평가가 없습니다.</li>'; return; }
  sortByWhen(merged); merged.forEach(r=>ul.appendChild(renderWorkItem(r,'tasks')));
}
/* 숙제 */
async function loadHomeworks(){
  const ul=$('#list_homework'); if(!ul) return; ul.innerHTML='';
  const merged=[...(await tryFlat(['homeworks','homework'])), ...(await tryLegacy('homeworks'))];
  if(!merged.length){ ul.innerHTML='<li class="task" style="opacity:.7">등록된 숙제가 없습니다.</li>'; return; }
  sortByWhen(merged); merged.forEach(r=>ul.appendChild(renderWorkItem(r,'homeworks')));
}

/* =====================================
   수정/삭제 버튼 + 모달
   ===================================== */
function editButtons(colname,id,fields){
  const wrap=el('div',{class:'row',style:'gap:8px;margin-top:10px;'});
  const bEdit=el('button',{class:'btn'},'수정');
  const bDel =el('button',{class:'btn'},'삭제');
  bEdit.onclick=async ()=>{
    if(colname==='notices'){
      const res=await openModal('공지 수정',[
        {key:'title',label:'제목',type:'text',value:fields.title||''},
        {key:'body', label:'내용',type:'textarea',value:fields.body||''},
        {key:'kind', label:'종류(notice|info|alert)',type:'text',value:fields.kind||'notice'},
      ]);
      if(!res) return;
      await colRef('notices').doc(id).update({title:res.title,body:res.body,kind:res.kind});
    }else{
      const res=await openModal('항목 수정',[
        {key:'subject',label:'과목',type:'text',value:fields.subject||''},
        {key:'text',label:'내용',type:'textarea',value:fields.text||''},
        {key:'detail',label:'상세 내용',type:'textarea',value:fields.detail||''},
        {key:'startDate',label:'시작일',type:'date',value:fields.startDate||''},
        {key:'endDate',label:'종료일',type:'date',value:fields.endDate||''},
        {key:'period',label:'교시/시간',type:'text',value:fields.period||''},
      ]);
      if(!res) return;
      await colRef(colname).doc(id).update(res);
    }
    await loadAll();
  };
  bDel.onclick=async ()=>{ if(!confirm('삭제할까요?'))return; await colRef(colname).doc(id).delete(); await loadAll(); };
  wrap.append(bEdit,bDel); return wrap;
}
function ensureModalRoot(){ let r=$('#modal-root'); if(!r){r=el('div',{id:'modal-root'}); document.body.appendChild(r);} return r; }
function openModal(title,fields){
  return new Promise(resolve=>{
    const root=ensureModalRoot();
    const overlay=el('div',{class:'modal show'});
    const dialog =el('div',{class:'modal__dialog'});
    const head   =el('div',{class:'modal__head'}, el('strong',{},title), el('button',{class:'modal__close'},'닫기'));
    const body   =el('div',{class:'modal__body'});
    const foot   =el('div',{class:'modal__foot'});
    const form   =el('div',{class:'form-grid'}); const state={};

    fields.forEach(f=>{
      const lab=el('label',{},f.label);
      let input;
      if(f.type==='textarea') input=el('textarea',{value:f.value||''});
      else if(f.type==='date') input=el('input',{type:'date',value:f.value||''});
      else input=el('input',{type:'text',value:f.value||''});
      lab.appendChild(input); form.appendChild(lab); state[f.key]=input;
    });

    const save=el('button',{class:'btn btn--primary'},'저장');
    const cancel=el('button',{class:'btn'},'취소');
    body.appendChild(form); foot.append(cancel,save);
    dialog.append(head,body,foot); overlay.appendChild(dialog); root.appendChild(overlay);

    head.querySelector('.modal__close').onclick=close;
    cancel.onclick=()=>{ close(); resolve(null); };
    save.onclick=()=>{ const r={}; fields.forEach(f=>r[f.key]=state[f.key].value); close(); resolve(r); };
    function close(){ overlay.remove(); }
  });
}

/* =====================================
   추가
   ===================================== */
const v=id=>(document.getElementById(id)?.value||'').trim();

/* 공지 */
$('#nAddBtn')?.addEventListener('click', async ()=>{
  if(!currentUser) return alert('로그인이 필요합니다.');
  const title=v('nTitle'), body=v('nBody'), kind=$('#nKind')?.value||'notice';
  if(!title && !body) return alert('내용을 입력해주세요.');
  await colRef('notices').add({title,body,kind,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  ['nTitle','nBody'].forEach(id=>{const e=document.getElementById(id); if(e) e.value='';});
  await loadNotices();
});

/* 시험(과목 없음) */
$('#exAddBtn')?.addEventListener('click', async ()=>{
  if(!currentUser) return alert('로그인이 필요합니다.');
  const text=v('exText'), detail=v('exDetail'), start=$('#exStart')?.value||null, end=$('#exEnd')?.value||null, period=v('exPeriod');
  if(!text && !detail) return alert('내용을 입력해주세요.');
  await colRef('exams').add({subject:text, text, detail, startDate:start, endDate:end, period, createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  ['exText','exDetail','exStart','exEnd','exPeriod'].forEach(id=>{const e=document.getElementById(id); if(e) e.value='';});
  await loadExams();
});

/* 수행 */
$('#taAddBtn')?.addEventListener('click', async ()=>{
  if(!currentUser) return alert('로그인이 필요합니다.');
  const subject=v('taSubj'), text=v('taText'), detail=v('taDetail'), start=$('#taStart')?.value||null, end=$('#taEnd')?.value||null, period=v('taPeriod');
  if(!subject && !text && !detail) return alert('내용을 입력해주세요.');
  await colRef('tasks').add({subject,text,detail,startDate:start,endDate:end,period,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  ['taSubj','taText','taDetail','taStart','taEnd','taPeriod'].forEach(id=>{const e=document.getElementById(id); if(e) e.value='';});
  await loadTasks();
});

/* 숙제 */
$('#hwAddBtn')?.addEventListener('click', async ()=>{
  if(!currentUser) return alert('로그인이 필요합니다.');
  const subject=v('hwSubj'), text=v('hwText'), detail=v('hwDetail'), start=$('#hwStart')?.value||null, end=$('#hwEnd')?.value||null, period=v('hwPeriod');
  if(!subject && !text && !detail) return alert('내용을 입력해주세요.');
  await colRef('homeworks').add({subject,text,detail,startDate:start,endDate:end,period,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  ['hwSubj','hwText','hwDetail','hwStart','hwEnd','hwPeriod'].forEach(id=>{const e=document.getElementById(id); if(e) e.value='';});
  await loadHomeworks();
});

/* 공지 표시 토글(목록만 숨김) */
$('#noticeSwitch')?.addEventListener('change', e=>{
  const ul=$('#list_notice'); if(!ul) return; ul.style.display = e.target.checked ? '' : 'none';
});

/* 초기 */
clearAllLists();
