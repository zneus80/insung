'use client';

import type { Attendance } from '@/types';

/** 평가 상세의 근태현황(당해년도) 읽기전용 표시 — 육성면담서 다음에 위치 */
export default function AttendanceBody({ year, attendance }: { year: number; attendance: Attendance | null }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5">
        <span className="h-3.5 w-1 rounded-full bg-amber-400" />
        <h4 className="text-sm font-bold text-amber-700">근태현황 <span className="text-xs font-normal text-gray-400">({year}년)</span></h4>
      </div>
      <div className="px-4 py-4">
        {attendance ? (
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-xs text-gray-400 mb-0.5">지각</p>
              <p className={`text-lg font-bold ${attendance.latenessCount > 0 ? 'text-amber-600' : 'text-gray-700'}`}>{attendance.latenessCount}회</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400 mb-0.5">결근</p>
              <p className={`text-lg font-bold ${attendance.absenceCount > 0 ? 'text-red-600' : 'text-gray-700'}`}>{attendance.absenceCount}회</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-300">근태 입력 없음</p>
        )}
      </div>
    </section>
  );
}
