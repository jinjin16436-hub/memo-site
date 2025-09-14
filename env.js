// env.js
// ⚠️ 이 키는 웹용 제한(HTTP referrer) + API 제한이 걸려 있어야 안전합니다.
export const firebaseConfig = {
  apiKey: "AIzaSyA10dRuTxDs0Ymz0AC1hf7dhn678n4SVs4",
  authDomain: "my-memo-site.firebaseapp.com",
  projectId: "my-memo-site",
  storageBucket: "my-memo-site.firebasestorage.app",
  messagingSenderId: "196036694705",
  appId: "1:196036694705:web:8988d12919420130464890"
};

// 관리자 UID (변경해서 사용)
export const ADMIN_UID  = "vv0bADtWdqQUnqFMy8k01dhO13t2";
// 공개 조회용 UID (admin과 동일 컬렉션 읽게 둘거면 동일값 사용)
export const PUBLIC_UID = "vv0bADtWdqQUnqFMy8k01dhO13t2";

