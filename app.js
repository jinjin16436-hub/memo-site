/* app.js - v1.1.13
 * 변경사항:
 * - 탭 추가: 관리자(admin) (관리자만 표시)
 * - 관리자 메모(도메인/연장일/운영메모) Firestore 저장/로드
 */

if (!window.firebaseConfig) {
  alert("firebaseConfig가 로드되지 않았어요. env.js 순서를 확인해주세요.");
  throw new Error("Missing firebaseConfig");
}
const { firebaseConfig, PUBLIC_UID, ADMIN_UIDS = [], NEIS_PROXY_BASE } = window;

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

let currentUser = null;
let isAdmin = false;

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (name, attrs={}) => { const node = document.createElement(name); Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v)); return node; };

const pad2 = n => String(n).padStart(2,'0');

const userInfo  = $('#userInfo');
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');

const listNotice   = $('#list_notice');
const listSchedule = $('#list_schedule');
const listHoliday  = $('#list_holiday');
const listExam     = $('#list_exam');
const listTask     = $('#list_task');
const listHomework = $('#list_homework');
const toggleNotices = $('#toggleNotices');

// 일정/휴일 입력
const sTitle  = $('#sTitle');
const sDetail = $('#sDetail');
const sStart  = $('#sStart');
const sEnd    = $('#sEnd');
const sPStart = $('#sPStart');
const sPEnd   = $('#sPEnd');
const sAddBtn = $('#sAddBtn');

const hoTitle  = $('#hoTitle');
const hoDetail = $('#hoDetail');
const hoStart  = $('#hoStart');
const hoEnd    = $('#hoEnd');
const hoPStart = $('#hoPStart');
const hoPEnd   = $('#hoPEnd');
const hoAddBtn = $('#hoAddBtn');

// 시간표 UI
const ttSchool = $('#ttSchool');
const ttDate   = $('#ttDate');
const ttGrade  = $('#ttGrade');
const ttClass  = $('#ttClass');
const ttBtn    = $('#ttBtn');
const ttList   = $('#ttList');

// ✅ 관리자 UI
const adDomain = $('#adDomain');
const adRenew = $('#adRenew');
const adNotes = $('#adNotes');
const adSaveBtn = $('#adSaveBtn');
const adStatus = $('#adStatus');
const adRenewHint = $('#adRenewHint');

// ===== 유틸 =====
const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y=d.getFullYear(), m=d.getMonth()+1, dd=d.getDate();
  const w = ['일','월','화','수','목','금','토'][d.getDay()];
  return `${y}-${pad2(m)}-${pad2(dd)} (${w})`;
};
const fmtRange = (s,e)=>{ if(!s && !e) return ''; if(s && !e) return `${fmtDate(s)}`; if(!s && e) return `${fmtDate(e)}`; return `${fmtDate(s)} ~ ${fmtDate(e)}`; };
const asIntOrNull = v => (v === '' || v === null || v === undefined) ? null : (parseInt(v,10) || null);
const normPeriod  = n => (n>=1 && n<=7) ? n : null;
const periodText = (start, end, legacy) => {
  const s = normPeriod(asIntOrNull(start)); const e = normPeriod(asIntOrNull(end));
  if (s && e) return (s===e) ? `${s}교시` : `${s}~${e}교시`;
  if (s) return `${s}교시`; if (e) return `${e}교시`;
  if (legacy && String(legacy).trim()) return String(legacy).trim();
  return '';
};
const renderMeta = (startDate,endDate,pStart,pEnd,legacyPeriod)=>{
  const range = fmtRange(startDate,endDate);
  const ptxt  = periodText(pStart,pEnd,legacyPeriod);
  const parts = []; if (range) parts.push(range); if (ptxt) parts.push(ptxt);
  return parts.length ? `<div class="meta">${parts.join(' ')}</div>` : '';
};

