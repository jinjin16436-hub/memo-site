/********************  0) Firebase 초기화  ********************/
const firebaseConfig = {
  // 👉 여기에 본인 프로젝트 설정을 그대로 넣으세요
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

/********************  1) 상수 / DOM 헬퍼  ********************/
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2"; // 관리자 UID

const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

let currentUser = null;
let listeners = [];

/********************  2) 공용 유틸  ********************/
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
// 교시 텍스트
function periodText(pStart, pEnd){
  if(!pStart && !pEnd) return "";
  if(pStart && !pEnd)  return `${pStart}교시`;
  if(!pStart && pEnd)  return `${pEnd}교시`;
  if(pStart === pEnd)  return `${pStart}교시`;
  return `${pStart}~${pEnd}교시`;
}
// D-Day (시작일 기준, 시작~종료 기간은 D-day)
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
// HTML escape
function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}

/********************  3) Firestore 경로  ********************/
// 과제/시험/수행평가 저장 위치(관리자 문서 아래에 통일)
function taskCol(cat){
  return db.collection("users").doc(ADMIN_UID).collection("tasks").doc(cat).collection("items");
}
// 전달 사항(공지) – users/{ADMIN_UID}/announces
function noticesCol(){
  return db.collection("users").doc(ADMIN_UID).collection("announces");
}
// 설정 – users/{ADMIN_UID}/settings/app
function settingsDoc(){
  return db.collection("users").doc(ADMIN_UID).collection("settings").doc("app");
}

/********************  4) 렌더링(과제/시험/수행)  ********************/
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

function taskItemHTML(cat, id, it){
  const dates = dateSpanText(it.start, it.end);
  const pTxt  = periodText(it.pStart, it.pEnd);
  // 출력 순서: 과목 → 내용 → 상세 내용 → 날짜(요청사항 적용)
  return `
  <li class="task">
    <div class="task__main">
      <div><b>${escapeHTML(it.subj||"")}</b> ${renderDday(it.start, it.end)}</div>
      ${it.text ? `<div>${escapeHTML(it.text)}</div>` : ""}
      ${it.detail ? `<pre>${escapeHTML(it.detail)}</pre>` : ""}
      <div class="meta">📅 ${dates}${pTxt?` · ${pTxt}`:""}</div>
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

/********************  5) 리스너 시작/정지  ********************/
function startListen(){
  stopListen();
  ["exam","perf","home"].forEach(cat=>{
    const un = taskCol(cat).orderBy("start","asc").onSnapshot(snap=>{
      const arr=[]; snap.forEach(d=>arr.push(d));
      renderList(cat, arr);
    }, err=>{
      console.error("listener error:", err);
      alert("목록을 불러오지 못했습니다: "+err.message);
    });
    listeners.push(un);
  });

  // 전달 사항 리스너
  listenNotices();
}
function stopListen(){
  listeners.forEach(u=>u&&u()); listeners = [];
}

/********************  6) 로그인 UI  ********************/
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
loginBtn.onclick  = ()=> auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = ()=> auth.signOut();

function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
  const noticeAdd = $("#noticeAddRow");
  if (noticeAdd) noticeAdd.style.display = isAdmin ? "" : "none";
}

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  loginBtn.style.display  = u ? "none" : "";
  logoutBtn.style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);
  bindAddRows();
  startListen();
  bindNoticeToggle();   // 스위치 상태 반영
});

/********************  7) 추가폼(과제/시험/수행)  ********************/
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
        await taskCol(cat).add({
          subj, text, start, end, pStart, pEnd, detail,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
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

/********************  8) 수정/삭제(과제/시험/수행)  ********************/
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

window.openEdit = (cat, id)=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editCtx = {cat, id};
  taskCol(cat).doc(id).get().then(snap=>{
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
};
window.closeEdit = ()=>{ modal.classList.add("hidden"); editCtx={cat:null,id:null}; };

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
    await taskCol(cat).doc(id).update(payload);
    closeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};

window.doDelete = async (cat, id)=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{ await taskCol(cat).doc(id).delete(); }
  catch(e){ alert("삭제 실패: "+e.message); }
};

/********************  9) 전달 사항(announces)  ********************/
const $noticeList = $("#notice_list");
const noticeModal = $("#noticeModal");
const nmTitle = $("#nmTitle");
const nmBody  = $("#nmBody");
const nmKind  = $("#nmKind");
const nmSave  = $("#nmSave");
let noticeEditId = null;

// 요일표기 + 날짜(공지일) "YYYY-MM-DD (요일)"
function weekdayKR(d){ return ["일","월","화","수","목","금","토"][d.getDay()]; }
function fmtDateKR(ts){
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd= String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd} (${weekdayKR(d)})`;
}

