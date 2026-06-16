import { getAI, getGenerativeModel, VertexAIBackend, type GenerativeModel } from 'firebase/ai';
import app from './firebase';

/**
 * Firebase AI Logic (Vertex AI 백엔드) — 인사평가 성과 요약·참고 순위.
 *
 * ⚠️ 사용 전 Firebase 콘솔에서 "AI Logic → Vertex AI Gemini API" 활성화 + 빌링 연결 필요.
 *    활성화 전에는 generateContent 호출이 실패하며, 호출 측에서 안내 토스트로 처리한다.
 *
 * 데이터 거버넌스: Vertex AI 백엔드는 입력 데이터를 모델 학습에 사용하지 않는다.
 * 가시성: 호출 측(임원 확정 화면)이 이미 본인 책임 조직 멤버만 로드하므로 §6-1 스코프 내.
 * 결과는 '참고용' — 등급/순위 최종 결정은 사람(임원)이 한다.
 */

// 모델명 — 단일 상수로 관리(교체 시 이 줄만 변경).
//  · gemini-2.5-flash: GA(정식). 은퇴 예정 2026-10-16 → 그 전에 교체 필요.
//  · 차세대 후보 gemini-3-flash 는 현재 '공개 미리보기'라 운영 적용 보류(GA 후 교체).
//  · 종료된 gemini-2.0 계열(2026-06-01 종료)은 사용하지 않음.
const MODEL = 'gemini-2.5-flash';

let _model: GenerativeModel | null = null;
function model(): GenerativeModel {
  if (!_model) {
    const ai = getAI(app, { backend: new VertexAIBackend() }); // 리전 미지정 = 기본(us-central1). 데이터 레지던시 필요 시 인자로 지정.
    _model = getGenerativeModel(ai, {
      model: MODEL,
      // thinkingBudget 512 — 순위는 비교·정합성 판단이 필요해 사고를 일부 유지(속도↔품질 절충).
      // 1024 는 ~17초로 느렸고, 0 은 순위가 거칠어질 수 있어 512 로 균형. maxOutputTokens 는 다인원 JSON 잘림 방지.
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 32768,
        thinkingConfig: { thinkingBudget: 512 },
      },
    });
  }
  return _model;
}

export interface AiMemberInput {
  userId: string;
  name: string;
  position?: string;
  currentGrade?: string;       // 현재 입력된 등급(있으면)
  // 핵심목표 — 임팩트 추정을 위해 가중치(개인 기여도%)·설명·주간 진행사항 포함. statusLabel: 완료/추진중/포기.
  goals: { title: string; statusLabel: string; progress: number; weight?: number; description?: string; weeklyNotes?: string[] }[];
  coreGoalCount: number;       // 유효 핵심목표 수(포기 제외 — 완료+추진중)
  completedCount: number;      // 완료 핵심목표 수
  inProgressCount: number;     // 추진중 핵심목표 수
  abandonedCount: number;      // 포기(확정) 핵심목표 수 — 미달성
  selfEvalTotal?: number;      // 자기평가 가중 환산 총점(0~100). 미제출/미입력이면 생략.
  innovationCount?: number;    // 당해년도 혁신활동 참여 수(스마트프로젝트·TDS PM/멤버/수행 등) — 보조 가점
  innovationNames?: string[];  // 참여 혁신활동명(최대 일부)
  weeklyHighlights: string[];  // 그 해 Has Done 주요 실적
  selfEvalComments: string[];  // 자기평가 의견(점수 포함)
  generalWorkComments?: string[]; // 자기평가 중 '일반업무'만 별도(요약에 반드시 반영)
  // 팀장·본부장 전용 — 책임 조직(+산하)의 핵심목표 완료율(%). 관리자 가·감점 근거.
  teamAchievement?: { rate: number; completed: number; total: number };
  // 육성면담서 — 직무정보·경력개발·직무요청(특이 케이스)·종합의견을 균형있게 요약하기 위한 원자료
  mentoring?: {
    currentPosition?: string;   // 직위/직책
    mainDuties?: string;        // 주요담당업무
    careerPlan?: string;        // 희망 Position·경력개발 방향
    jobRequest?: string;        // 직무요청 유형(직무 확대/축소/변경/근무지 이동/만족)
    jobChangeReason?: string;   // 직무 변경 희망 이유
    desiredJobs?: string;       // 희망 직무 1·2순위
    desiredLocations?: string;  // 희망 근무지 1·2순위
    locationChangeReason?: string; // 근무지 변경 이유
    selfOpinion?: string;       // 작성자 종합의견
    interviewerOpinion?: string; // 면담자 종합의견
  };
}

