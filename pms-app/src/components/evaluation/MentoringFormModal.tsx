'use client';

import { useState } from 'react';
import type { MentoringForm } from '@/types';
import MentoringPerfBody from './MentoringPerfBody';

interface Props {
  form: MentoringForm;
  memberName: string;
  leadOpinion?: string;
  execOpinion?: string;
  /** 커스텀 트리거. 미지정 시 기본 "육성면담서 전체 보기" 텍스트 버튼 사용. */
  trigger?: React.ReactNode;
}

export default function MentoringFormModal({ form, memberName, leadOpinion, execOpinion, trigger }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {trigger ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left hover:opacity-80 transition-opacity cursor-pointer"
        >
          {trigger}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-blue-600 hover:underline font-medium"
        >
          육성면담서 전체 보기
        </button>
      )}

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
              {/* 통합 육성면담서(직무정보·업무실적·경력·요청·종합의견) — 신양식 */}
              <MentoringPerfBody form={form} />

              {/* 면담자 의견 */}
              {form.interviewerOpinion?.trim() && (
                <Section title="면담자 의견">
                  <Row label="면담자 의견" value={form.interviewerOpinion} multiline />
                </Section>
              )}

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
