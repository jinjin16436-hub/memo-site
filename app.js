
/* ===============================
   app.js (Firebase compat v9)
   - 단일 날짜 + 기간(시작~종료) 모두 지원
   - 오늘이 기간 내면 D-day
   - D-day 순 정렬
   =============================== */

if (!window.ENV || !window.ENV.FIREBASE) {
  alert('환경설정(ENV)이 없습니다. env.js를 확인하세요.');
}

firebase.initializeApp(window.ENV.FIREBASE);
const auth = firebase.auth();
const db   = firebase.firestore();

/* ====== 관리자/공개 설정 ====== */
const ADMIN_UIDS   = Array.isArray(window.ENV.ADMIN_UIDS) ? window.ENV.ADMIN_UIDS : [];
const ADMIN_EMAILS = Array.isArray(window.ENV.ADMIN_EMAILS) ? window.ENV.ADMIN_EMAILS : [];
const PUBLIC_UID   = window.ENV.PUBLIC_UID || (ADMIN_UIDS[0] ?? null);

/* ====== DOM ====== */
const loginBtn  = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

const $noticeSection  = document.getElementById('sec_notice') || document.querySelector('#sec_notice, [data-sec="notice"]');
const noticeToggle    = document.getElementById('noticeToggle');
const noticeAddRow    = document.getElementById('noticeAddRow');
const noticeList      = document.getElementById('notice_list');

const nTitle   = document.getElementById('nTitle');
const nKind    = document.getElementById('nKind');
const nBody    = document.getElementById('nBody');
const nAddBtn  = document.getElementById('nAddBtn');

const lists = {
  exam: document.getElementById('list_exam'),
  perf: document.getElementById('list_perf'),
  home: document.getElementById('list_home'),
};
const addRows = Array.from(document.querySelectorAll('.add-row[data-cat]'));

const userInfoBox = document.createElement('div');
userInfoBox.className = 'muted';

/* ====== 유틸 ====== */
const $ = (s, r=document) => r.querySelector(s);
const el = (t,c,h)=>{const n=document.createElement(t); if(c)n.className=c; if(h!=null)n.innerHTML=h; return n;};
function isAdminUser(user){
  if (!user) return false;
  return (ADMIN_UIDS.includes(user.uid)) || (user.email && ADMIN_EMAILS.includes(user.email));
}
function fmtDateK(d) {
  if (!d) return '';
  let dt;
  if (d?.toDate) dt = d.toDate();
  else if (typeof d === 'string') dt = new Date(d);
  else dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const wk = ['일','월','화','수','목','금','토'][dt.getDay()];
  return `${y}-${m}-${day} (${wk})`;
}
function toTsFromDateInput(dateStr) {
  if (!dateStr) return null;
  const dt = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return null;
  return firebase.firestore.Timestamp.fromDate(dt);
}
function startOfDay(d){ const t = new Date(d); t.setHours(0,0,0,0); return t; }

/* ====== D-day 계산 (단일/범위 지원) ====== */
function evalDDay(startLike, endLike){
  const today = startOfDay(new Date());

  const asDate = (x)=>{
    if (!x) return null;
    if (x?.toDate) return startOfDay(x.toDate());
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return null;
    return startOfDay(d);
  };

  const s = asDate(startLike);
  const e = asDate(endLike);

  // 단일 일정
  if (s && !e){
    const diff = Math.round((s - today) / (24*60*60*1000));
    if (diff < 0) return { label:`D+${Math.abs(diff)}`, cls:'gray',   diffRef:diff };
    if (diff === 0) return { label:'D-day',            cls:'red',    diffRef:0 };
    if (diff <= 2)  return { label:`D-${diff}`,        cls:'orange', diffRef:diff };
    if (diff <= 7)  return { label:`D-${diff}`,        cls:'yellow', diffRef:diff };
    return            { label:`D-${diff}`,             cls:'green',  diffRef:diff };
  }

  // 기간 일정
  if (s && e){
    if (today < s){
      const diff = Math.round((s - today) / (24*60*60*1000));
      if (diff <= 2)  return { label:`D-${diff}`, cls:'orange', diffRef:diff };
      if (diff <= 7)  return { label:`D-${diff}`, cls:'yellow', diffRef:diff };
      return            { label:`D-${diff}`, cls:'green', diffRef:diff };
    }
    if (today > e){
      const diffPast = Math.round((today - e) / (24*60*60*1000));
      return { label:`D+${diffPast}`, cls:'gray', diffRef:-diffPast };
    }
    // 기간 안: 오늘
    return { label:'D-day', cls:'red', diffRef:0 };
  }

  return null;
}

