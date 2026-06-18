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
    '- 표·목록을 적절히 활용해 읽기 쉽게 답하세요. 서론·평가기준 설명은 짧게(2~3줄 이내) 하고 본론에 집중하세요.',
    '- 다수 인원의 서열을 요청받으면 장황한 설명 대신 간결한 표(순위 | 이름 | 추천등급 | 핵심 근거 1줄)로 전원을 빠짐없이 제시하세요. 인원이 많아도 한 명당 1~2줄로 압축하세요.',
    '- 이것은 사람(경영진/HR)의 의사결정을 돕는 참고 자료입니다. 단정적 인사조치를 지시하지 말고, 한계가 있으면 밝히세요.',
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
