/* app.js - v1.1.17
 * 변경사항:
 * - 권한 등급 추가: 관리자(Admin) / 부관리자(Editor)
 * - 부관리자: 공지/일정/휴일/시험/수행/숙제 추가/수정/삭제 가능
 * - 관리자만: 관리자 탭(도메인 만료 관리) 접근/수정 가능
 * - editor-only 클래스 도입(관리자+부관리자 표시)
 * - 수정은 팝업(모달) + textarea 줄바꿈 유지
 */

if (!window.firebaseConfig) {
  alert("firebaseConfig가 로드되지 않았어요. env.js 순서를 확인해주세요.");
  throw new Error("Missing firebaseConfig");
}

const {
  firebaseConfig,
  PUBLIC_UID,
  ADMIN_UIDS = [],
  EDITOR_UIDS = [],
  NEIS_PROXY_BASE
} = window;

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

let currentUser = null;
let isAdmin = false;
let isEditor = false;
let canEdit = false;

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (name, attrs={}) => {
  const node = document.createElement(name);
  Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));
  return node;
};
const pad2 = n => String(n).padStart(2,'0');

const userInfo  = $('#userInfo');
const loginBtn  = $('#loginBtn');
const logoutBtn = $('#logoutBtn');

const listNotice   = $('#list_notice');
const listSchedule = $('#list_schedule');
const listHoliday  = $('#list_holiday');
const listExam     = $('#list_exam');
const listTask     = $('#list_task');
const listHomework = $('#list_homework');
const toggleNotices = $('#toggleNotices');

const ttSchool = $('#ttSchool');
const ttDate   = $('#ttDate');
const ttGrade  = $('#ttGrade');
const ttClass  = $('#ttClass');
const ttBtn    = $('#ttBtn');
const ttList   = $('#ttList');

// 관리자: 도메인 관리
const domName   = $('#domName');
const domRenew  = $('#domRenew');
const domNotes  = $('#domNotes');
const domAddBtn = $('#domAddBtn');
const domList   = $('#domList');
const domStatus = $('#domStatus');

