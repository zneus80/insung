'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Calendar, Pencil } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from './GoalStatusBadge';
import type { Goal } from '@/types';
import { cn } from '@/lib/utils';

// ── 컴포넌트 ─────────────────────────────────────────────────
interface GoalCardProps {
  goal: Goal;
  onEdit?: (goal: Goal) => void;
}

export default function GoalCard({ goal, onEdit }: GoalCardProps) {
  return (
    <Link href={`/goals/${goal.id}`}>
      <div
        className={cn(
          'relative border border-l-4 rounded-xl bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer',
          'border-l-blue-500',
        )}
      >
        {/* ── 상단: 상태 뱃지 ── */}
        <div className="flex items-center justify-end gap-2 mb-2">
          <GoalStatusBadge status={goal.status} />
        </div>

        {/* ── 제목 ── */}
        <h3 className="font-semibold text-gray-900 line-clamp-1 mb-0.5">{goal.title}</h3>

        {/* ── 설명 ── */}
        <p className="text-sm text-gray-500 line-clamp-2 mt-1 mb-3">{goal.description}</p>

        {/* ── 진행률 ── */}
        <div className="space-y-1 mb-3">
          <div className="flex justify-between text-xs text-gray-500">
            <span>진행률</span>
            <span className="font-medium text-gray-700">{goal.progress}%</span>
          </div>
          <Progress value={goal.progress} className="h-1.5" />
        </div>

        {/* ── 메타 정보 ── */}
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {format(goal.dueDate, 'MM/dd', { locale: ko })}까지
          </span>
        </div>

        {/* ── 수정 버튼 ── */}
        {onEdit && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(goal); }}
            className="absolute bottom-3 right-3 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="수정"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </Link>
  );
}
