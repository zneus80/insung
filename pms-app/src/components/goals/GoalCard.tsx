'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Calendar, Pencil } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from './GoalStatusBadge';
import type { Goal, GoalType, GeneralType, Importance } from '@/types';
import { cn } from '@/lib/utils';

// ── 업무 유형별 스타일 ────────────────────────────────────────
type GoalVariant = 'TASK' | 'MAJOR' | 'OTHER';

function getVariant(goal: Goal): GoalVariant {
  if (goal.goalType === 'TASK') return 'TASK';
  if (goal.generalType === 'MAJOR') return 'MAJOR';
  return 'OTHER';
}

const VARIANT_STYLE: Record<GoalVariant, { border: string; badge: string; label: string }> = {
  TASK:  { border: 'border-l-blue-500',  badge: 'bg-blue-50 text-blue-700',   label: '과제업무' },
  MAJOR: { border: 'border-l-green-500', badge: 'bg-green-50 text-green-700', label: '주요업무' },
  OTHER: { border: 'border-l-gray-300',  badge: 'bg-gray-50 text-gray-600',   label: '기타업무' },
};

const IMPORTANCE_LABEL: Record<Importance, string> = {
  HIGH:   '높음',
  MEDIUM: '보통',
  LOW:    '낮음',
};

// ── 컴포넌트 ─────────────────────────────────────────────────
interface GoalCardProps {
  goal: Goal;
  onEdit?: (goal: Goal) => void;
}

export default function GoalCard({ goal, onEdit }: GoalCardProps) {
  const variant = getVariant(goal);
  const { border, badge, label } = VARIANT_STYLE[variant];

  return (
    <Link href={`/goals/${goal.id}`}>
      <div
        className={cn(
          'relative border border-l-4 rounded-xl bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer',
          border,
        )}
      >
        {/* ── 상단: 유형 뱃지 + 상태 뱃지 ── */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* 업무 유형 뱃지 */}
            <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', badge)}>
              {label}
            </span>

            {/* 과제 반영 요청 뱃지 */}
            {goal.requestPromotion && (
              <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
                과제 반영 요청
              </span>
            )}
          </div>

          <GoalStatusBadge status={goal.status} />
        </div>

        {/* ── 제목 ── */}
        <h3 className="font-semibold text-gray-900 line-clamp-1 mb-0.5">{goal.title}</h3>

        {/* ── 팀 연계 표시 ── */}
        {goal.taskCategory === 'TEAM_LINKED' && goal.linkedOrgGoalTitle && (
          <p className="text-xs text-gray-400 mb-1">↳ {goal.linkedOrgGoalTitle}</p>
        )}

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

          {/* 과제업무: 가중치 */}
          {variant === 'TASK' && goal.weight !== undefined && (
            <span>가중치 {goal.weight}%</span>
          )}

          {/* 기타업무: 중요도 */}
          {variant === 'OTHER' && goal.importance && (
            <span>중요도 {IMPORTANCE_LABEL[goal.importance]}</span>
          )}
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
