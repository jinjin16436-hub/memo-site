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
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";  // 공개 조회는 같은 UID 사용

// 전달 사항 전용 컬렉션 (항상 관리자 경로)
const NOTICE_COL = db.collection("users").doc(ADMIN_UID).collection("announces");
// ON/OFF 설정 문서
const SETTINGS_DOC = db.collection("users").doc(ADMIN_UID).collection("settings").doc("app");

// ===== 2) DOM 헬퍼 =====
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

// ===== 3) 전역 =====
let currentUser = null;
let listeners = [];

// ===== 4) 도우미 =====
function toggleSection(id){ $("#"+id).classList.toggle("open"); }
function getWeekday(iso){ if(!iso) return ""; const d=new Date(iso+'T00:00:00'); return ["일","월","화","수","목","금","토"][d.getDay()]; }
function dateSpanText(start,end){
  if(!start && !end) return "";
  const s = start || end, e = end || start;
  const sw = getWeekday(s), ew = getWeekday(e);
  return s===e ? `${s} (${sw})` : `${s} (${sw}) ~ ${e} (${ew})`;
}
function periodText(ps,pe){ if(!ps&&!pe) return ""; if(ps&&pe&&ps!==pe) return `${ps}~${pe}교시`; return `${ps||pe}교시`; }
function escapeHTML(s){ return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }

// D-Day (시작 기준 / 진행중은 D-day)
function renderDday(start, end){
  if(!start) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start+'T00:00:00');
  const e = new Date((end||start)+'T00:00:00');
  const diff = Math.floor((s-today)/86400000);

  let label="", cls="";
  if(today >= s && today <= e){ label = "D-day"; cls = "yellow"; }
  else if(diff > 0){
    label = `D-${diff}`;
    if(diff===1) cls="red";
    else if(diff<=3) cls="orange";
    else if(diff<=5) cls="yellow";
    else cls="green";
  }else if(diff === 0){ label="D-0"; cls="red"; }
  else { label="끝"; cls="gray"; }
  return `<span class="dday ${cls}">${label}</span>`;
}

// ===== 5) Firestore 경로 =====
function col(cat){
  const uid = (currentUser && currentUser.uid===ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}

// ===== 6) 항목 렌더 =====
const lists = { exam: $("#list_exam"), perf: $("#list_perf"), home: $("#list_home") };

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
          </div>`:``}
      </div>
    </li>`;
}
function renderList(cat, docs){
  lists[cat].innerHTML = docs.map(d => taskItemHTML(cat,d.id,d.data())).join("");
}

// ===== 7) 전달 사항 렌더 =====
const noticeList = $("#notice_list");
function noticeHTML(id, it){
  const cls =
    it.kind==="notice" ? "kind-notice" :
    it.kind==="info"   ? "kind-info"   : "kind-alert";
  const kindLabel = it.kind==="notice" ? "공지" : it.kind==="info" ? "안내" : "알림";
  return `
    <li class="notice-card ${cls}">
      <div class="notice-title">[${kindLabel}] ${escapeHTML(it.title||"")}</div>
      ${it.body ? `<pre>${escapeHTML(it.body)}</pre>` : ""}
      ${currentUser?.uid===ADMIN_UID ? `
        <div class="card-actions">
          <button class="btn" onclick="openNoticeEdit('${id}')">수정</button>
          <button class="btn" onclick="deleteNotice('${id}')">삭제</button>
        </div>`:``}
    </li>`;
}
function renderNotices(snap){
  const arr = []; snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
  noticeList.innerHTML = arr.map(it => noticeHTML(it.id, it)).join("") ||
    `<li class="notice-card">등록된 전달 사항이 없습니다.</li>`;
}

// ===== 8) 리스너 =====
function stopListen(){ listeners.forEach(u=>u&&u()); listeners = []; }
function startListen(){
  stopListen();
  ["exam","perf","home"].forEach(cat=>{
    const un = col(cat).orderBy("start","asc").onSnapshot(snap=>{
      const docs=[]; snap.forEach(d=>docs.push(d));
      renderList(cat, docs);
    }, err=>{
      console.error(err);
      alert("목록을 불러오지 못했습니다: " + err.message);
    });
    listeners.push(un);
  });

  // 전달 사항 목록(관리자 경로 고정)
  const un2 = NOTICE_COL.orderBy("createdAt","desc").onSnapshot(renderNotices, err=>{
    console.error(err);
    alert("전달 사항 목록을 불러오지 못했습니다: " + err.message);
  });
  listeners.push(un2);

  // ON/OFF 스위치
  SETTINGS_DOC.onSnapshot(doc=>{
    const on = !!(doc.exists ? doc.data().showNotice : false);
    $("#noticeToggle").checked = on;
    $("#sec_notice").style.display = on ? "" : "none";
  });
}

