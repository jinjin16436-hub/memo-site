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
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2"; // 관리자
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2"; // 조회용

// ===== 2) DOM 헬퍼 =====
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

// ===== 3) 전역 =====
let currentUser = null;
let listeners = [];

// ===== 4) 공통 유틸 =====
function toggleSection(id){ document.getElementById(id).classList.toggle("open"); }

function getWeekday(iso){
  if(!iso) return "";
  const d = new Date(iso+"T00:00:00");
  return ["일","월","화","수","목","금","토"][d.getDay()];
}
function dateSpanText(start,end){
  if(!start && !end) return "";
  const s = start || end, e=end || start;
  const sW=getWeekday(s), eW=getWeekday(e);
  return (s===e)? `${s} (${sW})` : `${s} (${sW}) ~ ${e} (${eW})`;
}
function periodText(pStart,pEnd){
  if(!pStart && !pEnd) return "";
  if(pStart && !pEnd) return `${pStart}교시`;
  if(!pStart && pEnd) return `${pEnd}교시`;
  if(pStart===pEnd) return `${pStart}교시`;
  return `${pStart}~${pEnd}교시`;
}
// 시작 기준 & 기간 중 D-day, 색상 규칙
function renderDday(start,end){
  if(!start) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start+"T00:00:00");
  const e = new Date((end||start)+"T00:00:00");
  const diff = Math.floor((s - today)/86400000);

  let label="", cls="";
  if(today>=s && today<=e){ label="D-day"; cls="yellow"; }
  else if(diff>0){
    label=`D-${diff}`;
    if(diff===1) cls="red";
    else if(diff<=3) cls="orange";
    else if(diff<=5) cls="yellow";
    else cls="green";
  }else if(diff===0){ label="D-0"; cls="red"; }
  else { label="끝"; cls="gray"; }
  return `<span class="dday ${cls}">${label}</span>`;
}
function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}

// ===== 5) Firestore 경로 =====
function col(cat){
  const uid = (currentUser && currentUser.uid===ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}
const noticeCol   = () => db.collection("users").doc(ADMIN_UID).collection("notices").doc("items").collection("docs");
const settingsDoc = () => db.collection("users").doc(ADMIN_UID).collection("settings").doc("app");

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
  lists[cat].innerHTML = docs.map(d=>taskItemHTML(cat, d.id, d.data())).join("");
}

// ===== 7) 공지 렌더링 =====
function noticeItemHTML(id, it){
  const cls = it.kind==="notice" ? "kind-notice" : it.kind==="info" ? "kind-info" : "kind-alert";
  return `
  <li class="notice-card ${cls}">
    <div class="notice-title">[${it.kind==="notice"?"공지":it.kind==="info"?"안내":"알림"}] ${escapeHTML(it.title||"")}</div>
    ${it.body ? `<pre>${escapeHTML(it.body)}</pre>` : ""}
    ${currentUser?.uid===ADMIN_UID ? `
    <div class="card-actions">
      <button class="btn" onclick="openNoticeEdit('${id}')">수정</button>
      <button class="btn" onclick="deleteNotice('${id}')">삭제</button>
    </div>` : ``}
  </li>`;
}
function renderNotices(arr){
  $("#notice_list").innerHTML = arr.map(d=>noticeItemHTML(d.id, d.data())).join("");
}

// ===== 8) 구독 =====
function startListen(){
  stopListen();
  ["exam","perf","home"].forEach(cat=>{
    const un = col(cat).orderBy("start","asc").onSnapshot(snap=>{
      const arr=[]; snap.forEach(d=>arr.push(d));
      renderList(cat, arr);
    },err=>{
      alert("목록을 불러오지 못했습니다: "+err.message);
    });
    listeners.push(un);
  });

  // 전달 사항
  const un2 = settingsDoc().onSnapshot(doc=>{
    const on = !!doc.data()?.noticeOn;
    $("#noticeToggle").checked = on;
    $("#sec_notice").style.display = on ? "" : "none";
  });
  listeners.push(un2);

  const un3 = noticeCol().orderBy("createdAt","desc").onSnapshot(snap=>{
    const arr=[]; snap.forEach(d=>arr.push(d));
    renderNotices(arr);
  }, err=>{
    alert("전달 사항 목록을 불러오지 못했습니다: "+err.message);
  });
  listeners.push(un3);
}
function stopListen(){ listeners.forEach(u=>u&&u()); listeners=[]; }

// ===== 9) 로그인 UI =====
$("#loginBtn").onclick  = ()=> auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
$("#logoutBtn").onclick = ()=> auth.signOut();

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  $("#loginBtn").style.display  = u ? "none" : "";
  $("#logoutBtn").style.display = u ? "" : "none";
  setAdminVisible(!!u && u.uid===ADMIN_UID);
  bindAddRows();
  bindNoticeAdd();
  startListen();
});

function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r => r.style.display = isAdmin ? "" : "none");
  // 토글은 관리자만 변경 가능 (비관리자는 읽기만)
  $("#noticeToggle").disabled = !isAdmin;
}

// ===== 10) 추가폼 바인딩 =====
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
        await col(cat).add({
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
      }
    };
  });
}

// ===== 11) 수정/삭제 =====
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
function closeEdit(){ modal.classList.add("hidden"); editCtx={cat:null,id:null}; }
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
  try{ await col(cat).doc(id).update(payload); closeEdit(); }
  catch(e){ alert("수정 실패: "+e.message); }
};
async function doDelete(cat,id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{ await col(cat).doc(id).delete(); } catch(e){ alert("삭제 실패: "+e.message); }
}

// ===== 12) 공지 추가/수정/삭제/토글 =====
function bindNoticeAdd(){
  const btn = $("#nAddBtn");
  if(!btn) return;
  btn.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const title = $("#nTitle").value.trim();
    const kind  = $("#nKind").value;
    const body  = $("#nBody").value;
    if(!title){ alert("제목을 입력해 주세요."); return; }
    try{
      await noticeCol().add({
        title, kind, body,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      $("#nTitle").value=""; $("#nBody").value="";
    }catch(e){
      alert("전달 사항 저장 실패: "+e.message);
    }
  };

  // 토글 저장 (관리자만)
  $("#noticeToggle").onchange = async (e)=>{
    if(currentUser?.uid !== ADMIN_UID){ e.target.checked=!e.target.checked; return; }
    try{ await settingsDoc().set({noticeOn: e.target.checked},{merge:true}); }
    catch(err){ alert("설정 저장 실패: "+err.message); }
  };
}

// 공지 수정 모달
let nEditId = null;
function openNoticeEdit(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  nEditId = id;
  noticeCol().doc(id).get().then(snap=>{
    const it = snap.data();
    $("#nmTitle").value = it.title||"";
    $("#nmKind").value  = it.kind || "notice";
    $("#nmBody").value  = it.body || "";
    $("#noticeModal").classList.remove("hidden");
  });
}
function closeNoticeEdit(){ $("#noticeModal").classList.add("hidden"); nEditId=null; }
$("#nmSave").onclick = async ()=>{
  if(!nEditId) return;
  try{
    await noticeCol().doc(nEditId).update({
      title: $("#nmTitle").value.trim(),
      kind : $("#nmKind").value,
      body : $("#nmBody").value
    });
    closeNoticeEdit();
  }catch(e){ alert("저장 실패: "+e.message); }
};
async function deleteNotice(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{ await noticeCol().doc(id).delete(); } catch(e){ alert("삭제 실패: "+e.message); }
}
