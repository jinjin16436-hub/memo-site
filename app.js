/* ===========================
   app.js v22 (응급복구 + 경로복원)
   - Firestore 경로: users/{uid}/notices, users/{uid}/tasks/{cat}/items
   - env.js: window.firebaseConfig, window.PUBLIC_UID (또는 ENV.PUBLIC_UID) 사용
   =========================== */

(function () {
  // ------- 안전가드 & 헬퍼 -------
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, c, h) => {
    const n = document.createElement(t);
    if (c) n.className = c;
    if (h !== undefined && h !== null) n.innerHTML = h;
    return n;
  };
  const showAlert = (msg) => {
    console.error(msg);
    // 화면 상단에 에러 띄우기 (임시)
    let bar = document.getElementById("app-error-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "app-error-bar";
      bar.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fff;padding:8px 12px;font-size:14px";
      document.body.appendChild(bar);
    }
    bar.textContent = msg;
  };

  // ------- Firebase 로드 확인 -------
  if (!window.firebase) {
    showAlert("Firebase SDK 로드 실패: script 태그를 확인하세요.");
    return;
  }
  if (!window.firebaseConfig && !(window.ENV && window.ENV.FIREBASE)) {
    showAlert("env.js의 firebaseConfig(또는 ENV.FIREBASE)가 없습니다.");
    return;
  }

  // ------- Config / 초기화 -------
  const CONFIG = window.firebaseConfig || (window.ENV && window.ENV.FIREBASE);
  try {
    firebase.initializeApp(CONFIG);
  } catch (e) {
    // 이미 초기화된 경우 무시
    if (!/already exists/i.test(e.message)) {
      showAlert("Firebase 초기화 오류: " + e.message);
      return;
    }
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  // 데이터 소유자 UID (공개용 UID가 있으면 우선 사용)
  const getOwnerUid = () =>
    (window.PUBLIC_UID ||
      (window.ENV && (window.ENV.PUBLIC_UID || window.ENV.OWNER_UID)) ||
      (auth.currentUser && auth.currentUser.uid)) || null;

  // Firestore 경로(복원)
  const colNotices = (uid) =>
    db.collection("users").doc(uid).collection("notices");
  const colTasks = (cat, uid) =>
    db.collection("users").doc(uid).collection("tasks").doc(cat).collection("items");

  // ------- 포맷/유틸 -------
  function startOfDay(d) {
    const t = new Date(d);
    t.setHours(0, 0, 0, 0);
    return t;
  }
  function fmtDateK(x) {
    if (!x) return "";
    const d = x.toDate ? x.toDate() : new Date(x);
    if (isNaN(d)) return "";
    const yo = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const wk = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return `${yo}-${mo}-${da} (${wk})`;
  }
  function toTs(dateStr) {
    if (!dateStr) return null;
    const dt = new Date(dateStr + "T00:00:00");
    return firebase.firestore.Timestamp.fromDate(dt);
  }
  function evalDDay(startLike, endLike) {
    if (!startLike && !endLike) return null;
    const today = startOfDay(new Date());
    const asDate = (x) => {
      if (!x) return null;
      const d = x.toDate ? x.toDate() : new Date(x);
      if (isNaN(d)) return null;
      return startOfDay(d);
    };
    const s = asDate(startLike);
    const e = asDate(endLike) || s;

    if (!s) return null;
    if (today < s) {
      const diff = Math.round((s - today) / 86400000);
      return { label: `D-${diff}`, cls: diff <= 2 ? "orange" : diff <= 7 ? "yellow" : "green", key: diff };
    }
    if (today > e) {
      const p = Math.round((today - e) / 86400000);
      return { label: `D+${p}`, cls: "gray", key: 9999 + p };
    }
    return { label: "D-day", cls: "red", key: 0 };
  }

  // ------- 관리자 판단 (원래 규칙 넣어도 됨) -------
  const isAdminUser = (u) => {
    if (!u) return false;
    // 필요하면 ENV.ADMIN_UIDS/ADMIN_EMAILS 사용
    if (window.ENV && Array.isArray(window.ENV.ADMIN_UIDS) && window.ENV.ADMIN_UIDS.includes(u.uid)) return true;
    if (window.ENV && Array.isArray(window.ENV.ADMIN_EMAILS) && window.ENV.ADMIN_EMAILS.includes(u.email)) return true;
    return true; // 임시: 로그인한 사용자는 관리자 취급 (원래 규칙으로 바꿔도 됨)
  };

  // ------- DOM -------
  const loginBtn = $("#loginBtn");
  const logoutBtn = $("#logoutBtn");
  const noticeToggle = $("#noticeToggle");
  const noticeList = $("#notice_list");
  const noticeAddRow = $("#noticeAddRow");
  const nTitle = $("#nTitle");
  const nKind = $("#nKind");
  const nBody = $("#nBody");
  const nAddBtn = $("#nAddBtn");
  const lists = {
    exam: $("#list_exam"),
    perf: $("#list_perf"),
    home: $("#list_home"),
  };

  // 로그인/로그아웃(항상 동작하도록 먼저 연결)
  if (loginBtn)
    loginBtn.onclick = async () => {
      try {
        await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      } catch (e) {
        showAlert("로그인 실패: " + e.message);
      }
    };
  if (logoutBtn) logoutBtn.onclick = () => auth.signOut();

  // ------- 렌더링 -------
  function renderNotices(items) {
    if (!noticeList) return;
    noticeList.innerHTML = "";
    const admin = isAdminUser(auth.currentUser);

    items.forEach((it) => {
      const li = el("li", "notice-card " + (it.kind ? `kind-${it.kind}` : ""));
      const title = el("div", "notice-title", it.title || "(제목 없음)");
      const body = it.body ? el("pre", null, it.body) : null;
      const postedTs = it.createdAt || it.updatedAt || null;
      const meta = el("div", "notice-meta", postedTs ? `게시일: ${fmtDateK(postedTs)}` : "");

      li.append(title);
      if (body) li.append(body);
      li.append(meta);

      if (admin) {
        const bar = el("div", "card-actions");
        const eBtn = el("button", "btn", "수정");
        const dBtn = el("button", "btn", "삭제");
        eBtn.onclick = () => openNoticeEdit(it);
        dBtn.onclick = async () => {
          if (!confirm("삭제할까요?")) return;
          try {
            await colNotices(getOwnerUid()).doc(it.id).delete();
          } catch (e) {
            showAlert("공지 삭제 실패: " + e.message);
          }
        };
        bar.append(eBtn, dBtn);
        li.append(bar);
      }
      noticeList.append(li);
    });
  }

  function renderTasks(cat, items) {
    const ul = lists[cat];
    if (!ul) return;
    ul.innerHTML = "";

    const admin = isAdminUser(auth.currentUser);
    // D-day 정렬
    items.sort((a, b) => {
      const A = evalDDay(a.startAt || a.startDate, a.endAt || a.endDate) || { key: 1e9 };
      const B = evalDDay(b.startAt || b.startDate, b.endAt || b.endDate) || { key: 1e9 };
      if (A.key !== B.key) return A.key - B.key;
      const aStart = (a.startAt?.toDate?.() || (a.startDate ? new Date(a.startDate) : 0))?.getTime?.() || 0;
      const bStart = (b.startAt?.toDate?.() || (b.startDate ? new Date(b.startDate) : 0))?.getTime?.() || 0;
      return aStart - bStart;
    });

    items.forEach((it) => {
      const li = el("li", "task");
      const subj = el("div", "title", it.subj || "(과목 없음)");

      const dd = evalDDay(it.startAt || it.startDate, it.endAt || it.endDate);
      if (dd) subj.append(" ", el("span", `dday ${dd.cls}`, dd.label));

      const text = it.text ? el("div", "content", it.text) : null;
      const detail = it.detail ? el("pre", "detail", it.detail) : null;

      const s = it.startAt || it.startDate ? fmtDateK(it.startAt || it.startDate) : "";
      const e = it.endAt || it.endDate ? fmtDateK(it.endAt || it.endDate) : "";
      const period = it.period ? `${it.period}교시` : "";
      let dateLine = "";
      if (s && e && s !== e) dateLine = `${s} ~ ${e}`;
      else if (s) dateLine = s;
      if (period) dateLine = dateLine ? `${dateLine} ${period}` : period;
      const meta = dateLine ? el("div", "meta", "📅 " + dateLine) : null;

      li.append(subj);
      if (text) li.append(text);
      if (detail) li.append(detail);
      if (meta) li.append(meta);

      if (admin) {
        const bar = el("div", "card-actions");
        const eBtn = el("button", "btn", "수정");
        const dBtn = el("button", "btn", "삭제");
        eBtn.onclick = () => openTaskEdit(cat, it);
        dBtn.onclick = async () => {
          if (!confirm("삭제할까요?")) return;
          try {
            await colTasks(cat, getOwnerUid()).doc(it.id).delete();
          } catch (e) {
            showAlert(`${cat} 삭제 실패: ` + e.message);
          }
        };
        bar.append(eBtn, dBtn);
        li.append(bar);
      }

      ul.append(li);
    });
  }

  // ------- 실시간 리스너 -------
  let unsubscribers = [];
  function stopAll() {
    unsubscribers.forEach((u) => u && u());
    unsubscribers = [];
  }
  function startAll() {
    stopAll();
    const uid = getOwnerUid();
    if (!uid) return;

    // 공지
    unsubscribers.push(
      colNotices(uid).orderBy("createdAt", "desc").onSnapshot(
        (snap) => {
          const arr = [];
          snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
          renderNotices(arr);
        },
        (err) => showAlert("공지 로딩 실패: " + err.message)
      )
    );

    // tasks
    ["exam", "perf", "home"].forEach((cat) => {
      unsubscribers.push(
        colTasks(cat, uid).orderBy("createdAt", "asc").onSnapshot(
          (snap) => {
            const arr = [];
            snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
            renderTasks(cat, arr);
          },
          (err) => showAlert(`${cat} 로딩 실패: ` + err.message)
        )
      );
    });
  }

  // ------- 추가(관리자) -------
  function wireAddRows() {
    document.querySelectorAll(".add-row[data-cat]").forEach((row) => {
      const cat = row.getAttribute("data-cat");
      const subjEl = $(".subj", row);
      const textEl = $(".text", row);
      const detEl = $(".detail", row);
      const sEl = $(".date-start", row);
      const eEl = $(".date-end", row);
      const pEl = $(".period", row);
      const addBtn = $(".add", row);

      if (addBtn) {
        addBtn.onclick = async () => {
          if (!isAdminUser(auth.currentUser)) return alert("관리자만 추가");
          const uid = getOwnerUid();
          if (!uid) return showAlert("소유자 UID가 없습니다.");

          const payload = {
            subj: (subjEl.value || "").trim(),
            text: (textEl.value || "").trim(),
            detail: (detEl.value || "").trim(),
            period: (pEl.value || "").trim(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          };
          if (sEl.value) {
            payload.startDate = sEl.value;
            payload.startAt = toTs(sEl.value);
          }
          if (eEl.value) {
            payload.endDate = eEl.value;
            payload.endAt = toTs(eEl.value);
          }

          try {
            await colTasks(cat, uid).add(payload);
            [subjEl, textEl, detEl, sEl, eEl, pEl].forEach((x) => (x.value = ""));
          } catch (e) {
            showAlert(`${cat} 추가 실패: ` + e.message);
          }
        };
      }
    });

    if (nAddBtn) {
      nAddBtn.onclick = async () => {
        if (!isAdminUser(auth.currentUser)) return alert("관리자만 추가");
        const uid = getOwnerUid();
        if (!uid) return showAlert("소유자 UID가 없습니다.");
        const title = (nTitle.value || "").trim();
        if (!title) return alert("제목을 입력하세요.");
        try {
          await colNotices(uid).add({
            title,
            body: (nBody.value || "").trim(),
            kind: nKind.value || "notice",
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          nTitle.value = "";
          nBody.value = "";
        } catch (e) {
          showAlert("공지 추가 실패: " + e.message);
        }
      };
    }
  }

  // ------- 공지 수정 모달 -------
  const nModal = $("#noticeEditModal");
  const nEditTitle = $("#nEditTitle");
  const nEditBody = $("#nEditBody");
  const nEditKind = $("#nEditKind");
  $("#nEditCancel")?.addEventListener("click", () => nModal.classList.remove("show"));
  $("#nEditClose")?.addEventListener("click", () => nModal.classList.remove("show"));
  let editingNotice = null;

  function openNoticeEdit(it) {
    editingNotice = { id: it.id };
    nEditTitle.value = it.title || "";
    nEditBody.value = it.body || "";
    nEditKind.value = it.kind || "notice";
    nModal.classList.add("show");
  }
  $("#nEditSave")?.addEventListener("click", async () => {
    if (!editingNotice) return;
    const uid = getOwnerUid();
    if (!uid) return showAlert("소유자 UID가 없습니다.");
    try {
      await colNotices(uid)
        .doc(editingNotice.id)
        .set(
          {
            title: nEditTitle.value.trim(),
            body: nEditBody.value.trim(),
            kind: nEditKind.value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      nModal.classList.remove("show");
      editingNotice = null;
    } catch (e) {
      showAlert("공지 수정 실패: " + e.message);
    }
  });

  // ------- 과제 수정 모달 -------
  const tModal = $("#editModal");
  const mSubj = $("#mSubj");
  const mText = $("#mText");
  const mDetail = $("#mDetail");
  const mDateStart = $("#mDateStart");
  const mDateEnd = $("#mDateEnd");
  const mPeriod = $("#mPeriod");
  $("#editCancel")?.addEventListener("click", () => tModal.classList.remove("show"));
  $("#editClose")?.addEventListener("click", () => tModal.classList.remove("show"));
  let editingTask = null;

  function openTaskEdit(cat, it) {
    editingTask = { cat, id: it.id };
    mSubj.value = it.subj || "";
    mText.value = it.text || "";
    mDetail.value = it.detail || "";
    mDateStart.value =
      it.startDate ||
      (it.startAt?.toDate ? it.startAt.toDate().toISOString().slice(0, 10) : "");
    mDateEnd.value =
      it.endDate || (it.endAt?.toDate ? it.endAt.toDate().toISOString().slice(0, 10) : "");
    mPeriod.value = it.period || "";
    tModal.classList.add("show");
  }
  $("#editSave")?.addEventListener("click", async () => {
    if (!editingTask) return;
    const uid = getOwnerUid();
    if (!uid) return showAlert("소유자 UID가 없습니다.");
    try {
      const payload = {
        subj: mSubj.value.trim(),
        text: mText.value.trim(),
        detail: mDetail.value.trim(),
        period: mPeriod.value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (mDateStart.value) {
        payload.startDate = mDateStart.value;
        payload.startAt = toTs(mDateStart.value);
      } else {
        payload.startDate = firebase.firestore.FieldValue.delete();
        payload.startAt = firebase.firestore.FieldValue.delete();
      }
      if (mDateEnd.value) {
        payload.endDate = mDateEnd.value;
        payload.endAt = toTs(mDateEnd.value);
      } else {
        payload.endDate = firebase.firestore.FieldValue.delete();
        payload.endAt = firebase.firestore.FieldValue.delete();
      }

      await colTasks(editingTask.cat, uid).doc(editingTask.id).set(payload, { merge: true });
      tModal.classList.remove("show");
      editingTask = null;
    } catch (e) {
      showAlert("수정 실패: " + e.message);
    }
  });

  // ------- 공지 ON/OFF (설정문서 미사용 시 단순 토글) -------
  noticeToggle?.addEventListener("change", () => {
    const sec = document.getElementById("sec_notice");
    if (sec) sec.style.display = noticeToggle.checked ? "" : "none";
  });

  // ------- 인증 상태 반영 & 리스너 시작 -------
  auth.onAuthStateChanged((user) => {
    const admin = isAdminUser(user);
    $("#userInfoBox") && ($("#userInfoBox").textContent = user ? `${user.displayName || "사용자"} (${admin ? "관리자" : "일반"})` : "로그인 필요");
    if (loginBtn) loginBtn.style.display = user ? "none" : "";
    if (logoutBtn) logoutBtn.style.display = user ? "" : "none";

    // 관리자만 추가폼 표시
    document.querySelectorAll(".add-row[data-cat]").forEach((row) => {
      row.style.display = admin ? "flex" : "none";
    });
    if (noticeAddRow) noticeAddRow.style.display = admin ? "grid" : "none";

    startAll();        // 소유자 UID 변경 가능성 대비
  });

  // DOM 준비 후 추가 버튼 와이어링
  document.addEventListener("DOMContentLoaded", () => {
    wireAddRows();
  });
})();
