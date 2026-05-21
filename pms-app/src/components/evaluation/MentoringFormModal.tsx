'use client';

import { useState } from 'react';
import type { MentoringForm } from '@/types';

const JOB_REQUEST_LABEL: Record<string, string> = {
  EXPAND:    '직무 확대',
  REDUCE:    '직무 축소',
  CHANGE:    '직무 변경',
  RELOCATE:  '근무지 이동',
  SATISFIED: '현재 만족',
};

interface Props {
  form: MentoringForm;
  memberName: string;
  leadOpinion?: string;
  execOpinion?: string;
}

export default function MentoringFormModal({ form, memberName, leadOpinion, execOpinion }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:underline font-medium"
      >
        육성면담서 전체 보기
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 배경 */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

          {/* 모달 */}
          <div className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">{memberName} 육성면담서</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {form.cycleYear}년
                  {form.interviewDate && ` · 면담일: ${form.interviewDate}`}
                  {form.interviewerName && ` · 면담자: ${form.interviewerName}`}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 text-lg leading-none shrink-0 ml-4"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* 직무 정보 */}
              <Section title="직무 정보">
                <Row label="직위/직책"       value={form.currentPosition} />
                <Row label="주요담당업무"    value={form.mainDuties} multiline />
                <Row label="현 직위 승진일"  value={form.promotionDate} />
                <Row label="보유 자격증"     value={form.certifications} />
                <Row label="주요 업적"       value={form.achievements} multiline />
              </Section>

              {/* 직무 요청사항 */}
              <Section title="직무 요청사항">
                <Row label="직무 요청" value={JOB_REQUEST_LABEL[form.jobRequest] ?? form.jobRequest} />
                {form.jobRequest !== 'SATISFIED' && (
                  <>
                    <Row label="요청 이유"         value={form.jobRequestReason} multiline />
                    {form.jobRequest === 'CHANGE' && (
                      <>
                        <Row label="희망 직무 1순위"   value={form.desiredJob1} />
                        <Row label="희망 직무 2순위"   value={form.desiredJob2} />
                        <Row label="변경 희망 이유"    value={form.jobChangeReason} multiline />
                      </>
                    )}
                    {form.jobRequest === 'RELOCATE' && (
                      <>
                        <Row label="희망 근무지 1순위" value={form.desiredLocation1} />
                        <Row label="희망 근무지 2순위" value={form.desiredLocation2} />
                        <Row label="근무지 변경 이유"  value={form.locationChangeReason} multiline />
                      </>
                    )}
                  </>
                )}
              </Section>

              {/* 경력개발 방향 */}
              <Section title="경력개발 방향">
                <Row label="희망 Position 및 경력개발 방향" value={form.careerPlan} multiline />
              </Section>

              {/* 종합의견 */}
              <Section title="종합의견">
                <Row label="본인 종합의견"  value={form.selfOpinion}        multiline />
                <Row label="면담자 의견"    value={form.interviewerOpinion} multiline />
              </Section>

              {/* 평가 의견 (팀장/임원) */}
              {(leadOpinion || execOpinion) && (
                <Section title="평가 의견">
                  {leadOpinion && <Row label="팀장 의견" value={leadOpinion} multiline />}
                  {execOpinion && <Row label="임원 의견" value={execOpinion} multiline />}
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      <div className="rounded-xl border bg-gray-50 divide-y">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  if (!value) return null;
  return (
    <div className={`px-4 py-3 ${multiline ? '' : 'flex items-start gap-3'}`}>
      <span className="text-xs font-medium text-gray-500 shrink-0 min-w-[120px]">{label}</span>
      <span className={`text-sm text-gray-800 ${multiline ? 'mt-1 block whitespace-pre-wrap' : ''}`}>{value}</span>
    </div>
  );
}
