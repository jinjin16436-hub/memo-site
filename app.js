/* app.js - v1.1.6 (full) */

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

// ===== DOM 헬퍼 =====
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (name, attrs={}) => {
  const node = document.createElement(name);
  Object.entries(attrs).forEach(([k,v]) => node.setAttribute(k,v));
  return node;
};

// ===== 공통 요소 =====
const userInfo  = $('#userInfo');
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');

const listNotice   = $('#list_notice');
const listExam     = $('#list_exam');
const listTask     = $('#list_task');
const listHomework = $('#list_homework');

const toggleNotices = $('#toggleNotices');

// ===== 추가 폼 =====
// 공지
const nTitle = $('#nTitle');
const nKind  = $('#nKind');
const nBody  = $('#nBody');
const nAddBtn= $('#nAddBtn');

// 시험(과목 없음)
const eName   = $('#eName');
const eDetail = $('#eDetail');
const eStart  = $('#eStart');
const eEnd    = $('#eEnd');
const ePStart = $('#ePStart');
const ePEnd   = $('#ePEnd');
const eAddBtn = $('#eAddBtn');

// 수행
const tSubj   = $('#tSubj');
const tTitle  = $('#tTitle');
const tDetail = $('#tDetail');
const tStart  = $('#tStart');
const tEnd    = $('#tEnd');
const tPStart = $('#tPStart');
const tPEnd   = $('#tPEnd');
const tAddBtn = $('#tAddBtn');

// 숙제
const hSubj   = $('#hSubj');
const hTitle  = $('#hTitle');
const hDetail = $('#hDetail');
const hStart  = $('#hStart');
const hEnd    = $('#hEnd');
const hPStart = $('#hPStart');
const hPEnd   = $('#hPEnd');
const hAddBtn = $('#hAddBtn');

// ===== 유틸 =====
const pad2 = n => String(n).padStart(2,'0');

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y=d.getFullYear(), m=d.getMonth()+1, dd=d.getDate();
  const w = ['일','월','화','수','목','금','토'][d.getDay()];
  return `${y}-${pad2(m)}-${pad2(dd)} (${w})`;
};

const fmtRange = (s,e)=>{
  if(!s && !e) return '';
  if(s && !e) return `${fmtDate(s)}`;
  if(!s && e) return `${fmtDate(e)}`;
  return `${fmtDate(s)} ~ ${fmtDate(e)}`;
};

const asIntOrNull = v => (v === '' || v === null || v === undefined) ? null : (parseInt(v,10) || null);
const normPeriod  = n => (n>=1 && n<=7) ? n : null;

/** 교시 텍스트(1~1 -> 1교시) */
const periodText = (start, end, legacy) => {
  const s = normPeriod(asIntOrNull(start));
  const e = normPeriod(asIntOrNull(end));
  if (s && e) return (s===e) ? `${s}교시` : `${s}~${e}교시`;
  if (s) return `${s}교시`;
  if (e) return `${e}교시`;
  if (legacy && String(legacy).trim()) return String(legacy).trim();
  return '';
};

/** 날짜 + 교시 메타 라인(괄호 제거하고 띄어쓰기로 연결) */
const renderMeta = (startDate, endDate, pStart, pEnd, legacyPeriod) => {
  const range = fmtRange(startDate,endDate);
  const ptxt  = periodText(pStart, pEnd, legacyPeriod);
  const parts = [];
  if (range) parts.push(range);
  if (ptxt)  parts.push(ptxt);
  return parts.length ? `<div class="meta">${parts.join(' ')}</div>` : '';
};

// ===== D-day 표시 (규칙: D-n / D-day(하루) / 진행중(기간≥2일) / 종료) =====
const ddayBadge = (start, end) => {
  const toDate0 = (v) => {
    if (!v) return null;
    const d = v.toDate ? v.toDate() : new Date(v);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const colorByDiff = (n) => {
    if (n <= 2) return 'orange';
    if (n <= 7) return 'yellow';
    return 'green';
  };

  let s = toDate0(start);
  let e = toDate0(end);
  if (!s && !e) return '';
  if (!e && s) e = s;        // 종료 없으면 단일 하루
  if (!s && e) s = e;        // 시작 없고 종료만 있으면 단일 하루

  const today = toDate0(new Date());

  // 종료
  if (today > e) return `<span class="dday gray">종료</span>`;

  const isSingle = s.getTime() === e.getTime();

  if (isSingle) {
    const diff = Math.round((s - today) / 86400000);
    if (diff > 0)  return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`;
    if (diff === 0) return `<span class="dday red">D-day</span>`;
    return `<span class="dday gray">종료</span>`;
  } else {
    if (today < s) {
      const diff = Math.round((s - today) / 86400000);
      return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`;
    }
    // 오늘이 기간 사이
    return `<span class="dday red">진행중</span>`;
  }
};

