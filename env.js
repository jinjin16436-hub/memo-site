// env.js
window.ENV = {
  // ✅ Firebase Web App 설정 (네가 준 값 그대로)
  FIREBASE: {
    apiKey: "AIzaSyA10dRuTxDs0Ymz0AC1hf7dhn678n4SVs4",
    authDomain: "my-memo-site.firebaseapp.com",
    projectId: "my-memo-site",
    storageBucket: "my-memo-site.firebasestorage.app",
    messagingSenderId: "196036694705",
    appId: "1:196036694705:web:8988d12919420130464890"
  },

  // ✅ 읽기 전용 데이터 주인 UID
  PUBLIC_UID: "vv0bADtWdqQUnqFMy8k01dhO13t2",

  // ✅ 관리자 계정 (UID 또는 이메일로 판정)
  ADMIN_UIDS: [
    "vv0bADtWdqQUnqFMy8k01dhO13t2"   // 여기에 실제 관리자 UID 추가
  ],
  ADMIN_EMAILS: [
    "jinjin16436@gmail.com"            // 필요하면 관리자 이메일 추가
  ]
};
