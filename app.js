/* ===============================
   app.js  (Firebase compat v9)
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
const PUBLIC_UID   = window.ENV.PUBLIC_UID || ADMIN_UIDS[0];

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

const appHeaderUserBox = document.createElement('div'); // 로그인 정보 표시용
appHeaderUserBox.className = 'muted';

/* ====== 유틸 ====== */
const $ = (s, r=document) => r.querySelector(s);
const el = (t,c,h)=>{const n=document.createElement(t); if(c)n.className=c; if(h!=null)n.innerHTML=h; return n;};
const fmtDate = (d)=>{ if(!d)return''; const dt=d.toDate?d.toDate():new Date(d);
  const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), day=String(dt.getDate()).padStart(2,'0');
  const w=['일','월','화','수','목','금','토'][dt.getDay()]; return `${y}-${m}-${day} (${w})`;
};

/* ====== Firestore refs ====== */
// ✅ 전달 사항: users/{uid}/notices
const colNotices = (uid=PUBLIC_UID)=> db.collection('users').doc(uid).collection('notices');
// 과제: users/{uid}/tasks/{cat}/items
const colTask    = (cat,uid=PUBLIC_UID)=> db.collection('users').doc(uid).collection('tasks').doc(cat).collection('items');
// 앱 설정: users/{uid}/settings/app
const docAppSettings = (uid=(ADMIN_UIDS[0]||PUBLIC_UID))=> db.collection('users').doc(uid).collection('settings').doc('app');

/* ====== 관리자 판정 ====== */
function isAdminUser(user){
  if(!user) return false;
  const byUid   = ADMIN_UIDS.includes(user.uid);
  const byEmail = user.email ? ADMIN_EMAILS.includes(user.email) : false;
  return byUid || byEmail;
}

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

  // 헤더 우측에 현재 로그인 정보 & 관리자 여부 표시
  const authBox = document.querySelector('.auth');
  if (authBox) {
    appHeaderUserBox.textContent = user
      ? `${user.displayName ?? '사용자'} | ${user.email ?? ''} | UID ${user.uid.slice(0,8)}… | ${admin?'관리자':'일반'}`
      : '로그인 필요';
    authBox.prepend(appHeaderUserBox);
  }

  if (loginBtn)  loginBtn.style.display  = user ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = user ? '' : 'none';

  // 관리자만 입력 폼 보이기
  if (noticeAddRow) noticeAddRow.style.display = admin ? 'grid' : 'none';

  await pullNoticeToggle();
  startListeners();
});

/* ====== 전달 사항 ====== */
function renderNoticeList(items){
  if (!noticeList) return;
  noticeList.innerHTML = '';
  if (!items || !items.length) return;

  items.forEach((it)=>{
    const li    = el('li', 'notice-card ' + (it.kind?`kind-${it.kind}`:''));
    const title = el('div','notice-title', it.title || '(제목 없음)');
    const meta  = el('div','notice-meta', it.createdAt ? fmtDate(it.createdAt) : '');
    if (it.body) li.append(title, meta, el('pre', null, it.body));
    else li.append(title, meta);

    // 삭제 버튼(관리자)
    const user = auth.currentUser;
    if (isAdminUser(user)) {
      const actions = el('div','card-actions');
      const delBtn  = el('button','btn','삭제');
      delBtn.addEventListener('click', async ()=>{
        if (!confirm('삭제할까요?')) return;
        try { await colNotices().doc(it.id).delete(); }
        catch(e){ alert('삭제 실패: '+e.message); }
      });
      actions.appendChild(delBtn);
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
    (err)=>{ console.error(err); alert('목록을 불러오지 못했습니다: '+err.message); }
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

/* ====== 공지 ON/OFF 설정 ====== */
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

/* ====== 과제(시험/수행/숙제) ====== */
function renderTaskList(cat, docs){
  const ul = lists[cat]; if (!ul) return;
  ul.innerHTML = '';
  docs.forEach((it)=>{
    const li = el('li','task');
    const head = el('div','task__main');
    head.append(
      el('div','title', (it.subj||'(과목 없음)') + (it.text?` · ${it.text}`:'')),
      el('div','meta', (it.start?fmtDate(it.start):'') + (it.end?` ~ ${fmtDate(it.end)}`:''))
    );
    if (it.detail) head.append(el('pre',null,it.detail));
    li.appendChild(head);

    const user = auth.currentUser;
    if (isAdminUser(user)) {
      const actions = el('div','card-actions');
      const delBtn  = el('button','btn','삭제');
      delBtn.addEventListener('click', async ()=>{
        if (!confirm('삭제할까요?')) return;
        try { await colTask(cat).doc(it.id).delete(); }
        catch(e){ alert('삭제 실패: '+e.message); }
      });
      actions.appendChild(delBtn);
      li.appendChild(actions);
    }
    ul.appendChild(li);
  });
}
function listenTask(cat){
  colTask(cat).orderBy('start','asc').onSnapshot(
    (snap)=>{
      const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
      renderTaskList(cat, arr);
    },
    (err)=>{ console.error(err); alert(`${cat} 목록을 불러오지 못했습니다: `+err.message); }
  );
}

/* ====== 시작 ====== */
let started=false;
function startListeners(){ if(started)return; started=true;
  listenNotices(); listenTask('exam'); listenTask('perf'); listenTask('home');
}
