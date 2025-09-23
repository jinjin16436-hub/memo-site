/* app.js v1.4.1 — 모바일 폼 정리 + Timestamp 포맷 + 모달 수정 */

// ===== Firebase 준비 =====
if (!window.firebaseConfig) {
  alert('firebaseConfig가 로드되지 않았어요. env.js 순서를 확인해주세요.');
  throw new Error('Missing firebaseConfig');
}
firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

const PUBLIC_UID   = window.PUBLIC_UID;
const ADMIN_UIDS   = window.ADMIN_UIDS || [];
const ADMIN_EMAILS = window.ADMIN_EMAILS || [];

const isAdmin = () => {
  const u = auth.currentUser;
  if (!u) return false;
  return ADMIN_UIDS.includes(u.uid) || ADMIN_EMAILS.includes(u.email || '');
};

const $ = (sel, parent=document) => parent.querySelector(sel);
const el = (tag, attrs={}, ...children) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k==='class') node.className=v;
    else if (k==='html') node.innerHTML=v;
    else node.setAttribute(k,v);
  });
  children.forEach(c => {
    if (c==null) return;
    node.appendChild(typeof c==='string'? document.createTextNode(c) : c);
  });
  return node;
};

// ===== 날짜/시간 포맷 =====
const tsToDate = (ts) => {
  try { return ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : null); }
  catch(e){ return null; }
};
const fmtDate = (d, withDay=false) => {
  if (!d) return '';
  return d.toLocaleDateString('ko-KR', {
    year:'numeric', month:'2-digit', day:'2-digit',
    ...(withDay? {weekday:'short'} : {})
  });
};
const fmtRange = (s,e) => {
  const sd = tsToDate(s); const ed = tsToDate(e);
  if (!sd && !ed) return '';
  if (sd && ed) return `${fmtDate(sd,true)} ~ ${fmtDate(ed,true)}`;
  if (sd) return fmtDate(sd,true);
  return fmtDate(ed,true);
};
const ddayColor = (n) => {
  if (n<0) return 'gray';
  if (n===0) return 'red';
  if (n<=2) return 'orange';
  if (n<=7) return 'yellow';
  return 'green';
};
const ddayBadge = (start, end) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const s = tsToDate(start); const e = tsToDate(end);
  if (!s && !e) return '';
  const pick = s || e;
  const diff = Math.floor((pick - today)/(86400000));
  const color = ddayColor(diff);
  const label = (diff===0) ? 'D-day' : (diff>0 ? `D-${diff}` : `D+${Math.abs(diff)}`);
  return `<span class="dday ${color}">${label}</span>`;
};

// ===== 인증 =====
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const userInfo  = $('#userInfo');

loginBtn.onclick = async () => {
  try {
     const provider = new firebase.auth.GoogleAuthProvider();
     await auth.signInWithPopup(provider);
  } catch(err) { alert(err.message); }
};
logoutBtn.onclick = async () => auth.signOut();

auth.onAuthStateChanged((u)=>{
  if (u) {
    userInfo.textContent = `${u.displayName || u.email} (관리자: ${isAdmin() ? 'O' : 'X'})`;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = '';
    $('#noticeAdd')?.style && ( $('#noticeAdd').style.display = isAdmin() ? '' : 'none');
    renderAddForms();   // 권한에 따라 버튼 보이기/숨기기
  } else {
    userInfo.textContent = '로그인 필요';
    loginBtn.style.display = '';
    logoutBtn.style.display = 'none';
    $('#noticeAdd')?.style && ( $('#noticeAdd').style.display = 'none');
    renderAddForms();
  }
});

// ======= 공지 =======
const listNotice = $('#list_notice');
const noticeAddWrap = $('#noticeAdd');
const toggleNotices = $('#toggleNotices');
const noticeHeadBtn  = $('#noticeHeadBtn');
const noticeBody     = $('#noticeBody');

toggleNotices.onchange = async (e)=>{
  const on = e.target.checked;
  noticeAddWrap.style.display = on && isAdmin() ? '' : 'none';
  listNotice.parentElement.style.display = on ? '' : 'none';
  // settings 저장 (관리자만)
  if (isAdmin()){
    await db.doc(`users/${PUBLIC_UID}/settings/app`).set({showNotices:on},{merge:true});
  }
};
noticeHeadBtn.onclick = () => {
  noticeBody.style.display = (noticeBody.style.display==='none'?'':'none')==='' ? 'none' : '';
};

