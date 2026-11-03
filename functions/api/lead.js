// Cloudflare Pages Function: POST /api/lead
// 진단 페이지 신청 데이터를 노션 "법정의무교육 진단 리드" DB에 저장합니다.
// Cloudflare 환경변수(Settings > Variables and Secrets)에 두 값을 넣으세요:
//   NOTION_TOKEN  = 노션 내부 통합(Integration) 시크릿 (ntn_ 또는 secret_ 로 시작)
//   NOTION_DB_ID  = bbf528363afa494fbef1e9c161686a83

const ALLOWED = {
  size: ["5인 미만", "5~9인", "10~49인", "50~299인", "300인 이상"],
  industry: ["제조업", "건설업", "도소매·음식·숙박", "IT·전문서비스", "교육·기타 서비스", "기타"],
  jobmix: ["전원 사무직", "현장직 포함"],
  pension: ["없음", "DB", "DC", "모름"],
  evidence: ["전부", "일부", "없음"],
  risk: ["높음", "보통", "낮음"],
  trainings: ["산업안전보건", "성희롱 예방", "장애인 인식개선", "개인정보보호", "퇴직연금"],
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const text = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const pick = (v, list) => (list.includes(v) ? { select: { name: v } } : undefined);
const bool = (v) => v === true || v === "true";
const rich = (v) => ({ rich_text: v ? [{ text: { content: v } }] : [] });

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  // 봇 차단(허니팟): 숨은 칸이 채워져 있으면 저장하지 않고 성공처럼 응답
  if (text(d.website)) return json({ ok: true });

  const company = text(d.company, 100);
  const name = text(d.name, 50);
  const email = text(d.email, 120);
  const phone = text(d.phone, 30);

  if (!company || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (!bool(d.consent_privacy)) {
    return json({ ok: false, error: "no_consent" }, 400);
  }

  const trainings = text(d.required_trainings, 300)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ALLOWED.trainings.includes(s))
    .map((s) => ({ name: s }));

  const properties = {
    "회사명": { title: [{ text: { content: company } }] },
    "담당자": rich(name),
    "이메일": { email },
    "전화": { phone_number: phone || null },
    "인원수": pick(d.size, ALLOWED.size),
    "업종": pick(d.industry, ALLOWED.industry),
    "직무 구성": pick(d.jobmix, ALLOWED.jobmix),
    "퇴직연금": pick(d.pension, ALLOWED.pension),
    "증빙 보관": pick(d.evidence, ALLOWED.evidence),
    "리스크 등급": pick(d.risk, ALLOWED.risk),
    "실교육 필요": { multi_select: trainings },
    "개인정보 취급": { checkbox: bool(d.privacy_handler) },
    "개인정보 동의": { checkbox: true },
    "마케팅 수신 동의": { checkbox: bool(d.consent_marketing) },
    "유입 경로": rich(text(d.source, 100)),
    "상태": { status: { name: "신규" } },
  };
  for (const k of Object.keys(properties)) if (properties[k] === undefined) delete properties[k];

  // 복사·붙여넣기 때 섞여 들어간 공백·줄바꿈·따옴표 제거
  const rawToken = String(env.NOTION_TOKEN ?? "");
  const token = rawToken.trim().replace(/^["']|["']$/g, "");
  const dbId = String(env.NOTION_DB_ID ?? "").trim();

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: dbId }, properties }),
  });

  if (!res.ok) {
    // 토큰 전체는 남기지 않고, 형식 점검용 정보만 기록
    console.log("token check", {
      present: rawToken.length > 0,
      rawLength: rawToken.length,
      usedLength: token.length,
      prefix: token.slice(0, 4),
      hadWhitespace: rawToken !== rawToken.trim(),
    });
    console.log("notion error", res.status, await res.text());
    return json({ ok: false, error: "notion_failed" }, 502);
  }
  return json({ ok: true });
}

// POST 외 요청은 거절
export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