/** 정렬 키: 가까운 D-day → 진행중(0) → 먼 것 → 종료(맨뒤) */
const sortKeyByDday = (data) => {
  const to0 = (v) => v ? (v.toDate ? v.toDate() : new Date(v)) : null;
  const dayMs = 86400000;
  const today = new Date(); today.setHours(0,0,0,0);

  let s = to0(data.startDate);
  let e = to0(data.endDate);

  if (!s && !e) return 9e7; // 날짜 없음 → 뒤쪽
  if (!s && e) s = e;       // 종료만 있으면 단일 하루로 간주
  if (!e && s) e = s;

  // 종료는 맨 뒤
  if (today > e) return 9e8;

  const isSingle = s.getTime() === e.getTime();

  // 진행중(기간형) or D-day(단일 하루 오늘) → 0
  if (!isSingle && today >= s && today <= e) return 0;
  if (isSingle && s.getTime() === today.getTime()) return 0;

  // 시작 전: 시작일까지 D-n
  if (today < s) return Math.floor((s - today)/dayMs);

  // 안전망
  return 9e7;
};

// ===== 권한 UI =====
const applyAdminUI = () => {
  if (isAdmin) {
    document.body.classList.add('is-admin');
    $$('.admin-only').forEach(n => n.style.display='');
  } else {
    document.body.classList.remove('is-admin');
    $$('.admin-only').forEach(n => n.style.display='none');
  }
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
    loadNoticeSwitch().then(safeLoadNotices),
    safeLoadTasks('exams'),
    safeLoadTasks('tasks'),
    safeLoadTasks('homeworks'),
  ]);
});

// ===== 전달 사항 ON/OFF 저장/로드 =====
const loadNoticeSwitch = async ()=>{
  try{
    const doc = await db.doc(`users/${PUBLIC_UID}/settings/app`).get();
    const on = doc.exists ? (doc.data().showNotices !== false) : true; // default ON
    toggleNotices.checked = !!on;
    $('#sec_notice .section-body').style.display = on ? '' : 'none';
  }catch(e){
    toggleNotices.checked = true;
    $('#sec_notice .section-body').style.display = '';
  }
};
toggleNotices.addEventListener('change', async ()=>{
  if(!isAdmin) return;
  const on = toggleNotices.checked;
  await db.doc(`users/${PUBLIC_UID}/settings/app`).set({ showNotices:on }, {merge:true});
  $('#sec_notice .section-body').style.display = on ? '' : 'none';
});

// 섹션 헤더 클릭으로 토글(관리자만)
const secHead = $('#sec_notice .section-head');
if (secHead){
  secHead.addEventListener('click', (e)=>{
    // 라벨/체크박스 누른 경우는 기본동작 유지
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    if (!isAdmin) return;
    toggleNotices.checked = !toggleNotices.checked;
    toggleNotices.dispatchEvent(new Event('change'));
  });
}

