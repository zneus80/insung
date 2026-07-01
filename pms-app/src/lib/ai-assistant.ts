import { getAI, getGenerativeModel, VertexAIBackend, type GenerativeModel } from 'firebase/ai';
import app from './firebase';
import { getEvalCriteria } from './ai-eval';

/**
 * AI 인사·성과 분석 어시스턴트 (CEO·HR 마스터 전용).
 *
 * Firebase AI Logic(Vertex AI 백엔드) — 누적된 개인 업무 실적 데이터를 바탕으로
 * 직무 JD 작성·성과 요약/서열·조직 인사이트 등 자유 질의에 답한다.
 *
 * 데이터 거버넌스: Vertex 백엔드는 입력을 학습에 쓰지 않음. 호출 화면이 CEO·HR마스터(전 직원 열람 권한)만
 * 접근하므로 §6-1 가시성 범위 내. 결과는 '참고용' — 최종 판단은 사람이 한다.
 */
const FLASH = 'gemini-2.5-flash';   // 단순 질문 — 빠름
const PRO = 'gemini-2.5-pro';       // 분석·서열·JD 등 — 추론 품질↑(느림)

// (모델, 출력한도, 사고예산) 조합별 모델 캐시
const _models = new Map<string, GenerativeModel>();
function model(modelName: string, maxOutputTokens: number, thinkingBudget?: number): GenerativeModel {
  const key = `${modelName}:${maxOutputTokens}:${thinkingBudget ?? 'auto'}`;
  let m = _models.get(key);
  if (!m) {
    const ai = getAI(app, { backend: new VertexAIBackend() });
    m = getGenerativeModel(ai, {
      model: modelName,
      // thinkingBudget 지정 시 그 값으로(0=끄기), 미지정 시 모델 기본(자동). Pro 는 사고를 끌 수 없어 자동 사용.
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens,
        ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
      },
    });
    _models.set(key, m);
  }
  return m;
}

// 분석·서열·JD·비교 등 추론이 필요한 질문인지 — Pro 모델 + 큰 출력한도로 처리.
function isAnalytical(question: string): boolean {
  return /서열|순위|랭킹|전체|전\s*직원|모든|모두|비교|JD|직무\s*기술|분석|평가|원인|추천|우수|미흡|인재|최고|최우수|베스트|best|top|상위|하위|누가|누구|뽑|선정|후보/i.test(question);
}

export interface AssistantTurn { role: 'user' | 'assistant'; content: string; }

