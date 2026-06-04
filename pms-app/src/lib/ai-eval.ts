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
  goals: { title: string; status: string; progress: number }[];
  weeklyHighlights: string[];  // 그 해 Has Done 주요 실적
  selfEvalComments: string[];  // 자기평가 의견
  mentoringOpinion?: string;   // 육성면담서 종합의견
}

export interface AiMemberSummary {
  userId: string;
  summary: string;             // 한 문단 성과 요약
  strengths: string[];
  issues: string[];
  suggestedGrade?: string;     // 참고용 추천 등급
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
    goals: m.goals,
    weeklyHighlights: m.weeklyHighlights,
    selfEvalComments: m.selfEvalComments,
    mentoringOpinion: m.mentoringOpinion,
  }));
  return [
    '당신은 인사평가를 돕는 보조자입니다. 아래 구성원들의 한 해 업무 근거(핵심목표 진행, 주간 실적, 자기평가, 육성면담서)를 바탕으로,',
    '각 개인의 성과를 객관적으로 요약하고, 성과 기준 참고 순위를 제안하세요.',
    '규칙:',
    '- 사실(완료 목표 수, 진행률, 실적 항목)에 근거하고, 표현의 화려함이 아니라 실제 성과 중심으로 평가하세요.',
    '- 추측·과장 금지. 근거가 부족하면 그렇게 표기하세요.',
    '- 이것은 사람(임원)의 최종 결정을 돕는 참고 자료입니다. 단정적 판정 금지.',
    '- 각 항목은 반드시 입력 구성원의 idx 번호를 그대로 사용하세요(이름·식별자 임의 생성 금지).',
    '- 반드시 아래 JSON 스키마로만 응답하세요(설명 텍스트 없이).',
    '',
    'JSON 스키마:',
    '{"summaries":[{"idx":0,"summary":"2~3문장","strengths":["..."],"issues":["..."],"suggestedGrade":"A|B|C|D|E"}],',
    ' "ranking":[{"idx":0,"rank":1,"reason":"근거 한 문장"}],',
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
