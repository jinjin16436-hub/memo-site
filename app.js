/* app.js - v1.1.8 (Spark+Worker) */
// 변경사항: Cloudflare Worker 프록시 사용(NEIS), Hosting만 배포, D-day 크기 조정

if (!window.firebaseConfig) {
  alert("firebaseConfig가 로드되지 않았어요. env.js 순서를 확인해주세요.");
  throw new Error("Missing firebaseConfig");
}
const { firebaseConfig, PUBLIC_UID, ADMIN_UIDS = [], NEIS_PROXY_BASE } = window;

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

let currentUser = null;
let isAdmin = false;

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (name, attrs={}) => { const node = document.createElement(name); Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v)); return node; };

const userInfo  = $('#userInfo');
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');

const listNotice   = $('#list_notice');
const listExam     = $('#list_exam');
const listTask     = $('#list_task');
const listHomework = $('#list_homework');
const toggleNotices = $('#toggleNotices');

// 시간표 UI
const ttSchool = $('#ttSchool');
const ttDate   = $('#ttDate');
const ttGrade  = $('#ttGrade');
const ttClass  = $('#ttClass');
const ttBtn    = $('#ttBtn');
const ttList   = $('#ttList');

// ===== 유틸 =====
const pad2 = n => String(n).padStart(2,'0');
const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y=d.getFullYear(), m=d.getMonth()+1, dd=d.getDate();
  const w = ['일','월','화','수','목','금','토'][d.getDay()];
  return `${y}-${pad2(m)}-${pad2(dd)} (${w})`;
};
const fmtRange = (s,e)=>{ if(!s && !e) return ''; if(s && !e) return `${fmtDate(s)}`; if(!s && e) return `${fmtDate(e)}`; return `${fmtDate(s)} ~ ${fmtDate(e)}`; };
const asIntOrNull = v => (v === '' || v === null || v === undefined) ? null : (parseInt(v,10) || null);
const normPeriod  = n => (n>=1 && n<=7) ? n : null;
const periodText = (start, end, legacy) => {
  const s = normPeriod(asIntOrNull(start)); const e = normPeriod(asIntOrNull(end));
  if (s && e) return (s===e) ? `${s}교시` : `${s}~${e}교시`;
  if (s) return `${s}교시`; if (e) return `${e}교시`;
  if (legacy && String(legacy).trim()) return String(legacy).trim();
  return '';
};
const renderMeta = (startDate,endDate,pStart,pEnd,legacyPeriod)=>{
  const range = fmtRange(startDate,endDate);
  const ptxt  = periodText(pStart,pEnd,legacyPeriod);
  const parts = []; if (range) parts.push(range); if (ptxt) parts.push(ptxt);
  return parts.length ? `<div class="meta">${parts.join(' ')}</div>` : '';
};

// ===== D-day =====
const ddayBadge = (start,end)=>{
  const toDate0=v=>{ if(!v) return null; const d=v.toDate?v.toDate():new Date(v); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); };
  const colorByDiff=n=> n<=2?'orange':(n<=7?'yellow':'green');
  let s=toDate0(start), e=toDate0(end);
  if(!s && !e) return ''; if(!e&&s) e=s; if(!s&&e) s=e;
  const today=toDate0(new Date());
  if(today>e) return `<span class="dday gray">종료</span>`;
  const isSingle = s.getTime()===e.getTime();
  if(isSingle){
    const diff=Math.round((s-today)/86400000);
    if(diff>0) return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`;
    if(diff===0) return `<span class="dday red">D-day</span>`;
    return `<span class="dday gray">종료</span>`;
  }else{
    if(today<s){ const diff=Math.round((s-today)/86400000); return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`; }
    return `<span class="dday red">진행중</span>`;
  }
};
const sortKeyByDday = (data)=>{
  const to0=v=>v?(v.toDate?v.toDate():new Date(v)):null;
  const dayMs=86400000; const today=new Date(); today.setHours(0,0,0,0);
  let s=to0(data.startDate), e=to0(data.endDate);
  if(!s&&!e) return 9e7; if(!s&&e) s=e; if(!e&&s) e=s;
  if(today>e) return 9e8;
  const isSingle=s.getTime()===e.getTime();
  if(!isSingle && today>=s && today<=e) return 0;
  if(isSingle && s.getTime()===today.getTime()) return 0;
  if(today<s) return Math.floor((s-today)/dayMs);
  return 9e7;
};

// ===== 권한 UI =====
const applyAdminUI = ()=>{
  if(isAdmin){ document.body.classList.add('is-admin'); $$('.admin-only').forEach(n=>n.style.display=''); }
  else { document.body.classList.remove('is-admin'); $$('.admin-only').forEach(n=>n.style.display='none'); }
};