// 평가기준(criteria)은 HR마스터 편집값을 런타임에 주입 — 성과요약과 동일 기준 공유.
function buildSystem(criteria: string[]): string {
  return [
    '당신은 최고관리자·HR 마스터를 돕는 인사·성과 분석 보조자입니다.',
    '아래 "구성원 데이터(JSON)"는 사내 누적 업무 실적입니다(핵심목표·일반업무·주간업무보고·자기평가(점수·의견)·육성면담서·평가등급·혁신활동·포상·마일리지·근태(지각·결근)·소속 조직평가등급·승진요건).',
    '이 데이터와 일반적인 직무·KPI 이론 지식을 활용해 사용자의 질문에 한국어로 답하세요.',
    '- 육성면담서(mentoring)는 성과의 직접 근거가 아니라 향후 미래계획·직무 분석·경력개발 측면의 간접 참고로만 활용하고, 성과 점수·순위 산정의 직접 근거로 쓰지 마세요.',
    '원칙:',
    '- ⛔ 입력으로 받은 구성원 데이터(JSON)를 그대로 출력하거나 복사·나열하지 마세요. 절대 JSON 코드블록을 답으로 내보내지 마세요. 반드시 사람이 읽을 한국어 분석 결과(문장·표·목록)로만 답합니다.',
    '- 질문이 모호하거나 단순히 "보여줘" 류여도, 데이터를 그대로 덤프하지 말고 핵심을 요약·정리해 답하세요.',
    '- 데이터에는 전체 등록 인원이 포함됩니다. years 가 비어 있거나 noData:true 인 인원은 입력된 실적이 없는 사람이므로, 성과를 지어내지 말고 "데이터 없음"으로만 표기하고 서열·점수 평가 대상에서 제외하세요(명단에는 그대로 노출).',
    '- 각 인원의 org 필드는 "상위부문 > 본부 > 팀" 형식의 조직 경로입니다. 특정 조직(부문·본부·팀) 인원 분석을 요청받으면, 요청한 조직명이 org 경로에 포함된 인원만 정확히 골라내고, 경로에 없는 다른 부문·조직 인원은 절대 섞지 마세요. 예: "경영지원실 분석" → org 경로에 "경영지원실"이 들어간 인원만.',
    '- 성과 서열/평가/등급 추천을 요청받으면 아래 [평가 기준]을 그대로 적용하세요:',
    ...criteria,
    '- 승진요건 분석을 요청받으면 각 인원의 promotion 필드와 다음 기준을 적용하세요: ①팀원·팀장대행 → 팀장 승진: 완료된 스마트프로젝트 1건 이상(PM 또는 멤버, 추진중은 미인정) AND 마일리지 200점 이상(둘 다 충족해야 함). ②정식 팀장 → 임원 승진: 완료된 스마트프로젝트 PM 1건 이상(추진중은 미인정). promotion.충족=false 면 미충족자이며, 미충족사유(예: "스마트프로젝트 0/1", "마일리지 150/200")를 근거로 향후 관리 방법(부족 요건을 채우기 위한 구체적 액션)을 제시하세요.',
    '- 마일리지는 HR이 직접 입력하며, 직원은 TDS·스마트프로젝트 수행으로 적립합니다(수행 1건당 50점, TDS 지시자는 25점). 마일리지가 부족해 팀장 승진요건(200점)에 못 미치는 경우, TDS·스마트프로젝트 수행으로 채울 수 있음을 향후 관리 방법으로 제시하세요.',
    '- 근태(attendance: 지각·결근)·소속 조직평가등급은 참고 정보로 활용하되, 성과 순위·등급의 직접 변별 기준으로 과도하게 쓰지 마세요.',
    '- 직무 JD(직무기술서) 작성을 요청받으면 해당 직무/직책 인원들의 실제 핵심목표·주간 추진내용을 근거로 주요 업무·필요 역량·성과지표(KPI)를 구성하세요.',
    '- 이것은 사람(경영진/HR)의 의사결정을 돕는 참고 자료입니다. 단정적 인사조치를 지시하지 말고, 한계가 있으면 밝히세요.',
    '',
    '【출력 형식 — 반드시 준수】 답변은 깔끔한 Markdown 으로 구성합니다:',
    '- 문단은 2~4문장 단위로 나누고, **문단 사이에는 반드시 빈 줄**을 넣습니다.',
    '- 목록은 각 항목을 **반드시 별도의 줄**에서 하이픈(-)으로 시작합니다. 한 줄에 여러 항목을 "•"나 쉼표로 이어 붙이지 마세요.',
    '- 항목이 "제목: 설명" 형태면 `- **제목**: 설명` 처럼 제목을 굵게 합니다.',
    '- 여러 대상을 항목·수치로 비교·나열할 때는 **표(Markdown table)** 를 사용합니다. (예: 순위 | 이름 | 추천등급 | 핵심 근거)',
    '- 성격이 다른 내용은 `## 소제목` 으로 구획을 나눠 묶습니다. 서론·평가기준 설명은 2~3줄 이내로 짧게.',
    '- 관련된 항목은 한 목록/표로 묶고, 무관한 항목은 분리합니다.',
    '- 다수 인원 서열은 장황한 설명 대신 표로 전원을 빠짐없이(한 명당 1~2줄) 제시합니다.',
  ].join('\n');
}

const TRUNC_NOTICE = '\n\n…(응답이 길어 일부가 잘렸습니다. 범위를 좁혀(예: 특정 팀·상위 N명) 다시 질문해 주세요.)';