export interface AiMemberSummary {
  userId: string;
  summary: string;             // 한 문단 성과 요약
  strengths: string[];
  issues: string[];
  suggestedGrade?: string;     // 참고용 추천 등급
  mentoringSummary?: string;   // 육성면담서 요약(종합의견 기반)
}
export interface AiRankItem {
  userId: string;
  rank: number;                // 1 = 최상위
  reason: string;
}
export interface AiEvalResult {
  summaries: AiMemberSummary[];
  ranking: AiRankItem[];
  disclaimer: string;
}

/**
 * 평가·서열 공통 기준 — AI 성과요약(이 파일)과 AI 인사 챗봇(ai-assistant)이 공유한다.
 * 한쪽만 바꾸면 기준이 갈리므로 반드시 이 상수에서 단일 관리한다.
 */
export const SHARED_EVAL_CRITERIA: string[] = [
  '【B. 평가 가중치 — 가장 중요】',
  '- ① 조직 기여 임팩트(최우선): 핵심목표의 조직 기여도·전략적 영향력을 가장 높게 봅니다. 쉬운 목표를 여러 개 한 것보다 조직에 큰 영향을 주는 목표 하나를 해낸 것이 더 높은 가치이며, 단순 완료 갯수로 줄세우지 않습니다. (난도·복잡도는 임팩트의 일부로 포함)',
  '  · 고가치 성과의 예: 신규 시스템 도입, 회사의 경제적 이익 창출(매출 증대·원가/비용 절감), 신시장·신제품 개발, 생산성 개선, 신사업 개척, 회사 시스템·프로세스 개편, 대규모 거래처 확보 등 전사·조직 단위 영향.',
  '  · 임팩트 추정 — 관점: 균형성과표(BSC: 재무·고객·내부프로세스·학습성장)·전략 정렬·KPI 중요도/가중·비즈니스 임팩트(매출·비용·리스크·시장 영향 범위·지속성). 근거: 목표의 객관적 범위(영향 조직·기간·완료 여부·실제 진행률)에 한정하고 없는 성과를 지어내지 않습니다.',
  '- ② 완료(임팩트와 동급 핵심): 특히 고임팩트 목표의 완료를 가장 높게 봅니다. 완료 실적이 없으면(완료 0) 상위 등급(A·B)을 줄 수 없습니다. 추진중은 진행률로 일부만 반영, 포기는 미달성으로 간주(목표 수 가산 제외, 포기가 많으면 부정적으로 반영하고 명시).',
  '- ③ 유효 목표 갯수(보조): 포기 제외, 임팩트가 대등할 때에 한해 많을수록 가점.',
  '- ④ 팀장·본부장(관리자) 가·감점: teamAchievement(책임 팀의 목표 완료율 %)가 주어진 사람은 팀 성과 책임자이므로, 본인 주간 실적이 적더라도 팀 성과를 점수에 반영합니다(100점 만점 기준). 완료율 100% → +5점, 90~99% → 0, 80~89% → -2점, 80% 미만 → -5점. 이 가·감점을 종합 점수·등급 판단에 더하세요.',
  '',
  '【C. 데이터 해석 원칙】',
  '- 주간업무보고: ①효율성(투입 대비 산출) ②실효성(실제 성과·문제 해결로 이어졌는지) ③중대성(영향 범위·중요도) 관점으로 보고, 단순 나열·형식적 기록보다 구체적·실질적 성과를 높게 봅니다.',
  '- 서술 표현·포장: 길이·문장력·표현력은 평가 요소가 아닙니다. 미사여구를 걷어내고 "실제로 무엇을 했는가"만 추출하세요. 길게 썼다고 가점, 짧다고 감점하지 말고, 분량이 많다는 이유로 성과가 많다고 추정하지 않습니다(동일 사실이면 동일 평가).',
  '- 자기평가 점수: 함께 반영하되 본인 주장이므로 완료·실적 등 객관 근거와 상충하면 객관 근거를 우선합니다.',
  '- 혁신활동: 당해년도 참여는 보조 가점으로 작게 반영(핵심목표·완료 실적보다 낮은 비중).',
  '- 사실 기반: 모든 판단은 제공된 데이터에 근거하고, 근거가 부족하면 그렇게 표기합니다.',
  '',
  '【D. 등급 정의 및 분포】 (5단계 명칭·의미를 그대로 사용)',
  '- A(탁월함, 약 5%): 조직에 큰 영향을 준 고임팩트 목표를 해내는 등 성과가 명확히 두드러지는 최상위.',
  '- B(우수함, 약 15%): 목표 달성도·임팩트가 평균을 분명히 상회.',
  '- C(보통, 약 70%): 일반적인 수준의 성과(대부분의 인원이 여기에 해당).',
  '- D(미흡, 약 10%): 목표 미달·포기가 많거나 임팩트 낮은 일반업무 중심으로 기대에 못 미침.',
  '- E(미달, 예외적): 입력된 실적이 거의 없는 수준.',
  '- 분포는 참고용이며 강제 쿼터가 아닙니다. 다수에게 상위 등급을 몰아주지 말되 최종 등급은 실제 성과(임팩트·완료)에 근거하고, 인원이 적으면 분포를 기계적으로 맞추지 말고 성과를 우선합니다.',
  '',
  '【E. 순위 산정 원칙】',
  '- 서열은 오직 성과 데이터로만 매기고 직책·직급·입사일·나이 등 비성과 요소로 정렬하지 않습니다.',
  '- 추천 등급이 같아도 성과로 우열을 가립니다.',
];

