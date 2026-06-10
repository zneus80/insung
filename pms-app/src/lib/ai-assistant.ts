import { getAI, getGenerativeModel, VertexAIBackend, type GenerativeModel } from 'firebase/ai';
import app from './firebase';

/**
 * AI 인사·성과 분석 어시스턴트 (CEO·HR 마스터 전용).
 *
 * Firebase AI Logic(Vertex AI 백엔드) — 누적된 개인 업무 실적 데이터를 바탕으로
 * 직무 JD 작성·성과 요약/서열·조직 인사이트 등 자유 질의에 답한다.
 *
 * 데이터 거버넌스: Vertex 백엔드는 입력을 학습에 쓰지 않음. 호출 화면이 CEO·HR마스터(전 직원 열람 권한)만
 * 접근하므로 §6-1 가시성 범위 내. 결과는 '참고용' — 최종 판단은 사람이 한다.
 */
const MODEL = 'gemini-2.5-flash';

let _model: GenerativeModel | null = null;
function model(): GenerativeModel {
  if (!_model) {
    const ai = getAI(app, { backend: new VertexAIBackend() });
    _model = getGenerativeModel(ai, {
      model: MODEL,
      generationConfig: { temperature: 0.3, maxOutputTokens: 32768 },
    });
  }
  return _model;
}

export interface AssistantTurn { role: 'user' | 'assistant'; content: string; }

const SYSTEM = [
  '당신은 최고관리자·HR 마스터를 돕는 인사·성과 분석 보조자입니다.',
  '아래 "구성원 데이터(JSON)"는 사내 누적 업무 실적입니다(핵심목표·주간업무보고·자기평가·육성면담서·평가등급·혁신활동·포상).',
  '이 데이터와 일반적인 직무·KPI 이론 지식을 활용해 사용자의 질문에 한국어로 답하세요.',
  '원칙:',
  '- 사실(실적·점수·등급·완료/포기 등)은 반드시 제공된 데이터에 근거하고, 데이터에 없는 성과를 지어내지 마세요. 근거가 부족하면 "데이터 부족"이라고 명시하세요.',
  '- 성과 서열/평가를 요청받으면 핵심목표의 난도·완료 실적·갯수, 주간 추진내용의 효율성·실효성·중대성, 자기평가·혁신·포상을 종합해 근거와 함께 제시하세요. 직책·입사일 같은 비성과 요소로 순위를 매기지 마세요.',
  '- 직무 JD(직무기술서) 작성을 요청받으면 해당 직무/직책 인원들의 실제 핵심목표·주간 추진내용을 근거로 주요 업무·필요 역량·성과지표(KPI)를 구성하세요.',
  '- 표·목록을 적절히 활용해 읽기 쉽게 답하세요. 서론·평가기준 설명은 짧게(2~3줄 이내) 하고 본론에 집중하세요.',
  '- 다수 인원의 서열을 요청받으면 장황한 설명 대신 간결한 표(순위 | 이름 | 추천등급 | 핵심 근거 1줄)로 전원을 빠짐없이 제시하세요. 인원이 많아도 한 명당 1~2줄로 압축하세요.',
  '- 이것은 사람(경영진/HR)의 의사결정을 돕는 참고 자료입니다. 단정적 인사조치를 지시하지 말고, 한계가 있으면 밝히세요.',
].join('\n');

export async function askAssistant(opts: {
  question: string;
  history: AssistantTurn[];
  dossier: string;     // JSON 문자열 (구성원 데이터)
  yearLabel: string;   // 예: "2025년" 또는 "전체 누적"
}): Promise<string> {
  const convo = opts.history
    .map(t => `${t.role === 'user' ? '사용자' : 'AI'}: ${t.content}`)
    .join('\n');
  const prompt = [
    SYSTEM,
    '',
    `분석 대상 기간: ${opts.yearLabel}`,
    '구성원 데이터(JSON):',
    opts.dossier,
    '',
    convo ? `이전 대화:\n${convo}\n` : '',
    `사용자 질문: ${opts.question}`,
  ].join('\n');
  const res = await model().generateContent(prompt);
  const text = res.response.text();
  const finish = res.response.candidates?.[0]?.finishReason;
  if (finish === 'MAX_TOKENS') {
    return text + '\n\n…(응답이 길어 일부가 잘렸습니다. 범위를 좁혀(예: 특정 팀·상위 N명) 다시 질문해 주세요.)';
  }
  return text;
}
