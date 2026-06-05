'use client';

import { Lock } from 'lucide-react';
import { useActiveYear } from '@/contexts/ActiveYearContext';

/**
 * 확정(잠금)된 연도 안내 배너 — 해당 연도는 조회만 가능(읽기 전용).
 * activeYear 가 확정 상태일 때만 표시. 편집 표면 상단에 배치.
 */
export default function YearLockBanner({ className = '' }: { className?: string }) {
  const { activeYear, activeYearLocked } = useActiveYear();
  if (!activeYearLocked) return null;
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2.5 text-sm text-gray-600 ${className}`}>
      <Lock className="h-4 w-4 shrink-0 text-gray-500" />
      <span><b>{activeYear}년</b>은 확정된 연도입니다. 기록 조회만 가능하며 추가·수정·삭제는 제한됩니다.</span>
    </div>
  );
}
