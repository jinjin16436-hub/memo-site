/* ==============================
   Firebase 초기화 & 공통
============================== */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// 관리자 UID 등록(필요시 수정)
const ADMIN_UIDS = [
   'vv0bADtWdqQUnqFMy8k01dhO13t2'
];

let currentUser = null;
let isAdmin = false;

// DOM 유틸
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

/* 날짜 유틸 */
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (s) => !s ? '' : s;

/* 레거시 필드 매핑 유틸 (공지) */
function mapNoticeDoc(d) {
  // 과거에 title/body 대신 다른 키를 썼어도 안전하게 읽기
  const title = d.title ?? d.subject ?? d.name ?? '(제목 없음)';
  const body  = d.body  ?? d.text    ?? d.content ?? '';
  const kind  = d.kind  ?? 'notice';

  // createdAt이 Timestamp거나 문자열이거나 없을 수도 있음
  let createdISO = todayISO();
  if (d.createdAt?.toDate) {
    createdISO = d.createdAt.toDate().toISOString().slice(0,10);
  } else if (typeof d.createdAt === 'string') {
    createdISO = d.createdAt;
  } else if (d.created || d.date) {
    createdISO = (d.created || d.date);
  }
  return { title, body, kind, createdISO };
}

/* 레거시 필드 매핑 유틸 (시험/수행/숙제) */
function mapWorkDoc(d) {
  // subject/text/detail 호환
  const subject   = d.subject ?? d.title ?? d.name ?? '(과목 없음)';
  const text      = d.text    ?? d.content ?? '';
  const detail    = d.detail  ?? d.desc ?? d.description ?? '';

  // 날짜 호환: startDate/endDate || start/end || dateStart/dateEnd || date(단일)
  const startDate = d.startDate ?? d.start ?? d.dateStart ?? d.date ?? null;
  const endDate   = d.endDate   ?? d.end   ?? d.dateEnd   ?? null;

  // 교시/시간대 호환
  const period    = d.period ?? d.class ?? d.lesson ?? d.time ?? '';

  return { subject, text, detail, startDate, endDate, period };
}

/* D-day 계산 */
function colorByDiff(diff){
  if (diff === 0)  return 'red';      // 당일
  if (diff <= 2)   return 'orange';   // 1~2일 전
  if (diff <= 7)   return 'yellow';   // 3~7일 전
  return 'green';                      // 8일 이상
}
function calcDday(start, end) {
  if (!start && !end) return null;

  const today = new Date(todayISO());
  const s = start ? new Date(start) : null;
  const e = end   ? new Date(end)   : null;

  if (s && e) {
    if (today < s) {
      const diff = Math.ceil((s - today) / 86400000);
      return { label: `D-${diff}`, badge: colorByDiff(diff) };
    } else if (today > e) {
      return null; // 지난 일정
    } else {
      return { label: 'D-day', badge: 'green' };
    }
  } else if (s) {
    if (today < s) {
      const diff = Math.ceil((s - today) / 86400000);
      return { label: `D-${diff}`, badge: colorByDiff(diff) };
    } else if (today.toDateString() === s.toDateString()) {
      return { label: 'D-day', badge: 'red' };
    }
  } else if (e) {
    if (today < e) {
      const diff = Math.ceil((e - today) / 86400000);
      return { label: `D-${diff}`, badge: colorByDiff(diff) };
    } else if (today.toDateString() === e.toDateString()) {
      return { label: 'D-day', badge: 'red' };
    }
  }
  return null;
}

/* Firestore 경로 */
function colRef(name){
  if (!currentUser) throw new Error('로그인이 필요합니다.');
  return db.collection('users').doc(currentUser.uid).collection(name);
}

/* 안전한 로드: createdAt 정렬 실패하면 일반 조회로 폴백 */
async function safeLoad(colName) {
  try {
    return await colRef(colName).orderBy('createdAt','desc').get();
  } catch (e) {
    console.warn(`[safeLoad] orderBy(createdAt) 실패 → 일반 get() 폴백 : ${colName}`, e);
    return await colRef(colName).get();
  }
}

/* ==============================
   로그인/로그아웃
============================== */
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const userInfo  = $('#userInfo');

loginBtn?.addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
});
logoutBtn?.addEventListener('click', async () => {
  await auth.signOut();
});

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  isAdmin = !!(user && ADMIN_UIDS.includes(user.uid));

  if (!user) {
    userInfo.textContent = '로그아웃 상태';
    loginBtn.style.display = '';
    logoutBtn.style.display = 'none';
    clearAllLists();
    return;
  }

  userInfo.textContent = `${user.displayName || '사용자'} | UID ${user.uid}${isAdmin ? ' (관리자)' : ''}`;
  loginBtn.style.display = 'none';
  logoutBtn.style.display = '';

  await loadAll();
});