function renderNotices(docs){
  if (!$noticeList) return;
  if (!docs.length){
    $noticeList.innerHTML = `<li class="notice-card kind-info"><div>등록된 전달 사항이 없습니다.</div></li>`;
    return;
  }
  $noticeList.innerHTML = docs.map(d=>{
    const n = d.data();
    const kindClass =
      n.kind==="notice" ? "kind-notice" :
      n.kind==="alert"  ? "kind-alert"  : "kind-info";
    const title = n.title || "";
    const body  = (n.body || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const date  = fmtDateKR(n.createdAt || n.date || n._createdAt);

    return `
      <li class="notice-card ${kindClass}">
        <div class="notice-title">[${n.kind==="notice"?"공지":n.kind==="alert"?"알림":"안내"}] ${title}</div>
        <div class="body" style="white-space:pre-wrap;margin-top:6px">${body}</div>
        <div class="notice-meta" style="margin-top:10px">게시일: ${date}</div>
        ${currentUser?.uid===ADMIN_UID?`
        <div class="card-actions">
          <button class="btn" onclick="openNoticeEdit('${d.id}')">수정</button>
          <button class="btn" onclick="deleteNotice('${d.id}')">삭제</button>
        </div>`:""}
      </li>`;
  }).join("");
}

let unNotice = null;
function listenNotices(){
  if (unNotice){ unNotice(); unNotice=null; }
  unNotice = noticesCol()
    .orderBy("createdAt","desc")
    .onSnapshot(snap=>{
      const arr=[]; snap.forEach(doc=>arr.push(doc));
      renderNotices(arr);
    }, err=>{
      console.error(err);
      alert("전달 사항 목록을 불러오지 못했습니다: "+err.message);
    });
}

// 추가
const nTitle = $("#nTitle");
const nBody  = $("#nBody");
const nKind  = $("#nKind");
const nAddBtn= $("#nAddBtn");
if (nAddBtn){
  nAddBtn.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const title = (nTitle.value||"").trim();
    const body  = (nBody.value||"").trim();
    const kind  = nKind.value || "info";
    if(!title){ alert("제목을 입력해 주세요."); return; }
    try{
      await noticesCol().add({
        title, body, kind,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      nTitle.value=""; nBody.value=""; nKind.value="info";
    }catch(e){
      console.error(e); alert("추가 실패: "+e.message);
    }
  };
}

// 수정
window.openNoticeEdit = async (id)=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  noticeEditId = id;
  const snap = await noticesCol().doc(id).get();
  const n = snap.data();
  nmTitle.value = n.title || "";
  nmBody.value  = n.body  || "";
  nmKind.value  = n.kind  || "info";
  noticeModal.classList.remove("hidden");
};
window.closeNoticeEdit = ()=>{ noticeModal.classList.add("hidden"); noticeEditId=null; };

if(nmSave){
  nmSave.onclick = async ()=>{
    if(!noticeEditId) return;
    try{
      await noticesCol().doc(noticeEditId).update({
        title: nmTitle.value.trim(),
        body : nmBody.value.trim(),
        kind : nmKind.value
      });
      closeNoticeEdit();
    }catch(e){ console.error(e); alert("수정 실패: "+e.message); }
  };
}

// 삭제
window.deleteNotice = async (id)=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{ await noticesCol().doc(id).delete(); }
  catch(e){ console.error(e); alert("삭제 실패: "+e.message); }
};

/********************  10) 전달 사항 ON/OFF (settings/app)  ********************/
const noticeToggle = $("#noticeToggle");
const noticeBody   = $("#noticeBody");

function bindNoticeToggle(){
  // 읽기
  settingsDoc().get().then(s=>{
    const show = s.exists ? !!s.data().showNotice : true;
    noticeToggle.checked = show;
    noticeBody.style.display = show ? "" : "none";
  });
  // 쓰기
  if (noticeToggle) {
    noticeToggle.onchange = async ()=>{
      const show = !!noticeToggle.checked;
      noticeBody.style.display = show ? "" : "none";
      try{
        await settingsDoc().set({ showNotice: show }, { merge:true });
      }catch(e){
        console.error(e);
        alert("설정 저장 실패: "+e.message);
      }
    };
  }
}

/********************  (선택) 자동 새로고침 비활성
// setInterval(()=> location.reload(), 60_000);
************************************************************/
