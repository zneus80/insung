'use client';

import { cn } from '@/lib/utils';

/**
 * 연도 선택 탭 — 평가결과처럼 당해 포함 직전 3개년 조회용 공용 컴포넌트.
 * 과거 연도는 조회 전용(읽기)으로 사용하는 화면에서 함께 쓴다.
 */
export default function YearTabBar({
  selectedYear,
  yearTabs,
  onChange,
  className,
}: {
  selectedYear: number;
  yearTabs: readonly number[];
  onChange: (year: number) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {yearTabs.map(year => (
        <button
          key={year}
          onClick={() => onChange(year)}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
            selectedYear === year
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300',
          )}
        >
          {year}년
        </button>
      ))}
    </div>
  );
}
