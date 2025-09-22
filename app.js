/* =========================================================
   app.js  (v1.4.0 – full)
   - 반드시 env.js(전역: window.firebaseConfig, PUBLIC_UID, ADMIN_UIDS, ADMIN_EMAILS) 이후에 로드
   - Firebase CDN compat(전역 firebase.*) 사용 기준
   ========================================================= */

/* ---------------------------
   0) 안전 장치 (env.js 확인)
   --------------------------- */
if (!window.firebaseConfig) {
  alert("firebaseConfig가 로드되지 않았어요. env.js 순서를 확인해주세요.");
  throw new Error("Missing firebaseConfig");
}

/* ---------------------------
   1) Firebase 초기화
   --------------------------- */
// CDN compat 버전 예시
const app = firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

/* ---------------------------
   2) 전역 상태
   --------------------------- */
const STATE = {
  uid: null,
  isAdmin: false,
  profile: null,
};

const PUBLIC_UID = window.PUBLIC_UID || "public";
const USER_ROOT  = db.collection("users").doc(PUBLIC_UID);

/* ---------------------------
   3) Dom 쿼리 헬퍼
   --------------------------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

/* ---------------------------
   4) 관리자 판단
   --------------------------- */
function computeIsAdmin(user) {
  if (!user) return false;
  if (Array.isArray(window.ADMIN_UIDS) && window.ADMIN_UIDS.includes(user.uid)) return true;
  if (Array.isArray(window.ADMIN_EMAILS) && window.ADMIN_EMAILS.includes(user.email)) return true;
  return false;
}

/* ---------------------------
   5) 유틸
   --------------------------- */
function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
}
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d; // YYYY-MM-DD 문자열이면 그대로
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function ddayBadge(start, end) {
  if (!start && !end) return "";
  const today = new Date();
  const s = start ? new Date(start) : null;
  const e = end   ? new Date(end)   : null;

  if (s && e) {
    if (today >= s && today <= e) return `<span class="dday green">D-day</span>`;
  }
  let diff;
  if (s) diff = Math.ceil((s - today) / 86400000);
  else if (e) diff = Math.ceil((e - today) / 86400000);
  else return "";

  if (diff === 0) return `<span class="dday red">D-day</span>`;
  let klass = "gray";
  if (diff > 0 && diff <= 2) klass = "orange";
  else if (diff > 2 && diff <= 7) klass = "yellow";
  else if (diff > 7) klass = "green";
  return `<span class="dday ${klass}">D-${diff}</span>`;
}

/* ---------------------------
   6) 로그인/로그아웃 버튼
   --------------------------- */
const loginBtn  = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
const userInfo  = $("#userInfo");

loginBtn?.addEventListener("click", async () => {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    console.error(e);
    alert("로그인 실패");
  }
});
logoutBtn?.addEventListener("click", async () => { await auth.signOut(); });

auth.onAuthStateChanged(async (user) => {
  STATE.uid = user?.uid ?? null;
  STATE.isAdmin = computeIsAdmin(user);
  STATE.profile = user;

  if (userInfo) userInfo.textContent = user ? `${user.displayName || user.email}${STATE.isAdmin ? " (관리자)" : ""}` : "로그인 필요";
  if (loginBtn)  loginBtn.style.display  = user ? "none"         : "inline-block";
  if (logoutBtn) logoutBtn.style.display = user ? "inline-block" : "none";

  // 폼/목록 리렌더
  loadAll();
});

/* =========================================================
   A) 공지/전달 사항 & 설정 (선택 UI가 있는 경우에만 동작)
   --------------------------------------------------------- */

const NOTICE_KIND_LABEL = {
  notice: "공지(빨강)",
  info:   "안내(노랑)",
  alert:  "알림(초록)"
};

