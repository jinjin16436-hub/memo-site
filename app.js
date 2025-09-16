/* ===============================
   app.js  (Firebase compat v9)
   =============================== */

/* ====== 0) 환경값 체크 ====== */
if (!window.ENV || !window.ENV.FIREBASE || !window.ENV.ADMIN_UID) {
  alert('환경설정(ENV)이 없습니다. env.js를 확인하세요.');
}

/* ====== 1) Firebase 초기화 ====== */
firebase.initializeApp(window.ENV.FIREBASE);
const auth = firebase.auth();
const db   = firebase.firestore();

/* ====== 2) 상수/상태 ====== */
const ADMIN_UID  = window.ENV.ADMIN_UID;                        // 관리자 UID
const PUBLIC_UID = window.ENV.PUBLIC_UID || window.ENV.ADMIN_UID; // 읽기 공개 UID

let currentUser = null;
let isAdmin     = false;

/* ====== 3) DOM ====== */
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

/* ====== 4) 유틸 ====== */
function $(sel, root = document) { return root.querySelector(sel); }
function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}
function fmtDate(d) {
  if (!d) return '';
  const dt = d.toDate ? d.toDate() : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const day = String(dt.getDate()).padStart(2,'0');
  const w = ['일','월','화','수','목','금','토'][dt.getDay()];
  return `${y}-${m}-${day} (${w})`;
}

/* ====== 5) Firestore 참조 ====== */
// ✅ 전달 사항: users/{uid}/notices  (items 같은 하위 컬렉션 사용 금지!)
function colNotices(uid = PUBLIC_UID) {
  return db.collection('users').doc(uid).collection('notices');
}
// 과제: users/{uid}/tasks/{cat}/items
function colTask(cat, uid = PUBLIC_UID) {
  return db.collection('users').doc(uid).collection('tasks').doc(cat).collection('items');
}
// 앱 설정: users/{uid}/settings/app
function docAppSettings(uid = ADMIN_UID) {
  return db.collection('users').doc(uid).collection('settings').doc('app');
}

/* ====== 6) Auth ====== */
async function signIn() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    console.error(e);
    alert('로그인 실패: ' + e.message);
  }
}
async function signOut() { await auth.signOut(); }

auth.onAuthStateChanged(async (user) => {
  currentUser = user || null;
  isAdmin = !!(currentUser && currentUser.uid === ADMIN_UID);

  if (loginBtn)  loginBtn.style.display  = currentUser ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = currentUser ? '' : 'none';
  if (noticeAddRow) noticeAddRow.style.display = isAdmin ? 'grid' : 'none';

  await pullNoticeToggle();
  startListeners();
});

if (loginBtn)  loginBtn.addEventListener('click', signIn);
if (logoutBtn) logoutBtn.addEventListener('click', signOut);

/* ====== 7) 전달 사항 ====== */
function renderNoticeList(items) {
  if (!noticeList) return;
  noticeList.innerHTML = '';
  if (!items || !items.length) return;

  items.forEach((it) => {
    const li = el('li', 'notice-card ' + (it.kind ? `kind-${it.kind}` : ''));
    const title = el('div', 'notice-title', it.title || '(제목 없음)');
    const meta  = el('div', 'notice-meta', it.createdAt ? fmtDate(it.createdAt) : '');
    const pre   = el('pre', null, it.body || '');
    li.append(title, meta);
    if (it.body) li.append(pre);

    if (isAdmin) {
      const actions = el('div', 'card-actions');
      const btnDel = el('button', 'btn', '삭제');
      btnDel.addEventListener('click', async () => {
        if (!confirm('삭제할까요?')) return;
        try { await colNotices().doc(it.id).delete(); }
        catch (e) { alert('삭제 실패: ' + e.message); }
      });
      actions.appendChild(btnDel);
      li.appendChild(actions);
    }
    noticeList.appendChild(li);
  });
}

function listenNotices() {
  colNotices()
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        renderNoticeList(arr);
      },
      (err) => {
        console.error(err);
        alert('목록을 불러오지 못했습니다: ' + err.message);
      }
    );
}

async function addNotice() {
  if (!isAdmin) return alert('관리자만 추가할 수 있습니다.');
  const title = (nTitle && nTitle.value.trim()) || '';
  const kind  = (nKind && nKind.value) || 'notice';
  const body  = (nBody && nBody.value.trim()) || '';
  if (!title) return alert('제목을 입력하세요.');

  try {
    await colNotices().add({
      title, body, kind,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (nTitle) nTitle.value = '';
    if (nBody)  nBody.value  = '';
  } catch (e) {
    console.error(e);
    alert('추가 실패: ' + e.message);
  }
}
if (nAddBtn) nAddBtn.addEventListener('click', addNotice);

/* ====== 8) 앱 설정 (전달 사항 ON/OFF) ====== */
async function pullNoticeToggle() {
  if (!noticeToggle) return;
  try {
    const snap = await docAppSettings().get();
    const show = snap.exists ? !!snap.data().showNotice : true;
    noticeToggle.checked = show;
    if ($noticeSection) $noticeSection.style.display = show ? '' : 'none';
  } catch (e) { console.error(e); }
}

if (noticeToggle) {
  noticeToggle.addEventListener('change', async (e) => {
    const checked = !!e.target.checked;
    if (!isAdmin) {
      await pullNoticeToggle();
      return alert('관리자만 변경할 수 있습니다.');
    }
    try {
      await docAppSettings().set({ showNotice: checked }, { merge: true });
      if ($noticeSection) $noticeSection.style.display = checked ? '' : 'none';
    } catch (err) {
      console.error(err);
      alert('설정 저장 실패: ' + err.message);
    }
  });
}

/* ====== 9) 숙제/수행/시험 ====== */
function renderTaskList(cat, docs) {
  const ul = lists[cat];
  if (!ul) return;
  ul.innerHTML = '';

  docs.forEach((it) => {
    const li = el('li', 'task');
    const head = el('div', 'task__main');
    const t1 = el('div', 'title', (it.subj || '(과목 없음)') + (it.text ? ` · ${it.text}` : ''));
    const dateLine = el('div', 'meta', (it.start ? fmtDate(it.start) : '') + (it.end ? ' ~ ' + fmtDate(it.end) : ''));
    head.append(t1, dateLine);
    if (it.detail) head.append(el('pre', null, it.detail));
    li.appendChild(head);

    if (isAdmin) {
      const actions = el('div', 'card-actions');
      const delBtn  = el('button', 'btn', '삭제');
      delBtn.addEventListener('click', async () => {
        if (!confirm('삭제할까요?')) return;
        try { await colTask(cat).doc(it.id).delete(); }
        catch (e) { alert('삭제 실패: ' + e.message); }
      });
      actions.appendChild(delBtn);
      li.appendChild(actions);
    }
    ul.appendChild(li);
  });
}

function listenTask(cat) {
  colTask(cat)
    .orderBy('start', 'asc')
    .onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        renderTaskList(cat, arr);
      },
      (err) => {
        console.error(err);
        alert(`${cat} 목록을 불러오지 못했습니다: ` + err.message);
      }
    );
}

/* ====== 10) 리스너 시작 ====== */
let started = false;
function startListeners() {
  if (started) return; started = true;
  listenNotices();
  listenTask('exam');
  listenTask('perf');
  listenTask('home');
}

/* ====== 11) 섹션 토글 ====== */
window.toggleSection = function(id) {
  const box = document.getElementById(id);
  if (!box) return;
  box.classList.toggle('open');
};