// ===== 유틸 =====
const toDateOnly = (v)=>{
  if(!v) return null;
  const d = v.toDate ? v.toDate() : new Date(v);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const toInputDate = (v)=>{
  const d = toDateOnly(v);
  if(!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};
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

// 만료일까지 남은 일수(오늘=0)
const daysUntilDateString = (yyyyMMdd) => {
  if(!yyyyMMdd) return null;
  const [y,m,d] = yyyyMMdd.split('-').map(n=>parseInt(n,10));
  if(!y || !m || !d) return null;
  const target = new Date(y, m-1, d);
  target.setHours(0,0,0,0);
  const today = new Date();
  today.setHours(0,0,0,0);
  return Math.round((target - today)/86400000);
};

// ===== D-day(과제용) =====
const ddayBadge = (start,end)=>{
  let s=toDateOnly(start), e=toDateOnly(end);
  if(!s && !e) return '';
  if(!e&&s) e=s; if(!s&&e) s=e;
  const today=toDateOnly(new Date());

  if(today>e) return `<span class="dday gray">종료</span>`;

  const isSingle = s.getTime()===e.getTime();
  const colorByDiff=n=> n<=2?'orange':(n<=7?'yellow':'green');

  if(isSingle){
    const diff=Math.round((s-today)/86400000);
    if(diff>0) return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`;
    if(diff===0) return `<span class="dday red">D-day</span>`;
    return `<span class="dday gray">종료</span>`;
  }else{
    if(today<s){
      const diff=Math.round((s-today)/86400000);
      return `<span class="dday ${colorByDiff(diff)}">D-${diff}</span>`;
    }
    return `<span class="dday red">진행중</span>`;
  }
};
const sortKeyByDday = (data)=>{
  const dayMs=86400000;
  const today=new Date(); today.setHours(0,0,0,0);
  let s=toDateOnly(data.startDate), e=toDateOnly(data.endDate);
  if(!s&&!e) return 9e7; if(!s&&e) s=e; if(!e&&s) e=s;
  if(today>e) return 9e8;
  const isSingle=s.getTime()===e.getTime();
  if(!isSingle && today>=s && today<=e) return 0;
  if(isSingle && s.getTime()===today.getTime()) return 0;
  if(today<s) return Math.floor((s-today)/dayMs);
  return 9e7;
};

// ===== 권한 UI =====
const applyRoleUI = ()=>{
  // 관리자 전용
  $$('.admin-only').forEach(n=>{
    n.style.display = isAdmin ? '' : 'none';
  });

  // 관리자 + 부관리자
  $$('.editor-only').forEach(n=>{
    n.style.display = canEdit ? '' : 'none';
  });
};

// ===== 탭 =====
const initTabs = ()=>{
  const tabs = $('#tabs');
  if(!tabs) return;

  const setTab = (name)=>{
    if(name === 'admin' && !isAdmin) name = 'schedule';

    $$('.tab-btn', tabs).forEach(b=>b.classList.toggle('active', b.dataset.tab===name));

    const map = {
      schedule: $('#panel_schedule'),
      holiday: $('#panel_holiday'),
      exam: $('#panel_exam'),
      task: $('#panel_task'),
      homework: $('#panel_homework'),
      timetable: $('#panel_timetable'),
      admin: $('#panel_admin'),
    };
    Object.entries(map).forEach(([k, panel])=>{
      if(panel) panel.classList.toggle('active', k===name);
    });
  };

  tabs.addEventListener('click', (e)=>{
    const btn = e.target.closest('.tab-btn');
    if(!btn) return;
    const tab = btn.dataset.tab;
    if(tab === 'admin' && !isAdmin) return;
    setTab(tab);
  });

  setTab('schedule');
};

// ===== 로그인 =====
loginBtn.addEventListener('click', async ()=>{ await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); });
logoutBtn.addEventListener('click', async ()=>{ await auth.signOut(); });

// ===== 공지 ON/OFF =====
const loadNoticeSwitch = async ()=>{
  try{
    const doc = await db.doc(`users/${PUBLIC_UID}/settings/app`).get();
    const on = doc.exists ? (doc.data().showNotices !== false) : true;
    toggleNotices.checked = !!on;
    $('#sec_notice .section-body').style.display = on ? '' : 'none';
  }catch{
    toggleNotices.checked = true;
    $('#sec_notice .section-body').style.display = '';
  }
};
toggleNotices.addEventListener('change', async ()=>{
  if(!canEdit) return; // ✅ 부관리자도 가능
  const on = toggleNotices.checked;
  await db.doc(`users/${PUBLIC_UID}/settings/app`).set({ showNotices:on }, {merge:true});
  $('#sec_notice .section-body').style.display = on ? '' : 'none';
});
const secHead = $('#sec_notice .section-head');
if (secHead){
  secHead.addEventListener('click', (e)=>{
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    if (!canEdit) return; // ✅ 부관리자도 가능
    toggleNotices.checked = !toggleNotices.checked;
    toggleNotices.dispatchEvent(new Event('change'));
  });
}

/* =========================
   ✅ 모달(팝업) 편집기
========================= */
const modalRoot = $('#modal-root');

const closeModal = ()=>{
  if(!modalRoot) return;
  modalRoot.innerHTML = '';
  document.body.style.overflow = '';
};
const openModal = ({ title, fields, onSave })=>{
  if(!modalRoot) return;
  document.body.style.overflow = 'hidden';

  const backdrop = el('div', { class:'modal-backdrop' });
  backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeModal(); });

  const modal = el('div', { class:'modal' });

  const head = el('div', { class:'modal-head' });
  const t = el('div', { class:'modal-title' }); t.textContent = title || '수정';
  const x = el('button', { class:'modal-x', type:'button' }); x.textContent = '닫기';
  x.addEventListener('click', closeModal);
  head.append(t, x);

  const body = el('div', { class:'modal-body' });
  const grid = el('div', { class:'grid' });

  const state = {}; // key -> element

  fields.forEach(f=>{
    const wrap = el('div', { class:`f ${f.full ? 'full' : ''}` });
    const lab = el('label', { class:'label' });
    lab.textContent = f.label || f.key;
    wrap.appendChild(lab);

    let input;
    if (f.type === 'select'){
      input = el('select', { 'data-key': f.key });
      (f.options||[]).forEach(opt=>{
        const o = el('option');
        o.value = String(opt.value);
        o.textContent = opt.label ?? String(opt.value);
        input.appendChild(o);
      });
      input.value = (f.value ?? '') === null ? '' : String(f.value ?? '');
    } else if (f.type === 'textarea'){
      input = el('textarea', { 'data-key': f.key, placeholder: f.placeholder || '' });
      input.value = f.value ?? '';
    } else {
      input = el('input', { 'data-key': f.key, type: f.type || 'text', placeholder: f.placeholder || '' });
      input.value = f.value ?? '';
      if (f.min !== undefined) input.min = String(f.min);
      if (f.max !== undefined) input.max = String(f.max);
    }
    state[f.key] = input;
    wrap.appendChild(input);
    grid.appendChild(wrap);
  });

  body.appendChild(grid);

  const actions = el('div', { class:'modal-actions' });
  const cancelBtn = el('button', { class:'btn btn--ghost', type:'button' }); cancelBtn.textContent = '취소';
  cancelBtn.addEventListener('click', closeModal);

  const saveBtn = el('button', { class:'btn btn--primary', type:'button' }); saveBtn.textContent = '저장';
  saveBtn.addEventListener('click', async ()=>{
    try{
      saveBtn.disabled = true;
      const values = {};
      for(const f of fields){
        const v = state[f.key]?.value ?? '';
        values[f.key] = v;
        if (f.required && String(v).trim() === ''){
          alert(`${f.label || f.key}을(를) 입력해주세요.`);
          saveBtn.disabled = false;
          return;
        }
      }
      await onSave(values);
      closeModal();
    } catch(e){
      alert(`저장 오류: ${e.message || e}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  actions.append(cancelBtn, saveBtn);
  modal.append(head, body, actions);
  backdrop.appendChild(modal);
  modalRoot.innerHTML = '';
  modalRoot.appendChild(backdrop);

  const onKey = (e)=>{ if(e.key === 'Escape'){ window.removeEventListener('keydown', onKey); closeModal(); } };
  window.addEventListener('keydown', onKey);

  const first = modal.querySelector('input, textarea, select');
  first?.focus();
};

/* =========================
   공지
========================= */
const KIND_ORDER = { notice: 0, info: 1, alert: 2 };

const safeLoadNotices = async () => {
  listNotice.innerHTML = '';
  try {
    const snap = await db.collection(`users/${PUBLIC_UID}/notices`).orderBy('createdAt', 'desc').get();
    const docs = [];
    snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() || {} }));

    if (!docs.length) {
      listNotice.innerHTML = '<li class="meta">등록된 전달 사항이 없습니다.</li>';
      return;
    }

    docs.sort((a, b) => {
      const ka = KIND_ORDER[a?.data?.kind ?? 'notice'] ?? 3;
      const kb = KIND_ORDER[b?.data?.kind ?? 'notice'] ?? 3;
      if (ka !== kb) return ka - kb;
      const ta = a?.data?.createdAt?.toMillis?.() ?? 0;
      const tb = b?.data?.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });

    docs.forEach(({ id, data }) => {
      const li = el('li', { class: `notice-card kind-${data.kind || 'notice'}` });
      li.innerHTML = `
        <div class="title">${data.title || '(제목 없음)'}</div>
        ${data.body ? `<div class="content"><pre>${data.body}</pre></div>` : ''}
      `;

      if (canEdit) {
        const row = el('div', { class:'row' });

        const editBtn = el('button', { class:'btn' }); editBtn.textContent = '수정';
        editBtn.addEventListener('click', ()=>{
          openModal({
            title: '공지 수정',
            fields: [
              { key:'title', label:'제목', type:'text', required:true, value: data.title || '', full:true },
              { key:'kind', label:'분류', type:'select', required:true, value: data.kind || 'notice', options:[
                {value:'notice', label:'공지(빨강)'},
                {value:'info', label:'안내(노랑)'},
                {value:'alert', label:'참고(초록)'},
              ], full:true},
              { key:'body', label:'내용(줄바꿈 가능)', type:'textarea', value: data.body || '', full:true, placeholder:'내용을 입력하세요' },
            ],
            onSave: async (v)=>{
              const payload = {
                title: v.title.trim(),
                kind: v.kind,
                body: v.body,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              };
              await db.doc(`users/${PUBLIC_UID}/notices/${id}`).set(payload, { merge:true });
              await safeLoadNotices();
            }
          });
        });

        const delBtn = el('button', { class:'btn' }); delBtn.textContent = '삭제';
        delBtn.addEventListener('click', async ()=>{
          if(!confirm('삭제할까요?')) return;
          await db.doc(`users/${PUBLIC_UID}/notices/${id}`).delete();
          await safeLoadNotices();
        });

        row.append(editBtn, delBtn);
        li.appendChild(row);
      }

      listNotice.appendChild(li);
    });
  } catch (err) {
    listNotice.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`;
  }
};

// 공지 추가
$('#nAddBtn')?.addEventListener('click', async ()=>{
  if(!canEdit) return;
  const payload = {
    title: ($('#nTitle')?.value || '').trim(),
    kind:  $('#nKind')?.value || 'notice',
    body:  ($('#nBody')?.value || ''),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.title){ alert('제목을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/notices`).add(payload);
  $('#nTitle').value=''; $('#nBody').value='';
  await safeLoadNotices();
});

