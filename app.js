// Firebase 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

function colTask(cat){ return db.collection('tasks').doc(cat).collection('items'); }
function colNotice(){ return db.collection('notices'); }

// ===== 유틸 =====
function fmtDateK(ts){
  if(!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
}
function evalDDay(start,end){
  if(!start) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const s = start.toDate ? start.toDate() : new Date(start);
  const e = end?.toDate ? end.toDate() : (end? new Date(end): s);
  s.setHours(0,0,0,0); e.setHours(0,0,0,0);

  if(today < s){ // 아직 시작 전
    const diff = Math.round((s - today)/(1000*60*60*24));
    return `D-${diff}`;
  }
  if(today > e){ // 종료 후
    return '';
  }
  return 'D-day';
}

// ===== 인증 =====
function isAdminUser(user){
  if(!user) return false;
  return user.email && user.email.endsWith('@gmail.com'); // 필요시 조건 변경
}

auth.onAuthStateChanged(async (user)=>{
  const admin = isAdminUser(user);
  const userInfoEl = document.getElementById('userInfoBox');
  if (userInfoEl) {
    userInfoEl.textContent = user
      ? `${user.displayName ?? '사용자'} (${admin ? '관리자' : '일반'})`
      : '로그인 필요';
  }
  document.getElementById('loginBtn').style.display  = user ? 'none':'';
  document.getElementById('logoutBtn').style.display = user ? '':'none';

  document.querySelectorAll('.add-row').forEach(r=>{
    r.style.display = admin ? 'flex':'none';
  });
  const nrow = document.getElementById('noticeAddRow');
  if(nrow) nrow.style.display = admin ? 'grid':'none';

  startListeners();
});

// ===== 로그인/아웃 버튼 =====
document.getElementById('loginBtn').onclick=()=>{
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider);
};
document.getElementById('logoutBtn').onclick=()=>auth.signOut();

// ===== 공지 렌더 =====
function renderNoticeList(arr){
  const ul = document.getElementById('notice_list');
  ul.innerHTML='';
  arr.forEach(it=>{
    const li = document.createElement('li');
    li.className = `notice-card kind-${it.kind??'notice'}`;

    const title = document.createElement('div');
    title.className='notice-title';
    title.textContent=it.title;

    const body = document.createElement('pre');
    body.textContent=it.body;

    // 게시일 간격 고침 (숙제 스타일)
    const postedTs = it.createdAt || it.updatedAt || null;
    const posted   = postedTs ? `게시일: ${fmtDateK(postedTs)}` : '';
    const meta     = document.createElement('div');
    meta.className='notice-meta';
    meta.textContent=posted;

    // 관리자 버튼
    if(isAdminUser(auth.currentUser)){
      const row=document.createElement('div');
      row.style.marginTop='10px';
      const btnE=document.createElement('button');
      btnE.className='btn'; btnE.textContent='수정';
      btnE.onclick=()=>openNoticeEdit(it);
      const btnD=document.createElement('button');
      btnD.className='btn'; btnD.textContent='삭제';
      btnD.onclick=()=>colNotice().doc(it.id).delete();
      row.append(btnE,btnD);
      li.append(title,body,meta,row);
    } else {
      li.append(title,body,meta);
    }
    ul.append(li);
  });
}

// ===== 시험/수행/숙제 렌더 =====
function renderTaskList(cat, arr){
  const ul=document.getElementById('list_'+cat);
  ul.innerHTML='';
  arr.forEach(it=>{
    const li=document.createElement('li');
    li.className='task';

    const title=document.createElement('div');
    title.className='title';
    title.textContent=it.subj || '(제목없음)';

    const cont=document.createElement('div');
    cont.className='content';
    cont.textContent=it.text || '';

    const desc=document.createElement('pre');
    desc.className='detail';
    desc.textContent=it.detail||'';

    const s=it.start?fmtDateK(it.start):'';
    const e=it.end?fmtDateK(it.end):'';
    const period=it.period? `${it.period}교시`:'';

    let line='';
    if(s && e && s!==e) line=`${s} ~ ${e}`;
    else if(s) line=s;
    if(period) line=line? `${line} ${period}`:period;

    const meta=document.createElement('div');
    meta.className='meta';
    const dday=evalDDay(it.start,it.end);
    meta.textContent=line + (dday? ` (${dday})`:'');

    if(isAdminUser(auth.currentUser)){
      const row=document.createElement('div');
      row.style.marginTop='10px';
      const btnE=document.createElement('button');
      btnE.className='btn'; btnE.textContent='수정';
      btnE.onclick=()=>openEdit(cat,it);
      const btnD=document.createElement('button');
      btnD.className='btn'; btnD.textContent='삭제';
      btnD.onclick=()=>colTask(cat).doc(it.id).delete();
      row.append(btnE,btnD);
      li.append(title,cont,desc,meta,row);
    } else {
      li.append(title,cont,desc,meta);
    }
    ul.append(li);
  });
}