function mountNoticeAdd() {
  const wrap = $("#noticeAdd");
  if (!wrap) return;
  wrap.innerHTML = "";

  // 관리자만 추가 표시
  if (!STATE.isAdmin) { wrap.classList.add("hide"); return; }
  wrap.classList.remove("hide");

  const row = document.createElement("div");
  row.className = "add-row";
  row.dataset.cat = "notice-add";

  const title = input("text", "n-title", "제목");
  const kind  = selectKind();
  const detail = textarea("n-detail", "내용 (줄바꿈 가능)");
  const addBtn = document.createElement("button");
  addBtn.className = "btn btn--primary add";
  addBtn.textContent = "+ 추가";

  addBtn.addEventListener("click", async () => {
    const payload = {
      title: title.value.trim(),
      kind:  kind.value,
      content: detail.value.trim(),
      createdAt: Date.now()
    };
    if (!payload.title && !payload.content) {
      alert("제목 또는 내용 중 하나는 입력하세요.");
      return;
    }
    try {
      await USER_ROOT.collection("notices").add(payload);
      title.value = ""; detail.value = "";
      loadNotices();
    } catch (e) {
      console.error(e); alert("추가 실패");
    }
  });

  row.append(
    wrapEl(title),
    wrapEl(kind),
    wrapEl(detail),
    addBtn
  );
  wrap.appendChild(row);

  function input(type, cls, ph) { const el = document.createElement("input"); el.type = type; el.className = cls; if (ph) el.placeholder = ph; return el; }
  function textarea(cls, ph) { const el = document.createElement("textarea"); el.className = cls; if (ph) el.placeholder = ph; return el; }
  function selectKind() {
    const sel = document.createElement("select");
    sel.className = "select";
    sel.innerHTML = `
      <option value="notice">${NOTICE_KIND_LABEL.notice}</option>
      <option value="info">${NOTICE_KIND_LABEL.info}</option>
      <option value="alert">${NOTICE_KIND_LABEL.alert}</option>
    `;
    return sel;
  }
  function wrapEl(ch) { const d = document.createElement("div"); d.appendChild(ch); return d; }
}