/* ==============================
   로드 & 렌더
============================== */
function clearAllLists(){
  ['#list_notice','#list_exam','#list_task','#list_homework'].forEach(s=>{
    const ul = $(s);
    if (ul) ul.innerHTML = '';
  });
}
async function loadAll(){
  await Promise.all([
    loadNotices(),
    loadExams(),
    loadTasks(),
    loadHomeworks()
  ]);
}

/* 공지 */
async function loadNotices(){
  const ul = $('#list_notice'); if (!ul) return;
  ul.innerHTML = '';
  const snap = await safeLoad('notices');
  snap.forEach(doc => {
    const raw = doc.data(); raw.id = doc.id;
    ul.appendChild(renderNotice(raw));
  });
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
      title: d.title, body: d.body, kind: d.kind, createdAt: d.createdISO
    }));
  }
  return li;
}
function kindClass(kind){
  if (kind === 'notice') return 'kind-notice';
  if (kind === 'info')   return 'kind-info';
  if (kind === 'alert')  return 'kind-alert';
  return '';
}

/* 시험/수행/숙제 공통 */
function renderWorkItem(raw, colname){
  const d = mapWorkDoc(raw);
  const li = el('li',{class:'task'});

  const dday = calcDday(d.startDate, d.endDate);
  const title = el('div',{class:'title'},
    d.subject, dday ? el('span',{class:`dday ${dday.badge}`}, ' ', dday.label) : ''
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

async function loadExams(){
  const ul = $('#list_exam'); if (!ul) return;
  ul.innerHTML = '';
  const snap = await safeLoad('exams');
  snap.forEach(doc=>{
    const raw = doc.data(); raw.id = doc.id;
    ul.appendChild(renderWorkItem(raw,'exams'));
  });
}
async function loadTasks(){
  const ul = $('#list_task'); if (!ul) return;
  ul.innerHTML = '';
  const snap = await safeLoad('tasks');
  snap.forEach(doc=>{
    const raw = doc.data(); raw.id = doc.id;
    ul.appendChild(renderWorkItem(raw,'tasks'));
  });
}
async function loadHomeworks(){
  const ul = $('#list_homework'); if (!ul) return;
  ul.innerHTML = '';
  const snap = await safeLoad('homeworks');
  snap.forEach(doc=>{
    const raw = doc.data(); raw.id = doc.id;
    ul.appendChild(renderWorkItem(raw,'homeworks'));
  });
}

/* 수정/삭제 버튼 (간단 prompt 버전) */
function buttonRow(colname, id, mapped){
  const wrap = el('div',{class:'row', style:'gap:8px;margin-top:10px;'});
  const edit = el('button',{class:'btn'},'수정');
  const del  = el('button',{class:'btn'},'삭제');

  edit.addEventListener('click', async ()=>{
    if (colname === 'notices') {
      const title = prompt('제목', mapped.title ?? '');
      if (title === null) return;
      const body  = prompt('내용', mapped.body ?? '');
      if (body === null) return;
      const kind  = prompt('종류(notice|info|alert)', mapped.kind ?? 'notice') || 'notice';
      await colRef('notices').doc(id).update({ title, body, kind });
    } else {
      const subject   = prompt('과목', mapped.subject ?? '');
      if (subject === null) return;
      const text      = prompt('내용', mapped.text ?? '');
      if (text === null) return;
      const detail    = prompt('상세 내용', mapped.detail ?? '');
      if (detail === null) return;
      const startDate = prompt('시작일 yyyy-mm-dd', mapped.startDate ?? '') || null;
      const endDate   = prompt('종료일 yyyy-mm-dd', mapped.endDate ?? '') || null;
      const period    = prompt('교시', mapped.period ?? '') || '';
      await colRef(colname).doc(id).update({ subject, text, detail, startDate, endDate, period });
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

/* ==============================
   추가 폼 저장
============================== */
function v(id){ return (document.getElementById(id)?.value || '').trim(); }

/* 공지 */
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
  $('#nTitle').value = ''; $('#nBody').value = '';
  await loadNotices();
});

/* 시험 */
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
    const e = document.getElementById(id); if (e) e.value = '';
  });
  await loadExams();
});

/* 수행 */
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
    const e = document.getElementById(id); if (e) e.value = '';
  });
  await loadTasks();
});

/* 숙제 */
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
    const e = document.getElementById(id); if (e) e.value = '';
  });
  await loadHomeworks();
});

/* ==============================
   공지 표시 토글 (리스트만 숨김)
============================== */
const noticeSwitch = $('#noticeSwitch');
const noticeList   = $('#list_notice');
noticeSwitch?.addEventListener('change', (e)=>{
  if (!noticeList) return;
  noticeList.style.display = e.target.checked ? '' : 'none';
});

/* 초기화 */
clearAllLists();
