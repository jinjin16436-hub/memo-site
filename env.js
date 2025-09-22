// env.js (UTF-8, BOM 없이 저장, type="module" 사용 금지)

window.firebaseConfig = {
  apiKey: "AIzaSyA10dRuTxDs0Ymz0AC1hf7dhn678n4SVs4",
  authDomain: "my-memo-site.firebaseapp.com",
  projectId: "my-memo-site",
  storageBucket: "my-memo-site.firebasestorage.app",
  messagingSenderId: "196036694705",
  appId: "1:196036694705:web:8988d12919420130464890"
};

// 읽기 전용 데이터 주인 UID
window.PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";

// 관리자 식별 (여러 명 가능). 이메일을 쓰지 않으면 빈 배열 유지
window.ADMIN_UIDS   = ["vv0bADtWdqQUnqFMy8k01dhO13t2"];
window.ADMIN_EMAILS = []; // 예: ["jinjin16436@gmail.com"]