/**
 * AI 성과평가 기준 로드 — HR마스터가 시스템설정에서 편집한 값이 있으면 그것, 없으면 코드 기본값.
 * 성과요약(이 파일)·AI 챗봇(ai-assistant)이 공유한다.
 */
export async function getEvalCriteria(): Promise<string[]> {
  try {
    const { getSystemSettings } = await import('./firestore');
    const s = await getSystemSettings();
    if (s?.aiEvalCriteria && s.aiEvalCriteria.length > 0) return s.aiEvalCriteria;
  } catch { /* 로드 실패 시 기본값 사용 */ }
  return SHARED_EVAL_CRITERIA;
}

function buildPrompt(members: AiMemberInput[], criteria: string[] = SHARED_EVAL_CRITERIA): string {
  // AI 가 긴 userId 를 그대로 못 받아쓰는 문제 방지 — idx(번호)로만 식별. userId 는 프롬프트에서 제외.
  const data = members.map((m, idx) => ({
    idx,
    name: m.name,
    position: m.position,
    currentGrade: m.currentGrade,
    coreGoalCount: m.coreGoalCount,
    completedCount: m.completedCount,
    inProgressCount: m.inProgressCount,
    abandonedCount: m.abandonedCount,
    selfEvalTotal: m.selfEvalTotal,
    innovationCount: m.innovationCount,
    innovationNames: m.innovationNames,
    goals: m.goals,
    weeklyHighlights: m.weeklyHighlights,
    selfEvalComments: m.selfEvalComments,
    generalWorkComments: m.generalWorkComments,
    teamAchievement: m.teamAchievement,
    mentoring: m.mentoring,
  }));
  return [
    '당신은 인사평가를 돕는 보조자입니다. 분석 근거는 오직 ①핵심목표관리의 각 목표 ②주간업무보고 ③자기평가 입니다.',
    '각 개인의 성과를 객관적으로 요약하고, 성과 기준 참고 순위를 제안하세요.',
    '규칙:',
    '- 각 개인에 대해 아무것도 모르는 상태에서 시작하세요. 제공되는 데이터만을 기반으로 평가하고, 과도한 추론은 하지 마세요.',
    ...criteria,
    '- ranking 은 본인이 부여한 suggestedGrade 와 일관되게 매기세요: 더 높은 등급(A>B>C…)을 받은 사람이 더 낮은 등급자보다 아래 순위로 가면 안 됩니다. 충돌하면 등급 또는 순위를 재조정해 일관성을 맞추세요.',
    '- summary(성과 요약)에는 ①핵심목표(완료/추진중/포기 현황 포함) ②일반업무(주간 별표, generalWorkComments) 성과를 반드시 함께 언급하세요. 핵심목표만 다루지 말고, 완료·포기 건수도 짚으세요.',
    '- 추측·과장 금지. 근거가 부족하면 그렇게 표기하세요.',
    '- mentoringSummary 에는 육성면담서(mentoring)를 균형있게 2~3문장으로 요약하세요: (1)직무정보(직위·주요담당업무) (2)경력개발 방향(careerPlan) (3)종합의견(selfOpinion). 한쪽에 치우치지 마세요.',
    '  ★ 특이 케이스는 반드시 먼저 명시: 직무요청이 직무 확대/축소/변경 이거나 근무지 이동을 희망하면 그 사유(jobChangeReason·locationChangeReason)와 희망(desiredJobs·desiredLocations)을 구체적으로 짚고, 그 외 특이 이슈가 있으면 강조하세요. 단순 "만족"이면 특이사항 없음으로 간단히.',
    '- 이것은 사람(임원)의 최종 결정을 돕는 참고 자료입니다. 단정적 판정 금지.',
    '- 각 항목은 반드시 입력 구성원의 idx 번호를 그대로 사용하세요(이름·식별자 임의 생성 금지).',
    '- ranking 은 1위(최상위)부터 오름차순(rank=1,2,3…)으로 모든 구성원에게 빠짐없이·중복없이 부여하세요.',
    '- 순위는 오직 성과 데이터(핵심목표 임팩트·갯수·진행률·주간실적·자기평가)로만 매기세요. 직책·직급·입사일·나이 등 비성과 요소로 정렬하지 마세요. 추천 등급(suggestedGrade)이 같은 사람들 사이에서도 반드시 성과 데이터로 우열을 가리세요.',
    '- 반드시 아래 JSON 스키마로만 응답하세요(설명 텍스트 없이).',
    '',
    'JSON 스키마:',
    '{"summaries":[{"idx":0,"summary":"2~3문장","strengths":["..."],"issues":["..."],"suggestedGrade":"A|B|C|D|E","mentoringSummary":"육성면담서 요약 1~2문장"}],',
    ' "ranking":[{"idx":0,"rank":1,"reason":"근거 한 문장(목표의 조직 임팩트 우선, 비슷하면 완료 실적으로 세분)"}],',
    ' "disclaimer":"본 결과는 AI 참고 자료이며 최종 평가는 평가권자가 결정합니다."}',
    '',
    '구성원 데이터(각 항목의 idx 로 식별):',
    JSON.stringify(data, null, 0),
  ].join('\n');
}

