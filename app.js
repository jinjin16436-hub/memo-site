/* =========================================================
 * app.js  (Firebase compat)
 * - firebaseConfig 는 index.html 에서 window.firebaseConfig 로 주입
 * - 평면(복수/단수) + 레거시 경로를 모두 읽어 합치기
 * - 수정은 모달 팝업으로 처리
 * ========================================================= */

/* ---------- Firebase 초기화 ---------- */
const cfg =
  (typeof window !== 'undefined' && window.firebaseConfig)
    ? window.firebaseConfig
    : (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);

if (!cfg) {
  console.error('[Firebase] env(firebaseConfig) 로드 실패');
  alert('firebaseConfig가 로드되지 않았습니다. index.html의 스크립트 순서를 확인하세요.');
  throw new Error('Missing firebaseConfig');
}

firebase.initializeApp(cfg);
const auth = firebase.auth();
const db   = firebase.firestore();

/* ---------- 관리자 UID ---------- */
const ADMIN_UIDS = [
  "vv0bADtWdqQUnqFMy8k01dhO13t2" // 관리자
];

/* ---------- 전역 ---------- */
let currentUser = null;
let isAdmin = false;

/* ---------- DOM 헬퍼 ---------- */
const $ = (q) => document.querySelector(q);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  });
  children.forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
};

/* ---------- 날짜/포맷 ---------- */
const todayISO = () => new Date().toISOString().slice(0,10);
const fmtDate  = (s) => s ? s : '';

/* ---------- D-day ---------- */
function colorByDiff(diff){
  if (diff === 0) return 'red';
  if (diff <= 2)  return 'orange';
  if (diff <= 7)  return 'yellow';
  return 'green';
}
function calcDday(start, end) {
  if (!start && !end) return null;

  const today = new Date(todayISO());
  const s = start ? new Date(start) : null;
  const e = end   ? new Date(end)   : null;

  if (s && e) {
    if (today < s) {
      const diff = Math.ceil((s - today) / 86400000);
      return { label:`D-${diff}`, badge:colorByDiff(diff) };
    } else if (today > e) {
      return null;
    } else {
      return { label:'D-day', badge:'green' };
    }
  } else if (s) {
    if (today < s) {
      const diff = Math.ceil((s - today) / 86400000);
      return { label:`D-${diff}`, badge:colorByDiff(diff) };
    } else if (today.toDateString() === s.toDateString()) {
      return { label:'D-day', badge:'red' };
    }
  } else if (e) {
    if (today < e) {
      const diff = Math.ceil((e - today) / 86400000);
      return { label:`D-${diff}`, badge:colorByDiff(diff) };
    } else if (today.toDateString() === e.toDateString()) {
      return { label:'D-day', badge:'red' };
    }
  }
  return null;
}

/* ---------- 레거시 필드 매핑 ---------- */
function mapNoticeDoc(d){
  const title = d.title ?? d.subject ?? d.name ?? '(제목 없음)';
  const body  = d.body  ?? d.text    ?? d.content ?? '';
  const kind  = d.kind  ?? 'notice';

  let createdISO = todayISO();
  if (d.createdAt?.toDate) createdISO = d.createdAt.toDate().toISOString().slice(0,10);
  else if (typeof d.createdAt === 'string') createdISO = d.createdAt;
  else if (d.created || d.date) createdISO = d.created || d.date;

  return { title, body, kind, createdISO };
}
function mapWorkDoc(d){
  const subject   = d.subject ?? d.title ?? d.name ?? '(과목 없음)';
  const text      = d.text    ?? d.content ?? '';
  const detail    = d.detail  ?? d.desc ?? d.description ?? '';
  const startDate = d.startDate ?? d.start ?? d.dateStart ?? d.date ?? null;
  const endDate   = d.endDate   ?? d.end   ?? d.dateEnd   ?? null;
  const period    = d.period ?? d.class ?? d.lesson ?? d.time ?? '';
  return { subject, text, detail, startDate, endDate, period };
}

/* ---------- Firestore 경로 ---------- */
function colRef(col){ return db.collection('users').doc(currentUser.uid).collection(col); }

/* ---------- Auth ---------- */
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const userInfo  = $('#userInfo');

loginBtn?.addEventListener('click', async ()=>{
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
});
logoutBtn?.addEventListener('click', async ()=>{
  await auth.signOut();
});