export async function askAssistant(opts: {
  question: string;
  history: AssistantTurn[];
  dossier: string;     // JSON 문자열 (구성원 데이터)
  yearLabel: string;   // 예: "2025년" 또는 "전체 누적"
  /** 회사 경영목표·조직 연간목표 컨텍스트(B⑤ 정렬 가·감점 근거) */
  annualContext?: string;
  /** 스트리밍 중 누적 텍스트를 받는 콜백(글자가 흐르듯 표시). 미지정 시 완성본만 반환. */
  onChunk?: (accumulated: string) => void;
  /** 중지 신호 — abort() 시 진행 중 응답을 멈추고 지금까지의 부분 텍스트를 반환. */
  signal?: AbortSignal;
}): Promise<string> {
  const convo = opts.history
    .map(t => `${t.role === 'user' ? '사용자' : 'AI'}: ${t.content}`)
    .join('\n');
  const SYSTEM = buildSystem(await getEvalCriteria());
  const prompt = [
    SYSTEM,
    '',
    `분석 대상 기간: ${opts.yearLabel}`,
    ...(opts.annualContext ? ['회사·조직 연간목표(개인 핵심목표와 정렬 여부 판단 근거):', opts.annualContext, ''] : []),
    '구성원 데이터(JSON):',
    opts.dossier,
    '',
    convo ? `이전 대화:\n${convo}\n` : '',
    `사용자 질문: ${opts.question}`,
    '',
    '위 데이터를 분석해 질문에 한국어로 답하세요. 입력 JSON을 그대로 출력하지 말고, 분석 결과(문장·표·목록)만 작성하세요.',
  ].join('\n');

  // 분석 질문 → Pro(자동 사고, 큰 출력한도) / 단순 질문 → Flash(사고 끔, 작은 한도·빠름)
  const analytical = isAnalytical(opts.question);
  const m = analytical
    ? model(PRO, 16384, 1024)  // Pro: 사고 예산 제한(자동이면 25s+ → 컷). 품질 유지하며 지연↓
    : model(FLASH, 8192, 0);   // Flash: 사고 끔(빠름)
  let acc = '';
  // ── 지연 계측: 요청→첫글자(모델 사고) / 첫글자→완료(출력 생성) ──
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  let tFirst = 0;
  const elapsed = () => Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);
  try {
    const { stream, response } = await m.generateContentStream(
      prompt,
      opts.signal ? { signal: opts.signal } : undefined,
    );
    for await (const chunk of stream) {
      let t = '';
      try { t = chunk.text(); } catch { /* 일부 청크는 텍스트 없음 */ }
      if (t) {
        if (!tFirst) { tFirst = elapsed(); console.log(`[AI 계측] 모델=${analytical ? 'pro' : 'flash'} · 요청→첫글자 ${tFirst}ms`); }
        acc += t; opts.onChunk?.(acc);
      }
    }
    console.log(`[AI 계측] 첫글자→완료 ${elapsed() - tFirst}ms · 총 ${elapsed()}ms · 출력 ${acc.length}자`);
    const final = await response;
    const finish = final.candidates?.[0]?.finishReason;
    if (finish === 'MAX_TOKENS') {
      const out = acc + TRUNC_NOTICE;
      opts.onChunk?.(out);
      return out;
    }
    return acc;
  } catch (e: unknown) {
    // 사용자가 중지한 경우: 에러로 던지지 않고 지금까지의 부분 응답을 반환
    const aborted = opts.signal?.aborted || (e as { name?: string })?.name === 'AbortError';
    if (aborted) return acc;
    throw e;
  }
}

/**
 * 임원 위클리 리포트 — 산하 조직의 지난주 주간업무보고를 요약·분석·금주 방향으로 정리.
 * 입력은 팀별 주간 실적/계획 텍스트(+연동 목표명). 결과는 사람이 읽을 마크다운 섹션.
 * 호출 화면은 임원(본인 산하만) — §6-1 가시성 범위 내(주간 업무 내용, 개인평가등급 아님).
 */
