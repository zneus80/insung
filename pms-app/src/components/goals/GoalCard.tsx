'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Calendar, Pencil, Trash2, XCircle, Send } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from './GoalStatusBadge';
import type { Goal, GoalType, GeneralType, Importance } from '@/types';
import { cn } from '@/lib/utils';

// ── 업무 유형별 스타일 ────────────────────────────────────────
type GoalVariant = 'TASK' | 'MAJOR';

function getVariant(goal: Goal): GoalVariant {
  if (goal.goalType === 'TASK') return 'TASK';
  return 'MAJOR';
}

const VARIANT_STYLE: Record<GoalVariant, { border: string; badge: string; label: string }> = {
  TASK:  { border: 'border-l-blue-500',  badge: 'bg-blue-50 text-blue-700',   label: '과제업무' },
  MAJOR: { border: 'border-l-green-500', badge: 'bg-green-50 text-green-700', label: '주요업무' },
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
  onTrash?: (goal: Goal) => void;      // DRAFT/REJECTED → 휴지통
  onWithdraw?: (goal: Goal) => void;   // PENDING_APPROVAL → 회수
  onResubmit?: (goal: Goal) => void;   // REJECTED → 재상신
  /** 클릭 시 Link 대신 호출 (휴지통 내 카드) */
  onClick?: (goal: Goal) => void;
}

export default function GoalCard({ goal, onEdit, onTrash, onWithdraw, onResubmit, onClick }: GoalCardProps) {
  const variant = getVariant(goal);
  const { border, badge, label } = VARIANT_STYLE[variant];

  const inner = (
    <div
      className={cn(
        'relative border border-l-4 rounded-xl bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer',
        border,
      )}
    >
      {/* ── 상단: 유형 뱃지 + 상태 뱃지 ── */}
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', badge)}>
          {label}
        </span>
        {goal.requestPromotion && (
          <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
            과제 반영 요청
          </span>
        )}
      </div>

      {/* ── 제목 + 상태 뱃지 (같은 줄) ── */}
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <h3 className="text-base font-bold text-gray-900 line-clamp-1">{goal.title}</h3>
        <GoalStatusBadge status={goal.status} />
      </div>

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
        {variant === 'TASK' && goal.weight !== undefined && (
          <span>가중치 {goal.weight}%</span>
        )}
      </div>

      {/* ── 액션 버튼 그룹 ── */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1">
        {/* 수정 */}
        {onEdit && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(goal); }}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors"
            aria-label="수정"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {/* 재상신 (REJECTED) */}
        {onResubmit && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onResubmit(goal); }}
            className="rounded-md p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            aria-label="재상신"
            title="승인 요청"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
        {/* 회수 (PENDING_APPROVAL) */}
        {onWithdraw && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onWithdraw(goal); }}
            className="rounded-md p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-600 transition-colors"
            aria-label="승인 요청 회수"
            title="승인 요청 회수"
          >
            <XCircle className="h-3.5 w-3.5" />
          </button>
        )}
        {/* 휴지통 이동 */}
        {onTrash && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onTrash(goal); }}
            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            aria-label="휴지통으로 이동"
            title="휴지통으로 이동"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <div onClick={() => onClick(goal)} className="cursor-pointer">
        {inner}
      </div>
    );
  }

  return <Link href={`/goals/${goal.id}`}>{inner}</Link>;
}
