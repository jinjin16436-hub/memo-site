/***** 1) Firebase 초기화 *****/
const firebaseConfig = {
  apiKey: "AIzaSyBbThwhLWHJz8mBHGvhpWOL88cP9C7Nxio",
  authDomain: "my-memo-site.firebaseapp.com",
  projectId: "my-memo-site",
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

/***** 2) 역할/상수 *****/
const ADMIN_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";     // ← 관리자 UID
const OWNER_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";        // ← 실제 데이터를 보관하는 소유자 UID

/***** 3) 유틸 *****/
const KWD = ["일","월","화","수","목","금","토"];
const $  = (q, root=document)=>root.querySelector(q);
const $$ = (q, root=document)=>Array.from(root.querySelectorAll(q));

function fmtDateWithWeekday(dstr){
  if(!dstr) return "";
  const dt = new Date(dstr+"T00:00:00");
  if (isNaN(dt)) return dstr;
  const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,"0"), d=String(dt.getDate()).padStart(2,"0");
  return `${y}-${m}-${d} (${KWD[dt.getDay()]})`;
}

function renderDday(start, end){
  if(!start) return "";
  const today=new Date(); today.setHours(0,0,0,0);
  const s=new Date(start+"T00:00:00");
  const e=end? new Date(end+"T00:00:00"): s;

  let label="", cls="";
  if (today >= s && today <= e){ label="D-day"; cls="orange"; }
  else {
    const diff=Math.ceil((s - today)/(1000*60*60*24));
    if (diff<0){ label=`D+${Math.abs(diff)}`; cls="past"; }
    else if (diff===0){ label="D-day"; cls="red"; }
    else if (diff===1){ label="D-1"; cls="red"; }
    else if (diff<=3){ label=`D-${diff}`; cls="orange"; }
    else if (diff<=5){ label=`D-${diff}`; cls="yellow"; }
    else { label=`D-${diff}`; cls="green"; }
  }
  return `<span class="dday ${cls}">${label}</span>`;
}

/***** 4) Firestore 경로 *****/
const col = (cat)=>{
  // 쓰기와 읽기 모두 '소유자' 경로를 기준으로 관리합니다.
  const base = db.collection("users").doc(OWNER_UID);
  return base.collection(cat);
};
const settingsDoc = db.collection("users").doc(OWNER_UID).collection("settings").doc("global");

/***** 5) 로그인 UI *****/
$("#loginBtn").onclick = ()=>auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
$("#logoutBtn").onclick= ()=>auth.signOut();

/***** 6) 상태/리스너 *****/
let currentUser=null;
let unsubscribers = [];

auth.onAuthStateChanged(async user=>{
  currentUser=user;
  $("#loginBtn").style.display = user? "none" : "";
  $("#logoutBtn").style.display= user? "" : "none";
  $("#adminBadge").style.display= (user?.uid===ADMIN_UID) ? "" : "none";

  // 추가폼 노출 제어
  $$(".add-row").forEach(row=>{
    row.style.display = (user?.uid===ADMIN_UID) ? "" : "none";
  });

  // 전역 스위치(관리자 전용) 노출
  $("#noticeToggleWrap").style.display = (user?.uid===ADMIN_UID) ? "" : "none";

  startListeners();
});

/***** 7) 섹션 펼침 상태 저장/복원 *****/
const OPEN_KEY = "memo:open-v2";
function saveOpenState(){
  const s = {
    exam: $("#sec_exam")?.classList.contains("open"),
    perf: $("#sec_perf")?.classList.contains("open"),
    home: $("#sec_home")?.classList.contains("open"),
  };
  localStorage.setItem(OPEN_KEY, JSON.stringify(s));
}
function loadOpenState(){
  try{
    const s = JSON.parse(localStorage.getItem(OPEN_KEY)||"{}");
    if(s.exam === false) $("#sec_exam")?.classList.remove("open");
    if(s.perf === false) $("#sec_perf")?.classList.remove("open");
    if(s.home === false) $("#sec_home")?.classList.remove("open");
  }catch{}
}
loadOpenState();
window.toggleSection = (id)=>{
  $("#"+id).classList.toggle("open");
  saveOpenState();
};