auth.onAuthStateChanged(async (user)=>{
  currentUser = user || null;
  isAdmin = !!(user && ADMIN_UIDS.includes(user.uid));

  if (!user) {
    userInfo.textContent = '로그아웃 상태';
    loginBtn.style.display  = '';
    logoutBtn.style.display = 'none';
    clearAllLists();
    return;
  }

  userInfo.textContent = `${user.displayName || '사용자'} | UID ${user.uid}${isAdmin ? ' (관리자)' : ''}`;
  loginBtn.style.display  = 'none';
  logoutBtn.style.display = '';

  await loadAll();
});

/* ---------- 리스트 리셋/로드 ---------- */
function clearAllLists(){
  ['#list_notice','#list_exam','#list_task','#list_homework'].forEach(s=>{
    const ul = $(s); if (ul) ul.innerHTML = '';
  });
}
async function loadAll(){
  await Promise.all([loadNotices(), loadExams(), loadTasks(), loadHomeworks()]);
}

/* =========================================================
   공지 로딩/렌더
   ========================================================= */
async function loadNotices(){
  const ul = $('#list_notice'); if (!ul) return;
  ul.innerHTML = '';
  let snap;
  try {
    snap = await colRef('notices').orderBy('createdAt','desc').get();
  } catch (e) {
    snap = await colRef('notices').get();
  }
  snap.forEach(doc=>{
    const raw = doc.data(); raw.id = doc.id;
    ul.appendChild(renderNotice(raw));
  });
}
function kindClass(kind){
  if (kind==='notice') return 'kind-notice';
  if (kind==='info')   return 'kind-info';
  if (kind==='alert')  return 'kind-alert';
  return '';
}
function renderNotice(raw){
  const d = mapNoticeDoc(raw);
  const li   = el('li',{class:`notice-card ${kindClass(d.kind)}`});
  const ttl  = el('div',{class:'notice-title'}, d.title);
  const body = el('pre',{}, d.body);
  const meta = el('div',{class:'notice-meta'}, `게시일: ${d.createdISO}`);
  li.append(ttl, body, meta);

  if (isAdmin) {
    li.appendChild(buttonRow('notices', raw.id, {
      title:d.title, body:d.body, kind:d.kind, createdAt:d.createdISO
    }));
  }
  return li;
}

/* =========================================================
   시험/수행/숙제: 평면(복수/단수) + 레거시 모두 읽기
   ========================================================= */
// 평면 다중 시도
async function tryFlatMulti(candidates) {
  const allDocs = [];
  for (const cn of candidates) {
    try {
      const snap = await colRef(cn).get();
      if (!snap.empty) {
        console.log(`[flat] ${cn}: ${snap.size} docs`);
        allDocs.push(...snap.docs.map(d => ({ id:d.id, ...d.data() })));
      }
    } catch (e) {
      // 권한/경로 없음 무시
    }
  }
  return allDocs;
}

