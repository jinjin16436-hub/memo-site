/* app.js - v1.2.25
 * 홈: 급식/시간표 2열 + 다가오는 일정 PC 최대 8개·모바일 최대 5개.
 * 기존 Firestore 실시간 조회 결과를 일정 미리보기에 재사용 (추가 요청 없음).
 * 기존 Google Popup 로그인, Firestore 권한, NEIS 자동/수동 조회,
 * 선택과목/이동수업/수업 장소, 수행평가·숙제 배지, 급식 조회 유지.
 * 시간표 자동 전환·조회 경과 시간·오류 표시는 변경하지 않음.
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

// 시간표 수행평가/숙제 자동 매칭용 공개 캐시
let performanceTaskItems = [];
let homeworkTaskItems = [];

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (name, attrs={}) => {
  const node = document.createElement(name);
  Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));
  return node;
};
const pad2 = n => String(n).padStart(2,'0');

// 사용자 입력 텍스트를 안전하게 HTML로 변환한 뒤 간단한 서식만 적용
// **텍스트** → 굵게, __텍스트__ → 밑줄
const escapeHTML = (value='') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatRichText = (value='') => escapeHTML(value)
  .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
  .replace(/__([^\n]+?)__/g, '<u>$1</u>');

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
const noticeImageUrlInput = $('#nImageUrl');

const ttSchool = $('#ttSchool');
const ttDate   = $('#ttDate');
const ttGrade  = $('#ttGrade');
const ttClass  = $('#ttClass');
const ttBtn    = $('#ttBtn');
const todayTimetableMeta = $('#todayTimetableMeta');
const todayTimetableList = $('#todayTimetableList');
const ttList   = $('#ttList');

// 관리자: 도메인 관리
const domName   = $('#domName');
const domRenew  = $('#domRenew');
const domNotes  = $('#domNotes');
const domAddBtn = $('#domAddBtn');
const domList   = $('#domList');
const domStatus = $('#domStatus');

// 관리자/부관리자: 시간표 관리
const tsBaseSubject = $('#tsBaseSubject');
const tsMoveClass = $('#tsMoveClass');
const tsAlternateSubject = $('#tsAlternateSubject');
const tsAddBtn = $('#tsAddBtn');
const tsList = $('#tsList');
const tsStatus = $('#tsStatus');

const tlSubject = $('#tlSubject');
const tlLocation = $('#tlLocation');
const tlAddBtn = $('#tlAddBtn');
const tlList = $('#tlList');
const tlStatus = $('#tlStatus');

const toDate = $('#toDate');
const toPeriod = $('#toPeriod');
const toSubject = $('#toSubject');
const toAction = $('#toAction');
const toAddBtn = $('#toAddBtn');
const toList = $('#toList');
const toStatus = $('#toStatus');

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
const fmtRange = (s,e)=>{
  if(!s && !e) return '';
  if(s && !e) return `${fmtDate(s)}`;
  if(!s && e) return `${fmtDate(e)}`;

  const sd = toDateOnly(s);
  const ed = toDateOnly(e);
  if(sd && ed && sd.getTime() === ed.getTime()) return `${fmtDate(s)}`;

  return `${fmtDate(s)} ~ ${fmtDate(e)}`;
};
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
const dateSortValue = (data)=>{
  const d = toDateOnly(data.startDate || data.endDate);
  return d ? d.getTime() : 9e15;
};
const periodSortValue = (v)=>{
  const n = normPeriod(asIntOrNull(v));
  return n ?? 99;
};
const createdAtSortValue = (data)=> data?.createdAt?.toMillis?.() ?? 0;
const compareTaskItems = (a,b)=>{
  const ak = sortKeyByDday(a.data);
  const bk = sortKeyByDday(b.data);
  if(ak !== bk) return ak - bk;

  const ad = dateSortValue(a.data);
  const bd = dateSortValue(b.data);
  if(ad !== bd) return ad - bd;

  const aps = periodSortValue(a.data.periodStart);
  const bps = periodSortValue(b.data.periodStart);
  if(aps !== bps) return aps - bps;

  const ape = periodSortValue(a.data.periodEnd);
  const bpe = periodSortValue(b.data.periodEnd);
  if(ape !== bpe) return ape - bpe;

  return createdAtSortValue(a.data) - createdAtSortValue(b.data);
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
    if(name === 'admin' && !canEdit) name = 'schedule';

    $$('.tab-btn', tabs).forEach(b=>b.classList.toggle('active', b.dataset.tab===name));

    const map = {
      schedule: $('#panel_schedule'),
      holiday: $('#panel_holiday'),
      exam: $('#panel_exam'),
      task: $('#panel_task'),
      homework: $('#panel_homework'),
      timetable: $('#panel_timetable'),
      meal: $('#panel_meal'),
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
    if(tab === 'admin' && !canEdit) return;

    setTab(tab);

    // 탭 전환이 끝난 뒤 해당 패널 위치로 이동
    requestAnimationFrame(()=>{
      const panel = $(`#panel_${tab}`);
      panel?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  });
};

// ===== 로그인 =====
loginBtn.addEventListener('click', async ()=>{
  const provider = new firebase.auth.GoogleAuthProvider();

  try{
    await auth.signInWithPopup(provider);
  }catch(e){
    console.error('Google 로그인 오류:', e);
    alert(`로그인 오류: ${e.message || e}`);
  }
});
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
        ${data.body ? `<div class="content"><pre>${formatRichText(data.body)}</pre></div>` : ''}
        ${data.imageUrl ? `<div class="notice-image-wrap"><img class="notice-image" src="${data.imageUrl}" loading="lazy"></div>` : ''}
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
              { key:'imageUrl', label:'이미지 URL', type:'text', value: data.imageUrl || '', full:true },
            ],
            onSave: async (v)=>{
              const payload = {
                title: v.title.trim(),
                kind: v.kind,
                body: v.body,
                imageUrl: v.imageUrl || '',
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
    imageUrl: ($('#nImageUrl')?.value || '').trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(!payload.title){ alert('제목을 입력해주세요.'); return; }
  await db.collection(`users/${PUBLIC_UID}/notices`).add(payload);
  $('#nTitle').value=''; $('#nBody').value=''; if(noticeImageUrlInput) noticeImageUrlInput.value='';
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
        await refreshTimetableViews();
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
        await refreshTimetableViews();
      }
    });
  }
};

// ===== 홈 요약 카드 =====
const summaryElements = {
  schedules: { card: $('.summary-schedule'), main: $('#summaryScheduleMain'), sub: $('#summaryScheduleSub') },
  exams: { card: $('.summary-exam'), main: $('#summaryExamMain'), sub: $('#summaryExamSub') },
  tasks: { card: $('.summary-task'), main: $('#summaryTaskMain'), sub: $('#summaryTaskSub') },
  homeworks: { card: $('.summary-homework'), main: $('#summaryHomeworkMain'), sub: $('#summaryHomeworkSub') },
};

const itemDateRange = (d={})=>{
  let start = toDateOnly(d.startDate);
  let end = toDateOnly(d.endDate);
  if(!start && end) start = end;
  if(start && !end) end = start;
  return { start, end };
};

const summaryStatusText = (d={})=>{
  const {start,end} = itemDateRange(d);
  if(!start || !end) return '날짜 미정';
  const today = toDateOnly(new Date());
  if(today > end) return '종료';
  if(today >= start && today <= end) return start.getTime() === end.getTime() ? 'D-DAY' : '진행중';
  const diff = Math.ceil((start - today) / 86400000);
  return diff === 0 ? 'D-DAY' : `D-${diff}`;
};

const summaryItemTitle = (cat,d={})=>{
  if(cat === 'exams') return d.name || '시험';
  if(cat === 'schedules') return d.title || '일정';
  if(cat === 'tasks' || cat === 'homeworks') {
    const subject = (d.subject || '').trim();
    const content = (d.content || '').trim();
    return [subject, content].filter(Boolean).join(' · ') || (cat === 'tasks' ? '수행평가' : '숙제');
  }
  return '항목';
};

// 각 탭에서 이미 읽은 데이터를 합쳐 홈의 다가오는 일정을 갱신합니다.
const upcomingCache = { schedules:null, exams:null, tasks:null, homeworks:null };
const renderHomeUpcoming = ()=>{
  const host = $('#homeUpcomingList');
  if(!host) return;
  const labels = {schedules:'일정', exams:'시험', tasks:'수행', homeworks:'숙제'};
  const entries = Object.entries(upcomingCache).flatMap(([cat,docs])=>
    (docs || []).map(({data})=>({cat, data:data||{}}))
  ).filter(({data})=>{
    const {end} = itemDateRange(data);
    return end && end >= toDateOnly(new Date());
  }).sort((a,b)=>itemDateRange(a.data).end-itemDateRange(b.data).end).slice(0,8);
  host.replaceChildren();
  if(!entries.length){
    host.textContent = Object.values(upcomingCache).some(v=>v===null)
      ? '일정을 불러오는 중...' : '예정된 일정이 없습니다.';
    return;
  }
  entries.forEach(({cat,data})=>{
    const card=el('div',{class:'upcoming-item'});
    const header=el('div',{class:'upcoming-item-head'});
    const tag=el('span',{class:`upcoming-tag upcoming-${cat}`});
    tag.textContent=labels[cat];
    const dday=el('span',{class:'upcoming-dday'});
    dday.textContent=summaryStatusText(data);
    header.append(tag,dday);
    const name=el('div',{class:'upcoming-name'});
    name.textContent=summaryItemTitle(cat,data);
    const end=itemDateRange(data).end;
    const date=el('div',{class:'upcoming-date'});
    date.textContent=end ? `${end.getMonth()+1}월 ${end.getDate()}일` : '';
    card.append(header,name,date);
    host.appendChild(card);
  });
};

const updateSummaryCard = (cat, docs=[])=>{
  if(Object.hasOwn(upcomingCache,cat)){ upcomingCache[cat]=docs; renderHomeUpcoming(); }
  const ui = summaryElements[cat];
  if(!ui?.main || !ui?.sub) return;

  const active = docs
    .map(({data})=>data || {})
    .filter(d=>{
      const {end} = itemDateRange(d);
      return !end || end >= toDateOnly(new Date());
    })
    .sort((a,b)=>{
      const ad = itemDateRange(a).start;
      const bd = itemDateRange(b).start;
      if(!ad && !bd) return 0;
      if(!ad) return 1;
      if(!bd) return -1;
      return ad - bd;
    });

  ui.card?.classList.toggle('is-empty', active.length === 0);
  if(active.length === 0){
    ui.main.textContent = '예정 없음';
    ui.sub.textContent = cat === 'schedules' ? '등록된 예정 일정이 없습니다' : `남아 있는 ${catLabel(cat)}가 없습니다`;
    return;
  }

  const next = active[0];
  const status = summaryStatusText(next);
  if(cat === 'tasks' || cat === 'homeworks'){
    ui.main.textContent = `남은 ${catLabel(cat)} ${active.length}개`;
    ui.sub.textContent = `${summaryItemTitle(cat,next)} · ${status}`;
  } else {
    ui.main.textContent = summaryItemTitle(cat,next);
    ui.sub.textContent = `${status} · 남은 항목 ${active.length}개`;
  }
};

const normalizeSubjectName = (value='')=> String(value).trim().replace(/\s+/g, '').toLowerCase();

const isDateWithinTaskRange = (date, task={})=>{
  const target = toDateOnly(date);
  if(!target) return false;
  let start = toDateOnly(task.startDate);
  let end = toDateOnly(task.endDate);
  if(!start && !end) return false;
  if(!start) start = end;
  if(!end) end = start;
  return target >= start && target <= end;
};

const isPeriodWithinTaskRange = (period, task={})=>{
  const p = normPeriod(asIntOrNull(period));
  if(!p) return false;
  let start = normPeriod(asIntOrNull(task.periodStart));
  let end = normPeriod(asIntOrNull(task.periodEnd));
  if(!start && !end) return true;
  if(!start) start = end;
  if(!end) end = start;
  return p >= Math.min(start,end) && p <= Math.max(start,end);
};

const getMatchingTasksForTimetable = (items, date, period, subject, alternate=null)=>{
  const names = new Set([
    normalizeSubjectName(subject),
    normalizeSubjectName(alternate?.alternateSubject || '')
  ].filter(Boolean));

  return items.filter(item=>{
    const task = item.data || item;
    return names.has(normalizeSubjectName(task.subject || ''))
      && isDateWithinTaskRange(date, task)
      && isPeriodWithinTaskRange(period, task);
  });
};

const getPerformanceTasksForTimetable = (date, period, subject, alternate=null)=>
  getMatchingTasksForTimetable(performanceTaskItems, date, period, subject, alternate);

const getHomeworkTasksForTimetable = (date, period, subject, alternate=null)=>
  getMatchingTasksForTimetable(homeworkTaskItems, date, period, subject, alternate);

const safeLoadTasks = async (cat)=>{
  const ul = getListForCat(cat);
  if(!ul) return;

  ul.innerHTML = '';
  try{
    const snap = await db.collection(`users/${PUBLIC_UID}/tasks/${cat}/items`).get();
    if(snap.empty){
      if(cat === 'tasks') performanceTaskItems = [];
      ul.innerHTML = `<li class="meta">등록된 ${catLabel(cat)}가 없습니다.</li>`;
      updateSummaryCard(cat, []);
      return;
    }

    const docs=[]; snap.forEach(doc=>docs.push({id:doc.id,data:doc.data()||{}}));
    docs.sort(compareTaskItems);
    if(cat === 'tasks') performanceTaskItems = docs.map(item=>({ id:item.id, data:item.data }));
    if(cat === 'homeworks') homeworkTaskItems = docs.map(item=>({ id:item.id, data:item.data }));
    updateSummaryCard(cat, docs);

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
        ${d.content ? `<div class="content"><pre>${formatRichText(d.content)}</pre></div>` : ''}
        ${d.detail  ? `<div class="content"><pre>${formatRichText(d.detail)}</pre></div>` : ''}
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
          if(cat === 'tasks' || cat === 'homeworks') await refreshTimetableViews();
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
  await refreshTimetableViews();
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
  await refreshTimetableViews();
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
  if(diff <= 30) return `<span class="warn-badge">만료 임박 <small>D-${diff}</small></span>`;
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
        ${data.notes ? `<div class="content"><pre>${formatRichText(data.notes)}</pre></div>` : ``}
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
   ✅ 시간표 관리 (관리자 + 부관리자)
========================= */
const timetableSubjectsCol = ()=> db.collection(`users/${PUBLIC_UID}/settings/timetableSubjects/items`);
const timetableLocationsCol = ()=> db.collection(`users/${PUBLIC_UID}/settings/timetableLocations/items`);
const timetableOverridesCol = ()=> db.collection(`users/${PUBLIC_UID}/settings/timetableOverrides/items`);

