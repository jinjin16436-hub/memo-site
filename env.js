// ===== 환경 변수(배포 전 본인 값으로 교체) =====
window.ENV = {
  // Firebase Web App Config
  FIREBASE_CONFIG: {
    apiKey:      "AIzaSyA10dRuTxDs0Ymz0AC1hf7dhn678n4SVs4",
    authDomain:  "my-memo-site.firebaseapp.com",
    projectId:   "my-memo-site",
    storageBucket: "my-memo-site.firebasestorage.app",
    messagingSenderId: "196036694705",
    appId:       "1:196036694705:web:8988d12919420130464890",
  },

  // 읽기 공개 UID (학생들이 읽는 데이터의 주인 UID)
  PUBLIC_UID: "vv0bADtWdqQUnqFMy8k01dhO13t2",

  // 관리자 UID (쓰기 권한)
  ADMIN_UID:  "vv0bADtWdqQUnqFMy8k01dhO13t2"
};