async function loadNotices() {
  const list = $("#list_notice");
  if (!list) return;
  list.innerHTML = "";

  try {
    const snap = await USER_ROOT.collection("notices").orderBy("createdAt", "asc").get();
    if (snap.empty) {
      const empty = document.createElement("div");
      empty.className = "notice-card";
      empty.textContent = "등록된 전달 사항이 없습니다.";
      list.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    snap.forEach((doc) => {
      const d = doc.data();
      const card = renderNoticeCard(doc.id, d);
      frag.appendChild(card);
    });
    list.appendChild(frag);
  } catch (e) {
    console.error(e);
    const err = document.createElement("div");
    err.className = "notice-card";
    err.textContent = "전달 사항을 불러오지 못했어요.";
    list.appendChild(err);
  }
}

function renderNoticeCard(id, d) {
  const div = document.createElement("div");
  div.className = `notice-card ${kindClass(d.kind)}`;

  const t = document.createElement("div");
  t.className = "notice-title";
  t.textContent = d.title || "(제목 없음)";

  const body = document.createElement("pre");
  body.textContent = d.content || "";

  const meta = document.createElement("div");
  meta.className = "notice-meta";
  meta.textContent = fmtDate(d.createdAt || Date.now());

  const btns = document.createElement("div");
  btns.className = "row gap-8";
  if (STATE.isAdmin) {
    const edit = mkBtn("수정", () => openNoticeEdit(id, d));
    const del  = mkBtn("삭제", async () => {
      if (!confirm("삭제할까요?")) return;
      try {
        await USER_ROOT.collection("notices").doc(id).delete();
        loadNotices();
      } catch (e) { console.error(e); alert("삭제 실패"); }
    });
    btns.append(edit, del);
  }

  div.append(t, body, meta, btns);
  return div;

  function mkBtn(txt, fn) { const b=document.createElement("button"); b.className="btn"; b.textContent=txt; b.onclick=fn; return b; }
  function kindClass(k) {
    if (k === "notice") return "kind-notice";
    if (k === "info")   return "kind-info";
    if (k === "alert")  return "kind-alert";
    return "";
  }
}

function openNoticeEdit(id, d) {
  const modal = $("#modal-root");
  modal.innerHTML = "";
  modal.classList.add("show");

  const dlg = document.createElement("div");
  dlg.className = "modal__dialog";

  const head = document.createElement("div");
  head.className = "modal__head";
  head.innerHTML = `<strong>전달 사항 수정</strong>`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "modal__close";
  closeBtn.textContent = "닫기";
  closeBtn.onclick = () => modal.classList.remove("show");
  head.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "modal__body";

  const form = document.createElement("div");
  form.className = "form-grid";

  const f1 = field("제목", "title", "text", d.title || "");
  const f2 = fieldSelect("종류", "kind", d.kind || "notice");
  const f3 = fieldTextarea("내용", "content", d.content || "");
  f3.classList.add("full");

  form.append(f1, f2, f3);
  body.appendChild(form);

  const foot = document.createElement("div");
  foot.className = "modal__foot";

  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "취소";
  cancel.onclick = () => modal.classList.remove("show");

  const save = document.createElement("button");
  save.className = "btn btn--primary";
  save.textContent = "저장";
  save.onclick = async () => {
    const payload = {
      title:   $('input[name="title"]', form)?.value.trim() || "",
      kind:    $('select[name="kind"]', form)?.value || "notice",
      content: $('textarea[name="content"]', form)?.value.trim() || ""
    };
    try {
      await USER_ROOT.collection("notices").doc(id).update(payload);
      modal.classList.remove("show");
      loadNotices();
    } catch (e) { console.error(e); alert("저장 실패"); }
  };

  foot.append(cancel, save);
  dlg.append(head, body, foot);
  modal.appendChild(dlg);

  function field(label, name, type, value) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `${label}`;
    const inp = document.createElement("input");
    inp.type = type; inp.name = name; inp.value = value || "";
    wrap.appendChild(inp); return wrap;
  }
  function fieldTextarea(label, name, value) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `${label}`;
    const ta = document.createElement("textarea");
    ta.name = name; ta.value = value || "";
    wrap.appendChild(ta); return wrap;
  }
  function fieldSelect(label, name, value) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `${label}`;
    const sel = document.createElement("select");
    sel.name = name;
    sel.innerHTML = `
      <option value="notice">공지(빨강)</option>
      <option value="info">안내(노랑)</option>
      <option value="alert">알림(초록)</option>
    `;
    sel.value = value;
    wrap.appendChild(sel); return wrap;
  }
}

/* 설정(전달 사항 표시 토글) – 페이지에 토글 UI가 있을 때만 동작 */
async function bindSettingToggle() {
  const toggle = $("#toggleNotices");
  if (!toggle) return;

  // 읽기
  try {
    const doc = await USER_ROOT.collection("settings").doc("app").get();
    const val = doc.exists ? !!doc.data().showNotices : true;
    toggle.checked = val;
    controlNoticeVisibility(val);
  } catch (e) {
    console.error(e);
  }

  // 쓰기
  toggle.addEventListener("change", async () => {
    const v = !!toggle.checked;
    controlNoticeVisibility(v);
    if (!STATE.isAdmin) return;
    try {
      await USER_ROOT.collection("settings").doc("app").set(
        { showNotices: v },
        { merge: true }
      );
    } catch (e) { console.error(e); }
  });
}

function controlNoticeVisibility(show) {
  const sec = $("#noticeSection");
  if (!sec) return;
  sec.style.display = show ? "" : "none";
}

/* =========================================================
   B) 시험/수행/숙제 (공통 로직)
   --------------------------------------------------------- */
const CAT_INFO = {
  exams:      { title: "시험",     listId: "list_exam",     mountId: "add_exam" },
  activities: { title: "수행평가", listId: "list_activity", mountId: "add_activity" },
  homeworks:  { title: "숙제",     listId: "list_homework", mountId: "add_homework" }
};

