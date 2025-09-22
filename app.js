/* ==============================
   Firebase 초기화 & 공통
============================== */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// 관리자 UID 목록 (필요한 UID 추가)
const ADMIN_UIDS = [
   'vv0bADtWdqQUnqFMy8k01dhO13t2',
   '3L9ZSYKcPYNmc23FSP9bsrYo7J12',
];

let currentUser = null;
let isAdmin = false;

// 유틸
const $ = (q) => document.querySelector(q);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  });
  children.forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
};
const fmtDate = (s) => !s ? '' : s; // yyyy-mm-dd 그대로 사용
const todayISO = () => new Date().toISOString().slice(0,10);

// D-day 계산 (시작~종료 구간: 오늘이 구간 안이면 "D-day")
function calcDday(start, end) {
  if (!start && !end) return null;

  const today = new Date(todayISO());
  let badge = null;
  let label = null;

  const startD = start ? new Date(start) : null;
  const endD   = end   ? new Date(end)   : null;

  if (startD && endD) {
    if (today < startD) {
      const diff = Math.ceil((startD - today) / 86400000);
      label = `D-${diff}`;
      badge = colorByDiff(diff);
    } else if (today > endD) {
      label = null; // 지난 것
    } else {
      label = 'D-day';
      badge = 'green';
    }
  } else if (startD) {
    if (today < startD) {
      const diff = Math.ceil((startD - today) / 86400000);
      label = `D-${diff}`;
      badge = colorByDiff(diff);
    } else if (today.toDateString() === startD.toDateString()) {
      label = 'D-day'; badge = 'red';
    }
  } else if (endD) {
    if (today < endD) {
      const diff = Math.ceil((endD - today) / 86400000);
      label = `D-${diff}`;
      badge = colorByDiff(diff);
    } else if (today.toDateString() === endD.toDateString()) {
      label = 'D-day'; badge = 'red';
    }
  }
  return label ? {label, badge} : null;
}
function colorByDiff(diff){
  if (diff === 0)  return 'red';      // 오늘
  if (diff <= 2)   return 'orange';   // 1~2일 전
  if (diff <= 7)   return 'yellow';   // 3~7일 전
  return 'green';                      // 8일 이상
}

/* ==============================
   로그인 / 로그아웃
============================== */
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const userInfo  = $('#userInfo');

loginBtn.addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
});
logoutBtn.addEventListener('click', async () => {
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

  userInfo.innerHTML = `${user.displayName || '사용자'} ${
    isAdmin ? '(관리자)' : ''
  }`;
  loginBtn.style.display = 'none';
  logoutBtn.style.display = '';

  // 데이터 로드
  await loadAll();
});

/* ==============================
   컬렉션 참조 유틸
============================== */
function colRef(name){
  if (!currentUser) throw new Error('로그인 필요');
  return db.collection('users').doc(currentUser.uid).collection(name);
}

/* ==============================
   로드 / 렌더링
============================== */
async function loadAll(){
  await Promise.all([
    loadNotices(),
    loadExams(),
    loadTasks(),
    loadHomeworks()
  ]);
}
function clearAllLists(){
  ['#list_notice','#list_exam','#list_task','#list_homework'].forEach(s=>{
    const ul = $(s);
    if (ul) ul.innerHTML = '';
  });
}

// 공지
async function loadNotices(){
  const snap = await colRef('notices').orderBy('createdAt','desc').get();
  const ul = $('#list_notice'); ul.innerHTML = '';
  snap.forEach(doc => {
    const d = doc.data(); d.id = doc.id;
    ul.appendChild(renderNotice(d));
  });
}
function renderNotice(d){
  const li = el('li',{class:'notice-card ' + kindClass(d.kind || 'notice')});
  const title = el('div',{class:'notice-title'}, d.title || '(제목 없음)');
  const body  = el('pre',{}, d.body || '');
  const meta  = el('div',{class:'notice-meta'}, `게시일: ${fmtDate((d.createdAt && d.createdAt.toDate?.()) ? d.createdAt.toDate().toISOString().slice(0,10) : todayISO())}`);
  const rowBtn = isAdmin ? buttonRow('notices', d.id, d) : null;

  li.append(title, body, meta);
  if (rowBtn) li.appendChild(rowBtn);
  return li;
}
function kindClass(kind){
  if (kind === 'notice') return 'kind-notice';
  if (kind === 'info')   return 'kind-info';
  if (kind === 'alert')  return 'kind-alert';
  return '';
}

// 시험/수행/숙제 공통 렌더
function renderWorkItem(d, colname){
  const li = el('li',{class:'task'});
  const dday = calcDday(d.startDate, d.endDate);
  const title = el('div',{class:'title'},
    d.subject || '(과목 없음)', dday ? el('span',{class:`dday ${dday.badge}`}, ' ', dday.label) : ''
  );
  const content = el('pre',{}, d.text || '');
  const detail  = d.detail ? el('pre',{}, d.detail) : null;

  const meta = el('div',{class:'meta'},
    (d.startDate || d.endDate)
      ? `${fmtDate(d.startDate)} ~ ${fmtDate(d.endDate)}`
      : ''
  );
  if (d.period) meta.appendChild(document.createTextNode(
    (meta.textContent ? ' · ' : '') + d.period
  ));

  const rowBtn = isAdmin ? buttonRow(colname, d.id, d) : null;

  li.append(title, content);
  if (detail) li.append(detail);
  if (meta.textContent) li.append(meta);
  if (rowBtn) li.append(rowBtn);
  return li;
}