const refreshTimetableViews = async ()=>{
  await Promise.allSettled([
    loadTodayTimetable(),
    loadTimetableWeek({ silent:true }),
    loadMealAuto(),
  ]);
};

const loadTimetableManagementData = async ()=>{
  try{
    const [subjectSnap, locationSnap, overrideSnap] = await Promise.all([
      timetableSubjectsCol().get(),
      timetableLocationsCol().get(),
      timetableOverridesCol().get(),
    ]);

    timetableSubjectRules = subjectSnap.docs.map(doc=>({ id:doc.id, ...doc.data() }));
    timetableLocationRules = locationSnap.docs.map(doc=>({ id:doc.id, ...doc.data() }));
    timetableOverrides = overrideSnap.docs.map(doc=>({ id:doc.id, ...doc.data() }));

    timetableSubjectRules.sort((a,b)=> String(a.baseSubject||'').localeCompare(String(b.baseSubject||''), 'ko'));
    timetableLocationRules.sort((a,b)=> String(a.subject||'').localeCompare(String(b.subject||''), 'ko'));
    timetableOverrides.sort((a,b)=>{
      const dateCmp = String(a.date||'').localeCompare(String(b.date||''));
      return dateCmp || Number(a.period||0) - Number(b.period||0);
    });

    renderTimetableSubjectRules();
    renderTimetableLocationRules();
    renderTimetableOverrides();
  }catch(e){
    console.error('시간표 관리 데이터 로드 오류:', e);
    if(tsStatus) tsStatus.textContent = `불러오기 오류: ${e.message || e}`;
    if(tlStatus) tlStatus.textContent = `불러오기 오류: ${e.message || e}`;
    if(toStatus) toStatus.textContent = `불러오기 오류: ${e.message || e}`;
  }
};

