// app.js (ESM)
import { firebaseConfig, ADMIN_UID, PUBLIC_UID } from "./env.js";

// Firebase v9 모듈 API
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, orderBy, query
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ===== 0) Firebase 초기화 =====
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ===== 1) DOM 헬퍼 =====
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

// ===== 2) 전역 =====
let currentUser = null;
let listeners = [];

// UI 요소
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
const lists = { exam: $("#list_exam"), perf: $("#list_perf"), home: $("#list_home") };

// ===== 3) 공용 유틸 =====
function toggleSection(id){ $("#"+id)?.classList.toggle("open"); }
window.toggleSection = toggleSection; // HTML에서 호출

function getWeekday(iso){
  if(!iso) return ""; const d = new Date(iso+'T00:00:00');
  return ["일","월","화","수","목","금","토"][d.getDay()];
}
function dateSpanText(start, end){
  if(!start && !end) return "";
  const s = start || end, e = end || start; const sW = getWeekday(s), eW = getWeekday(e);
  return (s===e) ? `${s} (${sW})` : `${s} (${sW}) ~ ${e} (${eW})`;
}
function periodText(pStart, pEnd){
  if(!pStart && !pEnd) return "";
  if(pStart && !pEnd) return `${pStart}교시`;
  if(!pStart && pEnd) return `${pEnd}교시`;
  return (pStart===pEnd) ? `${pStart}교시` : `${pStart}~${pEnd}교시`;
}
function renderDday(start, end){
  if(!start) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start+'T00:00:00'); const e = new Date((end||start)+'T00:00:00');
  const diff = Math.floor((s - today) / 86400000);
  let label="", cls="";
  if(today >= s && today <= e){ label="D-day"; cls="yellow"; }
  else if(diff>0){ label=`D-${diff}`; cls = diff===1? "red" : diff<=3? "orange" : diff<=5? "yellow":"green"; }
  else if(diff===0){ label="D-0"; cls="red"; } else { label="끝"; cls="gray"; }
  return `<span class="dday ${cls}">${label}</span>`;
}
function escapeHTML(s){ return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }

// ===== 4) Firestore 경로 =====
function col(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return collection(db, "users", uid, "tasks", cat, "items");
}
const noticesCol = ()=> collection(db, "users", PUBLIC_UID, "notices", "items");
const settingsDoc = ()=> doc(db, "users", PUBLIC_UID, "settings", "app");

// ===== 5) 렌더링 =====
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
  lists[cat].innerHTML = docs.map(d => taskItemHTML(cat, d.id, d.data())).join("");
}

// ===== 6) 공지 렌더 =====
function noticeItemHTML(id, n){
  const kindCls = n.kind==="notice" ? "kind-notice" : n.kind==="info" ? "kind-info" : "kind-alert";
  const date = n.createdAt?.toDate ? n.createdAt.toDate() : (n.createdAt || new Date());
  const iso  = new Date(date); const w = ["일","월","화","수","목","금","토"][iso.getDay()];
  const dstr = `${iso.getFullYear()}-${String(iso.getMonth()+1).padStart(2,"0")}-${String(iso.getDate()).padStart(2,"0")} (${w})`;
  return `
  <li class="task notice-card ${kindCls}">
    <div class="notice-title">[${n.kind==="notice"?"공지":n.kind==="info"?"안내":"알림"}] ${escapeHTML(n.title||"")}</div>
    ${n.body ? `<pre>${escapeHTML(n.body)}</pre>` : ""}
    <div class="notice-meta">공고일: ${dstr}</div>
    ${currentUser?.uid===ADMIN_UID ? `
      <div class="card-actions" style="margin-top:10px;display:flex;gap:8px">
        <button class="btn" onclick="openNoticeEdit('${id}')">수정</button>
        <button class="btn" onclick="doNoticeDelete('${id}')">삭제</button>
      </div>` : ``}
  </li>`;
}
function renderNotices(docs){
  $("#notice_list").innerHTML = docs.map(d=>noticeItemHTML(d.id, d.data())).join("");
}

// ===== 7) 실시간 구독 =====
function stopListen(){ listeners.forEach(u=>u&&u()); listeners=[]; }
function startListen(){
  stopListen();
  // tasks
  ["exam","perf","home"].forEach(cat=>{
    const qy = query(col(cat), orderBy("start","asc"));
    const un = onSnapshot(qy, (snap)=>{
      const arr=[]; snap.forEach(d=>arr.push(d));
      renderList(cat, arr);
    }, (err)=> alert("목록을 불러오지 못했습니다: "+err.message));
    listeners.push(un);
  });

  // notices
  const unN = onSnapshot(query(noticesCol(), orderBy("createdAt","desc")),
    (snap)=>{ const arr=[]; snap.forEach(d=>arr.push(d)); renderNotices(arr); },
    (err)=> alert("전달 사항 목록을 불러오지 못했습니다: "+err.message));
  listeners.push(unN);

  // notice toggle
  getDoc(settingsDoc()).then(d=>{
    const on = d.exists()? !!d.data().showNotice : false;
    $("#noticeToggle").checked = on;
  }).catch(()=>{});
}

