/* app.js - v1.1.12 (Spark+Worker)
 * 변경사항:
 * - 탭 추가: 일정(schedule), 휴일(holiday)
 * - 배치 순서: [일정]-[휴일]-[시험]-[수행]-[숙제]-[시간표]
 * - 기존 Firestore 경로/권한/NEIS 프록시/모달 수정 기능 유지
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

// ===== 유틸 =====
const pad2 = n => String(n).padStart(2,'0');
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
  if(isAdmin){ document.body.classList.add('is-admin'); $$('.admin-only').forEach(n=>n.style.display=''); }
  else { document.body.classList.remove('is-admin'); $$('.admin-only').forEach(n=>n.style.display='none'); }
};

// ===== ✅ 탭 =====
const initTabs = ()=>{
  const tabs = $('#tabs');
  if(!tabs) return;

  const setTab = (name)=>{
    $$('.tab-btn', tabs).forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
    const map = {
      schedule: $('#panel_schedule'),
      holiday: $('#panel_holiday'),
      exam: $('#panel_exam'),
      task: $('#panel_task'),
      homework: $('#panel_homework'),
      timetable: $('#panel_timetable'),
    };
    Object.entries(map).forEach(([k, panel])=>{
      if(panel) panel.classList.toggle('active', k===name);
    });
  };

  tabs.addEventListener('click', (e)=>{
    const btn = e.target.closest('.tab-btn');
    if(!btn) return;
    setTab(btn.dataset.tab);
  });

  // 기본 탭: 일정
  setTab('schedule');
};

// ===== 로그인 =====
loginBtn.addEventListener('click', async ()=>{ await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); });
logoutBtn.addEventListener('click', async ()=>{ await auth.signOut(); });

auth.onAuthStateChanged(async (u)=>{
  currentUser = u;
  isAdmin = !!(u && ADMIN_UIDS.includes(u.uid));
  userInfo.textContent = isAdmin ? `${u.displayName} (관리자)` : (u ? u.email : '로그인 필요');
  loginBtn.style.display = u ? 'none' : '';
  logoutBtn.style.display = u ? '' : 'none';
  applyAdminUI();

  initTabs();

  await Promise.all([
    loadNoticeSwitch().then(safeLoadNotices),
    safeLoadTasks('schedules'),
    safeLoadTasks('holidays'),
    safeLoadTasks('exams'),
    safeLoadTasks('tasks'),
    safeLoadTasks('homeworks'),
  ]);

  // 시간표 기본 날짜: 오늘
  const d=new Date(); ttDate.value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
});

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

// ===== 공지 로드/정렬(공지>안내>참고) =====
const KIND_ORDER = { notice: 0, info: 1, alert: 2 };

const safeLoadNotices = async () => {
  listNotice.innerHTML = '';
  try {
    const snap = await db
      .collection(`users/${PUBLIC_UID}/notices`)
      .orderBy('createdAt', 'desc')
      .get();

    const docs = [];
    snap.forEach(doc => {
      const data = doc.data() || {};
      docs.push({ id: doc.id, data });
    });

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
      const d = data || {};
      const li = el('li', { class: `notice-card kind-${d.kind || 'notice'}` });
      li.innerHTML = `
        <div class="title">${d.title || '(제목 없음)'}</div>
        ${d.body ? `<div class="content"><pre>${d.body}</pre></div>` : ''}
        ${renderMeta(d.startDate, d.endDate, d.periodStart, d.periodEnd, d.period)}
      `;

      if (isAdmin) {
        const row = el('div');
        const b1 = el('button', { class: 'btn' }); b1.textContent = '수정';
        const b2 = el('button', { class: 'btn' }); b2.textContent = '삭제';
        b1.addEventListener('click', () => openNoticeEdit(id, d));
        b2.addEventListener('click', () => delNotice(id));
        row.append(b1, b2);
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
const delNotice = async (id)=>{ if(!confirm('삭제할까요?')) return; await db.doc(`users/${PUBLIC_UID}/notices/${id}`).delete(); await safeLoadNotices(); };

// ===== ✅ 시험/수행/숙제/일정/휴일 =====
const getListForCat = (cat)=>{
  if(cat==='exams') return listExam;
  if(cat==='tasks') return listTask;
  if(cat==='homeworks') return listHomework;
  if(cat==='schedules') return listSchedule;
  if(cat==='holidays') return listHoliday;
  return null;
};

const isExamCat = (cat)=> cat==='exams';
const isSubjCat = (cat)=> (cat==='tasks' || cat==='homeworks'); // 수행/숙제만 과목 표시

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
      let titleText = '';
      if (isExamCat(cat)) titleText = (d.name || '시험');
      else if (isSubjCat(cat)) titleText = (d.subject || '과목 없음');
      else titleText = (d.title || d.name || d.content || '항목');

      // 본문 구성(카테고리별로 최대한 기존 스타일 유지)
      const li = el('li',{class:'task'});
      const mainTitle = (cat==='exams')
        ? `${(d.name || '시험')} ${ddayBadge(d.startDate, d.endDate)}`
        : (cat==='schedules' || cat==='holidays')
          ? `${(d.title || '제목 없음')} ${ddayBadge(d.startDate, d.endDate)}`
          : `${titleText} ${ddayBadge(d.startDate, d.endDate)}`;

      li.innerHTML = `
        <div class="title">${mainTitle}</div>
        ${d.content ? `<div class="content"><pre>${d.content}</pre></div>` : ''}
        ${d.detail  ? `<div class="content"><pre>${d.detail}</pre></div>` : ''}
        ${renderMeta(d.startDate,d.endDate,d.periodStart,d.periodEnd,d.period)}
      `;

      if (isAdmin) {
        const row = el('div');
        const b1 = el('button',{class:'btn'}); b1.textContent='수정';
        const b2 = el('button',{class:'btn'}); b2.textContent='삭제';
        b1.addEventListener('click',()=> openTaskEdit(cat,id,d));
        b2.addEventListener('click',()=> delTask(cat,id));
        row.append(b1,b2); li.appendChild(row);
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

// ✅ 일정 추가
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

// ✅ 휴일 추가
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
  // 종료일 비었으면 시작일로 맞춤(단일 휴일)
  if(payload.startDate && !payload.endDate) payload.endDate = payload.startDate;

  await db.collection(`users/${PUBLIC_UID}/tasks/holidays/items`).add(payload);
  ['hoTitle','hoDetail','hoStart','hoEnd','hoPStart','hoPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('holidays');
});

const delTask = async (cat,id)=>{
  if(!confirm('삭제할까요?')) return;
  await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).delete();
  await safeLoadTasks(cat);
};

// ===== 수정 모달 (공지/항목) =====
const modalRoot = document.querySelector('#modal-root');
const closeModal = ()=> modalRoot.innerHTML = '';
const periodSelectOptions = (val)=>{
  const v = asIntOrNull(val);
  const opts=['<option value="">선택</option>'];
  for(let i=1;i<=7;i++){ opts.push(`<option value="${i}" ${v===i?'selected':''}>${i}교시</option>`); }
  return opts.join('');
};

const openNoticeEdit = (id,data)=>{
  if(!isAdmin) return;
  modalRoot.innerHTML = `
    <div class="modal show" id="m"><div class="modal__dialog">
      <div class="modal__head"><strong>전달 사항 수정</strong><button class="modal__close" id="mClose">닫기</button></div>
      <div class="modal__body">
        <div class="form-grid">
          <label class="full">제목 <input id="mTitle" value="${data.title||''}"></label>
          <label>분류
            <select id="mKind">
              <option value="notice" ${data.kind==='notice'?'selected':''}>공지(빨강)</option>
              <option value="info" ${data.kind==='info'?'selected':''}>안내(노랑)</option>
              <option value="alert" ${data.kind==='alert'?'selected':''}>참고(초록)</option>
            </select>
          </label>
          <label class="full">내용 <textarea id="mBody">${data.body||''}</textarea></label>
        </div>
      </div>
      <div class="modal__foot"><button class="btn btn--ghost" id="mCancel">취소</button><button class="btn btn--primary" id="mSave">저장</button></div>
    </div></div>`;
  $('#mClose').onclick = $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async ()=>{
    await db.doc(`users/${PUBLIC_UID}/notices/${id}`).update({
      title:$('#mTitle').value.trim(),
      kind:$('#mKind').value,
      body:$('#mBody').value.trim()
    });
    closeModal(); await safeLoadNotices();
  };
};

const toDateInputValue = ts => {
  if(!ts) return '';
  const d=ts.toDate?ts.toDate():new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};

const openTaskEdit = (cat,id,data)=>{
  if(!isAdmin) return;

  const withSubj = (cat === 'tasks' || cat === 'homeworks');
  const isExam   = (cat === 'exams');
  const isSimpleTitle = (cat === 'schedules' || cat === 'holidays');

  const titleLabel = isExam ? '시험 이름' : (withSubj ? '내용' : '제목');

  const titleValue = isExam
    ? (data.name || '')
    : isSimpleTitle
      ? (data.title || '')
      : (data.content || '');

  modalRoot.innerHTML = `
  <div class="modal show" id="m"><div class="modal__dialog">
    <div class="modal__head"><strong>항목 수정</strong><button class="modal__close" id="mClose">닫기</button></div>
    <div class="modal__body">
      <div class="form-grid">
        ${withSubj ? `<label>과목 <input id="mSubj" value="${data.subject||''}"></label>`:''}
        <label>${titleLabel} <input id="mTitle" value="${titleValue}"></label>
        <label class="full">상세 내용 <textarea id="mDetail">${data.detail||''}</textarea></label>
        <label>시작일 <input id="mStart" type="date" value="${toDateInputValue(data.startDate)}"></label>
        <label>종료일 <input id="mEnd" type="date" value="${toDateInputValue(data.endDate)}"></label>
        <label>교시 시작 <select id="mPStart">${periodSelectOptions(data.periodStart)}</select></label>
        <label>교시 끝 <select id="mPEnd">${periodSelectOptions(data.periodEnd)}</select></label>
      </div>
    </div>
    <div class="modal__foot"><button class="btn btn--ghost" id="mCancel">취소</button><button class="btn btn--primary" id="mSave">저장</button></div>
  </div></div>`;

  $('#mClose').onclick = $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async ()=>{
    const payload = {
      detail: $('#mDetail').value.trim(),
      startDate: $('#mStart').value ? new Date($('#mStart').value) : null,
      endDate:   $('#mEnd').value   ? new Date($('#mEnd').value)   : null,
      periodStart: asIntOrNull($('#mPStart').value),
      periodEnd:   asIntOrNull($('#mPEnd').value),
    };

    if(isExam){
      payload.name = $('#mTitle').value.trim();
    }else if(withSubj){
      payload.subject = $('#mSubj').value.trim();
      payload.content = $('#mTitle').value.trim();
    }else if(isSimpleTitle){
      payload.title = $('#mTitle').value.trim();
    }else{
      payload.content = $('#mTitle').value.trim();
    }

    await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).update(payload);
    closeModal(); await safeLoadTasks(cat);
  };
};

// ===== 시간표(NEIS) - Cloudflare Worker 프록시 사용 (FIX) =====
const PROXY = (NEIS_PROXY_BASE || '').replace(/\/+$/,'');

const ymdFromInput = (v)=>{
  if(!v) return '';
  const d=new Date(v);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
};

// ✅ 응답이 어떤 형태든 row 배열을 뽑아내기
const extractRows = (data)=>{
  if(!data) return [];

  // 1) 우리가 기대한 형태
  if(Array.isArray(data.rows)) return data.rows;

  // 2) NEIS 원본 형태: hisTimetable / misTimetable / elsTimetable 등
  const keys = ["hisTimetable","misTimetable","elsTimetable"];
  for (const k of keys) {
    const block = data[k];
    if (Array.isArray(block)) {
      const rowObj = block.find(x => x && Array.isArray(x.row));
      if (rowObj && Array.isArray(rowObj.row)) return rowObj.row;
    }
  }

  // 3) 혹시 row가 바로 있는 형태
  if(Array.isArray(data.row)) return data.row;

  return [];
};

// ✅ 실패 시 원문도 같이 보여주기
const getJSON = async (url)=>{
  const r = await fetch(url, { headers:{'Accept':'application/json'} });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, text, json };
};

const renderTT = (rows=[])=>{
  ttList.innerHTML = '';
  if(!rows.length){
    ttList.innerHTML = `<li class="meta">해당 조건의 시간표가 없습니다. (주말/공휴일/학교명/날짜 확인)</li>`;
    return;
  }

  rows.sort((a,b)=> (parseInt(a.PERIO||a.ORD||'0') - parseInt(b.PERIO||b.ORD||'0')));
  rows.forEach(r=>{
    const li = el('li',{class:'task'});
    const perio = r.PERIO || r.ORD || '';
    const name  = r.ITRT_CNTNT || r.SUBJECT || r.TI_NM || '';
    const room  = r.CLRM_NM || '';
    li.innerHTML = `<div class="title">${perio}교시 - ${name}${room?` (${room})`:''}</div>`;
    ttList.appendChild(li);
  });
};

ttBtn?.addEventListener('click', async ()=>{
  if(!PROXY){
    alert('env.js의 NEIS_PROXY_BASE를 설정해주세요(Cloudflare Worker URL).');
    return;
  }

  const schoolName = ttSchool.value.trim();
  const ymd = ymdFromInput(ttDate.value);
  const grade = ttGrade.value.trim();
  const classNm = ttClass.value.trim();

  if(!schoolName || !ymd || !grade || !classNm){
    alert('학교명/날짜/학년/반을 모두 입력해주세요.');
    return;
  }

  ttBtn.disabled = true;
  ttBtn.textContent = '불러오는 중...';
  ttList.innerHTML = `<li class="meta">불러오는 중...</li>`;

  try{
    const url = `${PROXY}/api/timetable?schoolName=${encodeURIComponent(schoolName)}&ymd=${ymd}&grade=${grade}&classNm=${classNm}`;
    const res = await getJSON(url);

    // ✅ 서버 에러면 원문 보여주기
    if(!res.ok){
      ttList.innerHTML = `
        <li class="meta">서버 오류 (HTTP ${res.status})</li>
        <li class="task"><pre>${(res.text || '').slice(0, 2000)}</pre></li>
      `;
      return;
    }

    const data = res.json;
    const rows = extractRows(data);

    // ✅ rows 추출 실패 시 json/원문 일부 보여주기
    if(!rows.length){
      const preview = res.text ? res.text.slice(0, 2000) : '(empty)';
      ttList.innerHTML = `
        <li class="meta">시간표 데이터가 비어있거나 형식이 달라요.</li>
        <li class="meta">학교명/날짜(평일)/학년/반을 확인해줘.</li>
        <li class="task"><pre>${preview}</pre></li>
      `;
      return;
    }

    renderTT(rows);
  }catch(e){
    ttList.innerHTML = `<li class="meta">오류: ${e.message||e}</li>`;
  }finally{
    ttBtn.disabled = false;
    ttBtn.textContent = '불러오기';
  }
});