const renderTimetableSubjectRules = ()=>{
  if(!tsList) return;
  tsList.innerHTML = '';
  if(!timetableSubjectRules.length){
    tsList.innerHTML = `<li class="meta">등록된 선택과목 이동수업 설정이 없습니다.</li>`;
    return;
  }

  timetableSubjectRules.forEach(rule=>{
    const li = el('li',{class:'task'});
    li.innerHTML = `
      <div class="title">${escapeHTML(rule.baseSubject || '과목 없음')}</div>
      <div class="meta">${escapeHTML(rule.moveClass || '이동 반 미지정')} 이동수업: ${escapeHTML(rule.alternateSubject || '과목 미지정')}</div>
    `;

    if(canEdit){
      const row = el('div',{class:'row management-actions'});
      const editBtn = el('button',{class:'btn'}); editBtn.textContent = '수정';
      editBtn.addEventListener('click', ()=>{
        openModal({
          title:'선택과목 / 이동수업 수정',
          fields:[
            {key:'baseSubject',label:'기준 과목',type:'text',required:true,value:rule.baseSubject||'',full:true},
            {key:'moveClass',label:'이동 반',type:'text',required:true,value:rule.moveClass||'',full:true},
            {key:'alternateSubject',label:'이동수업 과목',type:'text',required:true,value:rule.alternateSubject||'',full:true},
          ],
          onSave:async(v)=>{
            await timetableSubjectsCol().doc(rule.id).set({
              baseSubject:v.baseSubject.trim(),
              moveClass:v.moveClass.trim(),
              alternateSubject:v.alternateSubject.trim(),
              enabled:true,
              updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
            },{merge:true});
            await loadTimetableManagementData();
            await refreshTimetableViews();
          }
        });
      });
      const delBtn = el('button',{class:'btn btn--danger'}); delBtn.textContent = '삭제';
      delBtn.addEventListener('click', async()=>{
        if(!confirm('이 이동수업 설정을 삭제할까요?')) return;
        await timetableSubjectsCol().doc(rule.id).delete();
        await loadTimetableManagementData();
        await refreshTimetableViews();
      });
      row.append(editBtn,delBtn); li.appendChild(row);
    }
    tsList.appendChild(li);
  });
};


const renderTimetableLocationRules = ()=>{
  if(!tlList) return;
  tlList.innerHTML = '';

  if(!timetableLocationRules.length){
    tlList.innerHTML = `<li class="meta">등록된 수업 장소 설정이 없습니다.</li>`;
    return;
  }

  timetableLocationRules.forEach(rule=>{
    const li = el('li',{class:'task'});
    li.innerHTML = `
      <div class="title">${escapeHTML(rule.subject || '과목 없음')}</div>
      <div class="meta">수업 장소: ${escapeHTML(rule.location || '장소 미지정')}</div>
    `;

    if(canEdit){
      const row = el('div',{class:'row management-actions'});

      const editBtn = el('button',{class:'btn'});
      editBtn.textContent = '수정';
      editBtn.addEventListener('click', ()=>{
        openModal({
          title:'수업 장소 수정',
          fields:[
            {key:'subject',label:'과목명',type:'text',required:true,value:rule.subject||'',full:true},
            {key:'location',label:'수업 장소',type:'text',required:true,value:rule.location||'',full:true},
          ],
          onSave:async(v)=>{
            await timetableLocationsCol().doc(rule.id).set({
              subject:v.subject.trim(),
              location:v.location.trim(),
              enabled:true,
              updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
            },{merge:true});

            await loadTimetableManagementData();
            await refreshTimetableViews();
          }
        });
      });

      const delBtn = el('button',{class:'btn btn--danger'});
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', async()=>{
        if(!confirm('이 수업 장소 설정을 삭제할까요?')) return;
        await timetableLocationsCol().doc(rule.id).delete();
        await loadTimetableManagementData();
        await refreshTimetableViews();
      });

      row.append(editBtn,delBtn);
      li.appendChild(row);
    }

    tlList.appendChild(li);
  });
};

