/* app.js - v1.1.4 */

// ===== 안전 체크: env.js 선 로드 =====
if (!window.firebaseConfig) {
  alert("firebaseConfig가 로드되지 않았어요. env.js 순서를 확인해주세요.");
  throw new Error("Missing firebaseConfig");
}

const {
  firebaseConfig,
  PUBLIC_UID,
  ADMIN_UIDS = [],
} = window;

// ===== Firebase 초기화 =====
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ===== 상태 변수 =====
let currentUser = null;
let isAdmin = false;
const noticesEnabledKey = `notices_enabled_${PUBLIC_UID}`;

// ===== UI 엘리먼트 =====
const $ = (sel, root = document) => root.querySelector(sel);

const userInfo  = $('#userInfo');
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');

// 리스트
const listNotice   = $('#list_notice');
const listExam     = $('#list_exam');
const listTask     = $('#list_task');
const listHomework = $('#list_homework');

// 토글
const toggleNotices = $('#toggleNotices');

// 추가 폼(전달)
const nTitle = $('#nTitle');
const nKind  = $('#nKind');
const nBody  = $('#nBody');
const nAddBtn= $('#nAddBtn');

// 추가 폼(시험)
const eName   = $('#eName');
const eDetail = $('#eDetail');
const eStart  = $('#eStart');
const eEnd    = $('#eEnd');
const ePeriod = $('#ePeriod');
const eAddBtn = $('#eAddBtn');

// 추가 폼(수행)
const tSubj   = $('#tSubj');
const tTitle  = $('#tTitle');
const tDetail = $('#tDetail');
const tStart  = $('#tStart');
const tEnd    = $('#tEnd');
const tPeriod = $('#tPeriod');
const tAddBtn = $('#tAddBtn');

// 추가 폼(숙제)
const hSubj   = $('#hSubj');
const hTitle  = $('#hTitle');
const hDetail = $('#hDetail');
const hStart  = $('#hStart');
const hEnd    = $('#hEnd');
const hPeriod = $('#hPeriod');
const hAddBtn = $('#hAddBtn');

// ===== 유틸 =====
const el = (name, attrs={}) => {
  const node = document.createElement(name);
  Object.entries(attrs).forEach(([k,v]) => node.setAttribute(k,v));
  return node;
};
const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y=d.getFullYear(), m=d.getMonth()+1, dd=d.getDate();
  const w = ['일','월','화','수','목','금','토'][d.getDay()];
  const pad = n => String(n).padStart(2,'0');
  return `${y}-${pad(m)}-${pad(dd)} (${w})`;
};
const fmtRange = (s,e)=>{
  if(!s && !e) return '';
  if(s && !e) return `${fmtDate(s)}`;
  if(!s && e) return `${fmtDate(e)}`;
  return `${fmtDate(s)} ~ ${fmtDate(e)}`;
};
// 기존 ddayBadge 교체
const ddayBadge = (start, end) => {
  // Timestamp | Date | "YYYY-MM-DD" 모두 허용
  const toDate0 = (v) => {
    if (!v) return null;
    const d = v.toDate ? v.toDate() : new Date(v);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };

  const start0 = toDate0(start);
  const end0   = toDate0(end);

  if (!start0 && !end0) return "";

  // 오늘 00:00 기준
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1) 종료 판정
  if (end0) {
    if (today0 > end0) return `<span class="dday gray">종료</span>`;
  } else {
    if (start0 && today0 > start0) return `<span class="dday gray">종료</span>`;
  }

  // 2) 진행중 (기간형일 때만)
  if (end0 && today0 >= start0 && today0 <= end0) {
    return `<span class="dday green">진행중</span>`;
  }

  // 3) 남은 일수 (시작일 기준)
  const diff = Math.round((start0 - today0) / (1000 * 60 * 60 * 24));
  if (diff === 0) return `<span class="dday red">D-DAY</span>`;
  if (diff <= 2)  return `<span class="dday orange">D-${diff}</span>`;
  if (diff <= 7)  return `<span class="dday yellow">D-${diff}</span>`;
  return `<span class="dday green">D-${diff}</span>`;
};