// ===== 공지 로드/추가/삭제 =====
const safeLoadNotices = async ()=>{
  listNotice.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/notices`)
                         .orderBy('createdAt','desc')
                         .get();

    if(snap.empty){
      listNotice.innerHTML = '<li class="meta">등록된 전달 사항이 없습니다.</li>';
      return;
    }

    // 모든 문서를 배열로 변환
    const docs = [];
    snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() }));

    // 🔽 정렬 우선순위: 공지(notice) → 안내(info) → 참고(alert)
    const order = { notice: 1, info: 2, alert: 3 };
    docs.sort((a, b) => {
      const ak = order[a.data.kind] || 99;
      const bk = order[b.data.kind] || 99;
      if (ak !== bk) return ak - bk;
      // 같은 분류면 createdAt 내림차순
      const at = a.data.createdAt?.toMillis?.() || 0;
      const bt = b.data.createdAt?.toMillis?.() || 0;
      return bt - at;
    });

    // 렌더링
    docs.forEach(({id, data})=>{
      const li = el('li', {class:`notice-card kind-${data.kind || 'notice'}`});
      li.innerHTML = `
        <div class="title">${data.title || '(제목 없음)'}</div>
        ${data.body ? `<div class="content"><pre>${data.body}</pre></div>` : ''}
        ${renderMeta(data.startDate,data.endDate,data.periodStart,data.periodEnd,data.period)}
      `;

      if (isAdmin) {
        const row = el('div');
        const b1 = el('button',{class:'btn'}); b1.textContent='수정';
        const b2 = el('button',{class:'btn'}); b2.textContent='삭제';
        b1.addEventListener('click',()=> openNoticeEdit(id, data));
        b2.addEventListener('click',()=> delNotice(id));
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
    // (선택) 기간/교시도 넣고 싶으면 여기에 추가
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

// ===== 시험/수행/숙제 로드(디데이 빠른 순 정렬) =====
const safeLoadTasks = async (cat)=>{
  const ul = cat==='exams' ? listExam : (cat==='tasks' ? listTask : listHomework);
  ul.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).get();
    if(snap.empty){
      ul.innerHTML = `<li class="meta">등록된 ${cat==='exams'?'시험':cat==='tasks'?'수행평가':'숙제'}가 없습니다.</li>`;
      return;
    }

    // 배열화
    const docs = [];
    snap.forEach(doc=> docs.push({ id: doc.id, data: doc.data() }));

    // 디데이 기준 정렬
    docs.sort((a,b)=> sortKeyByDday(a.data) - sortKeyByDday(b.data));

    // 렌더링
    docs.forEach(({id,data})=>{
      const title = (cat==='exams' ? (data.name || '시험') : (data.subject || '과목 없음'));
      const li = el('li',{class:'task'});
      li.innerHTML = `
        <div class="title">${title} ${ddayBadge(data.startDate, data.endDate)}</div>
        ${data.content ? `<div class="content"><pre>${data.content}</pre></div>` : ''}
        ${data.detail  ? `<div class="content"><pre>${data.detail}</pre></div>` : ''}
        ${renderMeta(
            data.startDate, data.endDate,
            data.periodStart, data.periodEnd, data.period
        )}
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
    periodStart: asIntOrNull(ePStart.value),
    periodEnd:   asIntOrNull(ePEnd.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/exams/items`).add(payload);
  eName.value = eDetail.value = '';
  eStart.value = eEnd.value = '';
  ePStart.value = ePEnd.value = '';
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
    periodStart: asIntOrNull(tPStart.value),
    periodEnd:   asIntOrNull(tPEnd.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/tasks/items`).add(payload);
  tSubj.value=tTitle.value=tDetail.value='';
  tStart.value=tEnd.value='';
  tPStart.value=tPEnd.value='';
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
    periodStart: asIntOrNull(hPStart.value),
    periodEnd:   asIntOrNull(hPEnd.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/homeworks/items`).add(payload);
  hSubj.value=hTitle.value=hDetail.value='';
  hStart.value=hEnd.value='';
  hPStart.value=hPEnd.value='';
  await safeLoadTasks('homeworks');
});

// ===== 삭제 =====
const delTask = async (cat, id)=>{
  if(!confirm('삭제할까요?')) return;
  await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).delete();
  await safeLoadTasks(cat);
};

// ===== 수정 모달 =====
const modalRoot = document.querySelector('#modal-root');
const closeModal = ()=> modalRoot.innerHTML = '';

const periodSelectOptions = (val)=>{
  const v = asIntOrNull(val);
  const opts = ['<option value="">선택</option>'];
  for (let i=1;i<=7;i++){
    opts.push(`<option value="${i}" ${v===i?'selected':''}>${i}교시</option>`);
  }
  return opts.join('');
};

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
  $('#mClose').onclick = $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async ()=>{
    await db.doc(`users/${PUBLIC_UID}/notices/${id}`).update({
      title: $('#mTitle').value.trim(),
      kind:  $('#mKind').value,
      body:  $('#mBody').value.trim()
    });
    closeModal();
    await safeLoadNotices();
  };
};

const toDateInputValue = ts => {
  if(!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};

const openTaskEdit = (cat, id, data)=>{
  if(!isAdmin) return;
  const withSubj = (cat !== 'exams');
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
            <label>교시 시작
              <select id="mPStart">${periodSelectOptions(data.periodStart)}</select>
            </label>
            <label>교시 끝
              <select id="mPEnd">${periodSelectOptions(data.periodEnd)}</select>
            </label>
          </div>
        </div>
        <div class="modal__foot">
          <button class="btn btn--ghost" id="mCancel">취소</button>
          <button class="btn btn--primary" id="mSave">저장</button>
        </div>
      </div>
    </div>`;
  $('#mClose').onclick = $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async ()=>{
    const payload = {
      detail: $('#mDetail').value.trim(),
      startDate: $('#mStart').value ? new Date($('#mStart').value) : null,
      endDate:   $('#mEnd').value   ? new Date($('#mEnd').value)   : null,
      periodStart: asIntOrNull($('#mPStart').value),
      periodEnd:   asIntOrNull($('#mPEnd').value),
    };
    if(cat==='exams'){
      payload.name = $('#mTitle').value.trim();
    }else{
      payload.subject = $('#mSubj').value.trim();
      payload.content = $('#mTitle').value.trim();
    }
    await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).update(payload);
    closeModal();
    await safeLoadTasks(cat);
  };
};
