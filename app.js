/**************************************************
 * app.js (Firebase compat)
 * - env.js 에서 window.FIREBASE_CONFIG 로 설정
 * - Firestore 경로
 *   · 공지: users/{uid}/notices/{docId}
 *   · 앱 설정: users/{uid}/settings/app
 *   · 항목(시험/수행/숙제): users/{uid}/tasks/{cat}/items/{docId}
 **************************************************/

// ===== 0) Firebase 초기화 =====
(function initFirebase(){
  if(!window.FIREBASE_CONFIG){
    console.error('FIREBASE_CONFIG 가 없습니다. env.js 를 확인하세요.');
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
})();

const auth = firebase.auth();
const db   = firebase.firestore();

// ===== 1) 고정값 =====
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dh013t2"; // 관리자 UID
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dh013t2"; // 공개 조회용 UID(동일 사용 가능)

// ===== 2) DOM 헬퍼 =====
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

// ===== 3) 전역 =====
let currentUser = null;
let listeners = []; // onSnapshot 해제용

// 섹션 열림/닫힘
function toggleSection(id){
  const el = document.getElementById(id);
  el.classList.toggle("open");
}

// ===== 4) 날짜/표시 헬퍼 =====
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
// D-Day
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

// ===== 5) Firestore 경로 =====
function baseUid(){
  return (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
}
function colTasks(cat){
  const uid = baseUid();
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}
function colNotices(){
  const uid = baseUid();
  return db.collection("users").doc(uid).collection("notices");
}
function docAppSettings(){
  const uid = baseUid();
  return db.collection("users").doc(uid).collection("settings").doc("app");
}

// ===== 6) 렌더링 =====
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

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
        <div class="card-actions">
          <button class="btn" onclick="openEdit('${cat}','${id}')">수정</button>
          <button class="btn" onclick="doDelete('${cat}','${id}')">삭제</button>
        </div>` : ``}
    </div>
  </li>`;
}
function renderList(cat, docs){
  const ul = lists[cat];
  if(!ul) return;
  ul.innerHTML = docs.map(d => taskItemHTML(cat, d.id, d.data())).join("");
}

// ===== 7) 공지(전달 사항) =====
const noticeList = $("#notice_list");
function noticeItemHTML(id, n){
  const dt = n.createdAt?.toDate ? n.createdAt.toDate() : null;
  const yyyy = dt ? dt.getFullYear() : "";
  const mm   = dt ? String(dt.getMonth()+1).padStart(2,"0") : "";
  const dd   = dt ? String(dt.getDate()).padStart(2,"0") : "";
  const wd   = dt ? ["일","월","화","수","목","금","토"][dt.getDay()] : "";
  const dateText = dt ? `공고일: ${yyyy}-${mm}-${dd} (${wd})` : "";

  const kindTitle = n.kind==="notice" ? "[공지] " : n.kind==="info" ? "[안내] " : "[알림] ";
  const kindClass = n.kind==="notice" ? "kind-notice" : n.kind==="info" ? "kind-info" : "kind-alert";

  return `
  <li class="notice-card ${kindClass}">
    <div class="notice-title">${escapeHTML(kindTitle + (n.title||""))}</div>
    ${n.body ? `<pre>${escapeHTML(n.body)}</pre>` : ""}
    <div class="notice-meta">${dateText}</div>
    ${currentUser?.uid===ADMIN_UID ? `
    <div class="card-actions">
      <button class="btn" onclick="openNoticeEdit('${id}')">수정</button>
      <button class="btn" onclick="doNoticeDelete('${id}')">삭제</button>
    </div>` : ``}
  </li>`;
}
function renderNotices(docs){
  if(!noticeList) return;
  noticeList.innerHTML = docs.map(d=>noticeItemHTML(d.id, d.data())).join("");
}

// ===== 8) 구독 시작/해제 =====
function startListen(){
  stopListen();

  // tasks
  ["exam","perf","home"].forEach(cat=>{
    const un = colTasks(cat).orderBy("start","asc").onSnapshot(snap=>{
      const arr = []; snap.forEach(d=>arr.push(d));
      renderList(cat, arr);
    }, err=>{
      console.error("listener error:", err);
      alert("목록을 불러오지 못했습니다: "+err.message);
    });
    listeners.push(un);
  });

  // notices
  if(noticeList){
    const un2 = colNotices().orderBy("createdAt","desc").onSnapshot(snap=>{
      const arr=[]; snap.forEach(d=>arr.push(d));
      renderNotices(arr);
    }, err=>{
      console.error("notices listener error:", err);
      alert("전달 사항 목록을 불러오지 못했습니다: "+err.message);
    });
    listeners.push(un2);
  }

  // app settings (toggle)
  const noticeToggle = $("#noticeToggle");
  const secNotice = $("#sec_notice");
  if(noticeToggle && secNotice){
    const un3 = docAppSettings().onSnapshot(snap=>{
      const data = snap.data() || {};
      const on = !!data.showNotice;
      noticeToggle.checked = on;
      // 섹션 표시/숨김
      secNotice.style.display = on ? "" : "none";
    }, err=>{
      console.error("settings listener error:", err);
    });
    listeners.push(un3);
  }
}
function stopListen(){
  listeners.forEach(u=>u&&u());
  listeners = [];
}

// ===== 9) 로그인 UI =====
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
if(loginBtn){
  loginBtn.onclick = ()=>{
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({prompt: 'select_account'});
    auth.signInWithPopup(provider).catch(e=>{
      alert("로그인 실패: "+e.message);
    });
  };
}
if(logoutBtn){
  logoutBtn.onclick = ()=> auth.signOut();
}

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  if(loginBtn)  loginBtn.style.display  = u ? "none" : "";
  if(logoutBtn) logoutBtn.style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);
  bindAddRows();    // 버튼 재바인딩(동적)
  bindNoticeForm(); // 공지 추가
  startListen();
});