// 공지 목록
const loadNotices = async ()=>{
  const snap = await db.collection(`users/${PUBLIC_UID}/notices`)
    .orderBy('createdAt','desc')
    .get();
  listNotice.innerHTML = '';
  if (snap.empty){
    listNotice.appendChild(el('li',{},'등록된 전달 사항이 없습니다.'));
    return;
  }
  snap.forEach(doc=>{
    const d = doc.data();
    const createdTxt = fmtDate(tsToDate(d.createdAt), true);
    const li = el('li',{class:`notice-card kind-${d.kind || 'notice'}`});
    li.innerHTML = `
      <div class="notice-title">${d.title || '(제목 없음)'}</div>
      <div class="notice-body"><pre>${d.body || ''}</pre></div>
      <div class="notice-meta">${createdTxt}</div>
    `;
    if (isAdmin()){
      const row = el('div', {class:'row gap-8', style:'margin-top:10px'});
      const b1 = el('button', {class:'btn'}, '수정');
      const b2 = el('button', {class:'btn'}, '삭제');
      b1.onclick = ()=> openNoticeEdit(doc.id, d);
      b2.onclick = ()=> confirmDelete(()=> db.doc(`users/${PUBLIC_UID}/notices/${doc.id}`).delete());
      row.append(b1,b2); li.appendChild(row);
    }
    listNotice.appendChild(li);
  });
};

