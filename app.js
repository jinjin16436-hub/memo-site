/******************************
 * 0) Firebase 초기화 (환경변수 + 폴백) 
 ******************************/
(function initFirebase(){
  // Netlify/Vite 스타일 환경변수 시도
  const ENV = (typeof window !== 'undefined' && window.ENV) ? window.ENV : {};
  const env = (typeof importMeta !== 'undefined' && importMeta.env) ? importMeta.env : (typeof import !== 'undefined' && import.meta && import.meta.env ? import.meta.env : {});

  function pick(key, fallback=""){
    return (env && env[key]) || (ENV && ENV[key]) || fallback;
  }

  const firebaseConfig = {
    apiKey:             pick('VITE_FIREBASE_API_KEY',              ''), // 폴백은 비워둠
    authDomain:         pick('VITE_FIREBASE_AUTH_DOMAIN',          ''),
    projectId:          pick('VITE_FIREBASE_PROJECT_ID',           ''),
    storageBucket:      pick('VITE_FIREBASE_STORAGE_BUCKET',       ''),
    messagingSenderId:  pick('VITE_FIREBASE_MESSAGING_SENDER_ID',  ''),
    appId:              pick('VITE_FIREBASE_APP_ID',               ''),
  };

  // 만약 환경변수를 못 읽었다면(로컬 등), 필요시 아래에 직접 값 채워도 됨
  // firebaseConfig.apiKey = firebaseConfig.apiKey || "여기에_키";
  // ...

  firebase.initializeApp(firebaseConfig);
})();

const auth = firebase.auth();
const db   = firebase.firestore();

/******************************
 * 1) 고정값
 ******************************/
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";  // 관리자 UID
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";  // 공개 조회용 UID

/******************************
 * 2) DOM 헬퍼
 ******************************/
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

/******************************
 * 3) 전역
 ******************************/
let currentUser = null;
let listeners = [];   // onSnapshot 해제용

/******************************
 * 공통 UI 함수
 ******************************/
function toggleSection(id){
  const el = document.getElementById(id);
  el.classList.toggle("open");
}

function getWeekday(iso){
  if(!iso) return "";
  const d = new Date(iso+'T00:00:00');
  return ["일","월","화","수","목","금","토"][d.getDay()];
}

function dateSpanText(start, end){
  if(!start && !end) return "";
  const s = start || end;
  const e = end || start;
  const sW = getWeekday(s);
  const eW = getWeekday(e);
  if(s === e) return `${s} (${sW})`;
  return `${s} (${sW}) ~ ${e} (${eW})`;
}

function periodText(pStart, pEnd){
  if(!pStart && !pEnd) return "";
  if(pStart && !pEnd)  return `${pStart}교시`;
  if(!pStart && pEnd)  return `${pEnd}교시`;
  if(pStart === pEnd)  return `${pStart}교시`;
  return `${pStart}~${pEnd}교시`;
}

/* D-Day: 시작 기준 / 진행중 D-day(노랑) / D-1 빨강 / D-2~3 주황 / D-4~5 노랑 / 그 외 초록 / 지난 이벤트 회색 */
function renderDday(start, end){
  if(!start) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start+'T00:00:00');
  const e = new Date((end||start)+'T00:00:00');

  const diff = Math.floor((s - today) / 86400000); // 시작일까지
  let label="", cls="";

  if(today >= s && today <= e){          // 진행중
    label = "D-day"; cls = "yellow";
  }else if(diff > 0){
    label = `D-${diff}`;
    if(diff === 1) cls = "red";
    else if(diff <= 3) cls = "orange";
    else if(diff <= 5) cls = "yellow";
    else cls = "green";
  }else if(diff === 0){
    label = "D-0"; cls = "red";
  }else{
    label = "끝"; cls = "gray";
  }
  return `<span class="dday ${cls}">${label}</span>`;
}

/******************************
 * 4) Firestore 경로
 ******************************/
function col(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}
function noticesCol(){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  // users/{uid}/notices/items
  return db.collection("users").doc(uid).collection("notices").doc("items").collection("list");
}
function settingsDoc(){
  // users/{ADMIN_UID}/settings/app
  return db.collection("users").doc(ADMIN_UID).collection("settings").doc("app");
}

/******************************
 * 5) 렌더링
 ******************************/
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}