/* ====== D-day 정렬용 유틸 ====== */
function _getStartMillis(it){
  const ts =
    it.startAt?.toDate?.() ? it.startAt.toDate() :
    it.dateAt?.toDate?.()  ? it.dateAt.toDate()  : null;
  if (ts) return ts.getTime?.() ?? new Date(ts).getTime();
  if (it.startDate) return new Date(it.startDate + 'T00:00:00').getTime();
  if (it.date)      return new Date(it.date      + 'T00:00:00').getTime();
  const c = it.createdAt?.toDate?.() ? it.createdAt.toDate() : null;
  return c ? c.getTime() : 0;
}
function _makeSortKey(it){
  const dd = evalDDay(it.startDate || it.startAt || it.date || it.dateAt,
                      it.endDate   || it.endAt);
  if (!dd) return { group: 3, key: Number.MAX_SAFE_INTEGER, tiebreak: _getStartMillis(it) };
  if (dd.diffRef === 0) return { group: 0, key: 0, tiebreak: _getStartMillis(it) }; // 기간중/오늘
  if (dd.diffRef > 0)   return { group: 1, key: dd.diffRef, tiebreak: _getStartMillis(it) }; // 미래
  return { group: 2, key: Math.abs(dd.diffRef), tiebreak: _getStartMillis(it) }; // 과거
}

/* ====== Firestore refs ====== */
const colNotices = (uid=PUBLIC_UID)=> db.collection('users').doc(uid).collection('notices');
const colTask    = (cat,uid=PUBLIC_UID)=> db.collection('users').doc(uid).collection('tasks').doc(cat).collection('items');
const docAppSettings = (uid=(ADMIN_UIDS[0]||PUBLIC_UID))=> db.collection('users').doc(uid).collection('settings').doc('app');

/* ====== Auth ====== */
async function signIn(){
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  }catch(e){ console.error(e); alert('로그인 실패: '+e.message); }
}
async function signOut(){ await auth.signOut(); }
if (loginBtn)  loginBtn.addEventListener('click', signIn);
if (logoutBtn) logoutBtn.addEventListener('click', signOut);

auth.onAuthStateChanged(async (user)=>{
  const admin = isAdminUser(user);
  const authBox = document.querySelector('.auth');
  if (authBox) {
    userInfoBox.textContent = user
      ? `${user.displayName ?? '사용자'} | ${user.email ?? ''} | UID ${user.uid.slice(0,8)}… | ${admin?'관리자':'일반'}`
      : '로그인 필요';
    authBox.prepend(userInfoBox);
  }
  if (loginBtn)  loginBtn.style.display  = user ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = user ? '' : 'none';
  addRows.forEach(row => row.style.display = admin ? 'grid' : 'none');
  if (noticeAddRow) noticeAddRow.style.display = admin ? 'grid' : 'none';
  await pullNoticeToggle();
  startListeners();
});

