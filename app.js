/* ===============================
   app.js (Firebase compat v9)
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
  if (d?.toDate) dt = d.toDate();          // Firestore Timestamp
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
// D-day 계산: (대상날짜 - 오늘0시) 일수
function calcDDay(dateLike){
  if (!dateLike) return null;
  const dt = dateLike?.toDate ? dateLike.toDate() : new Date(dateLike);
  if (Number.isNaN(dt.getTime())) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dt); target.setHours(0,0,0,0);
  const diff = Math.round((target - today) / (24*60*60*1000)); // 일수
  return diff; // 음수면 지남, 0이면 D-day
}
function ddayBadge(diff){
  if (diff == null) return null;
  let label = diff > 0 ? `D-${diff}` : (diff === 0 ? 'D-day' : `D+${Math.abs(diff)}`);
  let cls   = diff < 0 ? 'red' : diff === 0 ? 'orange' : diff <= 7 ? 'yellow' : 'green';
  const span = el('span', `dday ${cls}`, label);
  return span;
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

    // 표시 순서: 과목 → 내용 → 상세 → 날짜(요일) + D-day
    const subjLine    = el('div','title', it.subj || '(과목 없음)');
    const contentLine = el('div','content', it.text || '');
    const detail      = it.detail ? el('pre','detail', it.detail) : null;

    const whenDate = it.date ? it.date : (it.dateAt ? it.dateAt : null);
    const whenStr  = whenDate ? fmtDateK(whenDate) : '';
    const dateLine = whenStr ? el('div','meta', whenStr) : null;

    // D-day
    const diff = calcDDay(whenDate);
    const badge = ddayBadge(diff);
    if (badge) { subjLine.append(' ', badge); }

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
    const dateEl   = $('.date', row);
    const detailEl = $('.detail', row);
    const addBtn   = $('.add', row);

    if (!addBtn) return;
    addBtn.addEventListener('click', async ()=>{
      const user = auth.currentUser;
      if (!isAdminUser(user)) return alert('관리자만 추가할 수 있습니다.');

      const subj   = (subjEl?.value ?? '').trim();
      const text   = (textEl?.value ?? '').trim();
      const detail = (detailEl?.value ?? '').trim();
      const dateStr= (dateEl?.value ?? '').trim();
      if (!subj) return alert('과목을 입력하세요.');

      const payload = {
        subj, text, detail,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (dateStr) {
        payload.date   = dateStr;
        payload.dateAt = toTsFromDateInput(dateStr);
      }

      try{
        await colTask(cat).add(payload);
        if (subjEl) subjEl.value = '';
        if (textEl) textEl.value = '';
        if (detailEl) detailEl.value = '';
        if (dateEl) dateEl.value = '';
      }catch(e){ console.error(e); alert('추가 실패: '+e.message); }
    });
  });
}

/* ====== 수정 모달 ====== */
const modal = $('#editModal');
const mSubj = $('#mSubj');
const mText = $('#mText');
const mDate = $('#mDate');
const mDetail = $('#mDetail');
const btnSave = $('#editSave');
const btnCancel = $('#editCancel');
const btnClose = $('#editClose');

let editing = null; // {cat, id}

function openEditModal(cat, item){
  editing = { cat, id: item.id };
  mSubj.value   = item.subj || '';
  mText.value   = item.text || '';
  mDetail.value = item.detail || '';
  // date string 우선, 없으면 Timestamp → YYYY-MM-DD
  let cur = item.date ? (typeof item.date === 'string' ? item.date : '') :
            (item.dateAt?.toDate ? item.dateAt.toDate().toISOString().slice(0,10) : '');
  mDate.value = cur || '';
  modal.classList.add('show');
}
function closeEditModal(){
  modal.classList.remove('show');
  editing = null;
}
if (btnCancel) btnCancel.addEventListener('click', closeEditModal);
if (btnClose)  btnClose.addEventListener('click', closeEditModal);
if (modal)     modal.addEventListener('click', (e)=>{ if (e.target === modal) closeEditModal(); });

if (btnSave) btnSave.addEventListener('click', async ()=>{
  if (!editing) return;
  const user = auth.currentUser;
  if (!isAdminUser(user)) { alert('관리자만 수정할 수 있습니다.'); return; }

  const subj   = mSubj.value.trim();
  const text   = mText.value.trim();
  const detail = mDetail.value.trim();
  const dateStr= mDate.value.trim();

  try{
    const payload = {
      subj, text, detail,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (dateStr) {
      payload.date   = dateStr;
      payload.dateAt = toTsFromDateInput(dateStr);
    } else {
      payload.date   = firebase.firestore.FieldValue.delete();
      payload.dateAt = firebase.firestore.FieldValue.delete();
    }
    await colTask(editing.cat).doc(editing.id).set(payload, { merge:true });
    closeEditModal();
  }catch(e){ console.error(e); alert('수정 실패: '+e.message); }
});

/* ====== 시작 ====== */
let started=false;
function startListeners(){
  if(started) return; started = true;
  listenNotices();
  listenTask('exam'); listenTask('perf'); listenTask('home');
  wireAddButtons();
}

/* ====== 섹션 토글 ====== */
window.toggleSection = function(id){
  const box = document.getElementById(id);
  if (!box) return;
  box.classList.toggle('open');
};
