// 승인대기 관련 공유 필터 로직
// 대시보드 카운트와 사이드바 승인대기함 표시가 항상 일치하도록 한 곳에서 관리한다.

import type { Goal, Organization, User } from '@/types';

/** orgId 기준으로 자신 + 모든 하위 조직 ID 반환 */
export function getDescendantOrgIds(orgId: string, orgs: Organization[]): string[] {
  const result: string[] = [orgId];
  for (const child of orgs.filter(o => o.parentId === orgId)) {
    result.push(...getDescendantOrgIds(child.id, orgs));
  }
  return result;
}

/** orgId 기준으로 상위 조직 체인 반환 (자신 포함, 아래→위 순서) */
export function getOrgChain(orgId: string, allOrgs: Organization[]): Organization[] {
  const chain: Organization[] = [];
  let current = allOrgs.find(o => o.id === orgId);
  while (current) {
    chain.push(current);
    current = current.parentId ? allOrgs.find(o => o.id === current!.parentId) : undefined;
  }
  return chain;
}

/** 본부 + 부문 모두 존재하는 결재 체인인지 (= 본부장 중간 승인 단계가 의미 있는지) */
export function hasHQInChain(goal: Goal | undefined, allOrgs: Organization[]): boolean {
  if (!goal?.organizationId) return false;
  const chain = getOrgChain(goal.organizationId, allOrgs);
  return chain.some(o => o.type === 'HEADQUARTERS') && chain.some(o => o.type === 'DIVISION');
}

/** 목표의 팀에 명시적 팀장이 없는 경우 (leaderId 미지정) — 본부장/임원이 1차 대행 */
export function teamHasNoLead(goal: Goal, allOrgs: Organization[]): boolean {
  if (!goal.organizationId) return false;
  const chain = getOrgChain(goal.organizationId, allOrgs);
  const teamOrg = chain.find(o => o.type === 'TEAM');
  return !!teamOrg && !teamOrg.leaderId;
}

export type ApprovalRole = 'TEAM_LEAD' | 'HQ_HEAD' | 'EXEC';

/** 현재 사용자가 특정 목표의 결재 체인에서 담당하는 역할을 결정 */
export function getMyApprovalRole(
  goal: Goal,
  allOrgs: Organization[],
  userId: string,
  userRole: string,
  myOrg?: Organization | null,
): ApprovalRole | null {
  if (!goal?.organizationId) return null;
  const chain = getOrgChain(goal.organizationId, allOrgs);
  const teamOrg = chain.find(o => o.type === 'TEAM');
  const hqOrg   = chain.find(o => o.type === 'HEADQUARTERS');
  const divOrg  = chain.find(o => o.type === 'DIVISION');

  if (teamOrg?.leaderId === userId) return 'TEAM_LEAD';
  if (divOrg?.leaderId === userId) return 'EXEC';
  if (hqOrg?.leaderId === userId) return divOrg ? 'HQ_HEAD' : 'EXEC';

  // leaderId 미설정 환경 fallback — CEO 는 인사평가 결재 라인에 참여하지 않음
  if (userRole === 'EXECUTIVE') {
    // 본부장(EXECUTIVE) 인데 상위에 DIVISION 있으면 → HQ_HEAD (2차 의견만, 최종 X)
    if (myOrg?.type === 'HEADQUARTERS' && divOrg && hqOrg?.id === myOrg.id) {
      return 'HQ_HEAD';
    }
    return 'EXEC';
  }
  if (myOrg && userRole === 'TEAM_LEAD') {
    if (myOrg.type === 'DIVISION') return 'EXEC';
    if (myOrg.type === 'HEADQUARTERS' && hqOrg?.id === myOrg.id) {
      return divOrg ? 'HQ_HEAD' : 'EXEC';
    }
    if (myOrg.type === 'TEAM' && teamOrg?.id === myOrg.id) return 'TEAM_LEAD';
  }
  return null;
}

/**
 * 사용자가 처리해야 할 목표(목표 승인 + 완료 확인 + 포기 요청) 모두 합산.
 * approvals 페이지와 동일한 필터를 한 곳에서 처리.
 */