// ===== 권한 표시 =====
const applyAdminUI = () => {
  if (isAdmin) document.body.classList.add('is-admin');
  else document.body.classList.remove('is-admin');
};

// ===== 로그인 / 로그아웃 =====
loginBtn.addEventListener('click', async ()=>{
  await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
});
logoutBtn.addEventListener('click', async ()=>{
  await auth.signOut();
});

auth.onAuthStateChanged(async (u)=>{
  currentUser = u;
  isAdmin = !!(u && ADMIN_UIDS.includes(u.uid));
  userInfo.textContent = isAdmin
    ? `${u.displayName} (관리자)`
    : (u ? u.email : '로그인 필요');

  loginBtn.style.display  = u ? 'none' : '';
  logoutBtn.style.display = u ? '' : 'none';

  applyAdminUI();

  // 데이터 로드
  await Promise.all([
    safeLoadNotices(),
    safeLoadTasks('exams'),
    safeLoadTasks('tasks'),
    safeLoadTasks('homeworks'),
  ]);
});

// ===== 전달 사항 ON/OFF 저장/로드 =====
toggleNotices.addEventListener('change', async ()=>{
  if(!isAdmin) return;
  const on = toggleNotices.checked;
  await db.doc(`users/${PUBLIC_UID}/settings/app`).set({ showNotices: on }, {merge:true});
});

const loadNoticeSwitch = async ()=>{
  try{
    const doc = await db.doc(`users/${PUBLIC_UID}/settings/app`).get();
    const on = doc.exists && doc.data().showNotices !== false;
    toggleNotices.checked = !!on;
    $('#sec_notice .section-body').style.display = on ? '' : 'none';
  }catch(e){
    // 기본 ON
    toggleNotices.checked = true;
  }
};
$('#sec_notice .section-head').addEventListener('click', ()=>{
  if (!isAdmin) return; // 관리자만 토글
  toggleNotices.click();
  $('#sec_notice .section-body').style.display = toggleNotices.checked ? '' : 'none';
});

// ===== 공용: 카드를 그릴 때 날짜옆에 교시 붙이기 =====
const renderMeta = (startDate,endDate,period) => {
  const range = fmtRange(startDate,endDate);
  const periodTxt = period ? ` (${period})` : '';
  return (range || period) ? `<div class="meta">${range}${periodTxt}</div>` : '';
};

// ===== 전달 사항 로드/추가/수정/삭제 =====
const safeLoadNotices = async ()=>{
  await loadNoticeSwitch();
  listNotice.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/notices`).orderBy('createdAt','desc').get();
    if(snap.empty){
      listNotice.innerHTML = '<li class="meta">등록된 전달 사항이 없습니다.</li>';
      return;
    }
    snap.forEach(doc=>{
      const d = doc.data();
      const li = el('li', {class:`notice-card kind-${d.kind || 'notice'}`});
      li.innerHTML = `
        <div class="title">${d.title || '(제목 없음)'}</div>
        ${d.body ? `<div class="content"><pre>${d.body}</pre></div>` : ''}
        ${renderMeta(d.startDate, d.endDate, d.period)}
      `;

      if (isAdmin) {
        const row = el('div');
        const b1 = el('button',{class:'btn'}); b1.textContent='수정';
        const b2 = el('button',{class:'btn'}); b2.textContent='삭제';
        b1.addEventListener('click',()=> openNoticeEdit(doc.id, d));
        b2.addEventListener('click',()=> delNotice(doc.id));
        row.append(b1,b2);
        li.appendChild(row);
      }

      listNotice.appendChild(li);
    });
  }catch(err){
    listNotice.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`;
  }
};

