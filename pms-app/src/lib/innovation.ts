// 혁신활동 데이터 헬퍼.
// 복수 PM/수행자 지원 + 구버전(단일 pmId/performerId) 호환.

import type { InnovationActivity } from '@/types';

export function getPmIds(a: InnovationActivity): string[] {
  if (a.pmIds && a.pmIds.length > 0) return a.pmIds;
  if (a.pmId) return [a.pmId];
  return [];
}

export function getPerformerIds(a: InnovationActivity): string[] {
  if (a.performerIds && a.performerIds.length > 0) return a.performerIds;
  if (a.performerId) return [a.performerId];
  return [];
}

/** subject 가 혁신활동에 참여(PM/멤버/수행/지시) 하는지 여부 */
export function isInvolved(a: InnovationActivity, userId: string): boolean {
  if (a.type === 'SMART_PROJECT') {
    if (getPmIds(a).includes(userId)) return true;
    if ((a.memberIds ?? []).includes(userId)) return true;
  } else {
    if (getPerformerIds(a).includes(userId)) return true;
    if (a.instructorId === userId) return true;
  }
  return false;
}