// ===== D-day =====
const ddayBadge = (start,end)=>{
  const toDate0=v=>{ if(!v) return null; const d=v.toDate?v.toDate():new Date(v); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); };
  const colorByDiff=n=> n<=2?'orange':(n<=7?'yellow':'green');
  let s=toDate0(start), e=toDate0(end);
  if(!s && !e) return ''; if(!e&&s) e=s; if(!s&&e) s=e;
  const today=toDate0(new Date());
  if(today>e) return `<span class="dday gray">종료</span>`;
  const isSingle = s.getTime()===e.getTime();
  if(isSingle){
    const diff=Math.round((s-today)/86400000);
    if(diff>0) return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`;
    if(diff===0) return `<span class="dday red">D-day</span>`;
    return `<span class="dday gray">종료</span>`;
  }else{
    if(today<s){ const diff=Math.round((s-today)/86400000); return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`; }
    return `<span class="dday red">진행중</span>`;
  }
};
const sortKeyByDday = (data)=>{
  const to0=v=>v?(v.toDate?v.toDate():new Date(v)):null;
  const dayMs=86400000; const today=new Date(); today.setHours(0,0,0,0);
  let s=to0(data.startDate), e=to0(data.endDate);
  if(!s&&!e) return 9e7; if(!s&&e) s=e; if(!e&&s) e=s;
  if(today>e) return 9e8;
  const isSingle=s.getTime()===e.getTime();
  if(!isSingle && today>=s && today<=e) return 0;
  if(isSingle && s.getTime()===today.getTime()) return 0;
  if(today<s) return Math.floor((s-today)/dayMs);
  return 9e7;
};

// ===== 권한 UI =====
const applyAdminUI = ()=>{
  if(isAdmin){
    document.body.classList.add('is-admin');
    $$('.admin-only').forEach(n=>n.style.display='');
  } else {
    document.body.classList.remove('is-admin');
    $$('.admin-only').forEach(n=>n.style.display='none');
  }
};

// ===== ✅ 탭 =====
const initTabs = ()=>{
  const tabs = $('#tabs');
  if(!tabs) return;

  const setTab = (name)=>{
    // 관리자가 아니면 admin 탭 강제 차단
    if(name === 'admin' && !isAdmin) name = 'schedule';

    $$('.tab-btn', tabs).forEach(b=>b.classList.toggle('active', b.dataset.tab===name));

    const map = {
      schedule: $('#panel_schedule'),
      holiday: $('#panel_holiday'),
      exam: $('#panel_exam'),
      task: $('#panel_task'),
      homework: $('#panel_homework'),
      timetable: $('#panel_timetable'),
      admin: $('#panel_admin'),
    };
    Object.entries(map).forEach(([k, panel])=>{
      if(panel) panel.classList.toggle('active', k===name);
    });
  };

  tabs.addEventListener('click', (e)=>{
    const btn = e.target.closest('.tab-btn');
    if(!btn) return;
    const tab = btn.dataset.tab;
    if(tab === 'admin' && !isAdmin) return;
    setTab(tab);
  });

  setTab('schedule');
};

// ===== 로그인 =====
loginBtn.addEventListener('click', async ()=>{ await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); });
logoutBtn.addEventListener('click', async ()=>{ await auth.signOut(); });

// ===== 전달 사항 ON/OFF =====
const loadNoticeSwitch = async ()=>{
  try{
    const doc = await db.doc(`users/${PUBLIC_UID}/settings/app`).get();
    const on = doc.exists ? (doc.data().showNotices !== false) : true;
    toggleNotices.checked = !!on;
    $('#sec_notice .section-body').style.display = on ? '' : 'none';
  }catch(e){
    toggleNotices.checked = true; $('#sec_notice .section-body').style.display = '';
  }
};
toggleNotices.addEventListener('change', async ()=>{
  if(!isAdmin) return;
  const on = toggleNotices.checked;
  await db.doc(`users/${PUBLIC_UID}/settings/app`).set({ showNotices:on }, {merge:true});
  $('#sec_notice .section-body').style.display = on ? '' : 'none';
});
const secHead = $('#sec_notice .section-head');
if (secHead){
  secHead.addEventListener('click', (e)=>{
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    if (!isAdmin) return;
    toggleNotices.checked = !toggleNotices.checked;
    toggleNotices.dispatchEvent(new Event('change'));
  });
}

// ===== 공지 =====
const KIND_ORDER = { notice: 0, info: 1, alert: 2 };