/***** 8) 입력 임시저장 (LocalStorage) *****/
const DRAFT_KEY = "memo:draft-v2";
function gatherDraft(){
  const data={};
  $$(".add-row").forEach(row=>{
    const cat=row.dataset.cat;
    data[cat]={};
    if(cat==="notice"){
      data[cat].subj  = $(".subj", row).value;
      data[cat].type  = $(".cat",  row).value;
      data[cat].detail= $(".detail", row).value;
    }else{
      data[cat].subj  = $(".subj", row).value;
      data[cat].text  = $(".text", row).value;
      data[cat].date  = $(".date", row).value;
      data[cat].date2 = $(".date2", row).value;
      data[cat].detail= $(".detail", row).value;
    }
  });
  return data;
}
function applyDraft(){
  try{
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY)||"{}");
    $$(".add-row").forEach(row=>{
      const cat=row.dataset.cat; const v=d[cat]; if(!v) return;
      if(cat==="notice"){
        $(".subj",row).value = v.subj||"";
        $(".cat", row).value = v.type||"공지";
        $(".detail",row).value = v.detail||"";
      }else{
        $(".subj",row).value = v.subj||"";
        $(".text",row).value = v.text||"";
        $(".date",row).value = v.date||"";
        $(".date2",row).value= v.date2||"";
        $(".detail",row).value= v.detail||"";
      }
    });
  }catch{}
}
applyDraft();
document.addEventListener("input",(e)=>{
  if(e.target.closest(".add-row")){
    localStorage.setItem(DRAFT_KEY, JSON.stringify(gatherDraft()));
  }
});

/***** 9) 실시간 리스너 시작 *****/
function clearUnsubs(){unsubscribers.forEach(u=>u&&u()); unsubscribers=[];}
function startListeners(){
  clearUnsubs();

  // 설정(공지 ON/OFF)
  const un1 = settingsDoc.onSnapshot(snap=>{
    const show = snap.exists ? !!snap.data().showNotices : true;
    $("#noticeBox").style.display = show ? "" : "none";
    const isAdmin = (auth.currentUser?.uid===ADMIN_UID);
    if(isAdmin){ $("#noticeToggle").checked = show; }
  });
  unsubscribers.push(un1);

  // 중요 전달 사항
  const un2 = col("notice").orderBy("createdAt","desc").onSnapshot(snap=>{
    const ul=$("#list_notice"); ul.innerHTML="";
    if(snap.empty){ ul.insertAdjacentHTML("beforeend",`<li class="task"><div class="meta">등록된 전달 사항이 없습니다.</div></li>`); return; }
    snap.forEach(doc=>ul.insertAdjacentHTML("beforeend", renderNotice(doc.id, doc.data())));
  });
  unsubscribers.push(un2);

  // 시험/수행/숙제
  ["exam","perf","home"].forEach(cat=>{
    const un = col(cat).orderBy("start","asc").onSnapshot(snap=>{
      const ul = $(`#list_${cat}`); ul.innerHTML="";
      snap.forEach(doc=> ul.insertAdjacentHTML("beforeend", renderTask(cat, doc.id, doc.data())));
    }, err=>{
      console.error("listener error:", err);
    });
    unsubscribers.push(un);
  });
}

/***** 10) 렌더러 *****/
function renderNotice(id, it){
  const chip = `<span class="notice-chip notice-${it.noticeType||'공지'}">[${it.noticeType||'공지'}]</span>`;
  return `
    <li class="task">
      <div class="task__main">
        <div><b>${chip}${it.subj||""}</b></div>
        ${it.detail ? `<pre>${it.detail}</pre>` : ""}
        ${auth.currentUser?.uid===ADMIN_UID ? `
        <div class="card-actions">
          <button class="btn-ghost" onclick="openEdit('notice','${id}')">수정</button>
          <button class="btn-ghost" onclick="doDelete('notice','${id}')">삭제</button>
        </div>`:""}
      </div>
    </li>
  `;
}

function renderTask(cat, id, it){
  const dateText = (it.end && it.end!==it.start)
    ? `${fmtDateWithWeekday(it.start)} ~ ${fmtDateWithWeekday(it.end)}`
    : `${fmtDateWithWeekday(it.start||it.end||"")}`;
  return `
    <li class="task">
      <div class="task__main">
        <div><b>${it.subj||""}</b> ${renderDday(it.start,it.end)}</div>
        ${it.text ? `<div>${it.text}</div>`:""}
        <div class="meta">📅 ${dateText}</div>
        ${it.detail ? `<pre>${it.detail}</pre>` : ""}
        ${auth.currentUser?.uid===ADMIN_UID ? `
        <div class="card-actions">
          <button class="btn-ghost" onclick="openEdit('${cat}','${id}')">수정</button>
          <button class="btn-ghost" onclick="doDelete('${cat}','${id}')">삭제</button>
        </div>`:""}
      </div>
    </li>
  `;
}