nAddBtn.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    title: nTitle.value.trim(),
    kind:  nKind.value,
    body:  nBody.value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/notices`).add(payload);
  nTitle.value=''; nBody.value='';
  await safeLoadNotices();
});

const delNotice = async (id)=>{
  if(!confirm('삭제할까요?')) return;
  await db.doc(`users/${PUBLIC_UID}/notices/${id}`).delete();
  await safeLoadNotices();
};
// (수정 모달은 아래 공통 모달에 포함)

// ===== 시험/수행/숙제 로드 =====
const safeLoadTasks = async (cat)=>{
  const ul = cat==='exams' ? listExam : (cat==='tasks' ? listTask : listHomework);
  ul.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).get();
    if(snap.empty){
      ul.innerHTML = `<li class="meta">등록된 ${cat==='exams'?'시험':cat==='tasks'?'수행평가':'숙제'}가 없습니다.</li>`;
      return;
    }

    // --- 데이터 배열화 ---
    const docs = [];
    snap.forEach(doc => {
      docs.push({ id: doc.id, data: doc.data() });
    });

    // --- 디데이 기준 정렬 ---
    docs.sort((a, b) => {
      const today = new Date(); today.setHours(0,0,0,0);
      const toDay0 = (v) => {
        if (!v) return null;
        const d = v.toDate ? v.toDate() : new Date(v);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      };
      const sa = toDay0(a.data.startDate);
      const ea = toDay0(a.data.endDate);
      const sb = toDay0(b.data.startDate);
      const eb = toDay0(b.data.endDate);

      // 남은 일수 계산
      const left = (s,e)=>{
        if(!s && !e) return 99999; // 날짜 없으면 뒤로
        if(e && today > e) return 99999; // 종료된 건 뒤로
        const base = s || e;
        return Math.floor((base - today)/(1000*60*60*24));
      };

      return left(sa,ea) - left(sb,eb);
    });

    // --- 렌더링 ---
    docs.forEach(({id,data})=>{
      const title = (cat==='exams' ? (data.name || '시험') : (data.subject || '과목 없음'));
      const dday  = ddayBadge(data.startDate, data.endDate);

      const li = el('li',{class:'task'});
      li.innerHTML = `
        <div class="title">${title} ${dday}</div>
        ${data.content ? `<div class="content"><pre>${data.content}</pre></div>` : ''}
        ${data.detail  ? `<div class="content"><pre>${data.detail}</pre></div>` : ''}
        ${renderMeta(data.startDate, data.endDate, data.period)}
      `;

      if (isAdmin) {
        const row = el('div');
        const b1 = el('button',{class:'btn'}); b1.textContent='수정';
        const b2 = el('button',{class:'btn'}); b2.textContent='삭제';
        b1.addEventListener('click',()=> openTaskEdit(cat, id, data));
        b2.addEventListener('click',()=> delTask(cat, id));
        row.append(b1,b2);
        li.appendChild(row);
      }

      ul.appendChild(li);
    });

  }catch(err){
    ul.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`;
  }
};

// ===== 추가(시험/수행/숙제) =====
eAddBtn.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    name: eName.value.trim(),
    detail: eDetail.value.trim(),
    startDate: eStart.value ? new Date(eStart.value) : null,
    endDate:   eEnd.value   ? new Date(eEnd.value)   : null,
    period: ePeriod.value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/exams/items`).add(payload);
  eName.value = eDetail.value = ePeriod.value = '';
  eStart.value = eEnd.value = '';
  await safeLoadTasks('exams');
});

tAddBtn.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    subject: tSubj.value.trim(),
    content: tTitle.value.trim(),
    detail: tDetail.value.trim(),
    startDate: tStart.value ? new Date(tStart.value) : null,
    endDate:   tEnd.value   ? new Date(tEnd.value)   : null,
    period: tPeriod.value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/tasks/items`).add(payload);
  tSubj.value=tTitle.value=tDetail.value=tPeriod.value='';
  tStart.value=tEnd.value='';
  await safeLoadTasks('tasks');
});