// 관리자만 추가폼 표시
function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
  const row = $("#noticeAddRow");
  if(row) row.style.display = isAdmin ? "" : "none";
}

// ===== 10) 항목 추가/수정/삭제 =====
function bindAddRows(){
  $$(".add-row").forEach(row=>{
    const btn = $(".add", row);
    if(!btn) return;
    btn.onclick = async ()=>{
      if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
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
        await colTasks(cat).add({
          subj, text, start, end, pStart, pEnd, detail,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // reset
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
}

// 수정 모달
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

window.openEdit = function(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editCtx = {cat, id};
  colTasks(cat).doc(id).get().then(snap=>{
    const it = snap.data()||{};
    mSubj.value   = it.subj   || "";
    mText.value   = it.text   || "";
    mStart.value  = it.start  || "";
    mEnd.value    = it.end    || it.start || "";
    mPStart.value = it.pStart || "";
    mPEnd.value   = it.pEnd   || "";
    mDetail.value = it.detail || "";
    modal.classList.remove("hidden");
  });
};
window.closeEdit = function(){
  modal.classList.add("hidden");
  editCtx = {cat:null, id:null};
};
if(mSave){
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
      await colTasks(cat).doc(id).update(payload);
      closeEdit();
    }catch(e){
      alert("수정 실패: "+e.message);
    }
  };
}
window.doDelete = async function(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await colTasks(cat).doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
};

// ===== 11) 공지 추가/수정/삭제 =====
function bindNoticeForm(){
  const addBtn = $("#nAddBtn");
  if(!addBtn) return;
  addBtn.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const title = $("#nTitle").value.trim();
    const kind  = $("#nKind").value || "notice"; // notice | info | alert
    const body  = $("#nBody").value;

    if(!title){ alert("제목은 필수입니다."); return; }

    try{
      await colNotices().add({
        title, kind, body,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      $("#nTitle").value = "";
      $("#nBody").value  = "";
    }catch(e){
      alert("저장 실패: "+e.message);
    }
  };

  // 공지 ON/OFF 토글 저장
  const toggle = $("#noticeToggle");
  if(toggle){
    toggle.onchange = async ()=>{
      if(currentUser?.uid !== ADMIN_UID){
        // 관리자가 아니면 UI만 원복
        startListen(); 
        return;
      }
      try{
        await docAppSettings().set({showNotice: !!toggle.checked}, {merge:true});
      }catch(e){
        alert("설정 저장 실패: "+e.message);
      }
    };
  }
}

// 공지 수정 모달
let nEditId = null;
const noticeModal = $("#noticeModal");
const nmTitle = $("#nmTitle");
const nmKind  = $("#nmKind");
const nmBody  = $("#nmBody");
const nmSave  = $("#nmSave");

window.openNoticeEdit = function(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  nEditId = id;
  colNotices().doc(id).get().then(snap=>{
    const it = snap.data()||{};
    nmTitle.value = it.title || "";
    nmKind.value  = it.kind || "notice";
    nmBody.value  = it.body || "";
    noticeModal.classList.remove("hidden");
  });
};
window.closeNoticeEdit = function(){
  noticeModal.classList.add("hidden");
  nEditId = null;
};
if(nmSave){
  nmSave.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
    if(!nEditId) return;
    try{
      await colNotices().doc(nEditId).update({
        title: nmTitle.value.trim(),
        kind:  nmKind.value,
        body:  nmBody.value
      });
      closeNoticeEdit();
    }catch(e){
      alert("수정 실패: "+e.message);
    }
  };
}
window.doNoticeDelete = async function(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await colNotices().doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
};

// ===== 12) 전역 노출 필요한 함수만 (이미 window.* 로 노출함) =====
// (openEdit, closeEdit, doDelete, openNoticeEdit, closeNoticeEdit, doNoticeDelete)

/* 끝 */