function mountAddRow(cat) {
  const mountEl = document.getElementById(CAT_INFO[cat].mountId);
  if (!mountEl) return;
  mountEl.innerHTML = "";

  if (!STATE.isAdmin) { mountEl.classList.add("hide"); return; }
  mountEl.classList.remove("hide");

  const row = document.createElement("div");
  row.className = "add-row";
  row.dataset.cat = cat;

  const subj   = input("text", "subj", "과목");
  const text   = input("text", "text", "내용");
  const detail = textarea("detail", "상세 내용 (줄바꿈 가능)");
  const start  = input("date", "date-start", "시작일");
  const end    = input("date", "date-end", "종료일");
  const period = input("text", "period", "교시/시간");
  const addBtn = document.createElement("button");
  addBtn.className = "btn btn--primary add";
  addBtn.textContent = "+ 추가";

  // 시험은 과목칸 숨김
  const subjWrap = wrap(subj);
  if (cat === "exams") subjWrap.classList.add("hide");

  addBtn.addEventListener("click", async () => {
    const payload = {
      subject: subj.value.trim(),
      title:   text.value.trim(),
      detail:  detail.value.trim(),
      start:   start.value || null,
      end:     end.value || null,
      period:  period.value.trim() || null,
      createdAt: Date.now()
    };
    if (cat === "exams") payload.subject = "";

    if (!payload.title && !payload.detail) {
      alert("내용 또는 상세 내용을 입력하세요.");
      return;
    }
    try {
      await USER_ROOT.collection("tasks").doc(cat).collection("items").add(payload);
      text.value = ""; detail.value=""; start.value=""; end.value=""; period.value="";
      loadCategory(cat);
    } catch (e) {
      console.error(e); alert("추가 실패(권한/네트워크 확인)");
    }
  });

  row.append(
    subjWrap,
    wrap(text),
    wrap(detail),
    wrap(start),
    wrap(end),
    wrap(period),
    addBtn
  );
  mountEl.appendChild(row);

  function input(type, cls, ph){ const el=document.createElement("input"); el.type=type; el.className=cls; if(ph) el.placeholder=ph; return el; }
  function textarea(cls, ph){ const el=document.createElement("textarea"); el.className=cls; if(ph) el.placeholder=ph; return el; }
  function wrap(child){ const d=document.createElement("div"); d.appendChild(child); return d; }
}

