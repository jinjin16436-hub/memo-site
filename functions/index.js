// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import fetch from "node-fetch";

// 환경변수: NEIS_API_KEY
const NEIS_API_KEY = process.env.NEIS_API_KEY;

// 공통 응답 헬퍼
const json = (data, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
const badRequest = (msg) => json({ error: msg }, { status: 400 });
const serverError = (msg) => json({ error: msg }, { status: 500 });

// 학교 검색 (schoolInfo)
async function findSchoolByName(name) {
  const params = new URLSearchParams({
    KEY: NEIS_API_KEY,
    Type: "json",
    pIndex: "1",
    pSize: "5",
    SCHUL_NM: name,
  });
  const url = `https://open.neis.go.kr/hub/schoolInfo?${params}`;
  const res = await fetch(url);
  const js = await res.json();
  const rows = js?.schoolInfo?.[1]?.row || [];
  return rows.map((r) => ({
    name: r.SCHUL_NM,
    eduOfc: r.ATPT_OFCDC_SC_CODE,
    school: r.SD_SCHUL_CODE,
  }));
}

// 고등학교 시간표 (hisTimetable)
async function getHisTimetable({ eduOfc, school, ymd, grade, classNm }) {
  const params = new URLSearchParams({
    KEY: NEIS_API_KEY,
    Type: "json",
    pIndex: "1",
    pSize: "100",
    ATPT_OFCDC_SC_CODE: eduOfc,
    SD_SCHUL_CODE: school,
    TI_FROM_YMD: ymd,
    TI_TO_YMD: ymd,
    GRADE: String(grade),
    CLASS_NM: String(classNm),
  });
  const url = `https://open.neis.go.kr/hub/hisTimetable?${params}`;
  const res = await fetch(url);
  const js = await res.json();
  return js?.hisTimetable?.[1]?.row || [];
}

/** GET /api/school?name=부광고 */
export const school = onRequest(
  { cors: true, region: "asia-northeast3" },
  async (req) => {
    try {
      const { name } = req.query;
      if (!NEIS_API_KEY) return serverError("NEIS_API_KEY not set");
      if (!name || String(name).trim().length < 1) return badRequest("name is required");

      const rows = await findSchoolByName(String(name).trim());
      return json({ rows });
    } catch (err) {
      logger.error("school error", err);
      return serverError(err.message || "internal error");
    }
  }
);

/** 
 * GET /api/timetable?schoolName=부광고&ymd=20251024&grade=1&classNm=3
 * 또는    /api/timetable?eduOfc=J10&school=7530456&ymd=20251024&grade=1&classNm=3
 */
export const timetable = onRequest(
  { cors: true, region: "asia-northeast3" },
  async (req) => {
    try {
      if (!NEIS_API_KEY) return serverError("NEIS_API_KEY not set");

      const { schoolName, eduOfc, school, ymd, grade, classNm } = req.query;
      if (!ymd || !grade || !classNm) return badRequest("ymd, grade, classNm are required");

      let edu = eduOfc;
      let sch = school;

      if (schoolName && (!edu || !sch)) {
        const list = await findSchoolByName(String(schoolName));
        if (!list.length) return json({ rows: [] });
        edu = list[0].eduOfc;
        sch = list[0].school;
      }

      if (!edu || !sch) return badRequest("eduOfc and school are required (or provide schoolName)");

      const rows = await getHisTimetable({
        eduOfc: String(edu),
        school: String(sch),
        ymd: String(ymd),
        grade: String(grade),
        classNm: String(classNm),
      });

      const trimmed = rows.map((r) => ({
        ALL_TI_YMD: r.ALL_TI_YMD,
        PERIO: r.PERIO,
        ITRT_CNTNT: r.ITRT_CNTNT,
        CLRM_NM: r.CLRM_NM,
        TECHER: r.TEACHER_NM || r.TEACHER || "",
      }));

      return json({ rows: trimmed }, { headers: { "Cache-Control": "public, max-age=120" } });
    } catch (err) {
      logger.error("timetable error", err);
      return serverError(err.message || "internal error");
    }
  }
);