tlAddBtn?.addEventListener('click',async()=>{
  if(!canEdit) return;

  const subject=(tlSubject?.value||'').trim();
  const location=(tlLocation?.value||'').trim();

  if(!subject || !location){
    alert('과목명과 수업 장소를 모두 입력해주세요.');
    return;
  }

  tlAddBtn.disabled=true;

  try{
    const existing = timetableLocationRules.find(
      rule=>String(rule.subject||'').trim() === subject
    );

    const ref = existing
      ? timetableLocationsCol().doc(existing.id)
      : timetableLocationsCol().doc();

    await ref.set({
      subject,
      location,
      enabled:true,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      ...(existing ? {} : {
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      }),
    },{merge:true});

    tlSubject.value='';
    tlLocation.value='';

    if(tlStatus){
      tlStatus.textContent = existing
        ? '기존 장소 설정을 갱신했습니다.'
        : '수업 장소를 추가했습니다.';
    }

    await loadTimetableManagementData();
    await refreshTimetableViews();
  }catch(e){
    if(tlStatus) tlStatus.textContent=`추가 오류: ${e.message||e}`;
  }finally{
    tlAddBtn.disabled=false;
  }
});

const renderTimetableOverrides = ()=>{
  if(!toList) return;
  toList.innerHTML = '';
  if(!timetableOverrides.length){
    toList.innerHTML = `<li class="meta">등록된 임시 시간표 수정이 없습니다.</li>`;
    return;
  }

  timetableOverrides.forEach(item=>{
    const li = el('li',{class:'task'});
    const isDelete = item.action === 'delete';
    li.innerHTML = `
      <div class="title"><span class="override-date">${escapeHTML(item.date || '')}</span> · ${escapeHTML(item.period || '')}교시</div>
      <div class="meta ${isDelete ? 'override-delete' : ''}">${isDelete ? '이 교시를 시간표에서 숨김' : `변경/추가: ${escapeHTML(item.subject || '')}`}</div>
    `;
    if(canEdit){
      const row = el('div',{class:'row management-actions'});
      const editBtn = el('button',{class:'btn'}); editBtn.textContent='수정';
      editBtn.addEventListener('click',()=>{
        openModal({
          title:'임시 시간표 수정',
          fields:[
            {key:'date',label:'날짜',type:'date',required:true,value:item.date||'',full:true},
            {key:'period',label:'교시 (1~7)',type:'number',required:true,value:item.period||'',full:true},
            {key:'subject',label:'변경 과목 (교시 삭제면 비워도 됨)',type:'text',required:false,value:item.subject||'',full:true},
          ],
          onSave:async(v)=>{
            const period = Number(v.period);
            if(!Number.isInteger(period) || period < 1 || period > 7) throw new Error('교시는 1~7 사이로 입력해주세요.');
            if(item.action !== 'delete' && !v.subject.trim()) throw new Error('변경 과목을 입력해주세요.');
            await timetableOverridesCol().doc(item.id).set({
              date:v.date,
              period,
              subject:item.action === 'delete' ? '' : v.subject.trim(),
              action:item.action || 'upsert',
              updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
            },{merge:true});
            await loadTimetableManagementData();
            await refreshTimetableViews();
          }
        });
      });
      const delBtn=el('button',{class:'btn btn--danger'}); delBtn.textContent='삭제';
      delBtn.addEventListener('click',async()=>{
        if(!confirm('이 임시 시간표 수정을 삭제할까요?')) return;
        await timetableOverridesCol().doc(item.id).delete();
        await loadTimetableManagementData();
        await refreshTimetableViews();
      });
      row.append(editBtn,delBtn); li.appendChild(row);
    }
    toList.appendChild(li);
  });
};