/***** 11) 추가 처리 *****/
$$(".add-row .add").forEach(btn=>{
  btn.onclick = async ()=>{
    if (auth.currentUser?.uid !== ADMIN_UID){ alert("관리자만 추가할 수 있습니다."); return; }
    const row = btn.closest(".add-row");
    const cat = row.dataset.cat;

    try{
      if (cat==="notice"){
        const subj = $(".subj", row).value.trim();
        const type = $(".cat",  row).value;
        const detail = $(".detail", row).value;
        if(!subj){ alert("제목을 입력하세요"); return; }

        await col("notice").add({
          subj, noticeType:type, detail,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }else{
        const subj  = $(".subj",  row).value.trim();
        const text  = $(".text",  row).value.trim();
        const start = $(".date",  row).value || "";
        const end   = $(".date2", row).value || start || "";
        const detail= $(".detail",row).value;
        if(!subj){ alert("과목을 입력하세요"); return; }

        await col(cat).add({
          subj, text, start, end, detail,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      // 입력 초기화 + 임시저장 갱신
      row.querySelectorAll("input,textarea").forEach(el=>el.value="");
      localStorage.setItem(DRAFT_KEY, JSON.stringify(gatherDraft()));
    }catch(e){
      alert("추가 실패: "+e.message);
      console.error(e);
    }
  };
});

/***** 12) 공지 ON/OFF (관리자) *****/
$("#noticeToggle").addEventListener("change", async (e)=>{
  if (auth.currentUser?.uid !== ADMIN_UID){ e.preventDefault(); return; }
  try{
    await settingsDoc.set({showNotices:e.target.checked},{merge:true});
  }catch(err){
    alert("설정 저장 실패: "+err.message);
    // 롤백
    const snap=await settingsDoc.get();
    e.target.checked = snap.exists ? !!snap.data().showNotices : true;
  }
});

/***** 13) 삭제 *****/
async function doDelete(cat,id){
  if (!confirm("삭제하시겠어요?")) return;
  await col(cat).doc(id).delete();
}
window.doDelete = doDelete;

/***** 14) 수정 모달 *****/
const modal   = $("#editModal");
const mCat    = $("#mCat");
const mSubj   = $("#mSubj");
const mText   = $("#mText");
const mStart  = $("#mStart");
const mEnd    = $("#mEnd");
const mDetail = $("#mDetail");
const mSave   = $("#mSave");

let editing = { cat:null, id:null };

function showModal(v){
  if(v){ modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false"); }
  else { modal.classList.add("hidden");    modal.setAttribute("aria-hidden","true"); }
}
modal.addEventListener("click", (e)=>{
  if(e.target.matches("[data-close], .modal__backdrop")) showModal(false);
});
$("#mCancel").addEventListener("click", ()=>showModal(false));

function openEdit(cat,id){
  if (auth.currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  editing = { cat, id };
  col(cat).doc(id).get().then(doc=>{
    const it=doc.data()||{};
    mCat.value=cat;
    mSubj.value=it.subj||"";
    mText.value=it.text||"";
    mStart.value=it.start||"";
    mEnd.value=it.end||"";
    mDetail.value=it.detail||"";
    showModal(true);
  });
}
window.openEdit = openEdit;

mSave.onclick = async ()=>{
  if (auth.currentUser?.uid !== ADMIN_UID){ alert("권한이 없습니다."); return; }
  const payload={
    subj:mSubj.value.trim(),
    text:mText.value.trim(),
    start:mStart.value||"",
    end:mEnd.value||mStart.value||"",
    detail:mDetail.value
  };
  if(!payload.subj){ alert("제목/과목을 입력하세요"); return; }
  await col(editing.cat).doc(editing.id).update(payload);
  showModal(false);
};

/***** 15) 1분 조용한 갱신 *****/
// Firestore 실시간 구독이 대부분을 처리하지만, 설정 문서나 연결 이슈 대응용
setInterval(async ()=>{
  // 페이지가 보일 때만 조용히 설정 문서만 재동기화
  if(document.visibilityState==="visible"){
    const snap=await settingsDoc.get().catch(()=>null);
    if(snap && snap.exists){
      const show = !!snap.data().showNotices;
      $("#noticeBox").style.display = show ? "" : "none";
      if(auth.currentUser?.uid===ADMIN_UID) $("#noticeToggle").checked = show;
    }
  }
}, 60_000);