hAddBtn.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    subject: hSubj.value.trim(),
    content: hTitle.value.trim(),
    detail: hDetail.value.trim(),
    startDate: hStart.value ? new Date(hStart.value) : null,
    endDate:   hEnd.value   ? new Date(hEnd.value)   : null,
    period: hPeriod.value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/homeworks/items`).add(payload);
  hSubj.value=hTitle.value=hDetail.value=hPeriod.value='';
  hStart.value=hEnd.value='';
  await safeLoadTasks('homeworks');
});

// ===== 삭제 =====
const delTask = async (cat, id)=>{
  if(!confirm('삭제할까요?')) return;
  await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).delete();
  await safeLoadTasks(cat);
};

// === 수정 모달 ===
const modalRoot = document.querySelector('#modal-root');

const openNoticeEdit = (id, data)=>{
  if(!isAdmin) return;
  modalRoot.innerHTML = `
    <div class="modal show" id="m">
      <div class="modal__dialog">
        <div class="modal__head">
          <strong>전달 사항 수정</strong>
          <button class="modal__close" id="mClose">닫기</button>
        </div>
        <div class="modal__body">
          <div class="form-grid">
            <label class="full">제목
              <input id="mTitle" value="${data.title || ''}">
            </label>
            <label>분류
              <select id="mKind">
                <option value="notice" ${data.kind==='notice'?'selected':''}>공지(빨강)</option>
                <option value="info"   ${data.kind==='info'  ?'selected':''}>안내(노랑)</option>
                <option value="alert"  ${data.kind==='alert' ?'selected':''}>참고(초록)</option>
              </select>
            </label>
            <label class="full">내용
              <textarea id="mBody">${data.body || ''}</textarea>
            </label>
          </div>
        </div>
        <div class="modal__foot">
          <button class="btn btn--ghost" id="mCancel">취소</button>
          <button class="btn btn--primary" id="mSave">저장</button>
        </div>
      </div>
    </div>`;
  const close = ()=> modalRoot.innerHTML='';
  document.getElementById('mClose').onclick = document.getElementById('mCancel').onclick = close;
  document.getElementById('mSave').onclick = async ()=>{
    await db.doc(`users/${PUBLIC_UID}/notices/${id}`).update({
      title: document.getElementById('mTitle').value.trim(),
      kind:  document.getElementById('mKind').value,
      body:  document.getElementById('mBody').value.trim()
    });
    close();
    await safeLoadNotices();
  };
};

const openTaskEdit = (cat, id, data)=>{
  if(!isAdmin) return;
  const withSubj = (cat!=='exams');
  modalRoot.innerHTML = `
    <div class="modal show" id="m">
      <div class="modal__dialog">
        <div class="modal__head">
          <strong>항목 수정</strong>
          <button class="modal__close" id="mClose">닫기</button>
        </div>
        <div class="modal__body">
          <div class="form-grid">
            ${withSubj ? `
            <label>과목
              <input id="mSubj" value="${data.subject||''}">
            </label>`:``}
            <label>${cat==='exams'?'시험 이름':'내용'}
              <input id="mTitle" value="${(cat==='exams'?data.name:data.content)||''}">
            </label>
            <label class="full">상세 내용
              <textarea id="mDetail">${data.detail||''}</textarea>
            </label>
            <label>시작일
              <input id="mStart" type="date" value="${toDateInputValue(data.startDate)}">
            </label>
            <label>종료일
              <input id="mEnd" type="date" value="${toDateInputValue(data.endDate)}">
            </label>
            <label>교시/시간
              <input id="mPeriod" value="${data.period||''}">
            </label>
          </div>
        </div>
        <div class="modal__foot">
          <button class="btn btn--ghost" id="mCancel">취소</button>
          <button class="btn btn--primary" id="mSave">저장</button>
        </div>
      </div>
    </div>`;
  const close = ()=> modalRoot.innerHTML='';
  document.getElementById('mClose').onclick = document.getElementById('mCancel').onclick = close;
  document.getElementById('mSave').onclick = async ()=>{
    const payload = {
      detail: document.getElementById('mDetail').value.trim(),
      startDate: document.getElementById('mStart').value ? new Date(document.getElementById('mStart').value) : null,
      endDate:   document.getElementById('mEnd').value   ? new Date(document.getElementById('mEnd').value)   : null,
      period: document.getElementById('mPeriod').value.trim()
    };
    if(cat==='exams'){
      payload.name = document.getElementById('mTitle').value.trim();
    }else{
      payload.subject = document.getElementById('mSubj').value.trim();
      payload.content = document.getElementById('mTitle').value.trim();
    }
    await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).update(payload);
    close();
    await safeLoadTasks(cat);
  };
};

function toDateInputValue(ts){
  if(!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = n=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}


