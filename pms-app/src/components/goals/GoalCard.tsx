'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Calendar, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from './GoalStatusBadge';
import type { Goal } from '@/types';
import { cn } from '@/lib/utils';

// ── 컴포넌트 ─────────────────────────────────────────────────
interface GoalCardProps {
  goal: Goal;
  onEdit?: (goal: Goal) => void;
  onRestore?: (goal: Goal) => void;
  onDelete?: (goal: Goal) => void;   // 영구 삭제 (휴지통에서만)
  onCardClick?: (goal: Goal) => void; // 제공 시 Link 대신 커스텀 클릭
  ownerName?: string;
}

export default function GoalCard({ goal, onEdit, onRestore, onDelete, onCardClick, ownerName }: GoalCardProps) {
  const inner = (
      <div
        className={cn(
          'relative border border-l-4 rounded-xl bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer',
          'border-l-blue-500',
        )}
      >
        {/* ── 상단: 제목 + 상태 뱃지 ── */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-[15px] font-bold text-gray-900 line-clamp-2 leading-snug">{goal.title}</h3>
          <div className="shrink-0 mt-0.5">
            <GoalStatusBadge status={goal.status} />
          </div>
        </div>

        {/* ── 설명 ── */}
        <p className="text-sm text-gray-500 line-clamp-2 mb-3">{goal.description}</p>

        {/* ── 진행률 (포기됨 제외) ── */}
        {goal.status !== 'ABANDONED' && (
          <div className="space-y-1 mb-3">
            <div className="flex justify-between text-xs text-gray-500">
              <span>진행률</span>
              <span className="font-medium text-gray-700">{goal.progress}%</span>
            </div>
            <Progress value={goal.progress} className="h-1.5" />
          </div>
        )}

        {/* ── 메타 정보 ── */}
        <div className="flex items-center justify-between gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {format(goal.dueDate, 'MM/dd', { locale: ko })}까지
          </span>
          {ownerName && (
            <span className="font-medium text-gray-500 truncate">{ownerName}</span>
          )}
        </div>

        {/* ── 우하단 버튼 (수정 / 복구 / 영구삭제) ── */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1">
          {onDelete && (
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(goal); }}
              className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              aria-label="영구 삭제"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onRestore && (
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onRestore(goal); }}
              className="rounded-md p-1.5 text-blue-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
              aria-label="복구"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(goal); }}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              aria-label="수정"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
  );

  if (onCardClick) {
    return (
      <div onClick={() => onCardClick(goal)}>
        {inner}
      </div>
    );
  }
  return <Link href={`/goals/${goal.id}`}>{inner}</Link>;
}