/* =========================
   과제/일정/휴일 공통
========================= */
const getListForCat = (cat)=>{
  if(cat==='exams') return listExam;
  if(cat==='tasks') return listTask;
  if(cat==='homeworks') return listHomework;
  if(cat==='schedules') return listSchedule;
  if(cat==='holidays') return listHoliday;
  return null;
};
const isSubjCat = (cat)=> (cat==='tasks' || cat==='homeworks');
const catLabel = (cat)=>
  cat==='exams'?'시험':cat==='tasks'?'수행평가':cat==='homeworks'?'숙제':cat==='schedules'?'일정':'휴일';

const periodOptions = [
  {value:'', label:'선택'},
  {value:'1', label:'1'}, {value:'2', label:'2'}, {value:'3', label:'3'},
  {value:'4', label:'4'}, {value:'5', label:'5'}, {value:'6', label:'6'}, {value:'7', label:'7'},
];

const openTaskEditModal = (cat, id, d)=>{
  if(cat === 'schedules'){
    openModal({
      title: '일정 수정',
      fields: [
        { key:'title', label:'제목', type:'text', required:true, value: d.title || '', full:true },
        { key:'detail', label:'상세(줄바꿈 가능)', type:'textarea', value: d.detail || '', full:true },
        { key:'start', label:'시작일', type:'date', value: toInputDate(d.startDate) },
        { key:'end', label:'종료일', type:'date', value: toInputDate(d.endDate) },
        { key:'pStart', label:'교시 시작', type:'select', value: (d.periodStart ?? '') === null ? '' : String(d.periodStart ?? ''), options:periodOptions },
        { key:'pEnd', label:'교시 끝', type:'select', value: (d.periodEnd ?? '') === null ? '' : String(d.periodEnd ?? ''), options:periodOptions },
      ],
      onSave: async (v)=>{
        const payload = {
          title: v.title.trim(),
          detail: v.detail,
          startDate: v.start ? new Date(v.start) : null,
          endDate:   v.end   ? new Date(v.end)   : null,
          periodStart: asIntOrNull(v.pStart),
          periodEnd:   asIntOrNull(v.pEnd),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.doc(`users/${PUBLIC_UID}/tasks/schedules/items/${id}`).set(payload,{merge:true});
        await safeLoadTasks('schedules');
      }
    });
    return;
  }

  if(cat === 'holidays'){
    openModal({
      title: '휴일 수정',
      fields: [
        { key:'title', label:'이름', type:'text', required:true, value: d.title || '', full:true },
        { key:'detail', label:'상세(줄바꿈 가능)', type:'textarea', value: d.detail || '', full:true },
        { key:'start', label:'시작일', type:'date', value: toInputDate(d.startDate) },
        { key:'end', label:'종료일', type:'date', value: toInputDate(d.endDate) },
        { key:'pStart', label:'교시 시작', type:'select', value: (d.periodStart ?? '') === null ? '' : String(d.periodStart ?? ''), options:periodOptions },
        { key:'pEnd', label:'교시 끝', type:'select', value: (d.periodEnd ?? '') === null ? '' : String(d.periodEnd ?? ''), options:periodOptions },
      ],
      onSave: async (v)=>{
        const startDate = v.start ? new Date(v.start) : null;
        let endDate = v.end ? new Date(v.end) : null;
        if(startDate && !endDate) endDate = startDate;

        const payload = {
          title: v.title.trim(),
          detail: v.detail,
          startDate,
          endDate,
          periodStart: asIntOrNull(v.pStart),
          periodEnd:   asIntOrNull(v.pEnd),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.doc(`users/${PUBLIC_UID}/tasks/holidays/items/${id}`).set(payload,{merge:true});
        await safeLoadTasks('holidays');
      }
    });
    return;
  }

  if(cat === 'exams'){
    openModal({
      title: '시험 수정',
      fields: [
        { key:'name', label:'시험 이름', type:'text', required:true, value: d.name || '', full:true },
        { key:'detail', label:'상세(줄바꿈 가능)', type:'textarea', value: d.detail || '', full:true },
        { key:'start', label:'시작일', type:'date', value: toInputDate(d.startDate) },
        { key:'end', label:'종료일', type:'date', value: toInputDate(d.endDate) },
        { key:'pStart', label:'교시 시작', type:'select', value: (d.periodStart ?? '') === null ? '' : String(d.periodStart ?? ''), options:periodOptions },
        { key:'pEnd', label:'교시 끝', type:'select', value: (d.periodEnd ?? '') === null ? '' : String(d.periodEnd ?? ''), options:periodOptions },
      ],
      onSave: async (v)=>{
        const payload = {
          name: v.name.trim(),
          detail: v.detail,
          startDate: v.start ? new Date(v.start) : null,
          endDate:   v.end   ? new Date(v.end)   : null,
          periodStart: asIntOrNull(v.pStart),
          periodEnd:   asIntOrNull(v.pEnd),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.doc(`users/${PUBLIC_UID}/tasks/exams/items/${id}`).set(payload,{merge:true});
        await safeLoadTasks('exams');
      }
    });
    return;
  }

  if(cat === 'tasks'){
    openModal({
      title: '수행평가 수정',
      fields: [
        { key:'subject', label:'과목', type:'text', required:true, value: d.subject || '' },
        { key:'content', label:'내용', type:'text', required:true, value: d.content || '', full:true },
        { key:'detail', label:'상세(줄바꿈 가능)', type:'textarea', value: d.detail || '', full:true },
        { key:'start', label:'시작일', type:'date', value: toInputDate(d.startDate) },
        { key:'end', label:'종료일', type:'date', value: toInputDate(d.endDate) },
        { key:'pStart', label:'교시 시작', type:'select', value: (d.periodStart ?? '') === null ? '' : String(d.periodStart ?? ''), options:periodOptions },
        { key:'pEnd', label:'교시 끝', type:'select', value: (d.periodEnd ?? '') === null ? '' : String(d.periodEnd ?? ''), options:periodOptions },
      ],
      onSave: async (v)=>{
        const payload = {
          subject: v.subject.trim(),
          content: v.content.trim(),
          detail: v.detail,
          startDate: v.start ? new Date(v.start) : null,
          endDate:   v.end   ? new Date(v.end)   : null,
          periodStart: asIntOrNull(v.pStart),
          periodEnd:   asIntOrNull(v.pEnd),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.doc(`users/${PUBLIC_UID}/tasks/tasks/items/${id}`).set(payload,{merge:true});
        await safeLoadTasks('tasks');
      }
    });
    return;
  }

  if(cat === 'homeworks'){
    openModal({
      title: '숙제 수정',
      fields: [
        { key:'subject', label:'과목', type:'text', required:true, value: d.subject || '' },
        { key:'content', label:'내용', type:'text', required:true, value: d.content || '', full:true },
        { key:'detail', label:'상세(줄바꿈 가능)', type:'textarea', value: d.detail || '', full:true },
        { key:'start', label:'시작일', type:'date', value: toInputDate(d.startDate) },
        { key:'end', label:'종료일', type:'date', value: toInputDate(d.endDate) },
        { key:'pStart', label:'교시 시작', type:'select', value: (d.periodStart ?? '') === null ? '' : String(d.periodStart ?? ''), options:periodOptions },
        { key:'pEnd', label:'교시 끝', type:'select', value: (d.periodEnd ?? '') === null ? '' : String(d.periodEnd ?? ''), options:periodOptions },
      ],
      onSave: async (v)=>{
        const payload = {
          subject: v.subject.trim(),
          content: v.content.trim(),
          detail: v.detail,
          startDate: v.start ? new Date(v.start) : null,
          endDate:   v.end   ? new Date(v.end)   : null,
          periodStart: asIntOrNull(v.pStart),
          periodEnd:   asIntOrNull(v.pEnd),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.doc(`users/${PUBLIC_UID}/tasks/homeworks/items/${id}`).set(payload,{merge:true});
        await safeLoadTasks('homeworks');
      }
    });
  }
};

const safeLoadTasks = async (cat)=>{
  const ul = getListForCat(cat);
  if(!ul) return;

  ul.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).get();
    if(snap.empty){
      ul.innerHTML = `<li class="meta">등록된 ${catLabel(cat)}가 없습니다.</li>`;
      return;
    }

    const docs=[]; snap.forEach(doc=>docs.push({id:doc.id,data:doc.data()||{}}));
    docs.sort((a,b)=> sortKeyByDday(a.data) - sortKeyByDday(b.data));

    docs.forEach(({id,data})=>{
      const d = data || {};
      const li = el('li',{class:'task'});

      const mainTitle =
        (cat==='exams')
          ? `${(d.name || '시험')} ${ddayBadge(d.startDate, d.endDate)}`
          : (cat==='schedules' || cat==='holidays')
            ? `${(d.title || '제목 없음')} ${ddayBadge(d.startDate, d.endDate)}`
            : `${(isSubjCat(cat) ? (d.subject || '과목 없음') : '항목')} ${ddayBadge(d.startDate, d.endDate)}`;

      li.innerHTML = `
        <div class="title">${mainTitle}</div>
        ${d.content ? `<div class="content"><pre>${d.content}</pre></div>` : ''}
        ${d.detail  ? `<div class="content"><pre>${d.detail}</pre></div>` : ''}
        ${renderMeta(d.startDate,d.endDate,d.periodStart,d.periodEnd,d.period)}
      `;

      if (canEdit) {
        const row = el('div', { class:'row' });

        const editBtn = el('button',{class:'btn'}); editBtn.textContent='수정';
        editBtn.addEventListener('click', ()=> openTaskEditModal(cat, id, d));

        const delBtn = el('button',{class:'btn'}); delBtn.textContent='삭제';
        delBtn.addEventListener('click', async ()=>{
          if(!confirm('삭제할까요?')) return;
          await db.doc(`users/${PUBLIC_UID}/tasks/${cat}/items/${id}`).delete();
          await safeLoadTasks(cat);
        });

        row.append(editBtn, delBtn);
        li.appendChild(row);
      }

      ul.appendChild(li);
    });
  }catch(err){
    ul.innerHTML = `<li class="meta">읽기 오류: ${err.message}</li>`;
  }
};

/* =========================
   추가(등록) 버튼들
========================= */
$('#eAddBtn')?.addEventListener('click', async ()=>{
  if(!canEdit) return;
  const payload = {
    name: ($('#eName')?.value || '').trim(),
    detail: ($('#eDetail')?.value || ''),
    startDate: $('#eStart').value ? new Date($('#eStart').value) : null,
    endDate:   $('#eEnd').value   ? new Date($('#eEnd').value)   : null,
    periodStart: asIntOrNull($('#ePStart').value),
    periodEnd:   asIntOrNull($('#ePEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.name){ alert('시험 이름을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/tasks/exams/items`).add(payload);
  ['eName','eDetail','eStart','eEnd','ePStart','ePEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('exams');
});

$('#tAddBtn')?.addEventListener('click', async ()=>{
  if(!canEdit) return;
  const payload = {
    subject: ($('#tSubj')?.value || '').trim(),
    content: ($('#tTitle')?.value || '').trim(),
    detail: ($('#tDetail')?.value || ''),
    startDate: $('#tStart').value ? new Date($('#tStart').value) : null,
    endDate:   $('#tEnd').value   ? new Date($('#tEnd').value)   : null,
    periodStart: asIntOrNull($('#tPStart').value),
    periodEnd:   asIntOrNull($('#tPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.content){ alert('내용을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/tasks/tasks/items`).add(payload);
  ['tSubj','tTitle','tDetail','tStart','tEnd','tPStart','tPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('tasks');
});

$('#hAddBtn')?.addEventListener('click', async ()=>{
  if(!canEdit) return;
  const payload = {
    subject: ($('#hSubj')?.value || '').trim(),
    content: ($('#hTitle')?.value || '').trim(),
    detail: ($('#hDetail')?.value || ''),
    startDate: $('#hStart').value ? new Date($('#hStart').value) : null,
    endDate:   $('#hEnd').value   ? new Date($('#hEnd').value)   : null,
    periodStart: asIntOrNull($('#hPStart').value),
    periodEnd:   asIntOrNull($('#hPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.content){ alert('내용을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/tasks/homeworks/items`).add(payload);
  ['hSubj','hTitle','hDetail','hStart','hEnd','hPStart','hPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('homeworks');
});

$('#sAddBtn')?.addEventListener('click', async ()=>{
  if(!canEdit) return;
  const payload = {
    title: ($('#sTitle')?.value || '').trim(),
    detail: ($('#sDetail')?.value || ''),
    startDate: $('#sStart').value ? new Date($('#sStart').value) : null,
    endDate:   $('#sEnd').value   ? new Date($('#sEnd').value)   : null,
    periodStart: asIntOrNull($('#sPStart').value),
    periodEnd:   asIntOrNull($('#sPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.title){ alert('일정 제목을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/tasks/schedules/items`).add(payload);
  ['sTitle','sDetail','sStart','sEnd','sPStart','sPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('schedules');
});

$('#hoAddBtn')?.addEventListener('click', async ()=>{
  if(!canEdit) return;
  const start = $('#hoStart').value ? new Date($('#hoStart').value) : null;
  let end = $('#hoEnd').value ? new Date($('#hoEnd').value) : null;
  if(start && !end) end = start;

  const payload = {
    title: ($('#hoTitle')?.value || '').trim(),
    detail: ($('#hoDetail')?.value || ''),
    startDate: start,
    endDate: end,
    periodStart: asIntOrNull($('#hoPStart').value),
    periodEnd:   asIntOrNull($('#hoPEnd').value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.title){ alert('휴일 이름을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/tasks/holidays/items`).add(payload);
  ['hoTitle','hoDetail','hoStart','hoEnd','hoPStart','hoPEnd'].forEach(id=>$('#'+id).value='');
  await safeLoadTasks('holidays');
});

/* =========================
   ✅ 관리자: 도메인 여러개 관리 (관리자만)
========================= */
const domainsCol = ()=> db.collection(`users/${PUBLIC_UID}/settings/domains/items`);

const renderDomainWarnBadge = (renewDateStr) => {
  const diff = daysUntilDateString(renewDateStr);
  if(diff === null) return '';
  if(diff < 0) return `<span class="dday gray">만료</span>`;
  if(diff === 0) return `<span class="warn-badge">만료 D-day</span>`;
  if(diff <= 7) return `<span class="warn-badge">만료 임박 <small>D-${diff}</small></span>`;
  return `<span class="dday green">D-${diff}</span>`;
};

const safeLoadDomains = async ()=>{
  if(!isAdmin) return;
  domList.innerHTML = '';
  domStatus.textContent = '';

  try{
    const snap = await domainsCol().get();
    if(snap.empty){
      domList.innerHTML = `<li class="meta">저장된 도메인이 없습니다.</li>`;
      return;
    }

    const docs = [];
    snap.forEach(doc=>{
      const d = doc.data() || {};
      docs.push({ id: doc.id, data: d });
    });

    docs.sort((a,b)=>{
      const da = daysUntilDateString(a.data.renewDate);
      const dbb = daysUntilDateString(b.data.renewDate);
      const aa = (da === null) ? 999999 : da;
      const bb = (dbb === null) ? 999999 : dbb;
      const ka = aa < 0 ? 999999 + Math.abs(aa) : aa;
      const kb = bb < 0 ? 999999 + Math.abs(bb) : bb;
      return ka - kb;
    });

    docs.forEach(({id, data})=>{
      const li = el('li', { class:'task' });

      const name = (data.domain || '(도메인 없음)').trim();
      const renew = (data.renewDate || '').trim();
      const badge = renderDomainWarnBadge(renew);

      li.innerHTML = `
        <div class="warn-line">
          <div class="title">${name}</div>
          ${badge}
        </div>
        ${renew ? `<div class="meta">만료일: ${renew}</div>` : `<div class="meta">만료일: (없음)</div>`}
        ${data.notes ? `<div class="content"><pre>${data.notes}</pre></div>` : ``}
      `;

      const row = el('div', { class:'row' });

      const editBtn = el('button', { class:'btn' }); editBtn.textContent = '수정';
      editBtn.addEventListener('click', ()=>{
        openModal({
          title: '도메인 수정',
          fields: [
            { key:'domain', label:'도메인', type:'text', required:true, value: data.domain || '', full:true },
            { key:'renewDate', label:'만료(연장) 일자', type:'date', required:false, value: data.renewDate || '', full:true },
            { key:'notes', label:'메모(줄바꿈 가능)', type:'textarea', required:false, value: data.notes || '', full:true },
          ],
          onSave: async (v)=>{
            const payload = {
              domain: v.domain.trim(),
              renewDate: (v.renewDate || '').trim(),
              notes: v.notes || '',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            };
            await domainsCol().doc(id).set(payload, { merge:true });
            await safeLoadDomains();
          }
        });
      });

      const delBtn = el('button', { class:'btn' }); delBtn.textContent = '삭제';
      delBtn.addEventListener('click', async ()=>{
        if(!confirm('이 도메인 항목을 삭제할까요?')) return;
        await domainsCol().doc(id).delete();
        await safeLoadDomains();
      });

      row.append(editBtn, delBtn);
      li.appendChild(row);

      domList.appendChild(li);
    });

  }catch(e){
    domStatus.textContent = `불러오기 오류: ${e.message || e}`;
  }
};

domAddBtn?.addEventListener('click', async ()=>{
  if(!isAdmin) return;

  const domain = (domName?.value || '').trim();
  const renewDate = (domRenew?.value || '').trim();
  const notes = (domNotes?.value || '');

  if(!domain){
    alert('도메인을 입력해주세요.');
    return;
  }

  domAddBtn.disabled = true;
  domAddBtn.textContent = '추가 중...';

  try{
    await domainsCol().add({
      domain,
      renewDate,
      notes,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    domName.value = '';
    domRenew.value = '';
    domNotes.value = '';
    domStatus.textContent = '추가 완료!';
    await safeLoadDomains();
  }catch(e){
    domStatus.textContent = `추가 오류: ${e.message || e}`;
  }finally{
    domAddBtn.disabled = false;
    domAddBtn.textContent = '+ 도메인 추가';
  }
});

/* =========================
   ✅ 시간표(NEIS)
========================= */
const PROXY = (NEIS_PROXY_BASE || '').replace(/\/+$/,'');
const ymdFromInput = (v)=>{
  if(!v) return '';
  const d=new Date(v);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
};
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
    li.innerHTML = `<div class="title">${perio}교시 - ${name}</div>`;
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
    const rows = data.rows || [];
    renderTT(rows);
  }catch(e){
    ttList.innerHTML = `<li class="meta">오류: ${e.message||e}</li>`;
  }finally{
    ttBtn.disabled = false; ttBtn.textContent = '불러오기';
  }
});

// ===== 시작 =====
auth.onAuthStateChanged(async (u)=>{
  currentUser = u;

  isAdmin = !!(u && ADMIN_UIDS.includes(u.uid));
  isEditor = !!(u && EDITOR_UIDS.includes(u.uid));
  canEdit = !!(isAdmin || isEditor);

  if (isAdmin) {
    userInfo.textContent = `${u.displayName} (관리자)`;
  } else if (isEditor) {
    userInfo.textContent = `${u.displayName} (부관리자)`;
  } else {
    userInfo.textContent = (u ? u.email : '비로그인 상태');
  }

  loginBtn.style.display = u ? 'none' : '';
  logoutBtn.style.display = u ? '' : 'none';

  applyRoleUI();
  initTabs();

  const d=new Date();
  if(ttDate) ttDate.value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

  await Promise.all([
    loadNoticeSwitch().then(safeLoadNotices),
    safeLoadTasks('schedules'),
    safeLoadTasks('holidays'),
    safeLoadTasks('exams'),
    safeLoadTasks('tasks'),
    safeLoadTasks('homeworks'),
  ]);

  await safeLoadDomains();
});
