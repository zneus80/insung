'use client';

import type { MentoringForm } from '@/types';

// 평가 상세 / 전사 확인의 "육성면담 및 업무실적" — 통합 육성면담서(자기평가 포함) 읽기전용 표시
const JOB_REQUEST_LABEL: Record<string, string> = {
  EXPAND: '직무 확대', REDUCE: '직무 축소', CHANGE: '직무 변경', RELOCATE: '근무지 이동', SATISFIED: '만족',
};

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-500 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

// 섹션 카드 — 색상 헤더 바 + 테두리로 영역 구분을 명확히
const SECTION_COLOR: Record<string, { head: string; bar: string }> = {
  violet: { head: 'text-violet-700', bar: 'bg-violet-400' },
  blue: { head: 'text-blue-700', bar: 'bg-blue-400' },
  gray: { head: 'text-gray-700', bar: 'bg-gray-400' },
};
function Section({ title, color = 'gray', children }: { title: string; color?: 'violet' | 'blue' | 'gray'; children: React.ReactNode }) {
  const c = SECTION_COLOR[color];
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5">
        <span className={`h-3.5 w-1 rounded-full ${c.bar}`} />
        <h4 className={`text-sm font-bold ${c.head}`}>{title}</h4>
      </div>
      <div className="px-4 py-4 space-y-3">{children}</div>
    </section>
  );
}

function Val({ text }: { text?: string }) {
  return text?.trim()
    ? <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{text}</p>
    : <p className="text-sm text-gray-300">—</p>;
}

export default function MentoringPerfBody({ form }: { form: MentoringForm | null }) {
  if (!form) {
    return <p className="text-sm text-gray-400 px-1 py-4">제출된 육성면담서가 없습니다.</p>;
  }
  const certs = (form.certifications ?? '').split('\n').filter(Boolean);
  const hasJobRequest = form.jobRequest && form.jobRequest !== 'SATISFIED';

  return (
    <div className="space-y-4">
      {/* 직무 정보 */}
      <Section title="직무 정보" color="violet">
        <Block label="직책"><Val text={form.currentPosition} /></Block>
        <Block label="보유 자격증">
          {certs.length
            ? <div className="flex flex-wrap gap-1.5">{certs.map((c, i) => <span key={i} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">{c}</span>)}</div>
            : <p className="text-sm text-gray-300">—</p>}
        </Block>
        <Block label="교육수강현황">
          {(form.educationHistory ?? []).length
            ? <div className="flex flex-wrap gap-1.5">{(form.educationHistory ?? []).map((e, i) => (
                <span key={i} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700">[{e.type}] {e.name}</span>
              ))}</div>
            : <p className="text-sm text-gray-300">—</p>}
        </Block>
        <Block label="주요 담당업무"><Val text={form.mainDuties} /></Block>
      </Section>

      {/* (v0.9.2) 당해년도 업무실적은 '자기평가'(SelfEvalBody)로 분리 */}

      {/* 경력개발 / 직무 요청사항 */}
      <Section title="경력개발 및 직무 요청" color="gray">
        <Block label="경력개발 방향"><Val text={form.careerPlan} /></Block>
        {hasJobRequest && (
          <Block label="직무 요청사항">
            <p className="text-sm text-gray-800">
              {JOB_REQUEST_LABEL[form.jobRequest!] ?? form.jobRequest}
              {form.jobRequestReason ? ` — ${form.jobRequestReason}` : ''}
            </p>
            {(form.desiredJob1 || form.desiredJob2) && (
              <p className="text-xs text-gray-600 mt-0.5">희망직무: {[form.desiredJob1, form.desiredJob2].filter(Boolean).join(', ')}{form.jobChangeReason && ` (${form.jobChangeReason})`}</p>
            )}
            {(form.desiredLocation1 || form.desiredLocation2) && (
              <p className="text-xs text-gray-600 mt-0.5">희망근무지: {[form.desiredLocation1, form.desiredLocation2].filter(Boolean).join(', ')}{form.locationChangeReason && ` (${form.locationChangeReason})`}</p>
            )}
          </Block>
        )}
      </Section>

      {/* 종합의견 */}
      <Section title="본인 종합의견" color="gray">
        {form.selfOpinion?.trim()
          ? <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{form.selfOpinion}</p>
          : <p className="text-sm text-gray-300">미작성</p>}
      </Section>
    </div>
  );
}
