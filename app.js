/***** 0) Firebase 초기화 *****/
const firebaseConfig = {
  // 본인 프로젝트 값으로 유지
  apiKey: "AIzaSyBbThwhLWHJz8mBHGvhpWOL88cP9C7Nxio",
  authDomain: "my-memo-site.firebaseapp.com",
  projectId: "my-memo-site",
  storageBucket: "my-memo-site.firebasestorage.app",
  messagingSenderId: "196036694705",
  appId: "1:196036694705:web:8988d12919420130464890",
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();

/***** 1) 상수/툴 *****/
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2"; // ★ 관리자 UID 로 교체
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2"; // 공개 조회용(동일)

const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

let currentUser = null;
let listeners = [];

/***** 2) 공용 함수 *****/
function toggleSection(id){
  const el = document.getElementById(id);
  el.classList.toggle("open");
  el.style.display = el.classList.contains("open") ? "" : "none";
}

// 날짜 → 요일
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

// D-Day (시작 기준, 진행중은 D-day)
function renderDday(start, end){
  if(!start) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start+'T00:00:00');
  const e = new Date((end||start)+'T00:00:00');

  const diff = Math.floor((s - today) / 86400000);
  let label="", cls="";

  if(today >= s && today <= e){
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

function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}

/***** 3) Firestore 경로 *****/
function tasksCol(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}
// 공지
function announcesCol(uid) {
  return db.collection("users").doc(uid).collection("announces");
}
// 설정(app)
function settingsDoc(uid) {
  return db.collection("users").doc(uid).collection("settings").doc("app");
}

/***** 4) 과목/숙제/수행 렌더링 *****/
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

function taskItemHTML(cat, id, it){
  // 표기 순서: 과목 → 내용 → 상세내용 → 날짜
  return `
  <li class="task">
    <div class="task__main">
      <div class="title">
        ${escapeHTML(it.subj||"")}
        ${renderDday(it.start, it.end)}
      </div>
      ${it.text ? `<div class="body">${escapeHTML(it.text)}</div>` : ""}
      ${it.detail ? `<pre>${escapeHTML(it.detail)}</pre>` : ""}
      <div class="meta">
        📅 ${dateSpanText(it.start, it.end)}
        ${it.pStart || it.pEnd ? ` · ${periodText(it.pStart, it.pEnd)}` : ""}
      </div>

      ${currentUser?.uid===ADMIN_UID ? `
        <div class="card-actions">
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

/***** 5) 실시간 구독 *****/
function startListenTasks(){
  stopListenTasks();
  ["exam","perf","home"].forEach(cat=>{
    const un = tasksCol(cat).orderBy("start","asc").onSnapshot(snap=>{
      const arr = []; snap.forEach(d=>arr.push(d));
      renderList(cat, arr);
    }, err=>{
      console.error("listener error:", err);
      alert("목록을 불러오지 못했습니다: "+err.message);
    });
    listeners.push(un);
  });
}
function stopListenTasks(){
  listeners.forEach(u=>u&&u()); listeners = [];
}

/***** 6) 로그인/표시 제어 *****/
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
loginBtn.onclick  = ()=> auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = ()=> auth.signOut();

function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
}

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  loginBtn.style.display  = u ? "none" : "";
  logoutBtn.style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);

  // 공지, 과목/숙제 모두 리스너 시작
  startNoticeListen();
  startListenTasks();
});

