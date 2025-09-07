/************************************************************
 *  Firebase 기본 설정 (네 프로젝트 값으로 교체)
 ************************************************************/
const firebaseConfig = {
  apiKey: "AIzaSyBbThwhLWHJz8mBHGvhpWOL88cP9C7Nxio",
  authDomain: "my-memo-site.firebaseapp.com",
  projectId: "my-memo-site",
  storageBucket: "my-memo-site.firebasestorage.app",
  messagingSenderId: "196036694705",
  appId: "1:196036694705:web:8988d12919420130464890"
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();

/************************************************************
 *  관리자 / 공개 UID 설정
 ************************************************************/
// 🔐 관리자 UID (반드시 본인 관리자 계정 UID로 교체)
const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";
// 👀 공개 조회용 UID (일반/비로그인 사용자는 이 UID의 데이터를 읽음)
const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";

/************************************************************
 *  DOM 헬퍼
 ************************************************************/
const $  = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));

const els = {
  loginBtn:  $("#loginBtn"),
  logoutBtn: $("#logoutBtn"),
  adminBadge: $("#adminBadge"),

  // notice
  noticeSwitchWrap: $("#noticeSwitchWrap"),
  toggleNotice:  $("#toggleNotice"),
  noticeForm:    $("#noticeForm"),
  noticeTitle:   $("#noticeTitle"),
  noticeType:    $("#noticeType"),
  noticeDetail:  $("#noticeDetail"),
  addNoticeBtn:  $("#addNoticeBtn"),
  noticeList:    $("#noticeList"),
  noticeEmpty:   $("#noticeEmpty"),

  // lists
  lists: {
    exam: $("#list_exam"),
    perf: $("#list_perf"),
    home: $("#list_home")
  },
};

let currentUser = null;
let isAdmin = false;
let unsub = []; // snapshot unsubscribers

/************************************************************
 *  로그인 / 로그아웃
 ************************************************************/
els.loginBtn.onclick = async ()=>{
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await auth.signInWithPopup(provider);
  }catch(e){
    alert("로그인 실패: " + e.message);
    console.error(e);
  }
};
els.logoutBtn.onclick = ()=>auth.signOut();

/************************************************************
 *  상태 변경 핸들러
 ************************************************************/
auth.onAuthStateChanged(async user=>{
  currentUser = user;
  isAdmin = !!(user && user.uid === ADMIN_UID);

  // UI 전환
  els.loginBtn.style.display  = user ? "none" : "";
  els.logoutBtn.style.display = user ? "" : "none";
  els.adminBadge.style.display = isAdmin ? "" : "none";

  // 관리자만 추가/수정 UI 보이기
  $$(".admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");
  els.noticeForm.style.display     = isAdmin ? "" : "none";
  els.noticeSwitchWrap.style.display = isAdmin ? "" : "none";

  // 기존 리스너 정리 후 다시 구독
  unsub.forEach(u=>u && u());
  unsub = [];
  startAllListeners();

  // 교시 셀렉트 옵션 세팅(중복 생성 방지 위해 한 번만)
  fillPeriodSelects();
});

/************************************************************
 *  실시간 리스너 시작
 ************************************************************/
function startAllListeners(){
  // 공지 visible 플래그
  const settingsDoc = db.collection("settings").doc("notice");
  unsub.push(settingsDoc.onSnapshot(snap=>{
    const data = snap.exists ? snap.data() : { visible: true };
    if(isAdmin) els.toggleNotice.checked = !!data.visible;
    renderNoticeAreaVisible(!!data.visible);
  }));

  // 공지 목록
  unsub.push(db.collection("notices").orderBy("createdAt","desc").onSnapshot(snap=>{
    const arr = [];
    snap.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderNotices(arr);
  }));

  // 카테고리(시험/수행평가/숙제)
  ["exam","perf","home"].forEach(cat=>{
    // 읽기는 공개 UID의 문서를 취함(관리자도 같은 문서를 보게 함)
    const readUid = PUBLIC_UID;
    const col = db.collection("users").doc(readUid)
                  .collection("tasks").doc(cat).collection("items");
    unsub.push(col.orderBy("dueStart","asc").onSnapshot(snap=>{
      const rows = [];
      snap.forEach(d=>rows.push({ id:d.id, ...d.data() }));
      renderList(cat, rows);
    }));
  });
}

/************************************************************
 *  중요 전달 사항 - on/off
 ************************************************************/
els.toggleNotice?.addEventListener("change", async (e)=>{
  if(!isAdmin){ e.preventDefault(); return; }
  try{
    await db.collection("settings").doc("notice").set({ visible: e.target.checked }, { merge:true });
  }catch(err){
    alert("설정 저장 실패: " + err.message);
  }
});