tsAddBtn?.addEventListener('click',async()=>{
  if(!canEdit) return;
  const baseSubject=(tsBaseSubject?.value||'').trim();
  const moveClass=(tsMoveClass?.value||'').trim();
  const alternateSubject=(tsAlternateSubject?.value||'').trim();
  if(!baseSubject || !moveClass || !alternateSubject){ alert('기준 과목, 이동 반, 이동수업 과목을 모두 입력해주세요.'); return; }
  tsAddBtn.disabled=true;
  try{
    await timetableSubjectsCol().add({baseSubject,moveClass,alternateSubject,enabled:true,createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    tsBaseSubject.value=''; tsMoveClass.value=''; tsAlternateSubject.value='';
    if(tsStatus) tsStatus.textContent='추가 완료!';
    await loadTimetableManagementData(); await refreshTimetableViews();
  }catch(e){ if(tsStatus) tsStatus.textContent=`추가 오류: ${e.message||e}`; }
  finally{ tsAddBtn.disabled=false; }
});

const syncOverrideSubjectState = ()=>{
  if(!toSubject || !toAction) return;
  const deleting = toAction.value === 'delete';
  toSubject.disabled = deleting;
  toSubject.placeholder = deleting ? '교시 삭제에서는 입력하지 않습니다' : '예: 물질과 에너지';
  if(deleting) toSubject.value='';
};
toAction?.addEventListener('change',syncOverrideSubjectState);

toAddBtn?.addEventListener('click',async()=>{
  if(!canEdit) return;
  const date=(toDate?.value||'').trim();
  const period=Number(toPeriod?.value||0);
  const action=toAction?.value||'upsert';
  const subject=(toSubject?.value||'').trim();
  if(!date || !Number.isInteger(period) || period<1 || period>7){ alert('날짜와 교시를 선택해주세요.'); return; }
  if(action==='upsert' && !subject){ alert('변경할 과목을 입력해주세요.'); return; }
  toAddBtn.disabled=true;
  try{
    // 같은 날짜+교시는 하나만 유지하여 중복 적용을 방지합니다.
    const existing = timetableOverrides.find(x=>x.date===date && Number(x.period)===period);
    const ref = existing ? timetableOverridesCol().doc(existing.id) : timetableOverridesCol().doc();
    await ref.set({date,period,action,subject:action==='delete'?'':subject,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),...(existing?{}:{createdAt:firebase.firestore.FieldValue.serverTimestamp()})},{merge:true});
    toPeriod.value=''; toSubject.value='';
    if(toStatus) toStatus.textContent=existing?'기존 수정사항을 갱신했습니다.':'수정사항을 등록했습니다.';
    await loadTimetableManagementData(); await refreshTimetableViews();
  }catch(e){ if(toStatus) toStatus.textContent=`등록 오류: ${e.message||e}`; }
  finally{ toAddBtn.disabled=false; }
});

/* =========================
   ✅ 시간표(NEIS)
========================= */
const PROXY = (NEIS_PROXY_BASE || '').replace(/\/+$/,'');

const TIMETABLE_DEFAULTS = Object.freeze({
  schoolName: '부광고등학교',
  grade: '2',
  classNm: '2',
});

// Firestore에서 불러온 선택과목/이동수업 및 날짜별 임시 변경 캐시
let timetableSubjectRules = [];
let timetableLocationRules = [];
let timetableOverrides = [];

const isDefaultClassConfig = (config=TIMETABLE_DEFAULTS)=>
  String(config.grade) === String(TIMETABLE_DEFAULTS.grade)
  && String(config.classNm) === String(TIMETABLE_DEFAULTS.classNm);

const getAlternateSubject = (subject, config=TIMETABLE_DEFAULTS)=>{
  if(!isDefaultClassConfig(config)) return null;
  const key = String(subject || '').trim();
  if(!key) return null;
  return timetableSubjectRules.find(rule=> rule.enabled !== false && rule.baseSubject === key) || null;
};

const getTimetableLocation = (subject, config=TIMETABLE_DEFAULTS)=>{
  if(!isDefaultClassConfig(config)) return null;
  const key = String(subject || '').trim();
  if(!key) return null;

  const rule = timetableLocationRules.find(
    item=>item.enabled !== false && String(item.subject||'').trim() === key
  );

  return rule?.location ? String(rule.location).trim() : null;
};

const ymdFromDate = (d)=>{
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
};

const dateInputValue = (d)=>{
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};

const getWeekdaysFromInput = (v)=>{
  const base = new Date(v);
  if(Number.isNaN(base.getTime())) return [];

  const day = base.getDay(); // 일0 월1 ... 토6
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMonday);

  return Array.from({ length: 5 }, (_, i)=>{
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
};

const weekdayText = ['일','월','화','수','목','금','토'];

const fmtTTDate = (d)=>{
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} (${weekdayText[d.getDay()]})`;
};

// 홈 자동 시간표는 한국 시간(KST)을 기준으로 선택합니다.
// 16:35부터는 다음 수업일을 표시하고, 주말은 다음 월요일로 넘깁니다.
const getKoreaDateTimeParts = (baseDate=new Date())=>{
  const parts = new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Seoul',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(baseDate);
  const values = Object.fromEntries(parts.map(part=>[part.type, part.value]));
  return {
    year:Number(values.year), month:Number(values.month), day:Number(values.day),
    hour:Number(values.hour), minute:Number(values.minute)
  };
};

const getAutoTimetableInfo = (baseDate=new Date())=>{
  const kst = getKoreaDateTimeParts(baseDate);
  const target = new Date(kst.year, kst.month - 1, kst.day, 12, 0, 0, 0);
  const afterCutoff = kst.hour > 16 || (kst.hour === 16 && kst.minute >= 35);

  if(afterCutoff) target.setDate(target.getDate() + 1);

  // 토/일이면 다음 월요일로 이동합니다.
  if(target.getDay() === 6) target.setDate(target.getDate() + 2);
  else if(target.getDay() === 0) target.setDate(target.getDate() + 1);

  const todayKst = new Date(kst.year, kst.month - 1, kst.day, 12, 0, 0, 0);
  const shifted = target.getFullYear() !== todayKst.getFullYear()
    || target.getMonth() !== todayKst.getMonth()
    || target.getDate() !== todayKst.getDate();

  return { targetDate:target, shifted, afterCutoff };
};

const getAutoTimetableDate = (baseDate=new Date())=> getAutoTimetableInfo(baseDate).targetDate;

const isWeekendDate = (date)=> date.getDay() === 0 || date.getDay() === 6;

const getJSON = async (url)=>{
  const r = await fetch(url,{
    headers:{
      'Accept':'application/json'
    }
  });

  // Worker/NEIS가 오류 상태 코드를 반환하더라도 본문에
  // 실제 오류 정보가 들어있는 경우가 있어 먼저 본문을 읽습니다.
  const text = await r.text();

  try{
    const data = JSON.parse(text);

    // 정상적인 JSON 응답이면 상태 코드와 관계없이 호출부에서 처리합니다.
    // 다만 JSON 안에 명시적인 error/message가 있고 HTTP도 실패라면
    // 디버깅이 쉽도록 메시지를 보존합니다.
    if(!r.ok && data && !Array.isArray(data.rows)) {
      const message = data.error || data.message || data.RESULT?.MESSAGE;
      if(message) throw new Error(`${message} (HTTP ${r.status})`);
    }

    return data;
  }catch(e){
    // JSON 파싱 실패라면 HTTP 상태와 짧은 본문을 함께 보여줍니다.
    if(e instanceof SyntaxError){
      const preview = text.trim().slice(0, 180);
      throw new Error(`시간표 서버 응답 오류 (HTTP ${r.status})${preview ? `: ${preview}` : ''}`);
    }
    throw e;
  }
};

const getTimetableConfig = ()=>({
  schoolName: (ttSchool?.value || TIMETABLE_DEFAULTS.schoolName).trim(),
  grade: (ttGrade?.value || TIMETABLE_DEFAULTS.grade).trim(),
  classNm: (ttClass?.value || TIMETABLE_DEFAULTS.classNm).trim(),
});

const applyTimetableDefaults = ()=>{
  const now = new Date();
  if(ttSchool && !ttSchool.value) ttSchool.value = TIMETABLE_DEFAULTS.schoolName;
  if(ttDate && !ttDate.value) ttDate.value = dateInputValue(now);
  if(ttGrade && !ttGrade.value) ttGrade.value = TIMETABLE_DEFAULTS.grade;
  if(ttClass && !ttClass.value) ttClass.value = TIMETABLE_DEFAULTS.classNm;
};

const applyTimetableOverrides = (rows=[], date, config=TIMETABLE_DEFAULTS)=>{
  if(!isDefaultClassConfig(config)) return [...rows];

  const dateKey = dateInputValue(date);
  const dayOverrides = timetableOverrides.filter(item=>item.date === dateKey);
  if(!dayOverrides.length) return [...rows];

  const result = rows.map(row=>({...row}));
  dayOverrides.forEach(item=>{
    const period = Number(item.period);
    const index = result.findIndex(row=>Number(row.PERIO || row.ORD || 0) === period);

    if(item.action === 'delete'){
      if(index >= 0) result.splice(index,1);
      return;
    }

    const subject = String(item.subject || '').trim();
    if(!subject) return;

    if(index >= 0){
      result[index] = { ...result[index], PERIO:String(period), ITRT_CNTNT:subject, SUBJECT:subject, TI_NM:subject, _manualOverride:true };
    }else{
      result.push({ PERIO:String(period), ITRT_CNTNT:subject, SUBJECT:subject, TI_NM:subject, _manualOverride:true });
    }
  });

  return result;
};

const fetchTimetableDay = async (date, config=getTimetableConfig())=>{
  const ymd = ymdFromDate(date);
  const url = `${PROXY}/api/timetable?schoolName=${encodeURIComponent(config.schoolName)}&ymd=${ymd}&grade=${encodeURIComponent(config.grade)}&classNm=${encodeURIComponent(config.classNm)}`;
  const data = await getJSON(url);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return applyTimetableOverrides(rows, date, config);
};

const sortTimetableRows = (rows=[])=>{
  return [...rows].sort((a,b)=> parseInt(a.PERIO||a.ORD||'0') - parseInt(b.PERIO||b.ORD||'0'));
};

const renderTTWeek = (items=[])=>{
  ttList.innerHTML = '';

  if(!items.length){
    ttList.innerHTML = `<li class="meta">해당 주의 시간표가 없습니다.</li>`;
    return;
  }

  let hasAnyRow = false;

  items.forEach(({ date, rows })=>{
    const dayTitle = el('li',{class:'meta'});
    dayTitle.innerHTML = `<strong>${fmtTTDate(date)}</strong>`;
    ttList.appendChild(dayTitle);

    if(!rows.length){
      const empty = el('li',{class:'task'});
      empty.innerHTML = `<div class="title">시간표 없음</div>`;
      ttList.appendChild(empty);
      return;
    }

    hasAnyRow = true;
    sortTimetableRows(rows).forEach(r=>{
      const li = el('li',{class:'task'});
      const perio = r.PERIO || r.ORD || '';
      const name  = r.ITRT_CNTNT || r.SUBJECT || r.TI_NM || '';
      const timetableConfig = { grade: ttGrade?.value, classNm: ttClass?.value };
      const alternate = getAlternateSubject(name, timetableConfig);
      const location = getTimetableLocation(name, timetableConfig);
      const basePerformance = getPerformanceTasksForTimetable(date, perio, name).length > 0;
      const baseHomework = getHomeworkTasksForTimetable(date, perio, name).length > 0;
      const alternatePerformance = alternate
        ? getPerformanceTasksForTimetable(date, perio, alternate.alternateSubject).length > 0
        : false;
      const alternateHomework = alternate
        ? getHomeworkTasksForTimetable(date, perio, alternate.alternateSubject).length > 0
        : false;
      const hasPerformance = basePerformance || alternatePerformance;
      const hasHomework = baseHomework || alternateHomework;
      if(hasPerformance) li.classList.add('timetable-performance');
      if(hasHomework) li.classList.add('timetable-homework');

      li.innerHTML = `
        <div class="title">${escapeHTML(perio)}교시 - ${escapeHTML(name)} ${basePerformance ? '<span class="timetable-performance-badge">[수행]</span>' : ''}${baseHomework ? '<span class="timetable-homework-badge">[숙제]</span>' : ''}</div>
        ${location ? `<div class="meta timetable-location">장소: ${escapeHTML(location)}</div>` : ''}
        ${alternate ? `<div class="meta">${escapeHTML(alternate.moveClass)} 이동수업: ${escapeHTML(alternate.alternateSubject)} ${alternatePerformance ? '<span class="timetable-performance-badge">[수행]</span>' : ''}${alternateHomework ? '<span class="timetable-homework-badge">[숙제]</span>' : ''}</div>` : ''}
      `;
      ttList.appendChild(li);
    });
  });

  if(!hasAnyRow){
    const note = el('li',{class:'meta'});
    note.textContent = '월~금 전체에 등록된 시간표가 없습니다.';
    ttList.appendChild(note);
  }
};

const renderTodayTimetable = (rows=[], date=new Date(), { weekendRedirect=false }={})=>{
  if(!todayTimetableList || !todayTimetableMeta) return;

  todayTimetableList.innerHTML = '';
  const prefix = weekendRedirect ? `다음 수업일 · ${fmtTTDate(date)} · ` : '';
  todayTimetableMeta.textContent = `${prefix}${TIMETABLE_DEFAULTS.grade}학년 ${TIMETABLE_DEFAULTS.classNm}반`;

  if(!rows.length){
    todayTimetableList.innerHTML = `<div class="today-timetable-empty">${weekendRedirect ? '다음 월요일' : '오늘'}은 등록된 수업이 없습니다.</div>`;
    return;
  }

  sortTimetableRows(rows).forEach(r=>{
    const perio = r.PERIO || r.ORD || '';
    const name = r.ITRT_CNTNT || r.SUBJECT || r.TI_NM || '과목 정보 없음';
    const alternate = getAlternateSubject(name);
    const location = getTimetableLocation(name);
    const basePerformance = getPerformanceTasksForTimetable(date, perio, name).length > 0;
    const baseHomework = getHomeworkTasksForTimetable(date, perio, name).length > 0;
    const alternatePerformance = alternate
      ? getPerformanceTasksForTimetable(date, perio, alternate.alternateSubject).length > 0
      : false;
    const alternateHomework = alternate
      ? getHomeworkTasksForTimetable(date, perio, alternate.alternateSubject).length > 0
      : false;
    const hasPerformance = basePerformance || alternatePerformance;
    const hasHomework = baseHomework || alternateHomework;
    const item = el('div',{class:`today-period${hasPerformance ? ' timetable-performance' : ''}${hasHomework ? ' timetable-homework' : ''}`});
    item.innerHTML = `
      <span class="period-no">${escapeHTML(perio)}교시</span>
      <div class="period-subject-wrap">
        <span class="period-subject" title="${escapeHTML(name)}">${escapeHTML(name)} ${basePerformance ? '<span class="timetable-performance-badge">[수행]</span>' : ''}${baseHomework ? '<span class="timetable-homework-badge">[숙제]</span>' : ''}</span>
        ${location ? `<small class="period-location">${escapeHTML(location)}</small>` : ''}
        ${alternate ? `
          <small class="period-alternate">${escapeHTML(alternate.moveClass)} · ${escapeHTML(alternate.alternateSubject)} ${alternatePerformance ? '<span class="timetable-performance-badge">[수행]</span>' : ''}${alternateHomework ? '<span class="timetable-homework-badge">[숙제]</span>' : ''}</small>
        ` : ''}
      </div>
    `;
    todayTimetableList.appendChild(item);
  });
};

const loadTodayTimetable = async ()=>{
  if(!todayTimetableList || !todayTimetableMeta) return;

  if(!PROXY){
    todayTimetableMeta.textContent = '시간표 자동 조회를 사용할 수 없습니다.';
    todayTimetableList.innerHTML = `<div class="today-timetable-empty">NEIS_PROXY_BASE 설정을 확인해주세요.</div>`;
    return;
  }

  const now = new Date();
  const autoInfo = getAutoTimetableInfo(now);
  const targetDate = autoInfo.targetDate;
  const weekendRedirect = autoInfo.shifted;
  const loadingMessage = autoInfo.shifted
    ? (autoInfo.afterCutoff ? '16:35 이후라 다음 수업일 시간표를 불러오는 중...' : '주말이라 다음 수업일 시간표를 불러오는 중...')
    : '오늘 시간표를 자동으로 불러오는 중...';

  // performance.now()로 실제 경과 시간을 측정하고 조회 중에도 표시한다.
  const startedAt = performance.now();
  const elapsedText = ()=> `${((performance.now() - startedAt) / 1000).toFixed(1)}초`;
  todayTimetableMeta.textContent = `${loadingMessage} (${elapsedText()} 경과)`;
  todayTimetableList.innerHTML = `<div class="today-timetable-empty">불러오는 중...</div>`;
  const elapsedTimer = setInterval(()=>{
    todayTimetableMeta.textContent = `${loadingMessage} (${elapsedText()} 경과)`;
  }, 100);

  try{
    const rows = await fetchTimetableDay(targetDate);
    clearInterval(elapsedTimer);
    renderTodayTimetable(rows, targetDate, { weekendRedirect });
    todayTimetableMeta.textContent += ` · ${elapsedText()} 소요`;
  }catch(e){
    clearInterval(elapsedTimer);
    console.error('오늘 시간표 자동 조회 오류:', e);
    todayTimetableMeta.textContent = `시간표를 불러오지 못했습니다. (${elapsedText()} 소요)`;
    todayTimetableList.innerHTML = `
      <div class="today-timetable-empty">
        ${escapeHTML(e.message || String(e))}
      </div>
    `;
  }
};

const loadTimetableWeek = async ({ silent=false }={})=>{
  if(!PROXY){
    if(!silent) alert('env.js의 NEIS_PROXY_BASE를 설정해주세요(Cloudflare Worker URL).');
    return;
  }

  applyTimetableDefaults();

  const schoolName = ttSchool.value.trim();
  const days = getWeekdaysFromInput(ttDate.value);
  const grade = ttGrade.value.trim();
  const classNm = ttClass.value.trim();

  if(!schoolName || !days.length || !grade || !classNm){
    if(!silent) alert('학교명/기준 날짜/학년/반을 모두 입력해주세요.');
    return;
  }

  if(ttBtn){
    ttBtn.disabled = true;
    ttBtn.textContent = '주간 시간표 불러오는 중...';
  }

  try{
    const config = { schoolName, grade, classNm };
    const items = await Promise.all(days.map(async (date)=>({
      date,
      rows: await fetchTimetableDay(date, config),
    })));

    renderTTWeek(items);
  }catch(e){
    ttList.innerHTML = `<li class="meta">오류: ${escapeHTML(e.message||e)}</li>`;
    console.error('주간 시간표 조회 오류:', e);
  }finally{
    if(ttBtn){
      ttBtn.disabled = false;
      ttBtn.textContent = '다시 불러오기';
    }
  }
};

ttBtn?.addEventListener('click', ()=> loadTimetableWeek());

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

  applyTimetableDefaults();

  await Promise.all([
    loadNoticeSwitch().then(safeLoadNotices),
    safeLoadTasks('schedules'),
    safeLoadTasks('holidays'),
    safeLoadTasks('exams'),
    safeLoadTasks('tasks'),
    safeLoadTasks('homeworks'),
  ]);

  await safeLoadDomains();

  // 시간표 설정은 공개 읽기이므로 로그인 여부와 관계없이 먼저 불러옵니다.
  await loadTimetableManagementData();
  if(toDate && !toDate.value) toDate.value = dateInputValue(new Date());
  syncOverrideSubjectState();

  // 로그인 여부와 관계없이 오늘/주간 시간표를 자동으로 불러옵니다.
  await Promise.allSettled([
    loadTodayTimetable(),
    loadTimetableWeek({ silent:true }),
  ]);
});


/* =========================
   v1.2.8 대시보드 UI 보조
========================= */
const initDashboardUI = ()=>{
  const heroDate = $('#heroDate');
  if(heroDate){
    const now = new Date();
    const weekdays = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
    heroDate.textContent = `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${weekdays[now.getDay()]}`;
  }

  const mobileMenuBtn = $('#mobileMenuBtn');
  const mobileMenuBackdrop = $('#mobileMenuBackdrop');
  const closeMobileMenu = ()=> document.body.classList.remove('menu-open');

  mobileMenuBtn?.addEventListener('click', ()=>{
    document.body.classList.toggle('menu-open');
  });
  mobileMenuBackdrop?.addEventListener('click', closeMobileMenu);

  $$('.tab-btn, .sidebar-link').forEach(item=>{
    item.addEventListener('click', ()=>{
      if(window.matchMedia('(max-width: 820px)').matches) closeMobileMenu();
    });
  });

  $$('.quick-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tab = btn.dataset.targetTab;
      const target = $(`.tab-btn[data-tab="${tab}"]`);
      if(!target) return;
      target.click();
      const panel = $(`#panel_${tab}`);
      panel?.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') closeMobileMenu();
  });
};

