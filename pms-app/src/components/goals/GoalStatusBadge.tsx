import { cn } from '@/lib/utils';
import type { Goal, GoalStatus } from '@/types';

const STATUS_MAP: Record<GoalStatus, { label: string; className: string }> = {
  DRAFT:            { label: '임시저장',   className: 'bg-gray-100 text-gray-600' },
  PENDING_APPROVAL: { label: '승인요청',   className: 'bg-yellow-100 text-yellow-700' },
  LEAD_APPROVED:    { label: '1차 승인',   className: 'bg-blue-100 text-blue-700' },
  APPROVED:         { label: '최종 승인',  className: 'bg-green-100 text-green-700' },
  IN_PROGRESS:      { label: '진행 중',    className: 'bg-blue-100 text-blue-700' },
  COMPLETED:        { label: '완료 요청',  className: 'bg-purple-100 text-purple-700' },
  PENDING_MODIFY:   { label: '수정 요청',  className: 'bg-orange-100 text-orange-700' },
  PENDING_ABANDON:  { label: '포기 요청',  className: 'bg-red-100 text-red-700' },
  REJECTED:         { label: '반려',       className: 'bg-red-100 text-red-700' },
  ABANDONED:        { label: '포기',       className: 'bg-gray-100 text-gray-500' },
};

interface Props {
  /** Goal 전체를 넘기면 leadApprovedBy/hqApprovedBy 기반 세부 라벨 표시 */
  goal?: Pick<Goal, 'status' | 'leadApprovedBy' | 'hqApprovedBy' | 'approvedBy'
    | 'completionLeadApprovedBy' | 'completionHqApprovedBy' | 'completionExecApprovedBy'>;
  /** Goal 없이 status만 받는 경우(레거시·이력 표시 등) */
  status?: GoalStatus;
  /** 진행현황 등 '추진중' 그룹 표시용 — APPROVED 도 '진행 중'으로 통일 표기 */
  unifyActive?: boolean;
}

export default function GoalStatusBadge({ goal, status, unifyActive }: Props) {
  const st = (goal?.status ?? status ?? 'DRAFT') as GoalStatus;
  const base = STATUS_MAP[st] ?? STATUS_MAP.DRAFT;
  let label = base.label;
  let className = base.className;

  // 진행현황(추진중 그룹): 최종승인(APPROVED)도 '진행 중'으로 일치 표기
  if (unifyActive && st === 'APPROVED') {
    label = STATUS_MAP.IN_PROGRESS.label;
    className = STATUS_MAP.IN_PROGRESS.className;
  }

  // LEAD_APPROVED 세부 라벨링 — 누가 승인했는지에 따라
  if (goal && st === 'LEAD_APPROVED') {
    if (goal.hqApprovedBy && goal.leadApprovedBy) label = '본부 2차 승인';
    else if (goal.hqApprovedBy) label = '본부 1차 승인';
    else if (goal.leadApprovedBy) label = '팀장 1차 승인';
    else label = '1차 승인';
  }

  // COMPLETED 세부 라벨링 — 완료 결재 단계별
  if (goal && st === 'COMPLETED') {
    if (goal.completionExecApprovedBy) {
      label = '완료';
      className = 'bg-emerald-100 text-emerald-700';
    } else if (goal.completionHqApprovedBy) {
      label = '완료 2차 승인';
    } else if (goal.completionLeadApprovedBy) {
      label = '완료 1차 승인';
    }
  }

  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', className)}>
      {label}
    </span>
  );
}
