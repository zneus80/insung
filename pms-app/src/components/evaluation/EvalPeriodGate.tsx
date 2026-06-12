'use client';

import { useEffect, useState } from 'react';
import { getActiveCycle } from '@/lib/firestore';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { CalendarClock } from 'lucide-react';

/**
 * 평가기간 훅 — 평가 시작일 이전이면 beforePeriod=true.
 * 화면은 막지 않고, 각 화면의 '제출/확정' 버튼 비활성화에 사용한다.
 *  - 평가기간(evaluationPeriods/{year}) 미설정 → beforePeriod=false (기존 동작 유지)
 *  - 조회 실패 → beforePeriod=false (가용성 우선)
 */
export function useEvalPeriod(): { beforePeriod: boolean; startDate: Date | null } {
  const { activeYear } = useActiveYear();
  const [beforePeriod, setBeforePeriod] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    getActiveCycle(activeYear)
      .then(c => {
        if (!alive) return;
        if (c?.evalStartDate && new Date() < c.evalStartDate) {
          setStartDate(c.evalStartDate);
          setBeforePeriod(true);
        } else {
          setStartDate(c?.evalStartDate ?? null);
          setBeforePeriod(false);
        }
      })
      .catch(() => { if (alive) setBeforePeriod(false); });
    return () => { alive = false; };
  }, [activeYear]);

  return { beforePeriod, startDate };
}

/** 평가기간 이전 안내 배너 — 제출 버튼 비활성과 함께 표시 */
export function EvalPeriodNotice({ startDate }: { startDate: Date | null }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
      <CalendarClock className="h-4 w-4 shrink-0" />
      <span>
        아직 평가기간이 아닙니다. 작성·임시저장은 가능하지만 <b>제출은 평가기간에만</b> 할 수 있습니다.
        {startDate && <> (시작일: <b>{startDate.toLocaleDateString('ko-KR')}</b>)</>}
      </span>
    </div>
  );
}
