/* ===============================
   app.js  (Firebase compat 버전)
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
const ADMIN_UID  = window.ENV.ADMIN_UID;    // 관리자 UID
const PUBLIC_UID = window.ENV.PUBLIC_UID || ADMIN_UID; // 공개 읽기용 UID(없으면 관리자 UID 재사용)

let currentUser = null;
let isAdmin     = false;

/* ====== 3) DOM 캐시 ====== */
// 공통
const loginBtn  = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

// ===== 전달 사항 =====
const $noticeSection  = document.getElementById('sec_notice') || document.querySelector('#sec_notice, [data-sec="notice"]');
const noticeToggle    = document.getElementById('noticeToggle');
const noticeAddRow    = document.getElementById('noticeAddRow');
const noticeList      = document.getElementById('notice_list');

// 관리자 입력 폼(전달 사항)
const nTitle   = document.getElementById('nTitle');
const nKind    = document.getElementById('nKind');
const nBody    = document.getElementById('nBody');
const nAddBtn  = document.getElementById('nAddBtn');

// ===== 각 카테고리 =====
const lists = {
  exam: document.getElementById('list_exam'),
  perf: document.getElementById('list_perf'),
  home: document.getElementById('list_home'),
};

/* ====== 4) 유틸 ====== */
function $(sel, root = document) {
  return root.querySelector(sel);
}
function fmtDate(d) {
  if (!d) return '';
  const dt = d.toDate ? d.toDate() : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const wNames = ['일', '월', '화', '수', '목', '금', '토'];
  const w = wNames[dt.getDay()];
  return `${y}-${m}-${day} (${w})`;
}
function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

/* ====== 5) Firestore Ref ====== */
// 전달 사항 컬렉션: users/{uid}/notices
function colNotices(uid = PUBLIC_UID) {
  return db.collection('users').doc(uid).collection('notices');
}

// tasks/{cat}/items: users/{uid}/tasks/{cat}/items
function colTask(cat, uid = PUBLIC_UID) {
  // ❗중요: 컬렉션/문서/컬렉션 순서로 체이닝
  return db.collection('users').doc(uid).collection('tasks').doc(cat).collection('items');
}

// 앱 설정: users/{uid}/settings/app (문서)
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
async function signOut() {
  await auth.signOut();
}

auth.onAuthStateChanged(async (user) => {
  currentUser = user || null;
  isAdmin = !!(currentUser && currentUser.uid === ADMIN_UID);

  // 버튼 표시
  if (loginBtn)  loginBtn.style.display  = currentUser ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = currentUser ? '' : 'none';

  // 전달 사항 입력폼(관리자만)
  if (noticeAddRow) noticeAddRow.style.display = isAdmin ? 'grid' : 'none';

  // 설정 동기화
  await pullNoticeToggle();

  // 리스너 시작
  startListeners();
});

if (loginBtn)  loginBtn.addEventListener('click', signIn);
if (logoutBtn) logoutBtn.addEventListener('click', signOut);

/* ====== 7) 전달 사항 (공지/안내/알림) ====== */
function renderNoticeList(items) {
  if (!noticeList) return;
  noticeList.innerHTML = '';
  if (!items || !items.length) return;

  items.forEach((it) => {
    const li = el('li', 'notice-card ' + (it.kind ? `kind-${it.kind}` : ''));
    const title = el('div', 'notice-title', it.title || '(제목 없음)');
    const meta  = el('div', 'notice-meta', it.createdAt ? fmtDate(it.createdAt) : '');
    const pre   = el('pre', null, it.body || '');
    li.appendChild(title);
    li.appendChild(meta);
    if (it.body) li.appendChild(pre);

    if (isAdmin) {
      const actions = el('div', 'card-actions');
      const btnDel = el('button', 'btn', '삭제');
      btnDel.addEventListener('click', async () => {
        if (!confirm('삭제할까요?')) return;
        try {
          await colNotices().doc(it.id).delete();
        } catch (e) {
          alert('삭제 실패: ' + e.message);
        }
      });
      actions.appendChild(btnDel);
      li.appendChild(actions);
    }

    noticeList.appendChild(li);
  });
}

function listenNotices() {
  // 최신순
  colNotices()
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((doc) => arr.push({ id: doc.id, ...doc.data() }));
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
  const kind  = (nKind && nKind.value) || 'notice'; // notice/info/alert
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

    // 섹션 show/hide
    if ($noticeSection) {
      $noticeSection.style.display = show ? '' : 'none';
    }
  } catch (e) {
    console.error(e);
  }
}

if (noticeToggle) {
  noticeToggle.addEventListener('change', async (e) => {
    const checked = !!e.target.checked;
    // 관리자만 변경 가능
    if (!isAdmin) {
      // 비관리자는 토글을 건드리지 못하게 되돌림
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

    // 상단 제목/디데이
    const head = el('div', 'task__main');
    const t1 = el('div', 'title', (it.subj || '(과목 없음)') + (it.text ? ` · ${it.text}` : ''));
    head.appendChild(t1);

    // 날짜 구간
    const dateLine = el(
      'div',
      'meta',
      (it.start ? fmtDate(it.start) : '') +
        (it.end ? ' ~ ' + fmtDate(it.end) : '')
    );
    head.appendChild(dateLine);

    // 상세
    if (it.detail) {
      const pre = el('pre', null, it.detail);
      head.appendChild(pre);
    }

    li.appendChild(head);

    // 관리자 버튼
    if (isAdmin) {
      const actions = el('div', 'card-actions');
      const delBtn  = el('button', 'btn', '삭제');
      delBtn.addEventListener('click', async () => {
        if (!confirm('삭제할까요?')) return;
        try {
          await colTask(cat).doc(it.id).delete();
        } catch (e) {
          alert('삭제 실패: ' + e.message);
        }
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
  if (started) return;
  started = true;

  // 전달 사항
  listenNotices();

  // 시험/수행/숙제
  listenTask('exam');
  listenTask('perf');
  listenTask('home');
}

/* ====== 11) (선택) 섹션 토글 버튼 ====== */
window.toggleSection = function(id) {
  const box = document.getElementById(id);
  if (!box) return;
  box.classList.toggle('open');
};