// ===== 로그인 =====
loginBtn.addEventListener('click', async ()=>{ await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); });
logoutBtn.addEventListener('click', async ()=>{ await auth.signOut(); });

auth.onAuthStateChanged(async (u)=>{
  currentUser = u;
  isAdmin = !!(u && ADMIN_UIDS.includes(u.uid));
  userInfo.textContent = isAdmin ? `${u.displayName} (관리자)` : (u ? u.email : '로그인 필요');
  loginBtn.style.display = u ? 'none' : '';
  logoutBtn.style.display = u ? '' : 'none';
  applyAdminUI();
  await Promise.all([
    loadNoticeSwitch().then(safeLoadNotices),
    safeLoadTasks('exams'),
    safeLoadTasks('tasks'),
    safeLoadTasks('homeworks'),
  ]);
  // 시간표 기본 날짜: 오늘
  const d=new Date(); ttDate.value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
});

// ===== 전달 사항 ON/OFF =====
const loadNoticeSwitch = async ()=>{
  try{
    const doc = await db.doc(`users/${PUBLIC_UID}/settings/app`).get();
    const on = doc.exists ? (doc.data().showNotices !== false) : true;
    toggleNotices.checked = !!on;
    $('#sec_notice .section-body').style.display = on ? '' : 'none';
  }catch(e){
    toggleNotices.checked = true; $('#sec_notice .section-body').style.display = '';
  }
};
toggleNotices.addEventListener('change', async ()=>{
  if(!isAdmin) return;
  const on = toggleNotices.checked;
  await db.doc(`users/${PUBLIC_UID}/settings/app`).set({ showNotices:on }, {merge:true});
  $('#sec_notice .section-body').style.display = on ? '' : 'none';
});
const secHead = $('#sec_notice .section-head');
if (secHead){
  secHead.addEventListener('click', (e)=>{
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    if (!isAdmin) return;
    toggleNotices.checked = !toggleNotices.checked;
    toggleNotices.dispatchEvent(new Event('change'));
  });
}

