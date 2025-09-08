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

// ===== 1) 고정값 (네 값으로 교체!) =====
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2"; // 관리자
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2"; // 공개 조회용

// ===== 2) DOM 헬퍼 =====
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

// ===== 3) 전역 =====
let currentUser = null;
let listeners = []; // onSnapshot 해제용
let noticeUnsub = null;
let settingsUnsub = null;

// ===== 4) UI helpers =====
function toggleSection(id){ $("#"+id).classList.toggle("open"); }

function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
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

// D-Day (시작일 기준, 진행중은 D-day 노랑, 시작 전 빨/주/노/초, 지남 회색)
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

// ===== 5) 경로 헬퍼 =====
function taskCol(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}
// 전달 사항: 단일 컬렉션(users/{PUBLIC_UID}/notices)
function noticesCol(){
  return db.collection("users").doc(PUBLIC_UID).collection("notices");
}
// ON/OFF 설정 문서(users/{PUBLIC_UID}/settings/app)
function appSettingsDoc(){
  return db.collection("users").doc(PUBLIC_UID).collection("settings").doc("app");
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
  ul.innerHTML = docs.map(d => taskItemHTML(cat, d.id, d.data())).join("");
}

// 전달사항 렌더
function noticeItemHTML(n){
  const kindCls = n.kind === 'notice' ? 'kind-notice'
                : n.kind === 'info'   ? 'kind-info'
                : 'kind-alert';
  const title = escapeHTML(n.title||"");
  const body  = escapeHTML(n.body||"");
  const created = n.createdAt?.toDate ? n.createdAt.toDate() : null;
  const meta = created ? created.toLocaleString() : "";

  return `
  <li class="notice-card ${kindCls}">
    <div class="notice-title">[${n.kind==='notice'?'공지':n.kind==='info'?'안내':'알림'}] ${title}</div>
    <pre style="margin:8px 0 0">${body}</pre>
    <div class="notice-meta">${meta}</div>
    ${currentUser?.uid===ADMIN_UID ? `
      <div class="card-actions">
        <button class="btn" onclick="openNoticeEdit('${n.id}')">수정</button>
        <button class="btn" onclick="deleteNotice('${n.id}')">삭제</button>
      </div>` : ``}
  </li>`;
}
function renderNotices(arr){
  $("#notice_list").innerHTML = arr.map(noticeItemHTML).join("");
}

// ===== 7) 실시간 구독 =====
function startTaskListeners(){
  stopTaskListeners();
  ["exam","perf","home"].forEach(cat=>{
    const un = taskCol(cat).orderBy("start","asc").onSnapshot(snap=>{
      const arr = []; snap.forEach(d=>arr.push(d));
      renderList(cat, arr);
    }, err=>{
      console.error(err);
      alert("목록을 불러오지 못했습니다: " + err.message);
    });
    listeners.push(un);
  });
}
function stopTaskListeners(){
  listeners.forEach(u=>u&&u()); listeners = [];
}

function startNoticeListener(){
  if(noticeUnsub) { noticeUnsub(); noticeUnsub=null; }
  noticeUnsub = noticesCol()
    .orderBy("createdAt", "desc")
    .onSnapshot((snap)=>{
      const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
      renderNotices(arr);
    }, (err)=>{
      console.error(err);
      alert("전달 사항 목록을 불러오지 못했습니다: "+err.message);
    });
}
function startSettingsListener(){
  if(settingsUnsub) { settingsUnsub(); settingsUnsub=null; }
  settingsUnsub = appSettingsDoc().onSnapshot((doc)=>{
    const data = doc.data() || { noticesOn: true };
    $("#noticeToggle").checked = !!data.noticesOn;
    $("#sec_notice").style.display = data.noticesOn ? "" : "none";
  }, (err)=>{
    console.error(err);
  });
}

// ===== 8) 로그인 =====
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
loginBtn.onclick  = ()=> auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = ()=> auth.signOut();

auth.onAuthStateChanged(u=>{
  currentUser = u || null;
  loginBtn.style.display  = u ? "none" : "";
  logoutBtn.style.display = u ? "" : "none";

  const isAdmin = !!u && u.uid===ADMIN_UID;
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");

  bindAddRows();              // 추가 버튼 바인딩
  startTaskListeners();       // 과제/시험/수행
  startNoticeListener();      // 전달 사항
  startSettingsListener();    // ON/OFF
});

// ===== 9) 추가 폼 바인딩 & 저장 =====
function bindAddRows(){
  $$(".add-row").forEach(row=>{
    const btn = $(".add", row);
    if(!btn) return;
    btn.onclick = async ()=>{
      if(currentUser?.uid !== ADMIN_UID) { alert("관리자만 추가할 수 있습니다."); return; }

      const cat   = row.dataset.cat;
      if(!cat){ return; } // 전달사항 폼도 add-row라서 구분

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

  // 전달 사항 추가 버튼
  const addBtn = $("#nAddBtn");
  if(addBtn){
    addBtn.onclick = async ()=>{
      if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
      const title = $("#nTitle").value.trim();
      const kind  = $("#nKind").value || "notice";
      const body  = $("#nBody").value;

      if(!title){ alert("제목을 입력해 주세요."); return; }
      try{
        await noticesCol().add({
          title, kind, body,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        $("#nTitle").value = "";
        $("#nKind").value = "notice";
        $("#nBody").value = "";
      }catch(e){
        alert("전달 사항 저장 실패: " + e.message);
        console.error(e);
      }
    };
  }
}

// ===== 10) 수정/삭제 (일반 항목) =====
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
    await taskCol(cat).doc(id).update(payload);
    closeEdit();
  }catch(e){
    alert("수정 실패: "+e.message);
  }
};
async function doDelete(cat, id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await taskCol(cat).doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
}

// ===== 11) 전달 사항 ON/OFF =====
$("#noticeToggle").addEventListener("change", async (e)=>{
  const on = e.target.checked;
  if(currentUser?.uid !== ADMIN_UID){
    // 읽기 전용: 다시 원래대로 돌려놓고 알림
    e.target.checked = !on;
    alert("관리자만 설정을 변경할 수 있습니다.");
    return;
  }
  try{
    await appSettingsDoc().set({ noticesOn: on }, { merge:true });
  }catch(err){
    alert("설정 저장 실패: "+err.message);
  }
});

// ===== 12) 전달 사항 수정/삭제 =====
let nEditId = null;
const nModal = $("#noticeModal");
const nmTitle = $("#nmTitle");
const nmKind  = $("#nmKind");
const nmBody  = $("#nmBody");
const nmSave  = $("#nmSave");

function openNoticeEdit(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  nEditId = id;
  noticesCol().doc(id).get().then(snap=>{
    const n = snap.data();
    nmTitle.value = n.title || "";
    nmKind.value  = n.kind  || "notice";
    nmBody.value  = n.body  || "";
    nModal.classList.remove("hidden");
  });
}
function closeNoticeEdit(){
  nModal.classList.add("hidden");
  nEditId = null;
}
$("#nmClose").onclick = closeNoticeEdit;
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
    alert("전달 사항 수정 실패: " + e.message);
  }
};
async function deleteNotice(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("전달 사항을 삭제할까요?")) return;
  try{
    await noticesCol().doc(id).delete();
  }catch(e){
    alert("전달 사항 삭제 실패: " + e.message);
  }
}