async function loadExams(){
  const snap = await colRef('exams').orderBy('createdAt','desc').get();
  const ul = $('#list_exam'); ul.innerHTML = '';
  snap.forEach(doc=>{
    const d = doc.data(); d.id = doc.id;
    ul.appendChild(renderWorkItem(d,'exams'));
  });
}
async function loadTasks(){
  const snap = await colRef('tasks').orderBy('createdAt','desc').get();
  const ul = $('#list_task'); ul.innerHTML = '';
  snap.forEach(doc=>{
    const d = doc.data(); d.id = doc.id;
    ul.appendChild(renderWorkItem(d,'tasks'));
  });
}
async function loadHomeworks(){
  const snap = await colRef('homeworks').orderBy('createdAt','desc').get();
  const ul = $('#list_homework'); ul.innerHTML = '';
  snap.forEach(doc=>{
    const d = doc.data(); d.id = doc.id;
    ul.appendChild(renderWorkItem(d,'homeworks'));
  });
}

/* ==============================
   버튼행 (수정/삭제) - 간단 버전
============================== */
function buttonRow(colname, id, d){
  const wrap = el('div',{class:'row', style:'gap:8px;margin-top:10px;'});
  const edit = el('button',{class:'btn'},'수정');
  const del  = el('button',{class:'btn'},'삭제');

  edit.addEventListener('click', async ()=>{
    // 간단 수정: prompt 기반 (모달 버전이 있다면 그걸로 교체)
    if (colname === 'notices') {
      const title = prompt('제목', d.title || '');
      if (title === null) return;
      const body  = prompt('내용', d.body || '');
      if (body === null) return;
      const kind  = prompt('종류(notice|info|alert)', d.kind || 'notice') || 'notice';
      await colRef('notices').doc(id).update({ title, body, kind });
    } else {
      const subject   = prompt('과목', d.subject || '');
      if (subject === null) return;
      const text      = prompt('내용', d.text || '');
      if (text === null) return;
      const detail    = prompt('상세 내용', d.detail || '');
      if (detail === null) return;
      const startDate = prompt('시작일 yyyy-mm-dd', d.startDate || '') || null;
      const endDate   = prompt('종료일 yyyy-mm-dd', d.endDate || '') || null;
      const period    = prompt('교시', d.period || '') || '';
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
   추가 폼 - 저장
============================== */
// 공지 추가
$('#nAddBtn').addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const title = $('#nTitle').value.trim();
  const body  = $('#nBody').value.trim();
  const kind  = $('#nKind').value;

  if (!title && !body) return alert('내용을 입력해주세요.');

  await colRef('notices').add({
    title, body, kind,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  $('#nTitle').value = '';
  $('#nBody').value  = '';
  await loadNotices();
});

// 시험
$('#exAddBtn').addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const subject   = $('#exSubj').value.trim();
  const text      = $('#exText').value.trim();
  const detail    = $('#exDetail').value.trim();
  const startDate = $('#exStart').value || null;
  const endDate   = $('#exEnd').value   || null;
  const period    = $('#exPeriod').value.trim();

  if (!subject && !text && !detail) return alert('내용을 입력해주세요.');

  await colRef('exams').add({
    subject, text, detail, startDate, endDate, period,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  $('#exSubj').value=''; $('#exText').value=''; $('#exDetail').value='';
  $('#exStart').value=''; $('#exEnd').value=''; $('#exPeriod').value='';
  await loadExams();
});
// 수행
$('#taAddBtn').addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const subject   = $('#taSubj').value.trim();
  const text      = $('#taText').value.trim();
  const detail    = $('#taDetail').value.trim();
  const startDate = $('#taStart').value || null;
  const endDate   = $('#taEnd').value   || null;
  const period    = $('#taPeriod').value.trim();

  if (!subject && !text && !detail) return alert('내용을 입력해주세요.');

  await colRef('tasks').add({
    subject, text, detail, startDate, endDate, period,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  $('#taSubj').value=''; $('#taText').value=''; $('#taDetail').value='';
  $('#taStart').value=''; $('#taEnd').value=''; $('#taPeriod').value='';
  await loadTasks();
});
// 숙제
$('#hwAddBtn').addEventListener('click', async ()=>{
  if (!currentUser) return alert('로그인이 필요합니다.');
  const subject   = $('#hwSubj').value.trim();
  const text      = $('#hwText').value.trim();
  const detail    = $('#hwDetail').value.trim();
  const startDate = $('#hwStart').value || null;
  const endDate   = $('#hwEnd').value   || null;
  const period    = $('#hwPeriod').value.trim();

  if (!subject && !text && !detail) return alert('내용을 입력해주세요.');

  await colRef('homeworks').add({
    subject, text, detail, startDate, endDate, period,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  $('#hwSubj').value=''; $('#hwText').value=''; $('#hwDetail').value='';
  $('#hwStart').value=''; $('#hwEnd').value=''; $('#hwPeriod').value='';
  await loadHomeworks();
});

/* ==============================
   공지 표시 토글 (리스트만 숨김)
============================== */
const noticeSwitch = $('#noticeSwitch');
const noticeList   = $('#list_notice');
noticeSwitch.addEventListener('change', (e)=>{
  noticeList.style.display = e.target.checked ? '' : 'none';
});

/* ==============================
   초기 진입(비로그인)
============================== */
clearAllLists();