// 공지 추가
$('#nAddBtn').onclick = async ()=>{
  if (!isAdmin()) return alert('관리자만 추가할 수 있어요.');
  const title = $('#nTitle').value.trim();
  const kind  = $('#nKind').value;
  const body  = $('#nBody').value.trim();
  if (!title || !body) return alert('제목/내용을 입력하세요.');
  await db.collection(`users/${PUBLIC_UID}/notices`).add({
    title, kind, body,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  $('#nTitle').value=''; $('#nBody').value='';
  await loadNotices();
};

// 공지 수정 모달
const openNoticeEdit = (id, data) => {
  const root = $('#modal-root'); root.innerHTML = '';
  const modal = el('div',{class:'modal show'});
  const dialog = el('div',{class:'modal__dialog'});
  dialog.innerHTML = `
    <div class="modal__head">
      <strong>전달 사항 수정</strong>
      <button class="modal__close">닫기</button>
    </div>
    <div class="modal__body">
      <div class="form-grid">
        <label>제목<input id="m_title" class="input" value="${data.title || ''}" /></label>
        <label>종류
          <select id="m_kind" class="select">
            <option value="notice" ${data.kind==='notice'?'selected':''}>공지(빨강)</option>
            <option value="info"   ${data.kind==='info'  ?'selected':''}>안내(노랑)</option>
            <option value="alert"  ${data.kind==='alert' ?'selected':''}>메모(초록)</option>
          </select>
        </label>
        <label class="full">내용<textarea id="m_body" class="input" style="min-height:120px">${data.body || ''}</textarea></label>
      </div>
    </div>
    <div class="modal__foot">
      <button class="btn btn--ghost" id="m_cancel">취소</button>
      <button class="btn btn--primary" id="m_save">저장</button>
    </div>
  `;
  modal.appendChild(dialog); root.appendChild(modal);

  dialog.querySelector('.modal__close').onclick = ()=> modal.remove();
  $('#m_cancel', dialog).onclick = ()=> modal.remove();
  $('#m_save', dialog).onclick   = async ()=>{
    const t = $('#m_title',dialog).value.trim();
    const k = $('#m_kind', dialog).value;
    const b = $('#m_body', dialog).value.trim();
    if (!t || !b) return alert('제목/내용 입력');
    await db.doc(`users/${PUBLIC_UID}/notices/${id}`).set({title:t,kind:k,body:b},{merge:true});
    modal.remove(); loadNotices();
  };
};

// ======= 과제(시험/수행/숙제) =======

const loadTasks = async (cat, listEl) => {
  listEl.innerHTML = '';
  const col = db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).orderBy('createdAt','desc');
  const snap = await col.get();
  if (snap.empty){
    listEl.appendChild(el('li',{}, `등록된 ${cat==='exams' ? '시험' : cat==='activities'?'수행평가':'숙제'}가 없습니다.`));
    return;
  }
  snap.forEach(doc=>{
    const d = doc.data();
    const title = (cat==='exams' ? (d.name || '시험') : (d.subject || '과목 없음'));
    const dday  = ddayBadge(d.startDate, d.endDate);
    const range = fmtRange(d.startDate, d.endDate);
    const li = el('li',{class:'task'});
    li.innerHTML = `
      <div class="title">${title} ${dday}</div>
      <div class="content"><pre>${d.content || ''}</pre></div>
      ${d.detail ? `<div class="content"><pre>${d.detail}</pre></div>` : ''}
      ${d.period ? `<div class="content"><pre>${d.period}</pre></div>` : ''}
      ${range ? `<div class="meta">${range}</div>` : ''}
    `;
    if (isAdmin()){
      const row = el('div',{class:'row gap-8', style:'margin-top:10px'});
      const b1 = el('button',{class:'btn'},'수정');
      const b2 = el('button',{class:'btn'},'삭제');
      b1.onclick = ()=> openTaskEdit(cat, doc.id, d);
      b2.onclick = ()=> confirmDelete(()=> db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${doc.id}`).delete()).then(()=>loadAllTasks());
      row.append(b1,b2); li.appendChild(row);
    }
    listEl.appendChild(li);
  });
};

const listExam     = $('#list_exam');
const listActivity = $('#list_activity');
const listHomework = $('#list_homework');

const loadAllTasks = ()=> Promise.all([
  loadTasks('exams',      listExam),
  loadTasks('activities', listActivity),
  loadTasks('homeworks',  listHomework),
]);

// ======= 추가 폼 렌더 =======
const renderAddForms = ()=>{
  renderAddExamForm();
  renderAddCommonForm('activities', $('#add_activity'));
  renderAddCommonForm('homeworks',  $('#add_homework'));
};

const renderAddExamForm = ()=>{
  const wrap = $('#add_exam'); wrap.innerHTML='';
  const disabled = !isAdmin();
  const g = el('div',{class:'task-add ta-grid ta-exam'});
  g.append(
    el('input',{class:'input name ta-full', placeholder:'시험 이름', id:'ex_name', ...(disabled? {disabled:true}: {}) }),
    el('textarea',{class:'input ta-full', placeholder:'상세 내용', id:'ex_detail', style:'min-height:140px', ...(disabled? {disabled:true}: {}) }),
    el('input',{class:'input', placeholder:'교시/시간', id:'ex_period', ...(disabled? {disabled:true}: {}) }),
    el('input',{class:'input', type:'date', id:'ex_start', ...(disabled? {disabled:true}: {}) }),
    el('input',{class:'input', type:'date', id:'ex_end', ...(disabled? {disabled:true}: {}) }),
  );
  const act = el('div',{class:'ta-actions'});
  const addBtn = el('button',{class:'btn btn--primary'},'+ 추가');
  addBtn.disabled = disabled;
  addBtn.onclick = async ()=>{
    if (!isAdmin()) return;
    const name = $('#ex_name').value.trim();
    if (!name) return alert('시험 이름을 입력하세요.');
    const detail = $('#ex_detail').value.trim();
    const period = $('#ex_period').value.trim();
    const sd = $('#ex_start').value ? new Date($('#ex_start').value) : null;
    const ed = $('#ex_end').value   ? new Date($('#ex_end').value)   : null;
    await db.collection(`users/${PUBLIC_UID}/tasks/exams/items`).add({
      name, content:'', detail, period,
      startDate: sd ? firebase.firestore.Timestamp.fromDate(sd) : null,
      endDate: ed ? firebase.firestore.Timestamp.fromDate(ed) : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    renderAddExamForm(); loadTasks('exams', listExam);
  };
  act.appendChild(addBtn);
  wrap.append(g,act);
};

const renderAddCommonForm = (cat, mount)=>{
  mount.innerHTML='';
  const disabled = !isAdmin();
  const g = el('div',{class:'task-add ta-grid'});
  g.append(
    el('input',{class:'input', placeholder:'과목', id:`${cat}_subject`, ...(disabled? {disabled:true}: {}) }),
    el('input',{class:'input', placeholder:'내용', id:`${cat}_content`, ...(disabled? {disabled:true}: {}) }),
    el('textarea',{class:'input ta-full', placeholder:'상세 내용', id:`${cat}_detail`, style:'min-height:140px', ...(disabled? {disabled:true}: {}) }),
    el('input',{class:'input', type:'date', id:`${cat}_start`, ...(disabled? {disabled:true}: {}) }),
    el('input',{class:'input', type:'date', id:`${cat}_end`, ...(disabled? {disabled:true}: {}) }),
    el('input',{class:'input', placeholder:'교시/시간', id:`${cat}_period`, ...(disabled? {disabled:true}: {}) }),
  );
  const act = el('div',{class:'ta-actions'});
  const addBtn = el('button',{class:'btn btn--primary'},'+ 추가');
  addBtn.disabled = disabled;
  addBtn.onclick = async ()=>{
    if (!isAdmin()) return;
    const s = $(`#${cat}_subject`).value.trim();
    const c = $(`#${cat}_content`).value.trim();
    const d = $(`#${cat}_detail`).value.trim();
    const p = $(`#${cat}_period`).value.trim();
    const sdV = $(`#${cat}_start`).value;
    const edV = $(`#${cat}_end`).value;
    if (!s || !c) return alert('과목/내용을 입력하세요.');
    const sd = sdV ? new Date(sdV) : null;
    const ed = edV ? new Date(edV) : null;
    await db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).add({
      subject:s, content:c, detail:d, period:p,
      startDate: sd ? firebase.firestore.Timestamp.fromDate(sd) : null,
      endDate: ed ? firebase.firestore.Timestamp.fromDate(ed) : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    renderAddCommonForm(cat, mount);
    loadTasks(cat, cat==='activities'? listActivity : listHomework);
  };
  act.appendChild(addBtn);
  mount.append(g,act);
};

// ===== 수정 모달 (시험은 과목칸 숨김) =====
const openTaskEdit = (cat, id, data) => {
  const root = $('#modal-root'); root.innerHTML = '';
  const modal = el('div',{class:'modal show'});
  const dialog = el('div',{class:'modal__dialog'});
  const isExam = cat==='exams';

  dialog.innerHTML = `
    <div class="modal__head">
      <strong>항목 수정</strong>
      <button class="modal__close">닫기</button>
    </div>
    <div class="modal__body">
      <div class="form-grid">
        ${isExam
          ? `<label class="full">시험 이름<input id="t_subject" class="input" value="${data.name || ''}"></label>`
          : `<label>과목<input id="t_subject" class="input" value="${data.subject || ''}"></label>`
        }
        <label>${isExam?'상세 내용':'내용'}<input id="t_content" class="input" value="${isExam ? (data.content||'') : (data.content||'') }"></label>
        <label>교시/시간<input id="t_period" class="input" value="${data.period || ''}"></label>
        <label class="full">상세 내용<textarea id="t_detail" class="input" style="min-height:120px">${data.detail || ''}</textarea></label>
        <label>시작일<input id="t_start" type="date" class="input" value="${toDateValue(data.startDate)}"></label>
        <label>종료일<input id="t_end"   type="date" class="input" value="${toDateValue(data.endDate)}"></label>
      </div>
    </div>
    <div class="modal__foot">
      <button class="btn btn--ghost" id="m_cancel">취소</button>
      <button class="btn btn--primary" id="m_save">저장</button>
    </div>
  `;

  modal.appendChild(dialog); root.appendChild(modal);
  dialog.querySelector('.modal__close').onclick = ()=> modal.remove();
  $('#m_cancel', dialog).onclick = ()=> modal.remove();
  $('#m_save', dialog).onclick   = async ()=>{
    const sub = $('#t_subject',dialog).value.trim();
    const con = $('#t_content',dialog).value.trim();
    const per = $('#t_period', dialog).value.trim();
    const det = $('#t_detail', dialog).value.trim();
    const s   = $('#t_start',  dialog).value;
    const e   = $('#t_end',    dialog).value;
    const sd  = s? firebase.firestore.Timestamp.fromDate(new Date(s)) : null;
    const ed  = e? firebase.firestore.Timestamp.fromDate(new Date(e)) : null;

    const payload = { content:con, detail:det, period:per, startDate:sd, endDate:ed };
    if (isExam) payload.name = sub; else payload.subject = sub;

    await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).set(payload,{merge:true});
    modal.remove();
    loadAllTasks();
  };
};

const toDateValue = (ts)=>{
  const d = tsToDate(ts);
  if (!d) return '';
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const da=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
};

const confirmDelete = async (fn)=>{
  if (!confirm('정말 삭제할까요?')) return;
  await fn();
};

// 초기 로드
(async ()=>{
  // setting 반영
  try{
    const setDoc = await db.doc(`users/${PUBLIC_UID}/settings/app`).get();
    const show = setDoc.exists ? !!setDoc.data().showNotices : true;
    toggleNotices.checked = show;
    noticeAddWrap.style.display = show && isAdmin() ? '' : 'none';
    listNotice.parentElement.style.display = show ? '' : 'none';
  }catch(e){ /* ignore */ }

  renderAddForms();
  await loadNotices();
  await loadAllTasks();
})();