function taskItemHTML(cat, id, it){
  const dates = dateSpanText(it.start, it.end);
  const pTxt  = periodText(it.pStart, it.pEnd);
  return `
  <li class="task">
    <div class="task__main">
      <div><b>${escapeHTML(it.subj||"")}</b> ${renderDday(it.start, it.end)}</div>
      ${it.text ? `<div>${escapeHTML(it.text)}</div>` : ""}
      <div class="meta">📅 ${dates}${pTxt?` · ${pTxt}`:""}</div>
      ${it.detail ? `<pre>${escapeHTML(it.detail)}</pre>` : ""}
      ${currentUser?.uid===ADMIN_UID ? `
        <div class="card-actions" style="margin-top:10px;display:flex;gap:8px">
          <button class="btn" onclick="openEdit('${cat}','${id}')">수정</button>
          <button class="btn" onclick="doDelete('${cat}','${id}')">삭제</button>
        </div>` : ``}
    </div>
  </li>`;
}

function renderList(cat, docs){
  const ul = lists[cat];
  ul.innerHTML = docs.map(d => taskItemHTML(cat, d.id, d.data())).join("");
}

/* 전달 사항 카드 */
function noticeItemHTML(id, it){
  // 공고일: YYYY-MM-DD (요일)
  const day = it?.createdDate || (it?.createdAt?.toDate ? it.createdAt.toDate().toISOString().slice(0,10) : "");
  const metaDate = day ? `${day} (${getWeekday(day)})` : "";
  const kindCls =
    it.kind === 'notice' ? 'kind-notice' :
    it.kind === 'info'   ? 'kind-info'   :
    'kind-alert';

  const kindLabel =
    it.kind === 'notice' ? '공지' :
    it.kind === 'info'   ? '안내' : '알림';

  return `
  <li class="notice-card ${kindCls}">
    <div class="notice-title">[${kindLabel}] ${escapeHTML(it.title||'')}</div>
    ${it.body ? `<pre>${escapeHTML(it.body)}</pre>` : ""}
    <div class="notice-meta">공고일: ${metaDate}</div>
    ${currentUser?.uid===ADMIN_UID ? `
      <div class="card-actions" style="margin-top:10px;display:flex;gap:8px">
        <button class="btn" onclick="openNoticeEdit('${id}')">수정</button>
        <button class="btn" onclick="deleteNotice('${id}')">삭제</button>
      </div>
    `:``}
  </li>`;
}

/******************************
 * 6) 구독 시작/해제
 ******************************/
function startListen(){
  stopListen();

  // tasks
  ["exam","perf","home"].forEach(cat=>{
    const un = col(cat).orderBy("start","asc").onSnapshot(snap=>{
      const arr = []; snap.forEach(d=>arr.push(d));
      renderList(cat, arr);
    }, err=>{
      console.error("listener error:", err);
      alert("목록을 불러오지 못했습니다: "+err.message);
    });
    listeners.push(un);
  });

  // notices
  const un2 = noticesCol().orderBy("createdAt","desc").onSnapshot(snap=>{
    const ul = $("#notice_list");
    const arr = []; snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
    ul.innerHTML = arr.map(n => noticeItemHTML(n.id, n)).join("");
  }, err=>{
    console.error("notices error:", err);
    alert("전달 사항 목록을 불러오지 못했습니다: "+err.message);
  });
  listeners.push(un2);

  // toggle 상태
  const un3 = settingsDoc().onSnapshot(snap=>{
    const data = snap.data() || {};
    const chk = $("#noticeToggle");
    chk.checked = !!data.showNotice;
    // ON/OFF에 따라 목록 가시성만 제어
    $("#sec_notice .section-body").style.display = chk.checked ? "" : "none";
  });
  listeners.push(un3);
}
function stopListen(){
  listeners.forEach(u=>u&&u()); listeners = [];
}

/******************************
 * 7) 로그인 UI
 ******************************/
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
loginBtn.onclick  = ()=> auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = ()=> auth.signOut();

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  loginBtn.style.display  = u ? "none" : "";
  logoutBtn.style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);
  bindAddRows();  // 버튼 바인딩 재설치
  startListen();
});

function setAdminVisible(isAdmin){
  // 추가 폼 보이기/숨기기
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
  // 전달 사항 입력 폼
  $("#noticeAddRow").style.display = isAdmin ? "" : "none";
}

/******************************
 * 8) 추가폼 바인딩 & 저장
 ******************************/