// ===== 9) 로그인 / UI =====
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
  bindNoticeRow();
  startListen();
});

function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r => r.style.display = isAdmin ? "" : "none");
}

// ===== 10) 과목/숙제 추가 =====
function bindAddRows(){
  $$(".add-row[data-cat]").forEach(row=>{
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
        await col(cat).add({
          subj,text,start,end,pStart,pEnd,detail,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        $(".subj",row).value=""; $(".text",row).value="";
        $(".date",row).value=""; $(".date2",row).value="";
        $(".pStart",row).value=""; $(".pEnd",row).value="";
        $(".detail",row).value="";
      }catch(e){ alert("저장 실패: "+e.message); console.error(e); }
    };
  });
}

// ===== 11) 항목 수정/삭제 =====
let editCtx = {cat:null,id:null};
const modal=$("#editModal");
const mSubj=$("#mSubj"), mText=$("#mText"), mStart=$("#mStart"), mEnd=$("#mEnd"),
      mPStart=$("#mPStart"), mPEnd=$("#mPEnd"), mDetail=$("#mDetail"), mSave=$("#mSave");

function openEdit(cat,id){
  if(currentUser?.uid!==ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editCtx={cat,id};
  col(cat).doc(id).get().then(s=>{
    const it=s.data();
    mSubj.value=it.subj||""; mText.value=it.text||"";
    mStart.value=it.start||""; mEnd.value=it.end||it.start||"";
    mPStart.value=it.pStart||""; mPEnd.value=it.pEnd||"";
    mDetail.value=it.detail||"";
    modal.classList.remove("hidden");
  });
}
function closeEdit(){ modal.classList.add("hidden"); editCtx={cat:null,id:null}; }
mSave.onclick = async ()=>{
  if(currentUser?.uid!==ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  const {cat,id}=editCtx; if(!cat||!id) return;
  try{
    await col(cat).doc(id).update({
      subj:mSubj.value.trim(),
      text:mText.value.trim(),
      start:mStart.value||"",
      end:mEnd.value||mStart.value||"",
      pStart:mPStart.value||"", pEnd:mPEnd.value||"",
      detail:mDetail.value
    });
    closeEdit();
  }catch(e){ alert("수정 실패: "+e.message); }
};
async function doDelete(cat,id){
  if(currentUser?.uid!==ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{ await col(cat).doc(id).delete(); }catch(e){ alert("삭제 실패: "+e.message); }
}

// ===== 12) 전달 사항 추가/수정/삭제 =====
function bindNoticeRow(){
  const addBtn = $("#nAddBtn");
  const title  = $("#nTitle");
  const kind   = $("#nKind");
  const body   = $("#nBody");
  if(!addBtn) return;

  // 관리자만 보이기
  $("#noticeAddRow").style.display = (currentUser?.uid===ADMIN_UID) ? "" : "none";

  addBtn.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const t=title.value.trim(); const k=kind.value; const b=body.value;
    if(!t){ alert("제목을 입력하세요."); return; }
    try{
      await NOTICE_COL.add({
        title:t, kind:k, body:b,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      title.value=""; body.value="";
    }catch(e){ alert("추가 실패: "+e.message); console.error(e); }
  };

  // ON/OFF 토글 저장
  $("#noticeToggle").onchange = async (e)=>{
    try{ await SETTINGS_DOC.set({showNotice:e.target.checked},{merge:true}); }
    catch(err){ alert("설정 저장 실패: "+err.message); }
  };
}

// 수정 모달
const nModal=$("#noticeModal");
const nmTitle=$("#nmTitle"), nmKind=$("#nmKind"), nmBody=$("#nmBody"),
      nmSave=$("#nmSave");
let nEditId=null;

function openNoticeEdit(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  nEditId=id;
  NOTICE_COL.doc(id).get().then(s=>{
    const it=s.data();
    nmTitle.value=it.title||"";
    nmKind.value =it.kind ||"notice";
    nmBody.value =it.body ||"";
    nModal.classList.remove("hidden");
  });
}
function closeNoticeEdit(){ nModal.classList.add("hidden"); nEditId=null; }
nmSave.onclick = async ()=>{
  if(!nEditId) return;
  try{
    await NOTICE_COL.doc(nEditId).update({
      title:nmTitle.value.trim(),
      kind:nmKind.value,
      body:nmBody.value
    });
    closeNoticeEdit();
  }catch(e){ alert("수정 실패: "+e.message); }
};
async function deleteNotice(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("삭제할까요?")) return;
  try{ await NOTICE_COL.doc(id).delete(); }catch(e){ alert("삭제 실패: "+e.message); }
}

// ===== 13) 초기 1분마다 조용히 새로고침(선택) =====
setInterval(()=>{ location.reload(); }, 60*1000);