const safeLoadNotices = async () => {
  listNotice.innerHTML = '';
  try {
    const snap = await db
      .collection(`users/${PUBLIC_UID}/notices`)
      .orderBy('createdAt', 'desc')
      .get();

    const docs = [];
    snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() || {} }));

    if (!docs.length) {
      listNotice.innerHTML = '<li class="meta">등록된 전달 사항이 없습니다.</li>';
      return;
    }

    docs.sort((a, b) => {
      const ka = KIND_ORDER[a?.data?.kind ?? 'notice'] ?? 3;
      const kb = KIND_ORDER[b?.data?.kind ?? 'notice'] ?? 3;
      if (ka !== kb) return ka - kb;
      const ta = a?.data?.createdAt?.toMillis?.() ?? 0;
      const tb = b?.data?.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });

    docs.forEach(({ id, data }) => {
      const li = el('li', { class: `notice-card kind-${data.kind || 'notice'}` });
      li.innerHTML = `
        <div class="title">${data.title || '(제목 없음)'}</div>
        ${data.body ? `<div class="content"><pre>${data.body}</pre></div>` : ''}
      `;

      if (isAdmin) {
        const row = el('div');
        const b2 = el('button', { class: 'btn' }); b2.textContent = '삭제';
        b2.addEventListener('click', async ()=>{ if(!confirm('삭제할까요?')) return; await db.doc(`users/${PUBLIC_UID}/notices/${id}`).delete(); await safeLoadNotices(); });
        row.append(b2);
        li.appendChild(row);
      }
      listNotice.appendChild(li);
    });
  } catch (err) {
    listNotice.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`;
  }
};

$('#nAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    title: $('#nTitle').value.trim(),
    kind:  $('#nKind').value,
    body:  $('#nBody').value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/notices`).add(payload);
  $('#nTitle').value=''; $('#nBody').value='';
  await safeLoadNotices();
});

// ===== 공통 로더 =====
const getListForCat = (cat)=>{
  if(cat==='exams') return listExam;
  if(cat==='tasks') return listTask;
  if(cat==='homeworks') return listHomework;
  if(cat==='schedules') return listSchedule;
  if(cat==='holidays') return listHoliday;
  return null;
};
const isExamCat = (cat)=> cat==='exams';
const isSubjCat = (cat)=> (cat==='tasks' || cat==='homeworks');

const safeLoadTasks = async (cat)=>{
  const ul = getListForCat(cat);
  if(!ul) return;

  ul.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).get();
    if(snap.empty){
      const label = (cat==='exams'?'시험':cat==='tasks'?'수행평가':cat==='homeworks'?'숙제':cat==='schedules'?'일정':'휴일');
      ul.innerHTML = `<li class="meta">등록된 ${label}가 없습니다.</li>`;
      return;
    }
    const docs=[]; snap.forEach(doc=>docs.push({id:doc.id,data:doc.data()}));
    docs.sort((a,b)=> sortKeyByDday(a.data) - sortKeyByDday(b.data));

    docs.forEach(({id,data})=>{
      const d = data || {};
      const li = el('li',{class:'task'});

      const mainTitle =
        (cat==='exams')
          ? `${(d.name || '시험')} ${ddayBadge(d.startDate, d.endDate)}`
          : (cat==='schedules' || cat==='holidays')
            ? `${(d.title || '제목 없음')} ${ddayBadge(d.startDate, d.endDate)}`
            : `${(isSubjCat(cat) ? (d.subject || '과목 없음') : '항목')} ${ddayBadge(d.startDate, d.endDate)}`;

      li.innerHTML = `
        <div class="title">${mainTitle}</div>
        ${d.content ? `<div class="content"><pre>${d.content}</pre></div>` : ''}
        ${d.detail  ? `<div class="content"><pre>${d.detail}</pre></div>` : ''}
        ${renderMeta(d.startDate,d.endDate,d.periodStart,d.periodEnd,d.period)}
      `;

      if (isAdmin) {
        const row = el('div');
        const b2 = el('button',{class:'btn'}); b2.textContent='삭제';
        b2.addEventListener('click', async ()=>{
          if(!confirm('삭제할까요?')) return;
          await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).delete();
          await safeLoadTasks(cat);
        });
        row.append(b2);
        li.appendChild(row);
      }
      ul.appendChild(li);
    });
  }catch(err){
    ul.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`;
  }
};

// --- 추가 버튼들 ---
$('#eAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    name: $('#eName').value.trim(),
    detail: $('#eDetail').value.trim(),
    startDate: $('#eStart').value ? new Date($('#eStart').value) : null,
    endDate:   $('#eEnd').value   ? new Date($('#eEnd').value)   : null,
    periodStart: asIntOrNull($('#ePStart').value),
    periodEnd:   asIntOrNull($('#ePEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/exams/items`).add(payload);
  ['eName','eDetail','eStart','eEnd','ePStart','ePEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('exams');
});