// 레거시: /users/{uid}/tasks/{cat}/items  (cat 복수/단수 둘다 시도)
async function tryLegacy(catPlural) {
  const cats = [catPlural, catPlural.replace(/s$/, '')];
  const results = [];
  for (const cat of cats) {
    try {
      const snap = await colRef('tasks').doc(cat).collection('items').get();
      if (!snap.empty) {
        console.log(`[legacy] tasks/${cat}/items: ${snap.size} docs`);
        results.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    } catch (e) { /* 경로 없으면 무시 */ }
  }
  return results;
}

function sortByWhen(items){
  items.sort((a,b) => {
    const getT = (x) => {
      if (x.createdAt?.toDate) return x.createdAt.toDate().getTime();
      if (typeof x.createdAt === 'string') return new Date(x.createdAt).getTime();
      if (x.startDate) return new Date(x.startDate).getTime();
      if (x.endDate) return new Date(x.endDate).getTime();
      return 0;
    };
    return getT(b) - getT(a);
  });
}

/* ---- 공통 렌더 ---- */
function renderWorkItem(raw, colname){
  const d = mapWorkDoc(raw);
  const li = el('li',{class:'task'});

  const dday = calcDday(d.startDate, d.endDate);
  const title = el('div',{class:'title'},
    d.subject,
    dday ? el('span',{class:`dday ${dday.badge}`}, ' ', dday.label) : ''
  );
  const content = el('pre',{}, d.text);
  const detail  = d.detail ? el('pre',{}, d.detail) : null;

  const metaText =
    (d.startDate || d.endDate ? `${fmtDate(d.startDate)} ~ ${fmtDate(d.endDate)}` : '') +
    (d.period ? `${(d.startDate || d.endDate) ? ' · ' : ''}${d.period}` : '');
  const meta = metaText ? el('div',{class:'meta'}, metaText) : null;

  li.append(title, content);
  if (detail) li.append(detail);
  if (meta)   li.append(meta);

  if (isAdmin) {
    li.appendChild(buttonRow(colname, raw.id, {
      subject:d.subject, text:d.text, detail:d.detail,
      startDate:d.startDate, endDate:d.endDate, period:d.period
    }));
  }
  return li;
}

/* ---- 시험 ---- */
async function loadExams() {
  const ul = $('#list_exam'); if (!ul) return;
  ul.innerHTML = '';

  const flatItems   = await tryFlatMulti(['exams','exam']);
  const legacyItems = await tryLegacy('exams');
  let items = [...flatItems, ...legacyItems];

  console.log('[loadExams] merged:', items.length);

  if (!items.length) {
    ul.innerHTML = '<li class="task" style="opacity:.7">등록된 시험이 없습니다.</li>';
    return;
  }
  sortByWhen(items);
  items.forEach(raw => ul.appendChild(renderWorkItem(raw, 'exams')));
}

/* ---- 수행평가 ---- */
async function loadTasks() {
  const ul = $('#list_task'); if (!ul) return;
  ul.innerHTML = '';

  const flatItems   = await tryFlatMulti(['tasks','task']);
  const legacyItems = await tryLegacy('tasks');
  let items = [...flatItems, ...legacyItems];

  console.log('[loadTasks] merged:', items.length);

  if (!items.length) {
    ul.innerHTML = '<li class="task" style="opacity:.7">등록된 수행평가가 없습니다.</li>';
    return;
  }
  sortByWhen(items);
  items.forEach(raw => ul.appendChild(renderWorkItem(raw, 'tasks')));
}

/* ---- 숙제 ---- */
async function loadHomeworks() {
  const ul = $('#list_homework'); if (!ul) return;
  ul.innerHTML = '';

  const flatItems   = await tryFlatMulti(['homeworks','homework']);
  const legacyItems = await tryLegacy('homeworks');
  let items = [...flatItems, ...legacyItems];

  console.log('[loadHomeworks] merged:', items.length);

  if (!items.length) {
    ul.innerHTML = '<li class="task" style="opacity:.7">등록된 숙제가 없습니다.</li>';
    return;
  }
  sortByWhen(items);
  items.forEach(raw => ul.appendChild(renderWorkItem(raw, 'homeworks')));
}

/* =========================================================
   수정/삭제 버튼 + 모달 편집기
   ========================================================= */
function buttonRow(colname, id, mapped){
  const wrap = el('div',{class:'row',style:'gap:8px;margin-top:10px;'});
  const edit = el('button',{class:'btn'},'수정');
  const del  = el('button',{class:'btn'},'삭제');

  edit.addEventListener('click', async ()=>{
    if (colname === 'notices') {
      const initial = {
        title: mapped.title ?? '',
        body : mapped.body ?? '',
        kind : mapped.kind ?? 'notice',
      };
      const res = await openEditModal('공지 수정', [
        { key:'title', label:'제목', type:'text', value:initial.title },
        { key:'body',  label:'내용', type:'textarea', value:initial.body },
        { key:'kind',  label:'종류(notice|info|alert)', type:'text', value:initial.kind },
      ]);
      if (!res) return;
      await colRef('notices').doc(id).update({
        title:res.title, body:res.body, kind:res.kind
      });
    } else {
      const initial = {
        subject   : mapped.subject ?? '',
        text      : mapped.text ?? '',
        detail    : mapped.detail ?? '',
        startDate : mapped.startDate ?? '',
        endDate   : mapped.endDate ?? '',
        period    : mapped.period ?? '',
      };
      const res = await openEditModal('항목 수정', [
        { key:'subject',   label:'과목',     type:'text',     value:initial.subject },
        { key:'text',      label:'내용',     type:'textarea', value:initial.text },
        { key:'detail',    label:'상세 내용',type:'textarea', value:initial.detail },
        { key:'startDate', label:'시작일',   type:'date',     value:initial.startDate },
        { key:'endDate',   label:'종료일',   type:'date',     value:initial.endDate },
        { key:'period',    label:'교시/시간',type:'text',     value:initial.period },
      ]);
      if (!res) return;
      await colRef(colname).doc(id).update(res);
    }
    await loadAll();
  });

  del.addEventListener('click', async ()=>{
    if (!confirm('삭제할까요?')) return;
    await colRef(colname).doc(id).delete();
    await loadAll();
  });

  wrap.append(edit, del);
  return wrap;
}

/* ---------- 모달 ---------- */
function ensureModalRoot(){
  let root = $('#modal-root');
  if (!root) {
    root = el('div',{id:'modal-root'});
    document.body.appendChild(root);
  }
  return root;
}
function openEditModal(title, fields){
  return new Promise(resolve=>{
    const root = ensureModalRoot();

    const overlay = el('div',{class:'modal show'});
    const dialog  = el('div',{class:'modal__dialog'});
    const head    = el('div',{class:'modal__head'},
      el('strong',{}, title),
      el('button',{class:'modal__close'},'닫기')
    );
    const body    = el('div',{class:'modal__body'});
    const foot    = el('div',{class:'modal__foot'});

    const form = el('div',{class:'form-grid'});
    const state = {};

    fields.forEach(f=>{
      const wrap = el('label',{}, f.label);
      let input;
      if (f.type === 'textarea') {
        input = el('textarea',{value:f.value || ''});
      } else if (f.type === 'date') {
        input = el('input',{type:'date', value:f.value || ''});
      } else {
        input = el('input',{type:'text', value:f.value || ''});
      }
      wrap.appendChild(input);
      form.appendChild(wrap);
      state[f.key] = input;
    });

    const saveBtn = el('button',{class:'btn btn--primary'},'저장');
    const cancelBtn = el('button',{class:'btn'},'취소');

    body.appendChild(form);
    foot.append(cancelBtn, saveBtn);
    dialog.append(head, body, foot);
    overlay.appendChild(dialog);
    root.appendChild(overlay);

    // 이벤트
    head.querySelector('.modal__close').onclick = close;
    cancelBtn.onclick = () => { close(); resolve(null); };
    saveBtn.onclick = () => {
      const result = {};
      fields.forEach(f => result[f.key] = state[f.key].value);
      close(); resolve(result);
    };

    function close(){
      overlay.remove();
    }
  });
}

/* =========================================================
   추가(공지/시험/수행/숙제)
   ========================================================= */
function v(id){ return (document.getElementById(id)?.value || '').trim(); }

/* 공지 추가 */
$('#nAddBtn')?.addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const title = v('nTitle');
  const body  = v('nBody');
  const kind  = $('#nKind')?.value || 'notice';
  if (!title && !body) return alert('내용을 입력해주세요.');

  await colRef('notices').add({
    title, body, kind,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  $('#nTitle').value=''; $('#nBody').value='';
  await loadNotices();
});

/* 시험 추가 */
$('#exAddBtn')?.addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const subject   = v('exSubj');
  const text      = v('exText');
  const detail    = v('exDetail');
  const startDate = $('#exStart')?.value || null;
  const endDate   = $('#exEnd')?.value   || null;
  const period    = v('exPeriod');

  if (!subject && !text && !detail) return alert('내용을 입력해주세요.');

  await colRef('exams').add({
    subject, text, detail, startDate, endDate, period,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  ['exSubj','exText','exDetail','exStart','exEnd','exPeriod'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.value='';
  });
  await loadExams();
});

