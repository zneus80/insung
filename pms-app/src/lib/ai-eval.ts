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
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    });
  }
  return _model;
}

export interface AiMemberInput {
  userId: string;
  name: string;
  position?: string;
  currentGrade?: string;       // 현재 입력된 등급(있으면)
  // 핵심목표 — 난도 추정을 위해 가중치(개인 기여도%)·설명·주간 진행사항 포함
  goals: { title: string; status: string; progress: number; weight?: number; description?: string; weeklyNotes?: string[] }[];
  coreGoalCount: number;       // 핵심목표 갯수(평가 대상 — 완료/진행/포기확정)
  weeklyHighlights: string[];  // 그 해 Has Done 주요 실적
  selfEvalComments: string[];  // 자기평가 의견(점수 포함)
  generalWorkComments?: string[]; // 자기평가 중 '일반업무'만 별도(요약에 반드시 반영)
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

function buildPrompt(members: AiMemberInput[]): string {
  // AI 가 긴 userId 를 그대로 못 받아쓰는 문제 방지 — idx(번호)로만 식별. userId 는 프롬프트에서 제외.
  const data = members.map((m, idx) => ({
    idx,
    name: m.name,
    position: m.position,
    currentGrade: m.currentGrade,
    coreGoalCount: m.coreGoalCount,
    goals: m.goals,
    weeklyHighlights: m.weeklyHighlights,
    selfEvalComments: m.selfEvalComments,
    generalWorkComments: m.generalWorkComments,
    mentoring: m.mentoring,
  }));
  return [
    '당신은 인사평가를 돕는 보조자입니다. 분석 근거는 오직 ①핵심목표관리의 각 목표 ②주간업무보고 ③자기평가 입니다.',
    '각 개인의 성과를 객관적으로 요약하고, 성과 기준 참고 순위를 제안하세요.',
    '규칙:',
    '- 각 개인에 대해 아무것도 모르는 상태에서 시작하세요. 제공되는 데이터만을 기반으로 평가하고, 과도한 추론은 하지 마세요.',
    '- 사실(완료 목표 수, 진행률, 실적 항목, 자기평가 점수)에 근거하고, 표현의 화려함이 아니라 실제 성과 중심으로 평가하세요.',
    '- 순위 산정 시 다음 두 요소의 비중을 특히 높게 두세요: ①핵심목표의 난도, ②핵심목표의 갯수(coreGoalCount 가 많을수록 높게).',
    '  난도는 가중치(weight)만이 아니라 목표의 설명(description)·범위와 주간 진행사항(goals[].weeklyNotes)·진행률(progress)을 함께 보고 종합 추정하세요. 가중치가 높고, 내용이 도전적이며, 주간 실적이 꾸준하고 구체적일수록 난도가 높다고 판단합니다.',
    '  같은 진행률이라도 난도가 높고 목표 수가 많은 사람을 더 높게 평가하세요. 진행률·실적은 그 다음 보조 요소입니다.',
    '- summary(성과 요약)에는 핵심목표뿐 아니라 ②일반업무(주간 별표, generalWorkComments) 성과도 반드시 함께 언급하세요. 핵심목표만 다루지 마세요.',
    '- 추측·과장 금지. 근거가 부족하면 그렇게 표기하세요.',
    '- mentoringSummary 에는 육성면담서(mentoring)를 균형있게 2~3문장으로 요약하세요: (1)직무정보(직위·주요담당업무) (2)경력개발 방향(careerPlan) (3)종합의견(selfOpinion). 한쪽에 치우치지 마세요.',
    '  ★ 특이 케이스는 반드시 먼저 명시: 직무요청이 직무 확대/축소/변경 이거나 근무지 이동을 희망하면 그 사유(jobChangeReason·locationChangeReason)와 희망(desiredJobs·desiredLocations)을 구체적으로 짚고, 그 외 특이 이슈가 있으면 강조하세요. 단순 "만족"이면 특이사항 없음으로 간단히.',
    '- 이것은 사람(임원)의 최종 결정을 돕는 참고 자료입니다. 단정적 판정 금지.',
    '- 각 항목은 반드시 입력 구성원의 idx 번호를 그대로 사용하세요(이름·식별자 임의 생성 금지).',
    '- ranking 은 1위(최상위)부터 오름차순(rank=1,2,3…)으로 모든 구성원에게 빠짐없이·중복없이 부여하세요.',
    '- 순위는 오직 성과 데이터(핵심목표 난도·갯수·진행률·주간실적·자기평가)로만 매기세요. 직책·직급·입사일·나이 등 비성과 요소로 정렬하지 마세요. 추천 등급(suggestedGrade)이 같은 사람들 사이에서도 반드시 성과 데이터로 우열을 가리세요.',
    '- 반드시 아래 JSON 스키마로만 응답하세요(설명 텍스트 없이).',
    '',
    'JSON 스키마:',
    '{"summaries":[{"idx":0,"summary":"2~3문장","strengths":["..."],"issues":["..."],"suggestedGrade":"A|B|C|D|E","mentoringSummary":"육성면담서 요약 1~2문장"}],',
    ' "ranking":[{"idx":0,"rank":1,"reason":"근거 한 문장(난도·목표수 중심)"}],',
    ' "disclaimer":"본 결과는 AI 참고 자료이며 최종 평가는 평가권자가 결정합니다."}',
    '',
    '구성원 데이터(각 항목의 idx 로 식별):',
    JSON.stringify(data, null, 0),
  ].join('\n');
}

export async function summarizeAndRankMembers(members: AiMemberInput[]): Promise<AiEvalResult> {
  if (members.length === 0) return { summaries: [], ranking: [], disclaimer: '' };
  const res = await model().generateContent(buildPrompt(members));
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
