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
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";      // 관리자 UID 로 바꾸세요
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";  // 공개 조회용 UID

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
function col(cat){
  const uid = (currentUser && currentUser.uid === ADMIN_UID) ? ADMIN_UID : PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}

// ===== 5) 렌더링 =====
const lists = {
  exam: $("#list_exam"),
  perf: $("#list_perf"),
  home: $("#list_home"),
};

// li 요소를 *문자열이 아닌* DOM으로 만든다 (줄바꿈은 textContent + CSS로 처리)
function taskItemElement(cat, id, it){
  const li = document.createElement("li");
  li.className = "task";

  const main = document.createElement("div");
  main.className = "task__main";
  li.appendChild(main);

  // 1) 제목 + D-day
  const titleRow = document.createElement("div");
  const strong = document.createElement("b");
  strong.textContent = it.subj || "";
  titleRow.appendChild(strong);

  // D-day는 이미 HTML 뱃지이므로 안전하게 넣어도 됨
  const ddayWrap = document.createElement("span");
  ddayWrap.innerHTML = " " + renderDday(it.start, it.end);
  titleRow.appendChild(ddayWrap);
  main.appendChild(titleRow);

  // 2) 본문(내용)
  if (it.text) {
    const textEl = document.createElement("div");
    textEl.textContent = it.text;              // ✅ 줄바꿈 안전
    main.appendChild(textEl);
  }

  // 3) 날짜/교시 메타
  const dates = dateSpanText(it.start, it.end);
  const pTxt  = periodText(it.pStart, it.pEnd);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `📅 ${dates}${pTxt ? ` · ${pTxt}` : ""}`;
  main.appendChild(meta);

  // 4) 상세 내용(여러 줄) – 줄바꿈을 그대로 보여줌
  if (it.detail) {
    const details = document.createElement("div");
    details.className = "details";
    details.textContent = it.detail;           // ✅ 줄바꿈 안전
    main.appendChild(details);
  }

  // 5) 관리자만 버튼 보이기
  if (currentUser?.uid === ADMIN_UID) {
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const bEdit = document.createElement("button");
    bEdit.className = "btn";
    bEdit.textContent = "수정";
    bEdit.onclick = () => openEdit(cat, id);

    const bDel = document.createElement("button");
    bDel.className = "btn";
    bDel.textContent = "삭제";
    bDel.onclick = () => doDelete(cat, id);

    actions.appendChild(bEdit);
    actions.appendChild(bDel);
    main.appendChild(actions);
  }

  return li;
}

// 스냅샷 → 리스트 렌더링
function renderList(cat, docs){
  const ul = lists[cat];
  ul.innerHTML = "";                      // 기존 내용 비우고
  const frag = document.createDocumentFragment();
  docs.forEach(d => frag.appendChild(taskItemElement(cat, d.id, d.data())));
  ul.appendChild(frag);
}


// ===== 6) 구독 시작/해제 =====
function startListen(){
  stopListen();
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
  startListen();
});

// 관리자만 추가폼/버튼 보이기
function setAdminVisible(isAdmin){
  $$(".add-row").forEach(r=> r.style.display = isAdmin ? "" : "none");
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

// ===== 10) 유틸 =====
function escapeHTML(s){
  return (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
}