initDashboardUI();


/* =========================
   v1.2.20 NEIS 급식 (KST 16:35 자동 전환)
   기존 시간표 및 Firebase 로직과 독립적으로 동작
========================= */
const mealDateInput = $('#mealDate');
const mealStatus = $('#mealStatus');
const mealDaily = $('#mealDaily');
const mealWeek = $('#mealWeek');
const mealWeekStatus = $('#mealWeekStatus');
let mealRequestId = 0;
let mealAutoKey = '';
const mealCache = new Map();
const mealEsc = (value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mealDateFromValue = (v)=>{
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v||'');
  if(!m) return null;
  const d = new Date(+m[1],+m[2]-1,+m[3],12);
  return dateInputValue(d)===v?d:null;
};
const mealMonday = (d)=>{
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay()+6)%7));
  return x;
};
const mealPlain = (s)=>String(s||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').trim();
const mealList = (s)=>mealPlain(s).split(/\n+/).map(x=>x.trim()).filter(Boolean);
const mealEntry = (row)=>{
  const dishes = mealList(row.DDISH_NM).map(line=>{
    const allergens = [...line.matchAll(/\((\d+(?:[.,]\s*\d+)*)\)/g)].flatMap(m=>m[1].split(/[.,]/).map(x=>x.trim()));
    return {name:line.replace(/\(\d+(?:[.,]\s*\d+)*\)/g,'').trim(),allergens};
  });
  return {name:row.MMEAL_SC_NM||'급식',dishes,calorie:mealPlain(row.CAL_INFO),nutrition:mealList(row.NTR_INFO)};
};
const mealCard = (entry, compact=false)=>`<article class="meal-card"><h3>${mealEsc(entry.name)}</h3><ul class="meal-dishes">${entry.dishes.map(d=>`<li>${mealEsc(d.name)}${d.allergens.length?` <small class="meal-allergen">${mealEsc(d.allergens.join(', '))}</small>`:''}</li>`).join('')}</ul>${entry.calorie?`<div class="meal-calorie">🔥 ${mealEsc(entry.calorie)}</div>`:''}${entry.nutrition&&!compact?`<details class="meal-nutrition"><summary>영양 정보</summary><ul>${entry.nutrition.map(n=>`<li>${mealEsc(n)}</li>`).join('')}</ul></details>`:''}</article>`;
const mealEmpty = '<div class="meal-empty">이 날짜에는 등록된 급식이 없습니다.</div>';
const mealFetch = async (d)=>{
  const key=ymdFromDate(d);
  if(mealCache.has(key)) return mealCache.get(key);
  if(!PROXY) throw new Error('NEIS_PROXY_BASE가 설정되지 않았습니다.');
  const url=`${PROXY}/api/meal?schoolName=${encodeURIComponent(TIMETABLE_DEFAULTS.schoolName)}&ymd=${key}`;
  const r=await fetch(url,{headers:{Accept:'application/json'}});
  const data=await r.json().catch(()=>{throw new Error('Worker가 올바른 JSON을 반환하지 않았습니다.');});
  if(!r.ok||data.error) throw new Error(data.error||`급식 조회 오류 (HTTP ${r.status})`);
  if(!Array.isArray(data.rows)) throw new Error('Worker 급식 응답 형식이 올바르지 않습니다.');
  const entries=data.rows.map(mealEntry);
  mealCache.set(key,entries);
  return entries;
};
const mealTimer = (element,message)=>{
  const start=performance.now();
  const update=()=>{if(element)element.textContent=`${message} (${((performance.now()-start)/1000).toFixed(1)}초 경과)`;};
  update();const id=setInterval(update,100);
  return (end)=>{clearInterval(id);if(element)element.textContent=`${end} (${((performance.now()-start)/1000).toFixed(1)}초 소요)`;};
};
const loadMealHome = async ()=>{
  const info=getAutoTimetableInfo();
  const key=dateInputValue(info.targetDate);
  mealAutoKey=key;
  const meta=$('#homeMealMeta'), content=$('#homeMealContent');
  if(!meta||!content)return;
  content.innerHTML='';
  const finish=mealTimer(meta,info.shifted?'16:35 전환 또는 주말 기준 다음 수업일 급식을 불러오는 중...':'오늘 급식을 불러오는 중...');
  try{
    const rows=await mealFetch(info.targetDate);
    finish(`${fmtTTDate(info.targetDate)} 급식 조회 완료`);
    content.innerHTML=rows.length?rows.map(x=>mealCard(x,true)).join(''):mealEmpty;
  }catch(e){finish(`급식 조회 실패: ${e.message}`);content.innerHTML='<div class="meal-empty">급식 정보를 불러오지 못했습니다.</div>';}
};
const loadMealDaily = async ()=>{
  const d=mealDateFromValue(mealDateInput?.value);
  if(!d)return;
  const request=++mealRequestId;
  mealDaily.innerHTML='';
  const finish=mealTimer(mealStatus,`${fmtTTDate(d)} 급식을 불러오는 중...`);
  try{
    const rows=await mealFetch(d);
    if(request!==mealRequestId){finish('이전 조회 취소');return;}
    finish(`${fmtTTDate(d)} 급식 조회 완료`);
    mealDaily.innerHTML=rows.length?rows.map(x=>mealCard(x)).join(''):mealEmpty;
  }catch(e){finish(`급식 조회 실패: ${e.message}`);if(request===mealRequestId)mealDaily.innerHTML='<div class="meal-empty">급식 정보를 불러오지 못했습니다.</div>';}
};
let mealWeekRequestId=0;
const loadMealWeek = async ()=>{
  const selected=mealDateFromValue(mealDateInput?.value);
  if(!selected)return;
  const request=++mealWeekRequestId;
  const monday=mealMonday(selected);
  mealWeek.innerHTML='';
  const finish=mealTimer(mealWeekStatus,'주간 급식을 불러오는 중...');
  const dates=Array.from({length:5},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return d;});
  // 각 날짜별 독립 조회: 특정 날짜에 데이터가 없어도 다른 날짜는 표시
  const result=await Promise.allSettled(dates.map(d=>mealFetch(d)));
  if(request!==mealWeekRequestId){finish('이전 조회 취소');return;}
  finish('주간 급식 조회 완료');
  mealWeek.innerHTML=result.map((r,i)=>`<section class="meal-week-day"><h3>${mealEsc(fmtTTDate(dates[i]))}</h3>${r.status==='rejected'?`<div class="meal-empty">조회 실패: ${mealEsc(r.reason?.message||'오류')}</div>`:r.value.length?r.value.map(x=>mealCard(x,true)).join(''):mealEmpty}</section>`).join('');
};
const loadMealAuto=async ()=>{
  if(!mealDateInput)return;
  mealDateInput.value=dateInputValue(getAutoTimetableDate());
  await Promise.allSettled([loadMealHome(),loadMealDaily(),loadMealWeek()]);
};
mealDateInput?.addEventListener('change',()=>{loadMealDaily();loadMealWeek();});
$('#mealPrev')?.addEventListener('click',()=>{const d=mealDateFromValue(mealDateInput.value);if(!d)return;d.setDate(d.getDate()-1);mealDateInput.value=dateInputValue(d);loadMealDaily();loadMealWeek();});
$('#mealNext')?.addEventListener('click',()=>{const d=mealDateFromValue(mealDateInput.value);if(!d)return;d.setDate(d.getDate()+1);mealDateInput.value=dateInputValue(d);loadMealDaily();loadMealWeek();});
$('#mealAuto')?.addEventListener('click',loadMealAuto);
$('#mealWeekRefresh')?.addEventListener('click',()=>{mealCache.clear();loadMealWeek();});
// 페이지를 켜 둔 상태에서도 한국 시간 16:35가 지나면 홈 급식 자동 갱신
setInterval(()=>{
  const key=dateInputValue(getAutoTimetableDate());
  if(mealAutoKey&&mealAutoKey!==key){mealCache.clear();loadMealHome();}
},30000);

// v1.2.21: 페이지 최초 진입 시 홈/일일/주간 급식을 자동 조회
loadMealAuto();