/* ====== 공지 ====== */
function renderNoticeList(items){
  if (!noticeList) return;
  noticeList.innerHTML = '';
  if (!items || !items.length) return;
  const admin = isAdminUser(auth.currentUser);
  items.forEach((it)=>{
    const li    = el('li', 'notice-card ' + (it.kind?`kind-${it.kind}`:''));
    const title = el('div','notice-title', it.title || '(제목 없음)');
    const meta  = el('div','notice-meta', it.createdAt ? fmtDateK(it.createdAt) : '');
    if (it.body) li.append(title, meta, el('pre', null, it.body));
    else li.append(title, meta);
    if (admin) {
      const actions = el('div','card-actions');
      const delBtn  = el('button','btn','삭제');
      delBtn.addEventListener('click', async ()=>{
        if (!confirm('삭제할까요?')) return;
        try { await colNotices().doc(it.id).delete(); }
        catch(e){ alert('삭제 실패: '+e.message); }
      });
      actions.append(delBtn);
      li.appendChild(actions);
    }
    noticeList.appendChild(li);
  });
}
function listenNotices(){
  colNotices().orderBy('createdAt','desc').onSnapshot(
    (snap)=>{
      const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
      renderNoticeList(arr);
    },
    (err)=>{ console.error(err); alert('공지 목록을 불러오지 못했습니다: '+err.message); }
  );
}
async function addNotice(){
  const user = auth.currentUser;
  if (!isAdminUser(user)) return alert('관리자만 추가할 수 있습니다.');
  const title = (nTitle && nTitle.value.trim()) || '';
  const kind  = (nKind && nKind.value) || 'notice';
  const body  = (nBody && nBody.value.trim()) || '';
  if (!title) return alert('제목을 입력하세요.');
  try{
    await colNotices().add({
      title, body, kind,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (nTitle) nTitle.value = '';
    if (nBody)  nBody.value  = '';
  }catch(e){ console.error(e); alert('추가 실패: '+e.message); }
}
if (nAddBtn) nAddBtn.addEventListener('click', addNotice);

/* ====== 공지 ON/OFF ====== */
async function pullNoticeToggle(){
  if (!noticeToggle) return;
  try{
    const snap = await docAppSettings().get();
    const show = snap.exists ? !!snap.data().showNotice : true;
    noticeToggle.checked = show;
    if ($noticeSection) $noticeSection.style.display = show ? '' : 'none';
  }catch(e){ console.error(e); }
}
if (noticeToggle) {
  noticeToggle.addEventListener('change', async (e)=>{
    const user = auth.currentUser;
    if (!isAdminUser(user)) {
      await pullNoticeToggle();
      return alert('관리자만 변경할 수 있습니다.');
    }
    const checked = !!e.target.checked;
    try{
      await docAppSettings().set({ showNotice: checked }, { merge:true });
      if ($noticeSection) $noticeSection.style.display = checked ? '' : 'none';
    }catch(err){ console.error(err); alert('설정 저장 실패: '+err.message); }
  });
}

/* ====== 시험/수행/숙제 ====== */
function renderTaskList(cat, docs){
  const ul = lists[cat]; if (!ul) return;
  ul.innerHTML = '';
  const admin = isAdminUser(auth.currentUser);
  docs.forEach((it)=>{
    const li = el('li','task');
    const subjLine    = el('div','title', it.subj || '(과목 없음)');
    const contentLine = el('div','content', it.text || '');
    const detail      = it.detail ? el('pre','detail', it.detail) : null;
    const startLike = it.startDate || it.startAt || it.date || it.dateAt || null;
    const endLike   = it.endDate   || it.endAt   || null;
    const startStr = startLike ? fmtDateK(startLike) : '';
    const endStr   = endLike   ? fmtDateK(endLike)   : '';
    let dateText = '';
    if (startStr && endStr) dateText = `${startStr} ~ ${endStr}`;
    else if (startStr)      dateText = startStr;
    const periodStr = it.period ? `${it.period}교시` : '';
    const combined  = (dateText && periodStr) ? `${dateText} ${periodStr}` : (dateText || periodStr);
    const dateLine = combined ? el('div','meta', '📅 ' + combined) : null;
    const dd = evalDDay(startLike, endLike);
    if (dd) {
      const badge = el('span', `dday ${dd.cls}`, dd.label);
      subjLine.append(' ', badge);
    }
    const wrap = el('div','task__main');
    wrap.append(subjLine, contentLine);
    if (detail) wrap.append(detail);
    if (dateLine) wrap.append(dateLine);
    li.appendChild(wrap);
    if (admin) {
      const actions = el('div','card-actions');
      const editBtn = el('button','btn','수정');
      const delBtn  = el('button','btn','삭제');
      editBtn.addEventListener('click', ()=> openEditModal(cat, it));
      delBtn.addEventListener('click', async ()=>{
        if (!confirm('삭제할까요?')) return;
        try { await colTask(cat).doc(it.id).delete(); }
        catch(e){ alert('삭제 실패: '+e.message); }
      });
      actions.append(editBtn, delBtn);
      li.appendChild(actions);
    }
    ul.appendChild(li);
  });
}
function listenTask(cat){
  colTask(cat).orderBy('createdAt','asc').onSnapshot(
    (snap)=>{
      const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
      arr.sort((a,b)=>{
        const A = _makeSortKey(a);
        const B = _makeSortKey(b);
        if (A.group !== B.group) return A.group - B.group;
        if (A.key   !== B.key)   return A.key   - B.key;
        return A.tiebreak - B.tiebreak;
      });
      renderTaskList(cat, arr);
    },
    (err)=>{ console.error(err); alert(`${cat} 목록을 불러오지 못했습니다: `+err.message); }
  );
}
function wireAddButtons(){
  addRows.forEach(row=>{
    const cat = row.getAttribute('data-cat');
    const subjEl   = $('.subj', row);
    const textEl   = $('.text', row);
    const startEl  = $('.date-start', row);
    const endEl    = $('.date-end', row);
    const periodEl = $('.period', row);
    const detailEl = $('.detail', row);
    const addBtn   = $('.add', row);
    if (!addBtn) return;
    addBtn.addEventListener('click', async ()=>{
      const user = auth.currentUser;
      if (!isAdminUser(user)) return alert('관리자만 추가할 수 있습니다.');
      const subj    = (subjEl?.value ?? '').trim();
      const text    = (textEl?.value ?? '').trim();
      const detail  = (detailEl?.value ?? '').trim();
      const sDate   = (startEl?.value ?? '').trim();
      const eDate   = (endEl?.value ?? '').trim();
      const period  = (periodEl?.value ?? '').trim();
      if (!subj) return alert('과목을 입력하세요.');
      const payload = { subj, text, detail, period,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (sDate) { payload.startDate = sDate; payload.startAt = toTsFromDateInput(sDate); }
      if (eDate) { payload.endDate = eDate; payload.endAt   = toTsFromDateInput(eDate); }
      try{
        await colTask(cat).add(payload);
        subjEl.value = textEl.value = detailEl.value = periodEl.value = '';
        if (startEl) startEl.value = '';
        if (endEl)   endEl.value   = '';
      }catch(e){ console.error(e); alert('추가 실패: '+e.message); }
    });
  });
}

/* ====== 수정 모달 ====== */
const modal     = $('#editModal');
const mSubj     = $('#mSubj');
const mText     = $('#mText');
const mDateStart= $('#mDateStart');
const mDateEnd  = $('#mDateEnd');
const mPeriod   = $('#mPeriod');
const mDetail   = $('#mDetail');
const btnSave   = $('#editSave');
const btnCancel = $('#editCancel');
const btnClose  = $('#editClose');
let editing = null;
function openEditModal(cat, item){
  editing = { cat, id: item.id };
  mSubj.value    = item.subj || '';
  mText.value    = item.text