export interface WeeklyReportInput {
  divisionName: string;
  year: number;
  week: number;
  teams: Array<{
    teamName: string;
    members: Array<{ name: string; position?: string; hasDone: string[]; willDo: string[] }>;
  }>;
}
export async function summarizeWeeklyReport(input: WeeklyReportInput): Promise<string> {
  const m = model(PRO, 8192, 2048); // 분석 품질 — Pro, 사고 예산 제한으로 지연 완화
  const prompt = [
    '당신은 임원을 보좌하는 업무 분석가입니다. 아래 "주간업무보고 데이터(JSON)"는 임원 산하 조직의 지난주 실적/금주 계획입니다.',
    '이를 바탕으로 임원이 한눈에 파악할 수 있는 한국어 위클리 리포트를 작성하세요.',
    '반드시 아래 세 섹션을 마크다운 제목(##)으로 구성합니다:',
    '## 1. 요약 — 팀/부문별 지난주 주요 성과·진척을 핵심 위주로 압축(팀별 한두 줄).',
    '## 2. 분석 — 진행 양상, 눈에 띄는 성과, 지연·이슈·리스크, 팀 간 편차 등을 통찰 위주로.',
    '## 3. 금주 방향 — 다음 주 계획(willDo)과 위 분석을 토대로 임원이 챙겨야 할 우선순위·점검 포인트 제안.',
    '원칙:',
    '- 입력 JSON을 그대로 나열·복사하지 말고 통찰 있는 문장/목록으로 재구성하세요.',
    '- 데이터가 없는 팀은 "보고 없음"으로만 간단히 표기하고 추측으로 성과를 지어내지 마세요.',
    '- 이것은 사람의 판단을 돕는 참고 자료입니다. 단정적 지시보다 점검·제안 톤으로.',
    '【출력 형식 — 반드시 준수】',
    '- 문단은 2~4문장 단위로 나누고, 문단 사이에는 반드시 빈 줄을 넣습니다.',
    '- 목록은 각 항목을 반드시 별도의 줄에서 하이픈(-)으로 시작합니다. 한 줄에 여러 항목을 "•"나 쉼표로 이어 붙이지 마세요.',
    '- "팀명: 요약" 형태는 `- **팀명**: 요약` 처럼 앞을 굵게 합니다.',
    '- 팀별 성과·진척을 비교·나열할 때는 표(Markdown table)를 적절히 사용합니다.',
    '- 관련된 항목은 묶고, 장황한 서론은 생략합니다.',
    '',
    '주간업무보고 데이터(JSON):',
    JSON.stringify(input),
  ].join('\n');
  const { response } = await m.generateContentStream(prompt);
  const final = await response;
  let text = '';
  try { text = final.candidates?.[0]?.content?.parts?.map(p => (p as { text?: string }).text ?? '').join('') ?? ''; } catch { /* noop */ }
  if (!text) { try { text = final.text(); } catch { /* noop */ } }
  return text.trim();
}

/**
 * 목표명(+세부내용) 기반 KPI(성과지표) 추천 — 목표 작성 화면에서 호출.
 * KPI 이론(측정 가능·정량·기한)을 적용해 짧은 지표 문장 3~5개를 제안한다.
 * 전 직원이 쓰는 작성 화면이라 민감 데이터를 보내지 않음(목표 텍스트만). 결과는 예시·참고용.
 */
export async function recommendKpis(goalTitle: string, goalDescription?: string): Promise<string[]> {
  const title = (goalTitle || '').trim();
  if (!title) return [];
  const m = model(FLASH, 1024, 0); // 빠른 단순 생성
  const prompt = [
    '당신은 KPI(핵심성과지표) 설계 전문가입니다. 아래 업무 목표에 대해 달성도를 측정할 수 있는 KPI를 제안하세요.',
    '규칙:',
    '- KPI 이론(SMART: 구체적·측정가능·정량적·기한)을 적용합니다.',
    '- **반드시 정량·수치화**하세요. 측정 단위(건, 원, 일, 회, 점 등)와 목표 수치를 포함합니다. 정성적·모호한 표현("강화","개선","향상")만으로 끝내지 마세요.',
    '- 비율(%)은 100% 만점 척도로 자연스럽게 표기합니다. 달성률·만족도처럼 높을수록 좋은 지표는 100%를 지향(예: "달성률 90% 이상"), 불량률·이탈률처럼 낮을수록 좋은 지표는 0%를 지향(예: "불량률 2% 미만"). 증감률·배수 표현도 적절하면 사용 가능합니다.',
    '- 짧은 한 줄로 작성합니다. 3~5개를 제안하고 군더더기 설명 없이 지표 문장만.',
    '- 반드시 JSON 배열(문자열들)로만 응답합니다. 예: ["불량률 2% 이하 달성","월 신규 거래처 3건 확보","고객 응대 만족도 90% 이상"]',
    '',
    `[목표명] ${title}`,
    goalDescription?.trim() ? `[세부내용] ${goalDescription.trim().slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');
  try {
    const { response } = await m.generateContentStream(prompt);
    const final = await response;
    let text = '';
    try { text = final.candidates?.[0]?.content?.parts?.map(p => (p as { text?: string }).text ?? '').join('') ?? ''; } catch { /* noop */ }
    if (!text) { try { text = final.text(); } catch { /* noop */ } }
    // ```json 코드펜스 제거 후 배열 파싱
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('['); const end = cleaned.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr.map(x => String(x).trim()).filter(Boolean).slice(0, 6);
  } catch (e) {
    console.error('[KPI 추천] 실패:', e);
    throw e;
  }
}
