/** =========================
 *  Firebase 초기화
 * ========================= */
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

/** =========================
 *  상수(UID)
 * ========================= */
// 관리자 UID로 교체하세요.
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";
// 공개 조회용 UID (관리자와 같게 쓰면, 같은 경로만 읽습니다)
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";

/** =========================
 *  헬퍼
 * ========================= */
const $  = (q, r=document)=>r.querySelector(q);
const $$ = (q, r=document)=>Array.from(r.querySelectorAll(q));

function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}
function getWeekday(iso){
  if(!iso) return "";
  const d = new Date(iso+'T00:00:00');
  return ["일","월","화","수","목","금","토"][d.getDay()];
}
// YYYY-MM-DD → "YYYY-MM-DD (요일)" 또는 "YYYY-MM-DD (요일) ~ ..."
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
// D-Day: 시작 기준, 진행중은 D-day(노랑), 미래는 색 구간, 지남은 '끝'
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
// 현재 사용 UID(관리자는 자신의/그 외는 PUBLIC_UID)
function currentDataUID(){
  return (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
}
// tasks 컬렉션 경로
function tasksCol(cat){
  return db.collection("users").doc(currentDataUID()).collection("tasks").doc(cat).collection("items");
}
// notices 컬렉션 경로
function noticesCol(){
  return db.collection("users").doc(currentDataUID()).collection("notices").collection("items");
}
// settings 문서 경로
function settingsDoc(){
  return db.collection("users").doc(PUBLIC_UID).collection("settings").doc("app");
}

/** =========================
 *  전역 상태
 * ========================= */
let currentUser = null;
let listeners   = [];  // onSnapshot 해제 리스트

/** =========================
 *  섹션 펼침/접기
 * ========================= */
function toggleSection(id){
  const el = document.getElementById(id);
  el.classList.toggle("open");
}

/** =========================
 *  리스트 렌더 (시험/수행평가/숙제)
 * ========================= */
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

function taskItemHTML(cat, id, it){
  const dates = dateSpanText(it.start, it.end);
  const pTxt  = periodText(it.pStart, it.pEnd);

  // 카드 본문 순서: 과목 → 내용 → 상세 → 날짜/교시
  return `
  <li class="task">
    <div class="task__main">
      <div class="title"><b>${escapeHTML(it.subj||"")}</b> ${renderDday(it.start, it.end)}</div>
      ${it.text   ? `<div class="body">${escapeHTML(it.text)}</div>` : ""}
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

/** =========================
 *  전달 사항 날짜 포맷
 *    → "공고일: YYYY년 MM월 DD일 (요일)"
 * ========================= */
function formatNoticeDate(isoDate){ // isoDate: "YYYY-MM-DD"
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  const wk = ["일","월","화","수","목","금","토"][d.getDay()];
  return `공고일: ${y}년 ${m}월 ${day}일 (${wk})`;
}

/** =========================
 *  전달 사항 렌더
 * ========================= */
const noticeListEl   = $("#notice_list");
const noticeToggleEl = $("#noticeToggle");
const noticeAddRow   = $("#noticeAddRow");
const nTitle = $("#nTitle");
const nKind  = $("#nKind");
const nBody  = $("#nBody");
const nAdd   = $("#nAddBtn");

// 수정 모달 요소(전달 사항)
const noticeModal = $("#noticeModal");
const nmTitle = $("#nmTitle");
const nmKind  = $("#nmKind");
const nmBody  = $("#nmBody");
const nmSave  = $("#nmSave");

let noticeEditCtx = {id:null};

function noticeItemHTML(id, it){
  // 색상 클래스
  const kindClass = it.kind === "notice" ? "kind-notice"
                 : it.kind === "info"   ? "kind-info"
                 : "kind-alert";

  // 날짜: createdAtISO 저장값 우선, 없으면 서버시간 사용 시 변환
  let iso = it.createdAtISO;
  if (!iso && it.createdAt && it.createdAt.toDate) {
    const d = it.createdAt.toDate();
    iso = d.toISOString().slice(0,10);
  }
  const dateLine = iso ? formatNoticeDate(iso) : "";

  return `
    <li class="notice-card ${kindClass}">
      <div class="notice-title">[${it.kind === "notice" ? "공지" : it.kind === "info" ? "안내" : "알림"}] ${escapeHTML(it.title||"")}</div>
      ${it.body ? `<div class="body" style="margin-top:8px;white-space:pre-wrap">${escapeHTML(it.body)}</div>` : ""}
      ${dateLine ? `<div class="notice-meta" style="margin-top:10px">${dateLine}</div>` : ""}

      ${currentUser?.uid===ADMIN_UID ? `
      <div class="card-actions" style="margin-top:10px">
        <button class="btn" onclick="openNoticeEdit('${id}')">수정</button>
        <button class="btn" onclick="deleteNotice('${id}')">삭제</button>
      </div>` : ``}
    </li>
  `;
}
function renderNotices(docs){
  noticeListEl.innerHTML = docs.map(d=> noticeItemHTML(d.id, d.data())).join("");
}

/** =========================
 *  Firestore 구독
 * ========================= */
function stopListen(){
  listeners.forEach(u=>u&&u());
  listeners = [];
}

function startListen(){
  stopListen();

  // 시험/수행/숙제
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

  // 전달 사항
  const unNotice = noticesCol().orderBy("createdAt","desc").onSnapshot(snap=>{
    const arr=[]; snap.forEach(d=>arr.push(d));
    renderNotices(arr);
  }, err=>{
    console.error("notice listener error:", err);
    alert("전달 사항 목록을 불러오지 못했습니다: "+err.message);
  });
  listeners.push(unNotice);

  // 설정(ON/OFF) - 토글은 항상 보이게 하되, 리스트만 숨김/표시
  const unSetting = settingsDoc().onSnapshot(doc=>{
    const data = doc.data() || {showNotice:true};
    noticeToggleEl.checked = !!data.showNotice;
    // 리스트 영역 표시 제어(토글/입력폼은 항상 보임)
    noticeListEl.parentElement.style.display = data.showNotice ? "" : "none";
  });
  listeners.push(unSetting);
}

/** =========================
 *  로그인 UI
 * ========================= */
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
  startListen();
});

function setAdminVisible(isAdmin){
  // 할 일 추가폼
  $$(".add-row").forEach(r=>{
    // 전달사항 입력폼은 id="noticeAddRow"라서 별도 제어
    if(r.id === "noticeAddRow") return;
    r.style.display = isAdmin ? "" : "none";
  });
  // 전달사항 입력폼
  if (noticeAddRow) noticeAddRow.style.display = isAdmin ? "" : "none";
}

/** =========================
 *  추가(시험/수행/숙제)
 * ========================= */
function bindAddRows(){
  $$(".add-row").forEach(row=>{
    if (row.id === "noticeAddRow") return; // 전달사항 영역은 다른 함수에서 바인딩
    const btn = $(".add", row);
    if(!btn) return;

    btn.onclick = async ()=>{
      if(currentUser?.uid !== ADMIN_UID){
        alert("관리자만 추가할 수 있습니다.");
        return;
      }
      const cat   = row.dataset.cat;
      const subj  = $(".subj", row).value.trim();
      const text  = $(".text", row).value.trim();
      const start = $(".date", row).value || "";
      const end   = $(".date2",row).value || start;
      const pStart= $(".pStart",row).value || "";
      const pEnd  = $(".pEnd", row).value || "";
      const detail= $(".detail",row).value;

      if(!subj || !start){
        alert("과목/날짜는 필수입니다."); return;
      }
      try{
        await tasksCol(cat).add({
          subj, text, start, end, pStart, pEnd, detail,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // 입력 초기화
        $(".subj", row).value = "";
        $(".text", row).value = "";
        $(".date", row).value = "";
        $(".date2",row).value = "";
        $(".pStart",row).value = "";
        $(".pEnd", row).value = "";
        $(".detail",row).value = "";
      }catch(e){
        console.error(e);
        alert("저장 실패: "+e.message);
      }
    };
  });
}

/** =========================
 *  수정/삭제 (시험/수행/숙제)
 * ========================= */
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

/** =========================
 *  전달 사항: 추가/수정/삭제/ONOFF
 * ========================= */
function bindNoticeAdd(){
  if(!nAdd) return;
  nAdd.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){
      alert("관리자만 추가할 수 있습니다."); return;
    }
    const title = nTitle.value.trim();
    const kind  = nKind.value || "notice";
    const body  = nBody.value;

    if(!title){
      alert("제목은 필수입니다."); return;
    }
    try{
      const nowISO = new Date().toISOString().slice(0,10); // YYYY-MM-DD
      await noticesCol().add({
        title, kind, body,
        createdAtISO: nowISO,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      nTitle.value = "";
      nKind.value  = "notice";
      nBody.value  = "";
    }catch(e){
      console.error(e);
      alert("추가 실패: "+e.message);
    }
  };

  // ON/OFF 토글
  if (noticeToggleEl){
    noticeToggleEl.onchange = async (e)=>{
      try{
        await settingsDoc().set({showNotice: e.target.checked}, {merge:true});
      }catch(err){
        alert("설정 저장 실패: "+err.message);
      }
    };
  }
}

function openNoticeEdit(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
  noticeEditCtx = {id};
  noticesCol().doc(id).get().then(snap=>{
    const it = snap.data();
    nmTitle.value = it.title || "";
    nmKind.value  = it.kind  || "notice";
    nmBody.value  = it.body  || "";
    noticeModal.classList.remove("hidden");
  });
}
function closeNoticeEdit(){
  noticeModal.classList.add("hidden");
  noticeEditCtx = {id:null};
}
if(nmSave){
  nmSave.onclick = async ()=>{
    if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 수정할 수 있습니다."); return; }
    const {id} = noticeEditCtx; if(!id) return;
    const payload = {
      title: nmTitle.value.trim(),
      kind : nmKind.value,
      body : nmBody.value
    };
    try{
      await noticesCol().doc(id).update(payload);
      closeNoticeEdit();
    }catch(e){
      alert("수정 실패: "+e.message);
    }
  };
}

async function deleteNotice(id){
  if(currentUser?.uid !== ADMIN_UID){ alert("관리자만 삭제할 수 있습니다."); return; }
  if(!confirm("정말 삭제할까요?")) return;
  try{
    await noticesCol().doc(id).delete();
  }catch(e){
    alert("삭제 실패: "+e.message);
  }
}

/** =========================
 *  모달 닫기(ESC) - 선택
 * ========================= */
document.addEventListener("keydown", (e)=>{
  if(e.key === "Escape"){
    if(!modal.classList.contains("hidden")) closeEdit();
    if(!noticeModal.classList.contains("hidden")) closeNoticeEdit();
  }
});
