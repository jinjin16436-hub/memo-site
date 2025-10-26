// Cloudflare Worker - NEIS Proxy (Free)
// 대시보드에서 "Workers & Pages > Create Worker > Quick edit"에 붙여넣고 배포
// Settings > Variables > Secrets 에 NEIS_API_KEY 등록

const NEIS_BASE = 'https://open.neis.go.kr/hub';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    }
  });
}

async function fetchNEIS(pathWithQuery) {
  const url = `${NEIS_BASE}${pathWithQuery}`;
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, data: { raw: text } }; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return cors();

    // /api/school?name=부광고
    if (url.pathname === '/api/school') {
      const name = url.searchParams.get('name') || '';
      if (!name) return json({ error: 'name required' }, 400);

      const qs = new URLSearchParams({
        KEY: env.NEIS_API_KEY,
        Type: 'json',
        SCHUL_NM: name
      });
      const res = await fetchNEIS(`/schoolInfo?${qs.toString()}`);
      if (!res.ok) return json({ error: 'NEIS error', detail: res.data }, res.status);

      const rows = res.data?.schoolInfo?.[1]?.row || [];
      return json({ rows });
    }

    // /api/timetable?schoolName=부광고&ymd=20250115&grade=1&classNm=3
    if (url.pathname === '/api/timetable') {
      const schoolName = url.searchParams.get('schoolName') || '';
      const ymd = url.searchParams.get('ymd') || '';
      const grade = url.searchParams.get('grade') || '';
      const classNm = url.searchParams.get('classNm') || '';
      if (!schoolName || !ymd || !grade || !classNm) {
        return json({ error: 'schoolName, ymd, grade, classNm required' }, 400);
      }

      // 1) 학교 코드 조회
      const q1 = new URLSearchParams({ KEY: env.NEIS_API_KEY, Type: 'json', SCHUL_NM: schoolName });
      const sres = await fetchNEIS(`/schoolInfo?${q1.toString()}`);
      const srow = sres.data?.schoolInfo?.[1]?.row?.[0];
      if (!srow) return json({ error: '학교를 찾을 수 없습니다.' }, 404);

      const office = srow.ATPT_OFCDC_SC_CODE;
      const code   = srow.SD_SCHUL_CODE;

      // 2) 고등학교 시간표
      const q2 = new URLSearchParams({
        KEY: env.NEIS_API_KEY, Type: 'json',
        ATPT_OFCDC_SC_CODE: office,
        SD_SCHUL_CODE: code,
        GRADE: grade,
        CLASS_NM: classNm,
        TI_FROM_YMD: ymd,
        TI_TO_YMD: ymd
      });
      const tres = await fetchNEIS(`/hisTimetable?${q2.toString()}`);
      const rows = tres.data?.hisTimetable?.[1]?.row || [];
      return json({ rows, school: { office, code, name: srow.SCHUL_NM } });
    }

    return json({ ok: true, message: 'NEIS proxy alive' });
  }
};