// ===== 리스너 =====
function listenNotice(){
  colNotice().orderBy('createdAt','desc').onSnapshot(snap=>{
    const arr=[]; snap.forEach(d=>arr.push({id:d.id,...d.data()}));
    renderNoticeList(arr);
  });
}
function listenTask(cat){
  colTask(cat).orderBy('createdAt','asc').onSnapshot(snap=>{
    const arr=[]; snap.forEach(d=>arr.push({id:d.id,...d.data()}));
    renderTaskList(cat,arr);
  });
}
function startListeners(){
  listenNotice(); listenTask('exam'); listenTask('perf'); listenTask('home');
}

// ===== 추가 기능 =====
function bindAddRows(){
  document.querySelectorAll('.add-row').forEach(row=>{
    const cat=row.dataset.cat;
    if(!cat) return;
    row.querySelector('.add').onclick=()=>{
      const subj=row.querySelector('.subj').value.trim();
      const text=row.querySelector('.text').value.trim();
      const detail=row.querySelector('.detail').value.trim();
      const ds=row.querySelector('.date-start').value;
      const de=row.querySelector('.date-end').value;
      const period=row.querySelector('.period').value.trim();
      colTask(cat).add({
        subj,text,detail,period,
        start: ds? new Date(ds): null,
        end: de? new Date(de): null,
        createdAt: new Date()
      });
      row.querySelectorAll('input,textarea').forEach(el=>el.value='');
    };
  });
  document.getElementById('nAddBtn').onclick=()=>{
    const title=document.getElementById('nTitle').value.trim();
    const body=document.getElementById('nBody').value.trim();
    const kind=document.getElementById('nKind').value;
    colNotice().add({title,body,kind,createdAt:new Date()});
    document.getElementById('nTitle').value='';
    document.getElementById('nBody').value='';
  };
}
bindAddRows();

// ===== 모달 (수정) =====
function openEdit(cat,it){
  const m=document.getElementById('editModal');
  m.classList.add('show');
  document.getElementById('mSubj').value=it.subj||'';
  document.getElementById('mText').value=it.text||'';
  document.getElementById('mDetail').value=it.detail||'';
  document.getElementById('mDateStart').value=it.start? it.start.toDate().toISOString().slice(0,10):'';
  document.getElementById('mDateEnd').value=it.end? it.end.toDate().toISOString().slice(0,10):'';
  document.getElementById('mPeriod').value=it.period||'';

  document.getElementById('editSave').onclick=()=>{
    colTask(cat).doc(it.id).update({
      subj:document.getElementById('mSubj').value,
      text:document.getElementById('mText').value,
      detail:document.getElementById('mDetail').value,
      start:document.getElementById('mDateStart').value? new Date(document.getElementById('mDateStart').value):null,
      end:document.getElementById('mDateEnd').value? new Date(document.getElementById('mDateEnd').value):null,
      period:document.getElementById('mPeriod').value
    });
    m.classList.remove('show');
  };
  document.getElementById('editCancel').onclick=()=>m.classList.remove('show');
  document.getElementById('editClose').onclick=()=>m.classList.remove('show');
}
function openNoticeEdit(it){
  const m=document.getElementById('noticeEditModal');
  m.classList.add('show');
  document.getElementById('nEditTitle').value=it.title||'';
  document.getElementById('nEditBody').value=it.body||'';
  document.getElementById('nEditKind').value=it.kind||'notice';
  document.getElementById('nEditSave').onclick=()=>{
    colNotice().doc(it.id).update({
      title:document.getElementById('nEditTitle').value,
      body:document.getElementById('nEditBody').value,
      kind:document.getElementById('nEditKind').value
    });
    m.classList.remove('show');
  };
  document.getElementById('nEditCancel').onclick=()=>m.classList.remove('show');
  document.getElementById('nEditClose').onclick=()=>m.classList.remove('show');
}
