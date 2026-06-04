'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Calendar, Pencil, Trash2, XCircle, Send, UserCircle2, Users, Lock } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from './GoalStatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import type { Goal } from '@/types';
import { cn } from '@/lib/utils';

// ── 업무 유형별 스타일 ─────────────────────────────────────────
// 기본: 과제업무 (파란색)
// 공동: 공동과제업무 (보라색) — 본인이 collaboratorIds 에 포함
// 이관: 이관업무 (호박색) — previousOwnerId 가 존재
const CARD_STYLES = {
  default:    { border: 'border-l-blue-500',   badge: 'bg-blue-50 text-blue-700',     bg: 'bg-white',         label: '과제업무' },
  collaborate:{ border: 'border-l-purple-500', badge: 'bg-purple-50 text-purple-700', bg: 'bg-purple-50/30',  label: '공동과제업무' },
} as const;

// ── 컴포넌트 ─────────────────────────────────────────────────
interface GoalCardProps {
  goal: Goal;
  ownerName?: string;             // 수행자 이름 — 외부에서 usersMap 으로 조회해 전달
  participantNames?: string[];    // 공동업무: 수행자+공동수행자 이름을 차례대로(구분 없이) — 강조 표시
  onEdit?: (goal: Goal) => void;
  onTrash?: (goal: Goal) => void;
  onWithdraw?: (goal: Goal) => void;
  onResubmit?: (goal: Goal) => void;
  onClick?: (goal: Goal) => void; // 휴지통 다이얼로그 등에서 Link 대신 사용
}

export default function GoalCard({ goal, ownerName, participantNames, onEdit, onTrash, onWithdraw, onResubmit, onClick }: GoalCardProps) {
  const router = useRouter();
  const { userProfile } = useAuth();

  // 카드 분류 — 공동과제 여부만 (이관업무 유형 표시 제거)
  // 본인이 owner 든 collaborator 든 collaboratorIds 가 비어있지 않으면 "공동과제업무"
  const hasCollaborators = (goal.collaboratorIds ?? []).length > 0;
  const styleKey: keyof typeof CARD_STYLES = hasCollaborators ? 'collaborate' : 'default';
  const { border, badge, bg, label } = CARD_STYLES[styleKey];

  const hasActions = onEdit || onTrash || onWithdraw || onResubmit;

  const inner = (
    <div
      className={cn(
        'relative border border-l-4 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer',
        border,
        bg,
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

            {/* 수행자 재지정이 아직 안 된 이관 목표 */}
            {goal.needsReassignment && (
              <span
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700"
                title={`이전 수행자: ${goal.previousOwnerName ?? ''}`}
              >
                수행자 재지정 필요
              </span>
            )}

            {/* 대내비 — 전사 업무추진현황에서 마스킹됨 */}
            {goal.isConfidential && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700"
                title="대내비 — 전사 업무추진현황에서 CONFIDENTIAL 로 표시됩니다"
              >
                <Lock className="h-3 w-3" />
                대내비
              </span>
            )}
          </div>

          <GoalStatusBadge goal={goal} />
        </div>

        {/* ── 제목 ── */}
        <h3 className="font-semibold text-gray-900 line-clamp-1 mb-0.5">{goal.title}</h3>

        {/* ── 팀 연계 표시 ── */}
        {goal.taskCategory === 'TEAM_LINKED' && goal.linkedOrgGoalTitle && (
          <p className="text-xs text-gray-400 mb-1">↳ {goal.linkedOrgGoalTitle}</p>
        )}

        {/* ── 설명 ── */}
        {goal.description && (
          <p className="text-sm text-gray-500 line-clamp-2 mt-1 mb-2 whitespace-pre-line">{goal.description}</p>
        )}

        {/* ── 진행률 ── */}
        <div className="space-y-1 mb-3">
          <div className="flex justify-between text-xs text-gray-500">
            <span>진행률</span>
            <span className="font-medium text-gray-700">{goal.progress}%</span>
          </div>
          <Progress value={goal.progress} className="h-1.5" />
        </div>

        {/* ── 메타 정보 ── */}
        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {format(goal.dueDate, 'MM/dd', { locale: ko })}까지
          </span>

          {/* 수행자 표시 — 공동업무는 수행자/공동수행자 구분 없이 이름 차례대로 강조 */}
          {(participantNames && participantNames.length > 0) ? (
            <span className="flex items-center gap-1.5">
              {participantNames.length > 1
                ? <Users className="h-3.5 w-3.5 text-purple-500" />
                : <UserCircle2 className="h-3.5 w-3.5" />}
              <span className="text-sm font-semibold text-gray-800">{participantNames.join(', ')}</span>
              {participantNames.length > 1 && (
                <span className="text-[11px] font-medium text-purple-600">· 공동 {participantNames.length}명</span>
              )}
            </span>
          ) : ownerName ? (
            <span className="flex items-center gap-1">
              <UserCircle2 className="h-3.5 w-3.5" />
              <span className="text-sm font-semibold text-gray-800">{ownerName}</span>
            </span>
          ) : null}

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