export async function summarizeAndRankMembers(members: AiMemberInput[]): Promise<AiEvalResult> {
  if (members.length === 0) return { summaries: [], ranking: [], disclaimer: '' };
  const criteria = await getEvalCriteria();
  const prompt = buildPrompt(members, criteria);
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const res = await model().generateContent(prompt);
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);
  const um = res.response.usageMetadata as undefined | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  // 계측: 입력 크기·소요·토큰(특히 thoughtsTokenCount 로 thinkingBudget 실제 적용 여부 확인)
  console.log(`[AI요약 계측] ${members.length}명 · 입력 ${prompt.length.toLocaleString()}자 · 소요 ${ms}ms · 토큰{입력:${um?.promptTokenCount ?? '?'}, 사고:${um?.thoughtsTokenCount ?? '?'}, 출력:${um?.candidatesTokenCount ?? '?'}} · finish:${res.response.candidates?.[0]?.finishReason ?? '?'}`);
  const text = res.response.text();
  // JSON 파싱 (혹시 코드펜스로 감싸오면 제거)
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(clean) as {
    summaries?: (Omit<AiMemberSummary, 'userId'> & { idx: number })[];
    ranking?: (Omit<AiRankItem, 'userId'> & { idx: number })[];
    disclaimer?: string;
  };
  // idx → 실제 userId 로 복원 (AI 가 idx 를 잘못 주면 해당 항목은 버림)
  const summaries: AiMemberSummary[] = (parsed.summaries ?? [])
    .filter(s => members[s.idx])
    .map(s => ({
      userId: members[s.idx].userId,
      summary: s.summary ?? '',
      strengths: s.strengths ?? [],
      issues: s.issues ?? [],
      suggestedGrade: s.suggestedGrade,
      mentoringSummary: s.mentoringSummary,
    }));
  const ranking: AiRankItem[] = (parsed.ranking ?? [])
    .filter(r => members[r.idx])
    .map(r => ({ userId: members[r.idx].userId, rank: r.rank, reason: r.reason ?? '' }))
    .sort((a, b) => a.rank - b.rank);
  return {
    summaries,
    ranking,
    disclaimer: parsed.disclaimer ?? '본 결과는 AI 참고 자료이며 최종 평가는 평가권자가 결정합니다.',
  };
}