async function loadCategory(cat) {
  const listEl = document.getElementById(CAT_INFO[cat].listId);
  if (!listEl) return;
  listEl.innerHTML = "";

  try {
    const snap = await USER_ROOT.collection("tasks").doc(cat).collection("items")
      .orderBy("createdAt", "asc").get();

    if (snap.empty) {
      const empty = document.createElement("div");
      empty.className = "task";
      empty.textContent = `등록된 ${CAT_INFO[cat].title}가 없습니다.`;
      listEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    snap.forEach((doc) => {
      const data = doc.data();
      const card = renderTaskCard(cat, doc.id, data);
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  } catch (e) {
    console.error(e);
    const err = document.createElement("div");
    err.className="task";
    err.textContent="읽기 실패(권한/네트워크 확인)";
    listEl.appendChild(err);
  }
}

function renderTaskCard(cat, id, d) {
  const li = document.createElement("li");
  li.className = "task";

  const top = document.createElement("div");
  top.className = "row-between";

  const title = document.createElement("div");
  title.className = "title";
  const subjTxt = (cat !== "exams" && d.subject) ? `(${d.subject}) ` : "";
  title.innerHTML = `${subjTxt}${escapeHtml(d.title || "")}${ddayBadge(d.start, d.end)}`;
  top.appendChild(title);

  const btns = document.createElement("div");
  btns.className = "row gap-8";
  if (STATE.isAdmin) {
    const edit = mkButton("수정", () => openEditModal(cat, id, d));
    const del  = mkButton("삭제", async () => {
      if (!confirm("삭제할까요?")) return;
      try {
        await USER_ROOT.collection("tasks").doc(cat).collection("items").doc(id).delete();
        loadCategory(cat);
      } catch (e) { console.error(e); alert("삭제 실패"); }
    });
    btns.append(edit, del);
  }
  top.appendChild(btns);

  const body = document.createElement("div");
  body.className = "content";
  const pre = document.createElement("pre");
  pre.textContent = d.detail || "";
  body.appendChild(pre);

  const meta = document.createElement("div");
  meta.className = "meta";
  const dateRange = (d.start || d.end) ? `${d.start || ""} ~ ${d.end || ""}` : "";
  const period = d.period ? ` | ${d.period}` : "";
  meta.textContent = [dateRange, period].filter(Boolean).join("");
  li.append(top, body, meta);

  return li;

  function mkButton(t, fn){ const b=document.createElement("button"); b.className="btn"; b.textContent=t; b.addEventListener("click",fn); return b; }
}

/* ---------------------------
   수정 모달 (시험은 과목칸 숨김)
   --------------------------- */
function openEditModal(cat, id, d) {
  const modal = $("#modal-root");
  modal.innerHTML = "";
  modal.classList.add("show");

  const dlg = document.createElement("div");
  dlg.className = "modal__dialog";

  const head = document.createElement("div");
  head.className = "modal__head";
  head.innerHTML = `<strong>항목 수정</strong>`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "modal__close";
  closeBtn.textContent = "닫기";
  closeBtn.onclick = () => modal.classList.remove("show");
  head.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "modal__body";

  const form = document.createElement("div");
  form.className = "form-grid";

  const f1 = field("과목", "subject", "text", d.subject || "");
  const f2 = field("내용", "title", "text", d.title || "");
  const f3 = fieldTextarea("상세 내용", "detail", d.detail || ""); f3.classList.add("full");
  const f4 = field("시작일", "start", "date", d.start ? d.start : "");
  const f5 = field("종료일", "end", "date", d.end ? d.end : "");
  const f6 = field("교시/시간", "period", "text", d.period || "");

  form.append(f1, f2, f3, f4, f5, f6);
  body.appendChild(form);

  // 시험은 과목 칸 숨김
  if (cat === "exams") f1.classList.add("hide");

  const foot = document.createElement("div");
  foot.className = "modal__foot";

  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "취소";
  cancel.onclick = () => modal.classList.remove("show");

  const save = document.createElement("button");
  save.className = "btn btn--primary";
  save.textContent = "저장";
  save.onclick = async () => {
    const payload = {
      subject: $('input[name="subject"]', form)?.value.trim() || "",
      title:   $('input[name="title"]', form)?.value.trim() || "",
      detail:  $('textarea[name="detail"]', form)?.value.trim() || "",
      start:   $('input[name="start"]', form)?.value || null,
      end:     $('input[name="end"]', form)?.value || null,
      period:  $('input[name="period"]', form)?.value.trim() || null,
    };
    if (cat === "exams") payload.subject = "";

    try {
      await USER_ROOT.collection("tasks").doc(cat).collection("items").doc(id).update(payload);
      modal.classList.remove("show");
      loadCategory(cat);
    } catch (e) { console.error(e); alert("저장 실패"); }
  };

  foot.append(cancel, save);
  dlg.append(head, body, foot);
  modal.appendChild(dlg);

  function field(label, name, type, value) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `${label}`;
    const inp = document.createElement("input");
    inp.type = type; inp.name = name; inp.value = value || "";
    wrap.appendChild(inp); return wrap;
  }
  function fieldTextarea(label, name, value) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `${label}`;
    const ta = document.createElement("textarea");
    ta.name = name; ta.value = value || "";
    wrap.appendChild(ta); return wrap;
  }
}

/* =========================================================
   C) 로딩 시퀀스
   --------------------------------------------------------- */
function loadAll() {
  // 공지
  mountNoticeAdd();
  loadNotices();
  bindSettingToggle();

  // 카테고리 폼 + 목록
  Object.keys(CAT_INFO).forEach((cat) => mountAddRow(cat));
  Object.keys(CAT_INFO).forEach((cat) => loadCategory(cat));
}

/* --------------------------------------------------------- */