export function filterMyActionableGoals(
  goals: Goal[],
  allOrgs: Organization[],
  usersMap: Record<string, User>,
  currentUserId: string,
  currentUserRole: string,
): Goal[] {
  const myOrg = allOrgs.find(o => o.id === usersMap[currentUserId]?.organizationId);

  return goals.filter(g => {
    if (g.userId === currentUserId) return false;
    const role = getMyApprovalRole(g, allOrgs, currentUserId, currentUserRole, myOrg);
    if (!role) return false;
    const ownerRole = usersMap[g.userId]?.role;
    const isSubordinate = ownerRole !== 'TEAM_LEAD' && ownerRole !== 'EXECUTIVE' && ownerRole !== 'CEO';
    const ownerOrg = allOrgs.find(o => o.id === g.organizationId);
    const ownerOrgIsHQ = ownerOrg?.type === 'HEADQUARTERS';
    const noTeamLead = teamHasNoLead(g, allOrgs);
    const goalHasHQ = hasHQInChain(g, allOrgs);

    // ── 신규 목표 승인 ────────────────────────────────────
    if (g.status === 'PENDING_APPROVAL') {
      if (role === 'TEAM_LEAD' && isSubordinate) return true;
      if (role === 'HQ_HEAD') {
        if (ownerRole === 'TEAM_LEAD') return true; // 팀장 신규 목표 본부 1차
        if (isSubordinate && noTeamLead) return true; // 팀장 부재 시 본부장 대행
      }
      if (role === 'EXEC') {
        if (ownerRole === 'TEAM_LEAD' && !goalHasHQ) return true;
        if (ownerRole === 'TEAM_LEAD' && ownerOrgIsHQ) return true; // 본부장 본인 목표
        if (ownerRole === 'EXECUTIVE') return true; // 임원 role 본부장 본인 목표
        if (isSubordinate && noTeamLead && !goalHasHQ) return true;
      }
    }

    // ── 신규 목표 본부장 2차 / 임원 최종 ──────────────────
    if (g.status === 'LEAD_APPROVED') {
      if (role === 'HQ_HEAD' && !g.hqApprovedBy) return true;
      if (role === 'EXEC') {
        if (!goalHasHQ) return true;
        if (g.hqApprovedBy) return true;
      }
    }

    // ── 완료 확인 요청 ────────────────────────────────────
    if (g.status === 'COMPLETED') {
      if (role === 'TEAM_LEAD' && isSubordinate && !g.completionLeadApprovedBy) return true;
      if (role === 'HQ_HEAD') {
        if (isSubordinate && !!g.completionLeadApprovedBy && !g.completionHqApprovedBy) return true;
        if (ownerRole === 'TEAM_LEAD' && !g.completionHqApprovedBy) return true;
        if (isSubordinate && !g.completionLeadApprovedBy && !g.completionHqApprovedBy && noTeamLead) return true;
      }
      if (role === 'EXEC' && !g.completionExecApprovedBy) {
        if (ownerRole === 'TEAM_LEAD') {
          if (!goalHasHQ) return true;
          if (g.completionHqApprovedBy) return true;
          if (ownerOrgIsHQ) return true; // 본부장 본인 목표
        }
        if (ownerRole === 'EXECUTIVE') return true;
        if (isSubordinate && !!g.completionLeadApprovedBy) {
          if (!goalHasHQ) return true;
          if (g.completionHqApprovedBy) return true;
        }
      }
    }

    // ── 포기 요청 ─────────────────────────────────────────
    if (g.status === 'PENDING_ABANDON') {
      if (role === 'TEAM_LEAD' && isSubordinate && !g.abandonLeadApprovedBy) return true;
      if (role === 'HQ_HEAD' && isSubordinate && !g.abandonLeadApprovedBy && noTeamLead) return true;
      if (role === 'EXEC') {
        if (ownerRole === 'TEAM_LEAD') return true;
        if (ownerRole === 'EXECUTIVE') return true;
        if (isSubordinate && !!g.abandonLeadApprovedBy) return true;
        if (isSubordinate && !g.abandonLeadApprovedBy && noTeamLead && !goalHasHQ) return true;
      }
    }

    return false;
  });
}
