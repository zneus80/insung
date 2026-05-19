import { cn } from '@/lib/utils';
import type { GoalStatus } from '@/types';

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

export default function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const { label, className } = STATUS_MAP[status] ?? STATUS_MAP.DRAFT;
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', className)}>
      {label}
    </span>
  );
}