function bindAddRows(){
  $$(".add-row").forEach(row=>{
    const btn = $(".add", row);
    if(!btn) return;
    btn.onclick = async ()=>{
      if(currentUser?.uid !== ADMIN_UID) { alert("관리자만 추가할 수 있습니다."); return; }

      const cat   = row.dataset.cat;
      const subj  = $(".subj", row).value.trim();
      const text  = $(".text", row).value.trim();
      const start = $(".date", row).value || "";
      const end   = $(".date2",row).value || start;
      const pStart= $(".pStart",row).value || "";
      const pEnd  = $(".pEnd", row).value || "";
      const detail= $(".detail",row).value;

      if(!subj || !start){ alert("과목/날짜는 필수입니다."); return; }

      try{
        await col(cat).add({
          subj, text, start, end, pStart, pEnd, detail,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // 입력값 초기화
        $(".subj", row).value = "";
        $(".text", row).value = "";
        $(".date", row).value = "";
        $(".date2",row).value = "";
        $(".pStart",row).value = "";
        $(".pEnd", row).value = "";
        $(".detail",row).value = "";
      }catch(e){
        alert("저장 실패: "+e.message);
        console.error(e);
      }
    };
  });

  // 전달 사항 추가
  const addBtn = $("#nAddBtn");
  if(addBtn){
    addBtn.onclick = async ()=>{
      if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
      const title = $("#nTitle").value.trim();
      const kind  = $("#nKind").value;
      const body  = $("#nBody").value;

      if(!title){ alert("제목을 입력하세요."); return; }

      try{
        const now = new Date();
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth()+1).padStart(2,'0');
        const dd = String(now.getDate()).padStart(2,'0');
        const createdDate = `${yyyy}-${mm}-${dd}`;

        await noticesCol().add({
          title, kind, body,
          createdDate, // YYYY-MM-DD (표시용)
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        $("#nTitle").value = "";
        $("#nBody").value  = "";
      }catch(e){
        alert("추가 실패: "+e.message);
        console.error(e);
      }
    };
  }

  // 전달 사항 토글 저장
  const toggle = $("#noticeToggle");
  toggle.onchange = async (e)=>{
    try{
      await settingsDoc().set({ showNotice: !!e.target.checked }, { merge:true });
    }catch(err){
      alert("토글 저장 실패: "+err.message);
    }
  };
}

/******************************
 * 9) 수정/삭제
 ******************************/
let editCtx = {cat:null, id:null};
const modal   = $("#editModal");
const mSubj   = $("#mSubj");
const mText   = $("#mText");
const mStart  = $("#mStart");
const mEnd    = $("#mEnd");
const mPStart = $("#mPStart");
const mPEnd   = $("#mPEnd");
const mDetail = $("#mDetail");
const mSave   = $("#mSave");

function openEdit(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editCtx = {cat, id};
  col(cat).doc(id).get().then(snap=>{
    const it = snap.data();
    mSubj.value   = it.subj || "";
    mText.value   = it.text || "";
    mStart.value  = it.start || "";
    mEnd.value    = it.end   || it.start || "";
    mPStart.value = it.pStart || "";
    mPEnd.value   = it.pEnd   || "";
    mDetail.value = it.detail || "";
    modal.classList.remove("hidden");
  });
}
function closeEdit(){
  modal.classList.add("hidden");
  editCtx = {cat:null, id:null};
}
mSave.onclick = async ()=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  const {cat,id} = editCtx; if(!cat||!id) return;
  const payload = {
    subj:mSubj.value.trim(),
    text:mText.value.trim(),
    start:mStart.value||"",
    end:mEnd.value||mStart.value||"",
    pStart: mPStart.value || "",
    pEnd:   mPEnd.value   || "",
    detail:mDetail.value
  };
  try{
    await col(cat).doc(id).update(payload);
    closeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};
async function doDelete(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await col(cat).doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
}

/* 전달 사항 수정/삭제 */
let nEditId = null;
const nModal = $("#noticeModal");
const nmTitle= $("#nmTitle");
const nmKind = $("#nmKind");
const nmBody = $("#nmBody");
const nmSave = $("#nmSave");

function openNoticeEdit(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  nEditId = id;
  noticesCol().doc(id).get().then(snap=>{
    const it = snap.data();
    nmTitle.value = it.title || "";
    nmKind.value  = it.kind  || "notice";
    nmBody.value  = it.body  || "";
    nModal.classList.remove("hidden");
  });
}
function closeNoticeEdit(){
  nModal.classList.add("hidden");
  nEditId = null;
}
nmSave.onclick = async ()=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  if(!nEditId) return;
  try{
    await noticesCol().doc(nEditId).update({
      title: nmTitle.value.trim(),
      kind: nmKind.value,
      body: nmBody.value
    });
    closeNoticeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};
async function deleteNotice(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await noticesCol().doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
}
