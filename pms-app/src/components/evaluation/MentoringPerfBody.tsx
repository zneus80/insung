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

function Val({ text }: { text?: string }) {
  return text?.trim()
    ? <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{text}</p>
    : <p className="text-sm text-gray-300">—</p>;
}

function EvalRow({ title, comment }: { title: string; comment?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
      <p className="text-sm font-medium text-gray-800">{title}</p>
      {comment?.trim()
        ? <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap leading-relaxed">{comment}</p>
        : <p className="text-xs text-gray-300 mt-0.5">자기평가 미작성</p>}
    </div>
  );
}

export default function MentoringPerfBody({ form }: { form: MentoringForm | null }) {
  if (!form) {
    return <p className="text-sm text-gray-400 px-1 py-4">제출된 육성면담서가 없습니다.</p>;
  }
  const goalEvals = form.goalEvals ?? [];
  const generalEvals = form.generalEvals ?? [];
  const innovationEvals = form.innovationEvals ?? [];
  const certs = (form.certifications ?? '').split('\n').filter(Boolean);

  return (
    <div className="space-y-5">
      {/* 직무 정보 */}
      <div className="space-y-3">
        <p className="text-sm font-bold text-violet-700">직무 정보</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Block label="직위/직책"><Val text={form.currentPosition} /></Block>
          <Block label="현 직위 승진일"><Val text={form.promotionDate} /></Block>
        </div>
        <Block label="보유 자격증">
          {certs.length
            ? <div className="flex flex-wrap gap-1.5">{certs.map((c, i) => <span key={i} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{c}</span>)}</div>
            : <p className="text-sm text-gray-300">—</p>}
        </Block>
        <Block label="주요 담당업무"><Val text={form.mainDuties} /></Block>
      </div>

      {/* 당해년도 주요 업무실적 */}
      <div className="space-y-3">
        <p className="text-sm font-bold text-blue-700">당해년도 주요 업무실적</p>
        <Block label="완료 핵심목표">
          {goalEvals.length === 0 ? <p className="text-xs text-gray-400">없음</p>
            : <div className="space-y-1.5">{goalEvals.map(e => <EvalRow key={e.goalId} title={e.goalTitle} comment={e.comment} />)}</div>}
        </Block>
        <Block label="주요 일반업무 (★)">
          {generalEvals.length === 0 ? <p className="text-xs text-gray-400">없음</p>
            : <div className="space-y-1.5">{generalEvals.map(e => <EvalRow key={e.id} title={e.title} comment={e.comment} />)}</div>}
        </Block>
        <Block label="참여 혁신업무">
          {innovationEvals.length === 0 ? <p className="text-xs text-gray-400">없음</p>
            : <div className="space-y-1.5">{innovationEvals.map(e => <EvalRow key={e.activityId} title={e.name} comment={e.comment} />)}</div>}
        </Block>
      </div>

      {/* 경력개발 방향 */}
      <Block label="경력개발 방향"><Val text={form.careerPlan} /></Block>

      {/* 직무 요청사항 */}
      {form.jobRequest && form.jobRequest !== 'SATISFIED' && (
        <Block label="직무 요청사항">
          <p className="text-sm text-gray-800">
            {JOB_REQUEST_LABEL[form.jobRequest] ?? form.jobRequest}
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

      {/* 종합의견 */}
      <Block label="본인 종합의견">
        {form.selfOpinion?.trim()
          ? <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed rounded-lg bg-gray-50 px-3 py-2">{form.selfOpinion}</p>
          : <p className="text-sm text-gray-300">미작성</p>}
      </Block>
    </div>
  );
}
