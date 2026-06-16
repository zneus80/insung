import type { Organization, Goal } from '@/types';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';

/**
 * 팀장·본부장의 '팀 성과 책임' — 책임 조직(+산하)의 핵심목표 완료율.
 * AI 성과평가에서 관리자 가·감점 근거로 사용한다(본인 주간 실적이 적어도 팀 성과로 평가).
 */

const VISIBLE = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_ABANDON']);
function isEvalGoal(g: Goal): boolean {
  return VISIBLE.has(g.status)
    || (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange);
}

/**
 * leaderUserId 가 책임자(조직 leaderId)인 조직(+산하)의 유효 핵심목표 완료율.
 * 책임 조직이 없거나 대상 목표가 없으면 null.
 * - 완료율 = 완료 목표 수 / 유효 목표 수(완료+추진중+포기). 포기는 분모 포함·분자 제외(미달성).
 */
export function computeLeaderTeamAchievement(
  leaderUserId: string,
  allOrgs: Organization[],
  allGoals: Goal[],
): { rate: number; completed: number; total: number } | null {
  const ledOrgs = allOrgs.filter(o => o.leaderId === leaderUserId);
  if (ledOrgs.length === 0) return null;
  const scope = new Set<string>();
  for (const o of ledOrgs) findDescendantIds(o.id, allOrgs).forEach(id => scope.add(id));
  const goals = allGoals.filter(g =>
    isEvalGoal(g) && (scope.has(g.organizationId) || (g.relatedOrgIds ?? []).some(id => scope.has(id))),
  );
  if (goals.length === 0) return null;
  const completed = goals.filter(g => g.status === 'COMPLETED').length;
  return { rate: Math.round((completed / goals.length) * 100), completed, total: goals.length };
}