function renderNoticeAreaVisible(visible){
  // 관리자라면 스위치를 통해 제어, 일반사용자는 단순히 표시만
  const listWrap = els.noticeList.closest(".block");
  if(!visible){
    els.noticeList.style.display = "none";
    els.noticeEmpty.style.display = "none";
  }else{
    els.noticeList.style.display = "";
  }
}

/************************************************************
 *  중요 전달 사항 - 추가/삭제/수정
 ************************************************************/
els.addNoticeBtn?.addEventListener("click", async ()=>{
  if(!isAdmin) return;
  const title  = els.noticeTitle.value.trim();
  const type   = els.noticeType.value;
  const detail = els.noticeDetail.value.trim();
  if(!title){ alert("제목을 입력해 주세요."); return; }

  try{
    await db.collection("notices").add({
      title, type, detail,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    els.noticeTitle.value = "";
    els.noticeDetail.value = "";
  }catch(err){
    alert("추가 실패: " + err.message);
  }
});

function renderNotices(items){
  els.noticeList.innerHTML = "";
  if(!items.length){
    els.noticeEmpty.style.display = "";
    return;
  }
  els.noticeEmpty.style.display = "none";

  for (const it of items) {
    const type = (it.type || "알림").trim();  // 기본: 알림(초록)
    let tcls = "notice-green";
    if (type === "공지") tcls = "notice-red";
    else if (type === "안내") tcls = "notice-yellow";

    const li = document.createElement("li");
    li.className = `notice-card ${tcls}`;   // ← 타입별 색 적용!
    li.innerHTML = `
      <h3><span class="type">[${esc(type)}]</span>${esc(it.title||"")}</h3>
      <p>${escMultiline(it.detail||"")}</p>
      ${isAdmin ? `
        <div class="admin-tools">
          <button class="btn-ghost" data-act="edit" data-id="${it.id}">수정</button>
          <button class="btn-ghost" data-act="del" data-id="${it.id}">삭제</button>
        </div>` : ``}
    `;
    // (이하 관리자 edit/del 핸들러 동일)
    if(isAdmin){
      li.addEventListener("click", async (e)=>{
        const act = e.target.getAttribute("data-act");
        const id  = e.target.getAttribute("data-id");
        if(!act || !id) return;
        if(act==="del"){
          if(confirm("삭제할까요?")) await db.collection("notices").doc(id).delete();
        }else if(act==="edit"){
          const newTitle  = prompt("제목", it.title||"");
          if(newTitle===null) return;
          const newType   = prompt("유형(공지/안내/알림)", type);
          if(newType===null) return;
          const newDetail = prompt("상세", it.detail||"") ?? "";
          await db.collection("notices").doc(id).set(
            { title:newTitle, type:newType, detail:newDetail }, { merge:true }
          );
        }
      });
    }
    els.noticeList.appendChild(li);
  }
}


/************************************************************
 *  카테고리 목록 렌더링
 ************************************************************/
function renderList(cat, items){
  const ul = els.lists[cat];
  ul.innerHTML = "";
  if(!items.length){
    const d = document.createElement("div");
    d.className = "empty"; d.textContent = "등록된 항목이 없습니다.";
    ul.appendChild(d);
    return;
  }

  for(const it of items){
    const li = document.createElement("li");
    li.className = "task";

    const dateText = formatRange(it.dueStart, it.dueEnd);
    const dInfo = makeDday(it.dueStart, it.dueEnd);

    li.innerHTML = `
      <div class="task-main">
        <p class="task-title">
          ${esc(it.subj||"")} 
          ${dInfo ? `<span class="dday ${dInfo.cls}">${dInfo.label}</span>` : ""}
        </p>
        <div class="task-text">${esc(it.text||"")}</div>
        <div class="task-date">📅 ${dateText}${renderPeriods(it)}</div>
        ${it.detail ? `<div class="task-detail">${escMultiline(it.detail)}</div>` : ``}
      </div>
      <div class="task-actions">
        ${isAdmin ? `<button class="btn-ghost" data-act="edit">수정</button>
                     <button class="btn-ghost" data-act="del">삭제</button>` : ``}
      </div>
    `;

    if(isAdmin){
      li.querySelector('[data-act="del"]').onclick = async ()=>{
        if(!confirm("삭제할까요?")) return;
        await adminCol(cat).doc(it.id).delete();
      };

      li.querySelector('[data-act="edit"]').onclick = async ()=>{
        // 간단한 prompt 기반 수정 (제목/내용/날짜/상세/교시)
        const subj = prompt("과목", it.subj||"");             if(subj===null) return;
        const text = prompt("내용", it.text||"");             if(text===null) return;
        const s    = prompt("시작일(YYYY-MM-DD)", it.dueStart||""); if(s===null) return;
        const e    = prompt("종료일(YYYY-MM-DD)", it.dueEnd||"");   if(e===null) return;
        const detail = prompt("상세", it.detail||"");          if(detail===null) return;
        const start  = prompt("시작교시(숫자 또는 빈칸)", it.start||"");
        const end    = prompt("끝교시(숫자 또는 빈칸)", it.end||"");

        await adminCol(cat).doc(it.id).set({
          subj, text, dueStart:s||"", dueEnd:e||"", detail,
          start: start? Number(start):null,
          end:   end? Number(end):null
        }, { merge:true });
      };
    }

    ul.appendChild(li);
  }
}

/************************************************************
 *  추가 폼 바인딩 (관리자만)
 ************************************************************/
function bindAddRows(){
  $$(".add-row").forEach(row=>{
    const cat = row.dataset.cat;
    const btn = $(".add", row);
    if(!btn) return;
    btn.onclick = async ()=>{
      if(!isAdmin) return;
      const subj = $(".subj", row).value.trim();
      const text = $(".text", row).value.trim();
      const d1   = $(".date1", row).value || "";
      const d2   = $(".date2", row).value || "";
      const startSel = $(".start", row), endSel=$(".end", row);
      const start = toPeriodNumber(startSel.value);
      const end   = toPeriodNumber(endSel.value);
      const detail = $(".detail", row).value.trim();

      if(!subj || !text || !d1){ alert("과목/내용/시작일은 필수입니다."); return; }
      await adminCol(cat).add({
        subj, text, dueStart:d1, dueEnd:d2||d1, start, end, detail,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 입력값 초기화
      $(".subj", row).value = ""; $(".text", row).value="";
      $(".date1", row).value = ""; $(".date2", row).value="";
      startSel.selectedIndex = 0; endSel.selectedIndex=0;
      $(".detail", row).value="";
    };
  });
}

/************************************************************
 *  헬퍼들
 ************************************************************/
function adminCol(cat){
  // 관리자만 쓰기 가능한 경로(관리자와 공개뷰가 같은 데이터 사용)
  const uid = PUBLIC_UID;
  return db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");
}

function esc(s){ return (s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
function escMultiline(s){ return esc(s).replaceAll("\n","<br>"); }

function formatRange(s,e){
  if(!s && !e) return "";
  const A = fmtDateK(s);
  const B = fmtDateK(e||s);
  return (A===B) ? A : `${A} ~ ${B}`;
}

const WEEK = ["일","월","화","수","목","금","토"];
function fmtDateK(dstr){
  if(!dstr) return "";
  const d = new Date(dstr+"T00:00:00");
  const y = d.getFullYear(), m = ("0"+(d.getMonth()+1)).slice(-2), da=("0"+d.getDate()).slice(-2);
  const w = WEEK[d.getDay()];
  return `${y}-${m}-${da} (${w})`;
}

function renderPeriods(it){
  let line = "";
  if(it.start && it.end){
    line = ` • ${it.start}~${it.end}교시`;
  }else if(it.start){
    line = ` • ${it.start}교시`;
  }
  return line;
}

function toPeriodNumber(v){
  // "교시 없음", "1교시" 등 → 숫자 or null
  if(!v || v==="교시 없음") return null;
  const m = v.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function makeDday(dStart, dEnd){
  if(!dStart) return null;
  const today = new Date(); toZero(today);
  const s = new Date(dStart+"T00:00:00");
  const e = new Date((dEnd||dStart)+"T00:00:00");
  toZero(s); toZero(e);

  const diffStart = Math.floor((s - today)/86400000); // 시작일까지 남은날
  const diffEnd   = Math.floor((today - e)/86400000); // 종료일 이후 흐른날(양수면 지난 것)

  // 기간 사이(시작~종료 포함) -> D-day (빨강)
  if(today >= s && today <= e){
    return { label:"D-day", cls:"dd-red" };
  }

  // 시작일 이전: D-N
  if(diffStart > 0){
    const n = diffStart;
    // 색: D(오늘)/D-1=빨강, D-2~3=주황, D-4~5=노랑, D-6+=연두
    let cls = "dd-green";
    if(n <= 1) cls = "dd-red";
    else if(n <= 3) cls = "dd-orange";
    else if(n <= 5) cls = "dd-yellow";
    return { label:`D-${n}`, cls };
  }

  // 종료 후: A+N(회색)
  const passed = Math.abs(diffEnd);
  if(passed >= 0) return { label:`A+${passed}`, cls:"dd-gray" };
  return null;
}
function toZero(d){ d.setHours(0,0,0,0); }

function fillPeriodSelects(){
  $$(".add-row select.start, .add-row select.end").forEach(sel=>{
    if(sel.getAttribute("data-filled")) return;
    sel.setAttribute("data-filled","1");
    sel.innerHTML = ["교시 없음",1,2,3,4,5,6,7].map(v=>{
      return `<option>${v==="교시 없음"?v: v+"교시"}</option>`;
    }).join("");
  });
}

// 최초 바인딩(로그인 이후에도 호출되지만 안전)
bindAddRows();
