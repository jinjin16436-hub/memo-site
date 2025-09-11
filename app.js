// ===== 0) Firebase 초기화 =====
// => 본인 프로젝트 설정값 그대로 쓰세요
const firebaseConfig = {
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

// ===== 1) 고정값 =====
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";      // 관리자 UID
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";       // 공개 조회용 UID(동일)

// ===== 2) DOM 헬퍼 =====
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

// ===== 3) 전역 =====
let currentUser = null;        // 로그인 사용자
let listeners = [];            // onSnapshot 해제용

// 섹션 열림/닫힘
function toggleSection(id){
  const el = document.getElementById(id);
  el.classList.toggle("open");
}

// 날짜 → 요일 텍스트
function getWeekday(iso){
  if(!iso) return "";
  const d = new Date(iso+'T00:00:00');
  return ["일","월","화","수","목","금","토"][d.getDay()];
}
// YYYY-MM-DD → 표시
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

// D-Day 배지: 시작 기준, 시작~종료 기간은 D-day, 색상 규칙
function renderDday(start, end){
  if(!start) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start+'T00:00:00');
  const e = new Date((end||start)+'T00:00:00');

  const diff = Math.floor((s - today) / 86400000); // (시작일 - 오늘)
  let label="", cls="";

  // 진행중(오늘이 시작~종료 사이)
  if(today >= s && today <= e){
    label = "D-day"; cls = "yellow"; // 진행중은 노랑
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

// ===== 4) Firestore 경로 =====
function tasksCol(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}

// ===== 5) 렌더링 =====
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

// (중요) 표시 순서: 과목 → 내용 → 상세내용 → 날짜
function taskItemHTML(cat, id, it){
  const dates = dateSpanText(it.start, it.end);
  const pTxt  = periodText(it.pStart, it.pEnd);

  return `
  <li class="task">
    <div class="task__main">
      <!-- 1) 과목 + D-day -->
      <div class="title"><b>${escapeHTML(it.subj || "")}</b> ${renderDday(it.start, it.end)}</div>

      <!-- 2) 내용 -->
      ${it.text ? `<div class="body">${escapeHTML(it.text)}</div>` : ""}

      <!-- 3) 상세 내용(테두리/배경 없음) -->
      ${it.detail ? `<pre class="detail">${escapeHTML(it.detail)}</pre>` : ""}

      <!-- 4) 날짜/교시 -->
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

// ===== 6) 구독 시작/해제 =====
function startListen(){
  stopListen();
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

  // 전달 사항 ON/OFF + 목록
  bindNoticeRealtime();
}
function stopListen(){
  listeners.forEach(u=>u&&u()); listeners = [];
}

// ===== 7) 로그인 UI =====
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
loginBtn.onclick  = ()=> auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = ()=> auth.signOut();

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  loginBtn.style.display  = u ? "none" : "";
  logoutBtn.style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);
  bindAddRows();
  startListen();
});

// 관리자만 추가폼/버튼 보이기
function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
  // 전달사항 입력행
  $("#noticeAddRow").style.display = isAdmin ? "" : "none";
}

// ===== 8) 추가폼 바인딩 & 저장 =====
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
        await tasksCol(cat).add({
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
}

// ===== 9) 수정/삭제 =====
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
  tasksCol(cat).doc(id).get().then(snap=>{
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
    await tasksCol(cat).doc(id).update(payload);
    closeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};
async function doDelete(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await tasksCol(cat).doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
}

// ===== 10) 전달 사항 (ON/OFF + 목록/작성/수정) =====
const noticeToggle = $("#noticeToggle");
const noticeList   = $("#notice_list");

// config: users/{ADMIN_UID}/settings/app { showNotice: boolean }
function appSettingsDoc(){
  return db.collection("users").doc(ADMIN_UID).collection("settings").doc("app");
}
// notices: users/{ADMIN_UID}/notices/items
function noticesCol(){
  return db.collection("users").doc(ADMIN_UID).collection("notices").doc("items").collection("list");
}

let unSet = null;
let unNoti = null;

function bindNoticeRealtime(){
  // 스위치는 항상 보이도록 (OFF여도 숨기지 않음)
  appSettingsDoc().onSnapshot(snap=>{
    const data = snap.data()||{};
    const show = !!data.showNotice;
    noticeToggle.checked = show;

    // 목록 구독
    if(unNoti) { unNoti(); unNoti=null; }
    if(show){
      unNoti = noticesCol().orderBy("createdAt","desc").onSnapshot(s=>{
        const arr=[]; s.forEach(d=>arr.push({id:d.id, ...d.data()}));
        renderNotices(arr);
      });
    }else{
      renderNotices([]);
    }
  });

  // 스위치 변경(관리자만 저장)
  noticeToggle.addEventListener("change", async ()=>{
    if(currentUser?.uid !== ADMIN_UID){
      // 비관리자는 단순 UI 동기화만
      return;
    }
    try{
      await appSettingsDoc().set({showNotice: noticeToggle.checked}, {merge:true});
    }catch(e){
      alert("설정 저장 실패: "+e.message);
    }
  });

  // 추가 버튼
  $("#nAddBtn").onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const title = $("#nTitle").value.trim();
    const kind  = $("#nKind").value;
    const body  = $("#nBody").value;
    if(!title){ alert("제목을 입력하세요."); return; }
    try{
      await noticesCol().add({
        title, kind, body,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      $("#nTitle").value = ""; $("#nBody").value = "";
    }catch(e){
      alert("추가 실패: "+e.message);
    }
  };
}

function renderNotices(items){
  noticeList.innerHTML = items.map(n => `
    <li class="notice-card ${n.kind ? 'kind-'+n.kind : ''}">
      <div class="notice-title">[${kindLabel(n.kind)}] ${escapeHTML(n.title||"")}</div>
      ${n.body ? `<pre>${escapeHTML(n.body)}</pre>` : ""}
      ${currentUser?.uid===ADMIN_UID ? `
      <div class="card-actions">
        <button class="btn" onclick="openNoticeEdit('${n.id}')">수정</button>
        <button class="btn" onclick="deleteNotice('${n.id}')">삭제</button>
      </div>`:""}
    </li>
  `).join("");
}
function kindLabel(k){
  if(k==="notice") return "공지";
  if(k==="info")   return "안내";
  if(k==="alert")  return "알림";
  return "알림";
}

// 공지 수정 모달
const noticeModal = $("#noticeModal");
const nmTitle = $("#nmTitle");
const nmKind  = $("#nmKind");
const nmBody  = $("#nmBody");
let noticeEditId = null;

function openNoticeEdit(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  noticesCol().doc(id).get().then(s=>{
    const d=s.data();
    noticeEditId=id;
    nmTitle.value = d.title||"";
    nmKind.value  = d.kind||"alert";
    nmBody.value  = d.body||"";
    noticeModal.classList.remove("hidden");
  });
}
function closeNoticeEdit(){
  noticeModal.classList.add("hidden");
  noticeEditId = null;
}
$("#nmSave").onclick = async ()=>{
  if(!noticeEditId) return;
  try{
    await noticesCol().doc(noticeEditId).update({
      title:nmTitle.value.trim(),
      kind:nmKind.value,
      body:nmBody.value
    });
    closeNoticeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};
async function deleteNotice(id){
  if(!confirm("삭제할까요?")) return;
  try{
    await noticesCol().doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
}

// ===== 11) 유틸 =====
function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}
