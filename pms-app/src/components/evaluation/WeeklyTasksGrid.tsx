'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Star } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { WeeklyTask } from '@/types';

/**
 * 평가 화면에서 사용하는 1년치(1~52주) 주간업무 카드 그리드.
 *
 * - 데이터가 있는 주차 → 진한 검정색
 * - 데이터가 없는 주차 → 연한 회색
 * - 카드 클릭 시 팝업으로 해당 주차의 Has Done / Will Do / 종합 의견 표시
 */
export default function WeeklyTasksGrid({ tasks, year }: { tasks: WeeklyTask[]; year?: number }) {
  const [openWeek, setOpenWeek] = useState<number | null>(null);

  // 주차별 매핑 (있는 것만)
  const byWeek = new Map<number, WeeklyTask>();
  tasks.forEach(t => byWeek.set(t.weekNumber, t));

  const open = openWeek !== null ? byWeek.get(openWeek) ?? null : null;

  return (
    <div>
      <div className="grid grid-cols-13 gap-1 sm:grid-cols-[repeat(13,minmax(0,1fr))]"
           style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
        {Array.from({ length: 52 }, (_, i) => i + 1).map(w => {
          const t = byWeek.get(w);
          const hasData = !!t && ((t.hasDoneItems?.length ?? 0) + (t.willDoItems?.length ?? 0) + (t.summary?.length ?? 0)) > 0;
          const hasImportant = !!t && (t.hasDoneItems ?? []).some(i => i.important);
          return (
            <button
              key={w}
              type="button"
              disabled={!hasData}
              onClick={() => hasData && setOpenWeek(w)}
              className={cn(
                'relative aspect-square rounded text-[10px] font-semibold border transition-colors flex items-center justify-center',
                hasImportant
                  ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600 cursor-pointer'
                  : hasData
                    ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-700 cursor-pointer'
                    : 'bg-gray-50 text-gray-300 border-gray-100 cursor-default'
              )}
              title={hasImportant ? `${w}주차 — 중요 실적 포함` : hasData ? `${w}주차 보기` : `${w}주차 — 데이터 없음`}
            >
              {w}
              {hasImportant && <Star className="absolute -top-1 -right-1 h-2.5 w-2.5 fill-amber-300 text-amber-300" />}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        ■ 검정 = 데이터 있는 주차 · <span className="text-amber-600">★ 주황 = 중요 실적 포함</span> · ▢ 회색 = 데이터 없음 (클릭하여 세부 확인)
      </p>

      <Dialog open={!!open} onOpenChange={v => { if (!v) setOpenWeek(null); }}>
        <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-baseline gap-2 flex-wrap">
                  <span>{year ? `${year}년` : ''} {open.weekNumber}주차 주간업무</span>
                  <span className="text-xs font-normal text-gray-400">
                    {open.weekStart.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ~ {open.weekEnd.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {(open.hasDoneItems ?? []).length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-green-700 mb-1.5">Has Done — 이번 주 실적</p>
                    <div className="rounded-lg border bg-green-50/30 divide-y">
                      {(open.hasDoneItems ?? []).map(i => (
                        <div key={i.id} className={cn('px-3 py-2', i.important && 'bg-amber-50')}>
                          <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                            {i.important && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />}
                            {i.title}
                          </p>
                          {i.content && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{i.content}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(open.willDoItems ?? []).length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-700 mb-1.5">Will Do — 다음 주 계획</p>
                    <div className="rounded-lg border bg-gray-50/30 divide-y">
                      {(open.willDoItems ?? []).map(i => (
                        <div key={i.id} className="px-3 py-2">
                          <p className="text-sm font-medium text-gray-800">{i.title}</p>
                          {i.content && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{i.content}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {open.summary && (
                  <div>
                    <p className="text-xs font-bold text-blue-700 mb-1.5">종합 의견</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap rounded-lg border border-blue-100 bg-blue-50/30 px-3 py-2 leading-relaxed">{open.summary}</p>
                  </div>
                )}
                {(open.hasDoneItems ?? []).length === 0 && (open.willDoItems ?? []).length === 0 && !open.summary && (
                  <p className="text-sm text-gray-400 text-center py-6">등록된 업무가 없습니다.</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
