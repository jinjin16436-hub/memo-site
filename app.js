// ===== 0) Firebase 초기화 =====
const firebaseConfig = {
  // ⚠️ 여기 본인 프로젝트 키로 교체하세요 (GitHub 공개 저장소면 .env/비공개 처리 권장)
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
// 관리자/공개 UID
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";

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
// 작업(시험/수행/숙제)
function col(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}
// 전달 사항 컬렉션
function noticesCol(){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("notices");
}
// 앱 설정 (전달사항 ON/OFF)
function settingsDoc(){
  return db.collection("users").doc(ADMIN_UID).collection("settings").doc("app");
}

// ===== 5) 렌더링 =====
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

// 항목 카드 HTML (과목 → 내용 → 상세내용 → 날짜  순)
function taskItemHTML(cat, id, it){
  const dates = dateSpanText(it.start, it.end);
  const pTxt  = periodText(it.pStart, it.pEnd);
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

// 전달사항 HTML (날짜: “공고일: YYYY-MM-DD (요일)”)
function noticeItemHTML(id, it){
  const ymd = (it.createdAt && it.createdAt.toDate) ? it.createdAt.toDate() : null;
  const iso = ymd ? ymd.toISOString().slice(0,10) : "";
  const weekday = ymd ? ["일","월","화","수","목","금","토"][ymd.getDay()] : "";
  const dateLine = iso ? `공고일: ${iso} (${weekday})` : "";
  const kindClass = it.kind === "notice" ? "kind-notice"
                   : it.kind === "info"  ? "kind-info"
                   :                       "kind-alert";
  const prefix = it.kind === "notice" ? "[공지]" : it.kind === "info" ? "[안내]" : "[알림]";

  return `
  <li class="notice-card ${kindClass}">
    <div class="notice-title">${prefix} ${escapeHTML(it.title||"")}</div>
    ${it.body ? `<pre>${escapeHTML(it.body)}</pre>` : ""}
    <div class="notice-meta">${dateLine}</div>
    ${currentUser?.uid===ADMIN_UID ? `
      <div class="card-actions">
        <button class="btn" onclick="openNoticeEdit('${id}')">수정</button>
        <button class="btn" onclick="deleteNotice('${id}')">삭제</button>
      </div>` : ``}
  </li>`;
}

function renderNotices(docs){
  $("#notice_list").innerHTML = docs.map(d=> noticeItemHTML(d.id, d.data())).join("");
}

// ===== 6) 구독 시작/해제 =====
function startListen(){
  stopListen();

  // 전달사항 ON/OFF 상태 반영 + 목록 구독
  settingsDoc().onSnapshot(snap=>{
    const data = snap.data() || {};
    const on = !!data.showNotice;
    $("#noticeToggle").checked = on;

    // 목록 구독(ON 인 경우에만)
    listeners.filter(u=>u && u.__type==="noti").forEach(u=>u());
    listeners = listeners.filter(u=>u.__type!=="noti");

    if(on){
      const un = noticesCol().orderBy("createdAt","desc").onSnapshot(snap2=>{
        const arr = []; snap2.forEach(d=>arr.push(d));
        renderNotices(arr);
      });
      un.__type="noti";
      listeners.push(un);
    }else{
      $("#notice_list").innerHTML = "";
    }
  });

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
  bindNoticeAdd();
  bindNoticeToggle();
  startListen();
});

// 관리자만 추가폼/버튼 보이기
function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
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
}

// 전달사항 추가
function bindNoticeAdd(){
  const btn = $("#nAddBtn");
  if(!btn) return;
  btn.onclick = async ()=>{
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
      $("#nTitle").value = "";
      $("#nBody").value  = "";
    }catch(e){
      console.error(e);
      alert("추가 실패: "+e.message);
    }
  };
}

// 전달사항 ON/OFF
function bindNoticeToggle(){
  const t = $("#noticeToggle");
  if(!t) return;
  t.onchange = async ()=>{
    try{
      await settingsDoc().set({ showNotice: t.checked }, { merge: true });
    }catch(e){
      console.error(e);
      alert("설정 저장 실패: "+e.message);
    }
  };
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

// 전달 사항 수정
let nEditId = null;
const nModal = $("#noticeModal");
const nmTitle = $("#nmTitle");
const nmKind  = $("#nmKind");
const nmBody  = $("#nmBody");
const nmSave  = $("#nmSave");
function openNoticeEdit(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  nEditId = id;
  noticesCol().doc(id).get().then(s=>{
    const it = s.data();
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
      kind:  nmKind.value,
      body:  nmBody.value
    });
    closeNoticeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};
async function deleteNotice(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("삭제할까요?")) return;
  try{
    await noticesCol().doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
}

// ===== 10) 유틸 =====
function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}