$('#tAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    subject: $('#tSubj').value.trim(),
    content: $('#tTitle').value.trim(),
    detail: $('#tDetail').value.trim(),
    startDate: $('#tStart').value ? new Date($('#tStart').value) : null,
    endDate:   $('#tEnd').value   ? new Date($('#tEnd').value)   : null,
    periodStart: asIntOrNull($('#tPStart').value),
    periodEnd:   asIntOrNull($('#tPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/tasks/items`).add(payload);
  ['tSubj','tTitle','tDetail','tStart','tEnd','tPStart','tPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('tasks');
});

$('#hAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    subject: $('#hSubj').value.trim(),
    content: $('#hTitle').value.trim(),
    detail: $('#hDetail').value.trim(),
    startDate: $('#hStart').value ? new Date($('#hStart').value) : null,
    endDate:   $('#hEnd').value   ? new Date($('#hEnd').value)   : null,
    periodStart: asIntOrNull($('#hPStart').value),
    periodEnd:   asIntOrNull($('#hPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/homeworks/items`).add(payload);
  ['hSubj','hTitle','hDetail','hStart','hEnd','hPStart','hPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('homeworks');
});

// 일정 추가
sAddBtn?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    title: sTitle.value.trim(),
    detail: sDetail.value.trim(),
    startDate: sStart.value ? new Date(sStart.value) : null,
    endDate:   sEnd.value   ? new Date(sEnd.value)   : null,
    periodStart: asIntOrNull(sPStart.value),
    periodEnd:   asIntOrNull(sPEnd.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.title){ alert('일정 제목을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/tasks/schedules/items`).add(payload);
  ['sTitle','sDetail','sStart','sEnd','sPStart','sPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('schedules');
});

// 휴일 추가
hoAddBtn?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    title: hoTitle.value.trim(),
    detail: hoDetail.value.trim(),
    startDate: hoStart.value ? new Date(hoStart.value) : null,
    endDate:   hoEnd.value   ? new Date(hoEnd.value)   : null,
    periodStart: asIntOrNull(hoPStart.value),
    periodEnd:   asIntOrNull(hoPEnd.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.title){ alert('휴일 이름을 입력해주세요.'); return; }
  if(payload.startDate && !payload.endDate) payload.endDate = payload.startDate;
  await db.collection(`users/${PUBLIC_UID}/tasks/holidays/items`).add(payload);
  ['hoTitle','hoDetail','hoStart','hoEnd','hoPStart','hoPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('holidays');
});

// ===== ✅ 관리자 메모 저장/로드 =====
const adminDocRef = ()=> db.doc(`users/${PUBLIC_UID}/settings/admin`);

const daysUntil = (yyyyMMdd)=>{
  if(!yyyyMMdd) return null;
  const [y,m,d]=yyyyMMdd.split('-').map(n=>parseInt(n,10));
  if(!y||!m||!d) return null;
  const target=new Date(y,m-1,d); target.setHours(0,0,0,0);
  const today=new Date(); today.setHours(0,0,0,0);
  return Math.round((target - today)/86400000);
};

const updateRenewHint = ()=>{
  if(!adRenewHint || !adRenew) return;
  const v = adRenew.value;
  if(!v){ adRenewHint.textContent=''; return; }
  const diff = daysUntil(v);
  if(diff === null){ adRenewHint.textContent=''; return; }
  if(diff > 0) adRenewHint.textContent = `만료까지 D-${diff}`;
  else if(diff === 0) adRenewHint.textContent = `오늘 만료(D-day)`;
  else adRenewHint.textContent = `만료일이 ${Math.abs(diff)}일 지났어요`;
};

adRenew?.addEventListener('change', updateRenewHint);

const loadAdminMemo = async ()=>{
  if(!isAdmin) return;
  try{
    const doc = await adminDocRef().get();
    if(doc.exists){
      const d = doc.data() || {};
      if(adDomain) adDomain.value = d.domain || '';
      if(adRenew)  adRenew.value  = d.renewDate || '';
      if(adNotes)  adNotes.value  = d.notes || '';
      updateRenewHint();
      if(adStatus) adStatus.textContent = d.updatedAt?.toDate ? `마지막 저장: ${fmtDate(d.updatedAt)}` : '';
    } else {
      if(adStatus) adStatus.textContent = '저장된 관리자 메모가 아직 없어요.';
    }
  }catch(e){
    if(adStatus) adStatus.textContent = `불러오기 오류: ${e.message}`;
  }
};

adSaveBtn?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  try{
    const payload = {
      domain: (adDomain?.value || '').trim(),
      renewDate: (adRenew?.value || '').trim(),
      notes: (adNotes?.value || '').trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await adminDocRef().set(payload, { merge: true });
    if(adStatus) adStatus.textContent = '저장 완료!';
    await loadAdminMemo();
  }catch(e){
    if(adStatus) adStatus.textContent = `저장 오류: ${e.message}`;
  }
});

// ===== 시간표(NEIS 프록시) =====
const PROXY = (NEIS_PROXY_BASE || '').replace(/\/+$/,'');
const ymdFromInput = (v)=>{
  if(!v) return '';
  const d=new Date(v);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
};
const getJSON = async (url)=>{
  const r = await fetch(url,{headers:{'Accept':'application/json'}});
  const text = await r.text();
  try{ return JSON.parse(text); }catch{ return { raw:text }; }
};
const renderTT = (rows=[])=>{
  ttList.innerHTML = '';
  if(!rows.length){ ttList.innerHTML = `<li class="meta">해당 조건의 시간표가 없습니다.</li>`; return; }
  rows.sort((a,b)=> (parseInt(a.PERIO||a.ORD||'0') - parseInt(b.PERIO||b.ORD||'0')));
  rows.forEach(r=>{
    const li = el('li',{class:'task'});
    const perio = r.PERIO || r.ORD || '';
    const name  = r.ITRT_CNTNT || r.SUBJECT || r.TI_NM || '';
    li.innerHTML = `<div class="title">${perio}교시 - ${name}</div>`;
    ttList.appendChild(li);
  });
};
ttBtn?.addEventListener('click', async ()=>{
  if(!PROXY){ alert('env.js의 NEIS_PROXY_BASE를 설정해주세요(Cloudflare Worker URL).'); return; }
  const schoolName = ttSchool.value.trim();
  const ymd = ymdFromInput(ttDate.value);
  const grade = ttGrade.value.trim();
  const classNm = ttClass.value.trim();
  if(!schoolName || !ymd || !grade || !classNm){ alert('학교명/날짜/학년/반을 모두 입력해주세요.'); return; }
  ttBtn.disabled = true; ttBtn.textContent = '불러오는 중...';
  try{
    const url = `${PROXY}/api/timetable?schoolName=${encodeURIComponent(schoolName)}&ymd=${ymd}&grade=${grade}&classNm=${classNm}`;
    const data = await getJSON(url);
    const rows = data.rows || [];
    renderTT(rows);
  }catch(e){
    ttList.innerHTML = `<li class="meta">오류: ${e.message||e}</li>`;
  }finally{
    ttBtn.disabled = false; ttBtn.textContent = '불러오기';
  }
});

// ===== 시작 =====
auth.onAuthStateChanged(async (u)=>{
  currentUser = u;
  isAdmin = !!(u && ADMIN_UIDS.includes(u.uid));
  userInfo.textContent = isAdmin ? `${u.displayName} (관리자)` : (u ? u.email : '로그인 필요');
  loginBtn.style.display = u ? 'none' : '';
  logoutBtn.style.display = u ? '' : 'none';

  applyAdminUI();
  initTabs();

  // 시간표 기본 날짜: 오늘
  const d=new Date();
  if(ttDate) ttDate.value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

  await Promise.all([
    loadNoticeSwitch().then(safeLoadNotices),
    safeLoadTasks('schedules'),
    safeLoadTasks('holidays'),
    safeLoadTasks('exams'),
    safeLoadTasks('tasks'),
    safeLoadTasks('homeworks'),
  ]);

  await loadAdminMemo();
});