/***** 7) 추가 폼 저장 *****/
function bindAddRows(){
  $$(".add-row").forEach(row=>{
    const btn = $(".add", row);
    if(!btn) return;
    btn.onclick = async ()=>{
      if(currentUser?.uid !== ADMIN_UID) { alert("관리자만 추가할 수 있습니다."); return; }

      const cat   = row.dataset.cat;
      const subj  = $(".subj", row).value.trim();
      const text  = $(".text", row).value.trim();
      const detail= $(".detail",row).value;
      const start = $(".date", row).value || "";
      const end   = $(".date2",row).value || start;
      const pStart= $(".pStart",row).value || "";
      const pEnd  = $(".pEnd", row).value || "";

      if(!subj || !start){ alert("과목/날짜는 필수입니다."); return; }

      try{
        await tasksCol(cat).add({
          subj, text, detail, start, end, pStart, pEnd,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // 초기화
        $(".subj", row).value = "";
        $(".text", row).value = "";
        $(".detail",row).value = "";
        $(".date", row).value = "";
        $(".date2",row).value = "";
        $(".pStart",row).value = "";
        $(".pEnd", row).value = "";
      }catch(e){
        alert("저장 실패: "+e.message);
        console.error(e);
      }
    };
  });
}
bindAddRows();

/***** 8) 수정/삭제 모달 *****/
let editCtx = {cat:null, id:null};
const modal   = $("#editModal");
const mSubj   = $("#mSubj");
const mText   = $("#mText");
const mDetail = $("#mDetail");
const mStart  = $("#mStart");
const mEnd    = $("#mEnd");
const mPStart = $("#mPStart");
const mPEnd   = $("#mPEnd");
const mSave   = $("#mSave");

window.openEdit = function(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editCtx = {cat, id};
  tasksCol(cat).doc(id).get().then(snap=>{
    const it = snap.data();
    mSubj.value   = it.subj || "";
    mText.value   = it.text || "";
    mDetail.value = it.detail || "";
    mStart.value  = it.start || "";
    mEnd.value    = it.end   || it.start || "";
    mPStart.value = it.pStart || "";
    mPEnd.value   = it.pEnd   || "";
    modal.classList.remove("hidden");
  });
};
window.closeEdit = function(){
  modal.classList.add("hidden");
  editCtx = {cat:null, id:null};
};
mSave.onclick = async ()=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  const {cat,id} = editCtx; if(!cat||!id) return;
  const payload = {
    subj:mSubj.value.trim(),
    text:mText.value.trim(),
    detail:mDetail.value,
    start:mStart.value||"",
    end:mEnd.value||mStart.value||"",
    pStart: mPStart.value || "",
    pEnd:   mPEnd.value   || ""
  };
  try{
    await tasksCol(cat).doc(id).update(payload);
    closeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};
window.doDelete = async function(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await tasksCol(cat).doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
};

/***** 9) ===== 공지(전달 사항) ===== *****/
const noticeList   = document.getElementById("noticeList");
const noticeToggle = document.getElementById("noticeToggle");
const noticeAddRow = document.getElementById("noticeAddRow");

const nTitle = document.getElementById("nTitle");
const nKind  = document.getElementById("nKind");
const nBody  = document.getElementById("nBody");
const nAddBtn= document.getElementById("nAddBtn");

// 수정 모달
const noticeModal = document.getElementById("noticeModal");
const nmTitle = document.getElementById("nmTitle");
const nmKind  = document.getElementById("nmKind");
const nmBody  = document.getElementById("nmBody");
const nmSave  = document.getElementById("nmSave");

let noticeUnsub = null;
let settingsUnsub = null;
let editingNoticeId = null;

function noticeItemHTML(id, it){
  const cls = it.kind === "notice" ? "kind-notice"
            : it.kind === "info"   ? "kind-info"
            : "kind-alert";
  const when = it.createdAt?.toDate?.() || new Date();
  const yyyy = when.getFullYear();
  const mm   = String(when.getMonth()+1).padStart(2,"0");
  const dd   = String(when.getDate()).padStart(2,"0");

  return `
    <li class="notice-card ${cls}">
      <div class="notice-title">[${it.kind === "notice" ? "공지" : it.kind==="info"?"안내":"알림"}] ${escapeHTML(it.title||"")}</div>
      ${it.body ? `<pre>${escapeHTML(it.body)}</pre>` : ""}
      <div class="notice-meta">${yyyy}-${mm}-${dd}</div>
      ${currentUser?.uid===ADMIN_UID ? `
        <div class="card-actions">
          <button class="btn" onclick="openNoticeEdit('${id}', '${(it.title||"").replace(/'/g,"&#39;")}', '${it.kind}', \`${(it.body||"").replace(/`/g,"\\`")}\`)">수정</button>
          <button class="btn" onclick="deleteNotice('${id}')">삭제</button>
        </div>
      `:""}
    </li>`;
}

function startNoticeListen() {
  stopNoticeListen();
  const uidToRead = (currentUser && currentUser.uid===ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;

  // ON/OFF 설정 구독
  settingsUnsub = settingsDoc(uidToRead).onSnapshot(snap=>{
    const show = !!snap.data()?.showNotice;
    noticeToggle.checked = show;
    noticeList.style.display = show ? "" : "none";
    if(currentUser?.uid===ADMIN_UID){
      noticeAddRow.style.display = show ? "" : "none";
    }else{
      noticeAddRow.style.display = "none";
    }
  });

  // 공지 리스트 구독
  noticeUnsub = announcesCol(uidToRead)
    .orderBy("createdAt","desc")
    .onSnapshot(snap=>{
      const arr = [];
      snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
      noticeList.innerHTML = arr.map(it=>noticeItemHTML(it.id, it)).join("");
    }, err=>{
      console.error(err);
      alert("전달 사항 목록을 불러오지 못했습니다: "+err.message);
    });
}
function stopNoticeListen(){
  if(noticeUnsub){ noticeUnsub(); noticeUnsub = null; }
  if(settingsUnsub){ settingsUnsub(); settingsUnsub = null; }
}

// 스위치 저장(관리자만)
noticeToggle.addEventListener("change", async (e)=>{
  const meIsAdmin = currentUser?.uid === ADMIN_UID;
  try{
    if(meIsAdmin){
      await settingsDoc(ADMIN_UID).set({ showNotice: e.target.checked }, { merge:true });
    }else{
      // 비관리자는 화면 표시만 토글
      noticeList.style.display = e.target.checked ? "" : "none";
    }
  }catch(err){
    alert("설정 저장 실패: "+err.message);
  }
});

// 추가(관리자)
if(nAddBtn){
  nAddBtn.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const title = nTitle.value.trim();
    const kind  = nKind.value;
    const body  = nBody.value;
    if(!title){ alert("제목을 입력하세요."); return; }

    try{
      await announcesCol(ADMIN_UID).add({
        title, kind, body,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      nTitle.value = ""; nBody.value = ""; nKind.value = "notice";
    }catch(err){
      alert("추가 실패: "+err.message);
      console.error(err);
    }
  };
}

// 수정 모달
window.openNoticeEdit = function(id, title, kind, body){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editingNoticeId = id;
  nmTitle.value = title || "";
  nmKind.value  = kind  || "notice";
  nmBody.value  = body  || "";
  noticeModal.classList.remove("hidden");
};
window.closeNoticeEdit = function(){
  noticeModal.classList.add("hidden");
  editingNoticeId = null;
};
nmSave.onclick = async ()=>{
  if(currentUser?.uid !== ADMIN_UID || !editingNoticeId) return;
  try{
    await announcesCol(ADMIN_UID).doc(editingNoticeId).update({
      title: nmTitle.value.trim(),
      kind:  nmKind.value,
      body:  nmBody.value
    });
    closeNoticeEdit();
  }catch(err){
    alert("수정 실패: "+err.message);
  }
};

// 삭제
window.deleteNotice = async function(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("삭제할까요?")) return;
  try{
    await announcesCol(ADMIN_UID).doc(id).delete();
  }catch(err){
    alert("삭제 실패: "+err.message);
  }
};