// ===== 8) 로그인/로그아웃 =====
if (loginBtn)  loginBtn.onclick  = () => signInWithPopup(auth, new GoogleAuthProvider());
if (logoutBtn) logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, (u)=>{
  currentUser = u || null;
  loginBtn.style.display  = u ? "none" : "";
  logoutBtn.style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);
  bindAddRows();
  bindNoticeUI();
  startListen();
});

function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
  $("#noticeAddRow").style.display = isAdmin ? "" : "none";
}

// ===== 9) 추가폼 바인딩 =====
function bindAddRows(){
  $$(".add-row").forEach(row=>{
    const btn = $(".add", row); if(!btn) return;
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
        await addDoc(col(cat), {
          subj, text, start, end, pStart, pEnd, detail,
          createdAt: new Date()
        });
        // reset
        $(".subj", row).value = ""; $(".text", row).value = "";
        $(".date", row).value = ""; $(".date2", row).value = "";
        $(".pStart",row).value=""; $(".pEnd",row).value=""; $(".detail",row).value="";
      }catch(e){ alert("저장 실패: "+e.message); }
    };
  });
}

// ===== 10) 수정/삭제 =====
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

window.openEdit = async (cat, id)=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editCtx = {cat,id};
  const snap = await getDoc(doc(col(cat), id));
  const it = snap.data()||{};
  mSubj.value = it.subj||""; mText.value=it.text||"";
  mStart.value=it.start||""; mEnd.value=it.end||it.start||"";
  mPStart.value=it.pStart||""; mPEnd.value=it.pEnd||""; mDetail.value=it.detail||"";
  modal.classList.remove("hidden");
}
window.closeEdit = ()=>{ modal.classList.add("hidden"); editCtx={cat:null,id:null}; }
mSave.onclick = async ()=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  const {cat,id} = editCtx; if(!cat||!id) return;
  const payload = {
    subj:mSubj.value.trim(), text:mText.value.trim(),
    start:mStart.value||"", end:mEnd.value||mStart.value||"",
    pStart: mPStart.value || "", pEnd: mPEnd.value || "", detail:mDetail.value
  };
  try{ await updateDoc(doc(col(cat), id), payload); closeEdit(); }
  catch(e){ alert("수정 실패: "+e.message); }
};
window.doDelete = async (cat,id)=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{ await deleteDoc(doc(col(cat), id)); }catch(e){ alert("삭제 실패: "+e.message); }
};

// ===== 11) 공지 쓰기/수정/삭제 + 토글 =====
function bindNoticeUI(){
  const addBtn = $("#nAddBtn");
  if(addBtn) addBtn.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const title = $("#nTitle").value.trim();
    const kind  = $("#nKind").value;
    const body  = $("#nBody").value;
    if(!title){ alert("제목은 필수입니다."); return; }
    try{
      await addDoc(noticesCol(), { title, kind, body, createdAt: new Date() });
      $("#nTitle").value=""; $("#nBody").value="";
    }catch(e){ alert("추가 실패: "+e.message); }
  };

  $("#noticeToggle").onchange = async (e)=>{
    try{
      await updateDoc(settingsDoc(), { showNotice: e.target.checked });
    }catch(err){
      // 문서가 없을 때 set대신 update라 실패 가능 → add/merge 대체
      await updateDoc(settingsDoc(), { showNotice: e.target.checked }).catch(async ()=>{
        await (await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js"))
          .setDoc(settingsDoc(), { showNotice: e.target.checked }, { merge:true });
      });
    }
  };
}
window.openNoticeEdit = async (id)=>{
  // 간단화를 위해 기존 항목 수정 모달 재사용
  const snap = await getDoc(doc(noticesCol(), id));
  const n = snap.data()||{};
  mSubj.value = `[공지] ${n.title||""}`;
  mText.value = n.kind||"notice"; mStart.value=""; mEnd.value="";
  mPStart.value=""; mPEnd.value=""; mDetail.value=n.body||"";
  modal.classList.remove("hidden");
  editCtx = {cat:"__notice__", id};
};
window.doNoticeDelete = async (id)=>{
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{ await deleteDoc(doc(noticesCol(), id)); }catch(e){ alert("삭제 실패: "+e.message); }
};
// 모달 저장에서 공지 편집도 처리
const _origSave = mSave.onclick;
mSave.onclick = async ()=>{
  if(editCtx.cat === "__notice__"){
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
    try{
      await updateDoc(doc(noticesCol(), editCtx.id), {
        title: (mSubj.value||"").replace(/^\[공지\]\s*/,""),
        kind:  mText.value||"notice",
        body:  mDetail.value||""
      });
      closeEdit();
    }catch(e){ alert("수정 실패: "+e.message); }
  }else{
    await _origSave.call(mSave);
  }
};