/* 수행 추가 */
$('#taAddBtn')?.addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const subject   = v('taSubj');
  const text      = v('taText');
  const detail    = v('taDetail');
  const startDate = $('#taStart')?.value || null;
  const endDate   = $('#taEnd')?.value   || null;
  const period    = v('taPeriod');

  if (!subject && !text && !detail) return alert('내용을 입력해주세요.');

  await colRef('tasks').add({
    subject, text, detail, startDate, endDate, period,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  ['taSubj','taText','taDetail','taStart','taEnd','taPeriod'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.value='';
  });
  await loadTasks();
});

/* 숙제 추가 */
$('#hwAddBtn')?.addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const subject   = v('hwSubj');
  const text      = v('hwText');
  const detail    = v('hwDetail');
  const startDate = $('#hwStart')?.value || null;
  const endDate   = $('#hwEnd')?.value   || null;
  const period    = v('hwPeriod');

  if (!subject && !text && !detail) return alert('내용을 입력해주세요.');

  await colRef('homeworks').add({
    subject, text, detail, startDate, endDate, period,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  ['hwSubj','hwText','hwDetail','hwStart','hwEnd','hwPeriod'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.value='';
  });
  await loadHomeworks();
});

/* ---------- 공지 표시 토글(리스트만 숨김) ---------- */
const noticeSwitch = $('#noticeSwitch');
const noticeList   = $('#list_notice');
noticeSwitch?.addEventListener('change', (e)=>{
  if (!noticeList) return;
  noticeList.style.display = e.target.checked ? '' : 'none';
});

/* ---------- 초기 ---------- */
clearAllLists();
