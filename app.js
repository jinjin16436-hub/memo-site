// ===== 0) Firebase 초기화 =====
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
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";  // 관리자 UID
// 공개 조회용 UID가 따로 없다면 ADMIN_UID와 동일하게 둬도 됨
const PUBLIC_UID = ADMIN_UID;

// ===== 2) DOM 헬퍼 =====
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));
const escapeHTML = (s)=> (s||"").replace(/[&<>"]/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));

// ===== 3) 전역 =====
let currentUser = null;
let listeners = []; // tasks용 onSnapshot 해제
let unsubNotices = null, unsubApp = null; // notices용

// 섹션 열림/닫힘
function toggleSection(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.classList.toggle("open");
}

// 날짜/요일 포맷
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

// D-day (시작일 기준, 기간 중엔 D-day, 색규칙 반영)
function renderDday(start, end){
  if(!start) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start+'T00:00:00');
  const e = new Date((end||start)+'T00:00:00');

  const diff = Math.floor((s - today) / 86400000); // 시작일 - 오늘
  let label="", cls="";

  if(today >= s && today <= e){
    label = "D-day"; cls = "yellow"; // 진행중
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
// tasks: 로그인 사용자가 관리자면 ADMIN_UID, 아니면 PUBLIC_UID
function col(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}

// notices: 항상 관리자 소유로 고정(보기/쓰기 모두)
function noticeCol(){
  return db.collection("users").doc(ADMIN_UID).collection("notices").collection("items");
}
function appSettingsDoc(){
  return db.collection("users").doc(ADMIN_UID).collection("settings").doc("app");
}

// ===== 5) 렌더링 =====
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

// ===== 6) 구독 시작/해제 (tasks) =====
function startListen(){
  stopListen();
  ["exam","perf","home"].forEach(cat=>{
    const un = col(cat).orderBy("start","asc").onSnapshot(
      snap => {
        const arr = [];
        snap.forEach(d => arr.push(d));
        renderList(cat, arr);
      },
      err => {
        console.error("listener error:", err);
        alert("목록을 불러오지 못했습니다: " + err.message);
      }
    );
    listeners.push(un);
  });
}
function stopListen(){
  listeners.forEach(u => u && u());
  listeners = [];
}

// ===== 7) 로그인 UI =====
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
loginBtn.onclick  = ()=> auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = ()=> auth.signOut();

// 관리자만 추가폼/버튼 보이기
function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r => r.style.display = isAdmin ? "" : "none");
  const noticeAddRow = $("#noticeAddRow");
  if(noticeAddRow) noticeAddRow.style.display = isAdmin ? "" : "none";
}

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  loginBtn.style.display  = u ? "none" : "";
  logoutBtn.style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);

  bindAddRows();
  startListen();
  startNoticeListeners();
});

// ===== 8) 추가폼 바인딩 & 저장 (tasks) =====
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

// ===== 9) 수정/삭제 (tasks) =====
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

// ===== 10) 전달 사항 (항상 ADMIN_UID에서 읽기/쓰기) =====
const noticeList   = $("#notice_list");
const noticeToggle = $("#noticeToggle");
const nTitle = $("#nTitle");
const nKind  = $("#nKind");
const nBody  = $("#nBody");
const nAddBtn= $("#nAddBtn");

function renderNotices(docs) {
  if (!noticeList) return;
  noticeList.innerHTML = docs.map(d => {
    const it = d.data();
    const kindClass = it.kind === "notice" ? "kind-notice"
                   : it.kind === "info"   ? "kind-info"
                   : "kind-alert";
    const kindText  = it.kind === "notice" ? "공지"
                   : it.kind === "info"   ? "안내"
                   : "알림";
    return `
      <li class="notice-card ${kindClass}">
        <div class="notice-title">[${kindText}] ${escapeHTML(it.title||"")}</div>
        ${it.body ? `<pre class="notice-meta">${escapeHTML(it.body)}</pre>` : ""}
        ${currentUser?.uid === ADMIN_UID ? `
          <div class="card-actions">
            <button class="btn" onclick="openNoticeEdit('${d.id}')">수정</button>
            <button class="btn" onclick="deleteNotice('${d.id}')">삭제</button>
          </div>` : ``}
      </li>`;
  }).join("");
}

function startNoticeListeners(){
  // settings(app) -> showNotices
  if (unsubApp) unsubApp();
  unsubApp = appSettingsDoc().onSnapshot(snap => {
    const show = snap.exists ? !!snap.data().showNotices : true;
    const sec  = $("#sec_notice");
    if (sec) sec.style.display = show ? "" : "none";
    if (noticeToggle) noticeToggle.checked = show;
  }, err => {
    console.warn("settings read error:", err);
  });

  // 목록
  if (unsubNotices) unsubNotices();
  unsubNotices = noticeCol().orderBy("createdAt","desc").onSnapshot(snap => {
    const arr = [];
    snap.forEach(d => arr.push(d));
    renderNotices(arr);
  }, err => {
    alert("전달 사항 목록을 불러오지 못했습니다: " + err.message);
    console.error(err);
  });
}

// 토글 저장(관리자만)
if (noticeToggle) {
  noticeToggle.addEventListener("change", async () => {
    if (currentUser?.uid !== ADMIN_UID) return; // 학생은 바꿀 수 없음
    try {
      await appSettingsDoc().set({ showNotices: noticeToggle.checked }, { merge: true });
    } catch (e) {
      alert("설정 저장 실패: " + e.message);
      console.error(e);
    }
  });
}

// 추가(관리자만)
if (nAddBtn) {
  nAddBtn.onclick = async () => {
    if (currentUser?.uid !== ADMIN_UID) { alert("관리자만 추가할 수 있습니다."); return; }
    const title = (nTitle.value || "").trim();
    const body  = nBody.value || "";
    const kind  = nKind.value || "notice";
    if (!title) { alert("제목을 입력해 주세요."); return; }
    try {
      await noticeCol().add({
        title, body, kind,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      nTitle.value = ""; nBody.value = ""; nKind.value = "notice";
    } catch (e) {
      alert("추가 실패: " + e.message);
      console.error(e);
    }
  };
}

// 전달 사항 수정/삭제
let nEditId = null;
const nModal  = $("#noticeModal");
const nmTitle = $("#nmTitle");
const nmKind  = $("#nmKind");
const nmBody  = $("#nmBody");
const nmSave  = $("#nmSave");

window.openNoticeEdit = async function(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  nEditId = id;
  const snap = await noticeCol().doc(id).get();
  const it = snap.data();
  nmTitle.value = it.title || "";
  nmKind.value  = it.kind  || "notice";
  nmBody.value  = it.body  || "";
  nModal.classList.remove("hidden");
}
window.closeNoticeEdit = function(){
  nModal.classList.add("hidden");
  nEditId = null;
}
nmSave.onclick = async ()=>{
  if(currentUser?.uid !== ADMIN_UID || !nEditId) return;
  try{
    await noticeCol().doc(nEditId).update({
      title: nmTitle.value.trim(),
      kind:  nmKind.value,
      body:  nmBody.value
    });
    closeNoticeEdit();
  }catch(e){
    alert("수정 실패: " + e.message);
  }
}
window.deleteNotice = async function(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await noticeCol().doc(id).delete();
  }catch(e){
    alert("삭제 실패: " + e.message);
  }
}
