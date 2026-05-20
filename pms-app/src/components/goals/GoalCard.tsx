'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Calendar, Pencil, Trash2, XCircle, Send } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from './GoalStatusBadge';
import type { Goal } from '@/types';
import { cn } from '@/lib/utils';

// ── 업무 유형별 스타일 (핵심목표관리의 모든 목표는 '과제업무'로 표시) ──────
const CARD_STYLE = { border: 'border-l-blue-500', badge: 'bg-blue-50 text-blue-700', label: '과제업무' };

// ── 컴포넌트 ─────────────────────────────────────────────────
interface GoalCardProps {
  goal: Goal;
  onEdit?: (goal: Goal) => void;
  onTrash?: (goal: Goal) => void;
  onWithdraw?: (goal: Goal) => void;
  onResubmit?: (goal: Goal) => void;
  onClick?: (goal: Goal) => void; // 휴지통 다이얼로그 등에서 Link 대신 사용
}

export default function GoalCard({ goal, onEdit, onTrash, onWithdraw, onResubmit, onClick }: GoalCardProps) {
  const router = useRouter();
  const { border, badge, label } = CARD_STYLE;

  const hasActions = onEdit || onTrash || onWithdraw || onResubmit;

  const inner = (
    <div
      className={cn(
        'relative border border-l-4 rounded-xl bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer',
        border,
        hasActions && 'pb-10',
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

          {/* 가중치 (설정된 경우만 표시) */}
          {goal.weight !== undefined && (
            <span>가중치 {goal.weight}%</span>
          )}
        </div>

        {/* ── 액션 버튼 그룹 ── */}
        {hasActions && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1">
            {onEdit && (
              <button type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(goal); }}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label="수정"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onResubmit && (
              <button type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); onResubmit(goal); }}
                className="rounded-md p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                aria-label="재상신"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
            {onWithdraw && (
              <button type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); onWithdraw(goal); }}
                className="rounded-md p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-500 transition-colors"
                aria-label="승인요청 회수"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
            {onTrash && (
              <button type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); onTrash(goal); }}
                className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                aria-label="휴지통으로 이동"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
    </div>
  );

  if (onClick) {
    return <div onClick={() => onClick(goal)}>{inner}</div>;
  }
  // 액션 버튼이 있으면 <a> 안에 <button> 중첩을 피하기 위해 div + router.push 사용
  if (hasActions) {
    return (
      <div onClick={() => router.push(`/goals/${goal.id}`)} style={{ cursor: 'pointer' }}>
        {inner}
      </div>
    );
  }
  return <Link href={`/goals/${goal.id}`}>{inner}</Link>;
}