// ===== 공지 로드/정렬(공지>안내>참고) =====
const KIND_ORDER = { notice:0, info:1, alert:2 };
const safeLoadNotices = async ()=>{
  listNotice.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/notices`).orderBy('createdAt','desc').get();
    const docs=[]; snap.forEach(doc=>docs.push({id:doc.id,data:doc.data()}));
    // 분류 우선 정렬(공지→안내→참고), 동률이면 최신순
    docs.sort((a,b)=>{
      const ka = KIND_ORDER[a.data.kind||'notice'] ?? 3;
      const kb = KIND_ORDER[b.data.kind||'notice'] ?? 3;
      if (ka!==kb) return ka-kb;
      const ta = (a.data.createdAt?.toMillis?.() ?? 0);
      const tb = (b.data.createdAt?.toMillis?.() ?? 0);
      return tb-ta;
    });
    if(!docs.length){ listNotice.innerHTML = '<li class="meta">등록된 전달 사항이 없습니다.</li>'; return; }
    docs.forEach(({id,d})=>{
      const li = el('li',{class:`notice-card kind-${d.kind || 'notice'}`});
      li.innerHTML = `
        <div class="title">${d.title || '(제목 없음)'}</div>
        ${d.body ? `<div class="content"><pre>${d.body}</pre></div>` : ''}
        ${renderMeta(d.startDate,d.endDate,d.periodStart,d.periodEnd,d.period)}
      `;
      if (isAdmin) {
        const row = el('div');
        const b1 = el('button',{class:'btn'}); b1.textContent='수정';
        const b2 = el('button',{class:'btn'}); b2.textContent='삭제';
        b1.addEventListener('click',()=> openNoticeEdit(id, d));
        b2.addEventListener('click',()=> delNotice(id));
        row.append(b1,b2); li.appendChild(row);
      }
      listNotice.appendChild(li);
    });
  }catch(err){
    listNotice.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`;
  }
};
$('#nAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    title: $('#nTitle').value.trim(),
    kind:  $('#nKind').value,
    body:  $('#nBody').value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/notices`).add(payload);
  $('#nTitle').value=''; $('#nBody').value='';
  await safeLoadNotices();
});
const delNotice = async (id)=>{ if(!confirm('삭제할까요?')) return; await db.doc(`users/${PUBLIC_UID}/notices/${id}`).delete(); await safeLoadNotices(); };

// ===== 시험/수행/숙제 =====
const safeLoadTasks = async (cat)=>{
  const ul = cat==='exams' ? listExam : (cat==='tasks' ? listTask : listHomework);
  ul.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).get();
    if(snap.empty){ ul.innerHTML = `<li class="meta">등록된 ${cat==='exams'?'시험':cat==='tasks'?'수행평가':'숙제'}가 없습니다.</li>`; return; }
    const docs=[]; snap.forEach(doc=>docs.push({id:doc.id,data:doc.data()}));
    docs.sort((a,b)=> sortKeyByDday(a.data) - sortKeyByDday(b.data));
    docs.forEach(({id,data})=>{
      const title = (cat==='exams' ? (data.name || '시험') : (data.subject || '과목 없음'));
      const li = el('li',{class:'task'});
      li.innerHTML = `
        <div class="title">${title} ${ddayBadge(data.startDate, data.endDate)}</div>
        ${data.content ? `<div class="content"><pre>${data.content}</pre></div>` : ''}
        ${data.detail  ? `<div class="content"><pre>${data.detail}</pre></div>` : ''}
        ${renderMeta(data.startDate,data.endDate,data.periodStart,data.periodEnd,data.period)}
      `;
      if (isAdmin) {
        const row = el('div');
        const b1 = el('button',{class:'btn'}); b1.textContent='수정';
        const b2 = el('button',{class:'btn'}); b2.textContent='삭제';
        b1.addEventListener('click',()=> openTaskEdit(cat,id,data));
        b2.addEventListener('click',()=> delTask(cat,id));
        row.append(b1,b2); li.appendChild(row);
      }
      ul.appendChild(li);
    });
  }catch(err){ ul.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`; }
};
$('#eAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    name: $('#eName').value.trim(),
    detail: $('#eDetail').value.trim(),
    startDate: $('#eStart').value ? new Date($('#eStart').value) : null,
    endDate:   $('#eEnd').value   ? new Date($('#eEnd').value)   : null,
    periodStart: asIntOrNull($('#ePStart').value),
    periodEnd:   asIntOrNull($('#ePEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/exams/items`).add(payload);
  ['eName','eDetail','eStart','eEnd','ePStart','ePEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('exams');
});
$('#tAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    subject: $('#tSubj').value.trim(),
    content: $('#tTitle').value.trim(),
    detail: $('#tDetail').value.trim(),
    startDate: $('#tStart').value ? new Date($('#tStart').value) : null,
    endDate:   $('#tEnd').value   ? new Date($('#tEnd').value)   : null,
    periodStart: asIntOrNull($('#tPStart').value),
    periodEnd:   asIntOrNull($('#tPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/tasks/items`).add(payload);
  ['tSubj','tTitle','tDetail','tStart','tEnd','tPStart','tPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('tasks');
});
$('#hAddBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const payload = {
    subject: $('#hSubj').value.trim(),
    content: $('#hTitle').value.trim(),
    detail: $('#hDetail').value.trim(),
    startDate: $('#hStart').value ? new Date($('#hStart').value) : null,
    endDate:   $('#hEnd').value   ? new Date($('#hEnd').value)   : null,
    periodStart: asIntOrNull($('#hPStart').value),
    periodEnd:   asIntOrNull($('#hPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(`users/${PUBLIC_UID}/tasks/homeworks/items`).add(payload);
  ['hSubj','hTitle','hDetail','hStart','hEnd','hPStart','hPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('homeworks');
});
const delTask = async (cat,id)=>{ if(!confirm('삭제할까요?')) return; await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).delete(); await safeLoadTasks(cat); };

// ===== 수정 모달 (공지/항목) =====
const modalRoot = document.querySelector('#modal-root');
const closeModal = ()=> modalRoot.innerHTML = '';
const periodSelectOptions = (val)=>{
  const v = asIntOrNull(val); const opts=['<option value="">선택</option>']; for(let i=1;i<=7;i++){ opts.push(`<option value="${i}" ${v===i?'selected':''}>${i}교시</option>`); } return opts.join('');
};
const openNoticeEdit = (id,data)=>{
  if(!isAdmin) return;
  modalRoot.innerHTML = `
    <div class="modal show" id="m"><div class="modal__dialog">
      <div class="modal__head"><strong>전달 사항 수정</strong><button class="modal__close" id="mClose">닫기</button></div>
      <div class="modal__body">
        <div class="form-grid">
          <label class="full">제목 <input id="mTitle" value="${data.title||''}"></label>
          <label>분류
            <select id="mKind">
              <option value="notice" ${data.kind==='notice'?'selected':''}>공지(빨강)</option>
              <option value="info" ${data.kind==='info'?'selected':''}>안내(노랑)</option>
              <option value="alert" ${data.kind==='alert'?'selected':''}>참고(초록)</option>
            </select>
          </label>
          <label class="full">내용 <textarea id="mBody">${data.body||''}</textarea></label>
        </div>
      </div>
      <div class="modal__foot"><button class="btn btn--ghost" id="mCancel">취소</button><button class="btn btn--primary" id="mSave">저장</button></div>
    </div></div>`;
  $('#mClose').onclick = $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async ()=>{
    await db.doc(`users/${PUBLIC_UID}/notices/${id}`).update({ title:$('#mTitle').value.trim(), kind:$('#mKind').value, body:$('#mBody').value.trim() });
    closeModal(); await safeLoadNotices();
  };
};
const toDateInputValue = ts => { if(!ts) return ''; const d=ts.toDate?ts.toDate():new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; };
const openTaskEdit = (cat,id,data)=>{
  if(!isAdmin) return;
  const withSubj = (cat !== 'exams');
  modalRoot.innerHTML = `
  <div class="modal show" id="m"><div class="modal__dialog">
    <div class="modal__head"><strong>항목 수정</strong><button class="modal__close" id="mClose">닫기</button></div>
    <div class="modal__body">
      <div class="form-grid">
        ${withSubj ? `<label>과목 <input id="mSubj" value="${data.subject||''}"></label>`:''}
        <label>${cat==='exams'?'시험 이름':'내용'} <input id="mTitle" value="${(cat==='exams'?data.name:data.content)||''}"></label>
        <label class="full">상세 내용 <textarea id="mDetail">${data.detail||''}</textarea></label>
        <label>시작일 <input id="mStart" type="date" value="${toDateInputValue(data.startDate)}"></label>
        <label>종료일 <input id="mEnd" type="date" value="${toDateInputValue(data.endDate)}"></label>
        <label>교시 시작 <select id="mPStart">${periodSelectOptions(data.periodStart)}</select></label>
        <label>교시 끝 <select id="mPEnd">${periodSelectOptions(data.periodEnd)}</select></label>
      </div>
    </div>
    <div class="modal__foot"><button class="btn btn--ghost" id="mCancel">취소</button><button class="btn btn--primary" id="mSave">저장</button></div>
  </div></div>`;
  $('#mClose').onclick = $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async ()=>{
    const payload = {
      detail: $('#mDetail').value.trim(),
      startDate: $('#mStart').value ? new Date($('#mStart').value) : null,
      endDate:   $('#mEnd').value   ? new Date($('#mEnd').value)   : null,
      periodStart: asIntOrNull($('#mPStart').value),
      periodEnd:   asIntOrNull($('#mPEnd').value),
    };
    if(cat==='exams'){ payload.name = $('#mTitle').value.trim(); }
    else { payload.subject = $('#mSubj').value.trim(); payload.content = $('#mTitle').value.trim(); }
    await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).update(payload);
    closeModal(); await safeLoadTasks(cat);
  };
};

// ===== 시간표(NEIS) - Cloudflare Worker 프록시 사용 =====
const PROXY = (NEIS_PROXY_BASE || '').replace(/\/+$/,'');
const ymdFromInput = (v)=>{ if(!v) return ''; const d=new Date(v); return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`; };
const getJSON = async (url)=>{
  const r = await fetch(url,{headers:{'Accept':'application/json'}});
  const text = await r.text();
  try{ return JSON.parse(text); }catch{ return { raw:text }; }
};
const renderTT = (rows=[])=>{
  ttList.innerHTML = '';
  if(!rows.length){ ttList.innerHTML = `<li class="meta">해당 조건의 시간표가 없습니다.</li>`; return; }
  rows.sort((a,b)=> (parseInt(a.PERIO||a.ORD||'0') - parseInt(b.PERIO||b.ORD||'0')));
  rows.forEach(r=>{
    const li = el('li',{class:'task'});
    const perio = r.PERIO || r.ORD || '';
    const name  = r.ITRT_CNTNT || r.SUBJECT || r.TI_NM || '';
    const room  = r.CLRM_NM || '';
    li.innerHTML = `<div class="title">${perio}교시 - ${name}${room?` (${room})`:''}</div>`;
    ttList.appendChild(li);
  });
};
ttBtn?.addEventListener('click', async ()=>{
  if(!PROXY){ alert('env.js의 NEIS_PROXY_BASE를 설정해주세요(Cloudflare Worker URL).'); return; }
  const schoolName = ttSchool.value.trim();
  const ymd = ymdFromInput(ttDate.value);
  const grade = ttGrade.value.trim();
  const classNm = ttClass.value.trim();
  if(!schoolName || !ymd || !grade || !classNm){ alert('학교명/날짜/학년/반을 모두 입력해주세요.'); return; }
  ttBtn.disabled = true; ttBtn.textContent = '불러오는 중...';
  try{
    const url = `${PROXY}/api/timetable?schoolName=${encodeURIComponent(schoolName)}&ymd=${ymd}&grade=${grade}&classNm=${classNm}`;
    const data = await getJSON(url);
    renderTT(data.rows || []);
  }catch(e){
    ttList.innerHTML = `<li class="meta">오류: ${e.message||e}</li>`;
  }finally{
    ttBtn.disabled = false; ttBtn.textContent = '불러오기';
  }
});
