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
const ADMIN_UIDS   = Array.isArray(window.ENV.ADMIN_UIDS) ? window.ENV.ADMIN_UIDS : [window.ENV.ADMIN_UID].filter(Boolean);
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

/* 관리자용 입력 폼 컨테이너들 */
const addRows = Array.from(document.querySelectorAll('.add-row[data-cat]'));

const userInfoBox = document.createElement('div');
userInfoBox.className = 'muted';

/* ====== 유틸 ====== */
const $ = (s, r=document) => r.querySelector(s);
const el = (t,c,h)=>{const n=document.createElement(t); if(c)n.className=c; if(h!=null)n.innerHTML=h; return n;};
const fmtDate = (d)=>{ if(!d)return''; const dt=d.toDate?d.toDate():new Date(d);
  const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), day=String(dt.getDate()).padStart(2,'0');
  const w=['일','월','화','수','목','금','토'][dt.getDay()]; return `${y}-${m}-${day} (${w})`;
};
const isAdminUser = (user)=>{
  if(!user) return false;
  return (ADMIN_UIDS && ADMIN_UIDS.includes(user.uid)) ||
         (user.email && ADMIN_EMAILS && ADMIN_EMAILS.includes(user.email));
};

/* ====== Firestore refs ====== */
// 공지: users/{uid}/notices
const colNotices = (uid=PUBLIC_UID)=> db.collection('users').doc(uid).collection('notices');
// 과제: users/{uid}/tasks/{cat}/items
const colTask    = (cat,uid=PUBLIC_UID)=> db.collection('users').doc(uid).collection('tasks').doc(cat).collection('items');
// 앱 설정: users/{uid}/settings/app
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

  // 헤더에 로그인 정보 표시
  const authBox = document.querySelector('.auth');
  if (authBox) {
    userInfoBox.textContent = user
      ? `${user.displayName ?? '사용자'} | ${user.email ?? ''} | UID ${user.uid.slice(0,8)}… | ${admin?'관리자':'일반'}`
      : '로그인 필요';
    authBox.prepend(userInfoBox);
  }

  if (loginBtn)  loginBtn.style.display  = user ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = user ? '' : 'none';

  // ✅ 관리자에게만 각 섹션의 추가 폼 보이기
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
    const meta  = el('div','notice-meta', it.createdAt ? fmtDate(it.createdAt) : '');
    if (it.body) li.append(title, meta, el('pre', null, it.body));
    else li.append(title, meta);

    if (admin) {
      const actions = el('div','card-actions');
      const editBtn = el('button','btn','수정');
      const delBtn  = el('button','btn','삭제');

      editBtn.addEventListener('click', async ()=>{
        const newTitle = prompt('제목', it.title || '');
        if (newTitle === null) return;
        const newBody  = prompt('상세 내용', it.body || '');
        if (newBody === null) return;
        const newKind  = prompt('종류(notice/info/alert)', it.kind || 'notice') || 'notice';
        try{
          await colNotices().doc(it.id).set(
            { title:newTitle.trim(), body:newBody.trim(), kind:newKind.trim(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge:true }
          );
        }catch(e){ alert('수정 실패: '+e.message); }
      });

      delBtn.addEventListener('click', async ()=>{
        if (!confirm('삭제할까요?')) return;
        try { await colNotices().doc(it.id).delete(); }
        catch(e){ alert('삭제 실패: '+e.message); }
      });

      actions.append(editBtn, delBtn);
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
/* 저장 필드: subj(과목) text(내용) detail(상세 내용) day(요일 문자열) createdAt/updatedAt */

function renderTaskList(cat, docs){
  const ul = lists[cat]; if (!ul) return;
  ul.innerHTML = '';
  const admin = isAdminUser(auth.currentUser);

  docs.forEach((it)=>{
    const li = el('li','task');

    const head = el('div','task__main');
    const titleLine = (it.subj || '(과목 없음)') + (it.text ? ` · ${it.text}` : '');
    head.append(
      el('div','title', titleLine),
      el('div','meta', it.day ? `요일: ${it.day}` : '')
    );
    if (it.detail) head.append(el('pre', null, it.detail));
    li.appendChild(head);

    if (admin) {
      const actions = el('div','card-actions');
      const editBtn = el('button','btn','수정');
      const delBtn  = el('button','btn','삭제');

      editBtn.addEventListener('click', async ()=>{
        const subj  = prompt('과목', it.subj || '') ?? it.subj;
        const text  = prompt('내용', it.text || '') ?? it.text;
        const day   = prompt('요일(월/화/수/목/금/토/일)', it.day || '') ?? it.day;
        const detail= prompt('상세 내용', it.detail || '') ?? it.detail;
        try{
          await colTask(cat).doc(it.id).set(
            {
              subj: (subj??'').trim(),
              text: (text??'').trim(),
              day:  (day??'').trim(),
              detail: (detail??'').trim(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            { merge:true }
          );
        }catch(e){ alert('수정 실패: '+e.message); }
      });

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

/* ✅ 섹션별 "추가" 버튼 동작: 과목/내용/상세/요일 저장 */
function wireAddButtons(){
  addRows.forEach(row=>{
    const cat = row.getAttribute('data-cat'); // exam/perf/home
    const subjEl   = $('.subj', row);
    const textEl   = $('.text', row);
    const detailEl = $('.detail', row);
    const dowEl    = $('.dow', row);       // 요일 select
    const addBtn   = $('.add', row);

    if (!addBtn) return;
    addBtn.addEventListener('click', async ()=>{
      const user = auth.currentUser;
      if (!isAdminUser(user)) return alert('관리자만 추가할 수 있습니다.');
      const subj  = (subjEl?.value ?? '').trim();
      const text  = (textEl?.value ?? '').trim();
      const detail= (detailEl?.value ?? '').trim();
      const day   = (dowEl?.value ?? '').trim();

      if (!subj) return alert('과목을 입력하세요.');
      try{
        await colTask(cat).add({
          subj, text, detail, day,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (subjEl) subjEl.value = '';
        if (textEl) textEl.value = '';
        if (detailEl) detailEl.value = '';
        if (dowEl) dowEl.value = '';
      }catch(e){ console.error(e); alert('추가 실패: '+e.message); }
    });
  });
}

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
