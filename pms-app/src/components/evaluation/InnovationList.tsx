'use client';

import type { InnovationActivity } from '@/types';
import { cn } from '@/lib/utils';
import { getPmIds, getPerformerIds } from '@/lib/innovation';

const TYPE_LABEL: Record<string, string> = {
  SMART_PROJECT: '스마트프로젝트',
  TDS: 'TDS',
};
const TYPE_COLOR: Record<string, string> = {
  SMART_PROJECT: 'bg-purple-100 text-purple-700',
  TDS: 'bg-cyan-100 text-cyan-700',
};
const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  DROPPED: 'Drop',
};

/** 해당 멤버의 활동 내 역할 라벨 */
function roleOf(a: InnovationActivity, memberId: string): string {
  if (a.type === 'SMART_PROJECT') {
    if (getPmIds(a).includes(memberId)) return 'PM';
    if ((a.memberIds ?? []).includes(memberId)) return '참여';
  } else {
    if (getPerformerIds(a).includes(memberId)) return '수행';
    if (a.instructorId === memberId) return '지시';
  }
  return '';
}

export default function InnovationList({ items, memberId, revealConfidential = false }: { items: InnovationActivity[]; memberId: string; revealConfidential?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {items.map(a => {
        const role = roleOf(a, memberId);
        const masked = a.isConfidential && !revealConfidential;
        const displayName = masked ? 'CONFIDENTIAL (대내외비)' : a.name;
        return (
          <div key={a.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 font-medium', TYPE_COLOR[a.type])}>
              {TYPE_LABEL[a.type] ?? a.type}
            </span>
            <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 font-bold', masked ? 'bg-gray-200 text-gray-500' : 'text-gray-700')}>
              {role}
            </span>
            <span className={cn('flex-1 truncate', masked ? 'text-gray-400 italic' : 'text-gray-800')}>
              {displayName}
              {a.isConfidential && revealConfidential && (
                <span className="ml-1.5 text-[10px] text-amber-600 font-medium">[대내외비]</span>
              )}
            </span>
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 font-medium',
              a.status === 'COMPLETED' ? 'bg-green-100 text-green-700'
                : a.status === 'DROPPED' ? 'bg-gray-200 text-gray-600'
                : 'bg-orange-100 text-orange-700',
            )}>
              {STATUS_LABEL[a.status] ?? a.status}
            </span>
          </div>
        );
      })}
    </div>
  );
}
