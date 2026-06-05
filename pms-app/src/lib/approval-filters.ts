// 승인대기 관련 공유 필터 로직
// 대시보드 카운트와 사이드바 승인대기함 표시가 항상 일치하도록 한 곳에서 관리한다.

import type { Goal, Organization, User } from '@/types';

/**
 * Organization 정렬 비교자.
 *  - displayOrder 가 있는 항목 우선 (오름차순)
 *  - 둘 다 있으면 작은 값 먼저, 같으면 이름 가나다순
 *  - 모두 없으면 이름 가나다순
 * 부문/공장(DIVISION) 표시 순서 제어에 활용.
 */
export function compareOrgByDisplayOrder(a: Organization, b: Organization): number {
  const ao = a.displayOrder;
  const bo = b.displayOrder;
  const aHas = typeof ao === 'number' && !Number.isNaN(ao);
  const bHas = typeof bo === 'number' && !Number.isNaN(bo);
  if (aHas && bHas) {
    if (ao !== bo) return (ao as number) - (bo as number);
    return a.name.localeCompare(b.name, 'ko');
  }
  if (aHas) return -1;
  if (bHas) return 1;
  return a.name.localeCompare(b.name, 'ko');
}

/** orgId 기준으로 자신 + 모든 하위 조직 ID 반환 */
export function getDescendantOrgIds(orgId: string, orgs: Organization[]): string[] {
  const result: string[] = [orgId];
  for (const child of orgs.filter(o => o.parentId === orgId)) {
    result.push(...getDescendantOrgIds(child.id, orgs));
  }
  return result;
}

/**
 * 사용자의 스코프 조직 ID 합집합 — 다중 팀·본부·부문 leader 케이스 지원.
 *  - EXECUTIVE/CEO: 본인이 leaderId 인 조직만 → descendants 합집합 (home org 무시; CLAUDE.md §6-1 가시성 원칙)
 *  - TEAM_LEAD/MEMBER 등: home org descendants ∪ 본인이 leaderId 인 조직 descendants
 *  - HR 관리자는 별도 — 호출자가 전사 스코프를 요구하면 직접 처리할 것 (이 헬퍼는 본인 권한 스코프용)
 */
export function getMyScopeOrgIds(
  userId: string,
  userRole: string,
  userOrgId: string | undefined,
  allOrgsRaw: Organization[],
): string[] {
  // 보관(soft-archive)된 조직은 운영 스코프에서 제외 — 임원·팀장 화면에 폐조직이 새지 않도록.
  // (보관 조직은 항상 leaf 이므로 트리 체인 손상 없음)
  const allOrgs = allOrgsRaw.filter(o => !o.archivedAt);
  const led = allOrgs
    .filter(o => o.leaderId === userId)
    .flatMap(o => getDescendantOrgIds(o.id, allOrgs));
  if (userRole === 'EXECUTIVE' || userRole === 'CEO') {
    return Array.from(new Set(led));
  }
  const own = userOrgId ? getDescendantOrgIds(userOrgId, allOrgs) : [];
  return Array.from(new Set([...own, ...led]));
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

/** 결재 체인 단계 정보 */
export interface ApprovalStage {
  role: ApprovalRole;
  orgId: string;
  orgName: string;
  userId?: string;  // 해당 단계 책임자 (leaderId)
}

/**
 * 결재 체인 (단계 순서대로). 오너 본인이 차지하는 단계는 자동 제외.
 *  - 팀원 목표: [팀장, (본부장), 임원]
 *  - 팀장 목표: [(본부장), 임원]  ← 팀 = 본인 책임이라 팀장 단계 스킵
 *  - 본부장(HQ 직속) 목표: [임원]   ← HQ 단계 스킵
 */
export function buildApprovalChain(
  goal: Goal,
  allOrgs: Organization[],
  ownerRole: string | undefined,
): ApprovalStage[] {
  const chain = getOrgChain(goal.organizationId, allOrgs);
  const teamOrg = chain.find(o => o.type === 'TEAM');
  const hqOrg = chain.find(o => o.type === 'HEADQUARTERS');
  const divOrg = chain.find(o => o.type === 'DIVISION');
  const stages: ApprovalStage[] = [];

  const isOwnerTL = ownerRole === 'TEAM_LEAD';
  const isOwnerExec = ownerRole === 'EXECUTIVE';
  const ownerOrg = allOrgs.find(o => o.id === goal.organizationId);
  const ownerIsHQDirect = ownerOrg?.type === 'HEADQUARTERS'; // 본부장 본인 목표

  // ① 팀장 단계 — 오너가 팀원(=일반)일 때만
  if (teamOrg && !isOwnerTL && !isOwnerExec) {
    stages.push({ role: 'TEAM_LEAD', orgId: teamOrg.id, orgName: teamOrg.name, userId: teamOrg.leaderId ?? undefined });
  }
  // ② 본부장 단계 — HQ + DIV 모두 있고, 오너가 본부장 본인(HQ 직속)이 아닐 때
  if (hqOrg && divOrg && !ownerIsHQDirect) {
    stages.push({ role: 'HQ_HEAD', orgId: hqOrg.id, orgName: hqOrg.name, userId: hqOrg.leaderId ?? undefined });
  }
  // ③ 임원 단계 — DIV 가 최종, 없으면 HQ 가 최종 (본부장 본인 목표 제외)
  if (divOrg) {
    stages.push({ role: 'EXEC', orgId: divOrg.id, orgName: divOrg.name, userId: divOrg.leaderId ?? undefined });
  } else if (hqOrg && !ownerIsHQDirect) {
    stages.push({ role: 'EXEC', orgId: hqOrg.id, orgName: hqOrg.name, userId: hqOrg.leaderId ?? undefined });
  }
  return stages;
}

/** 현재 처리 대기 중인 stage index (없으면 -1) */
export function currentPendingStageIdx(goal: Goal, chain: ApprovalStage[]): number {
  if (chain.length === 0) return -1;
  if (goal.status === 'PENDING_APPROVAL') {
    // 첫 단계
    return 0;
  }
  if (goal.status === 'LEAD_APPROVED') {
    const hqIdx = chain.findIndex(s => s.role === 'HQ_HEAD');
    if (hqIdx >= 0 && !goal.hqApprovedBy) return hqIdx;
    const execIdx = chain.findIndex(s => s.role === 'EXEC');
    if (execIdx >= 0) return execIdx;
    return -1;
  }
  if (goal.status === 'COMPLETED') {
    const tlIdx = chain.findIndex(s => s.role === 'TEAM_LEAD');
    if (tlIdx >= 0 && !goal.completionLeadApprovedBy) return tlIdx;
    const hqIdx = chain.findIndex(s => s.role === 'HQ_HEAD');
    if (hqIdx >= 0 && !goal.completionHqApprovedBy) return hqIdx;
    const execIdx = chain.findIndex(s => s.role === 'EXEC');
    if (execIdx >= 0 && !goal.completionExecApprovedBy) return execIdx;
    return -1;
  }
  if (goal.status === 'PENDING_ABANDON') {
    const tlIdx = chain.findIndex(s => s.role === 'TEAM_LEAD');
    if (tlIdx >= 0 && !goal.abandonLeadApprovedBy) return tlIdx;
    const hqIdx = chain.findIndex(s => s.role === 'HQ_HEAD');
    if (hqIdx >= 0) return hqIdx;
    const execIdx = chain.findIndex(s => s.role === 'EXEC');
    if (execIdx >= 0) return execIdx;
  }
  return -1;
}

/** 내가 체인에서 어느 stage 에 해당하는지 (-1: 미해당)
 *
 * 매칭 규칙:
 *  ① stage 의 leaderId === 본인 → 정식 책임자 (확정 권한)
 *  ② leaderId 미지정 + 같은 조직 소속 + role 매치 → fallback (leaderId 운영 미정 환경)
 *  ③ leaderId 명시되어 있지만 본인이 같은 조직 EXECUTIVE → 차순위 임원 (목표 승인 권한)
 *     CLAUDE.md §2 케이스 B "동일 조직 임원 복수 배치" 의 부공장장·부부문장·부본부장.
 *     주의: 목표 승인은 가능하나 평가 등급 확정은 별도 UI 로직에서 EXEC_TOP 만 허용해야 함.
 */
export function myStageIdxIn(
  chain: ApprovalStage[],
  myUserId: string,
  myRole: string,
  myOrgId: string | undefined,
): number {
  for (let i = 0; i < chain.length; i++) {
    const st = chain[i];
    // ① 정식 책임자
    if (st.userId === myUserId) return i;
    // ② leaderId 미지정 fallback
    if (!st.userId && myOrgId) {
      if (st.role === 'TEAM_LEAD' && myRole === 'TEAM_LEAD' && st.orgId === myOrgId) return i;
      if (st.role === 'HQ_HEAD' && (myRole === 'TEAM_LEAD' || myRole === 'EXECUTIVE') && st.orgId === myOrgId) return i;
      if (st.role === 'EXEC' && myRole === 'EXECUTIVE') return i;
    }
    // ③ 차순위 책임자 — 같은 조직 EXECUTIVE 면 목표 승인 인정
    //    (정식 leader 가 다른 사람이지만 같은 조직 소속 EXEC = 부공장장·부부문장·부본부장)
    if (st.userId && st.userId !== myUserId && st.orgId === myOrgId && myRole === 'EXECUTIVE') {
      if (st.role === 'EXEC' || st.role === 'HQ_HEAD') return i;
    }
  }
  return -1;
}

/**
 * 사용자의 "유효 평가 권한" — 조직 체인 기반(leaderId)으로 동적 결정.
 *
 * CLAUDE.md §2 임원 권한 케이스에 따른 핵심 원칙:
 *   - 임원 역할 구분은 계정 단위가 아닌 조직 배정 단위로 관리
 *   - 동일 인물이 조직 A에서는 최상위 임원, 조직 B에서는 차순위 임원이 될 수 있음
 *
 * 반환 값:
 *   - 'EXEC_TOP'  : 부문/공장(DIVISION) leader, 또는 상위에 DIVISION 이 없는 최상위 HQ leader
 *                   → 평가등급확정·조직평가관리·최종 확정 권한
 *   - 'HQ_HEAD'   : DIVISION 산하 본부(HEADQUARTERS) leader (= 차순위 임원/본부장)
 *                   → 2차 의견(hqGrade) 권한만, 등급 확정 불가
 *   - 'TEAM_LEAD' : 팀(TEAM) leader
 *                   → 1차 의견(leadGrade) 권한
 *   - 'MEMBER'    : 그 외 일반 팀원
 *
 * 우선순위: 본인이 leader 인 조직 중 가장 상위 type 으로 판단.
 *   (예: 동일 인물이 TEAM + HQ 모두 leader → HQ_HEAD)
 */
/**
 * 유효 평가 권한 (조직 체인 + role 기반).
 *
 *  - 'EXEC_TOP'  : 부문/공장(DIVISION) leader, 또는 상위에 DIVISION 이 없는 최상위 HQ leader.
 *                  → 평가등급 확정 권한 (CLAUDE.md §2 케이스 B 최상위 임원).
 *  - 'EXEC_SUB'  : DIVISION 소속 EXECUTIVE 인데 leader 아닌 경우 (부공장장·부부문장).
 *                  → CLAUDE.md §2 케이스 B 차순위 임원. 산하 read·의견 가능, 확정 불가.
 *  - 'HQ_HEAD'   : HQ leader (DIVISION 산하) 또는 HQ 소속 비-leader EXECUTIVE (본부장·부본부장).
 *                  → 산하 read·의견 가능, 확정 불가.
 *  - 'TEAM_LEAD' : TEAM leader.
 *                  → 1차 의견(leadGrade) 권한.
 *  - 'MEMBER'    : 그 외 일반 팀원.
 *
 * 우선순위: 본인이 leader 인 조직 중 가장 상위 type → leader 아닌 EXECUTIVE → ...
 */
export type EffectiveEvalRole = 'EXEC_TOP' | 'EXEC_SUB' | 'HQ_HEAD' | 'TEAM_LEAD' | 'MEMBER';

export function getEffectiveEvalRole(
  userId: string,
  userRole: string,
  userOrgId: string | undefined,
  allOrgs: Organization[],
): EffectiveEvalRole {
  const myLedOrgs = allOrgs.filter(o => o.leaderId === userId);

  // 부모 체인에서 DIVISION 이 있는지 확인하는 헬퍼
  function hasDivisionAncestor(org: Organization): boolean {
    let cur = org.parentId ? allOrgs.find(o => o.id === org.parentId) : null;
    while (cur) {
      if (cur.type === 'DIVISION') return true;
      cur = cur.parentId ? allOrgs.find(o => o.id === cur!.parentId) : null;
    }
    return false;
  }

  // ① DIVISION leader → 최상위 임원
  if (myLedOrgs.some(o => o.type === 'DIVISION')) return 'EXEC_TOP';

  // ② HQ leader — 상위에 DIVISION 없으면 최상위, 있으면 차순위(본부장)
  const myLedHQs = myLedOrgs.filter(o => o.type === 'HEADQUARTERS');
  if (myLedHQs.length > 0) {
    const isTopLevelHQ = myLedHQs.some(o => !hasDivisionAncestor(o));
    if (isTopLevelHQ) return 'EXEC_TOP';
    return 'HQ_HEAD';
  }

  // ③ TEAM leader → 팀장
  if (myLedOrgs.some(o => o.type === 'TEAM')) return 'TEAM_LEAD';

  // ④ leadership 없음 → 본인 소속 조직 + 선언 role 기반 fallback (leaderId 미설정 환경)
  //    + CLAUDE.md §2 케이스 B (같은 조직 복수 임원 중 비-leader = 차순위)
  const myOrg = userOrgId ? allOrgs.find(o => o.id === userOrgId) : undefined;
  if (userRole === 'EXECUTIVE') {
    // HQ 소속 EXECUTIVE — 본부장 (산하 read 가능, 확정 불가)
    if (myOrg?.type === 'HEADQUARTERS' && hasDivisionAncestor(myOrg)) return 'HQ_HEAD';
    if (myOrg?.type === 'HEADQUARTERS') return 'HQ_HEAD'; // 최상위 HQ + 비-leader = 차순위 본부장
    // DIVISION 소속 EXECUTIVE — 부부문장·부공장장 (차순위)
    if (myOrg?.type === 'DIVISION') return 'EXEC_SUB';
    // 그 외 (COMPANY 직속 등) — 최상위 임원
    return 'EXEC_TOP';
  }
  if (userRole === 'TEAM_LEAD') return 'TEAM_LEAD';
  return 'MEMBER';
}

/** 단계 라벨 (UI용) */
/**
 * 승인자의 표시 라벨 — 본인 직책(position) 우선, 없으면 fallback.
 *
 * 예) 사용자 position = "기획본부장" → "기획본부장 1차 승인"
 *     position 없음 + role=HQ_HEAD → "본부장 1차 승인" (fallback)
 *     position = "부공장장" → "부공장장 의견"
 */
export function approverTitle(
  userId: string | null | undefined,
  allUsers: User[] | undefined,
  fallback: string,
): string {
  if (userId && allUsers) {
    const u = allUsers.find(x => x.id === userId);
    if (u?.position) return u.position;
  }
  return fallback;
}

/** stage role 의 기본 라벨 — 직책 모르는 경우 fallback. */
export function stageLabel(role: ApprovalRole): string {
  return role === 'TEAM_LEAD' ? '팀장' : role === 'HQ_HEAD' ? '본부장' : '임원';
}

/**
 * 상신자(=변경 행위자)가 새 수행자의 결재 체인에 포함되는 경우,
 * 그 단계까지 자동 승인된 결재 필드/상태를 계산한다.
 * 셀프 승인 방지(예: 팀장 본인이 본인 팀 팀원에게 수행자 재지정 시 팀장 단계 자동 처리).
 *
 * 동작:
 *  - submitter 가 체인에 없음 → { status:'PENDING_APPROVAL', fields:{} } 반환
 *  - submitter 의 단계가 TEAM_LEAD → leadApprovedBy 채움, status='LEAD_APPROVED'
 *  - submitter 의 단계가 HQ_HEAD  → hqApprovedBy 채움, status='LEAD_APPROVED'
 *      (leadApprovedBy 는 비워둠 — LEAD_APPROVED 상태에서 hqApprovedBy 가 있으면 currentPendingStageIdx 가
 *       자동으로 EXEC 단계로 진행시키므로 정상 동작)
 *  - submitter 의 단계가 EXEC     → approvedBy 채움, status='APPROVED'
 */
export function computeSubmitterAutoApproval(params: {
  newOwnerOrgId: string;
  newOwnerRole: string | undefined;
  allOrgs: Organization[];
  submitterId: string;
  submitterRole: string;
  submitterOrgId: string | undefined;
}): {
  status: 'PENDING_APPROVAL' | 'LEAD_APPROVED' | 'APPROVED';
  fields: {
    leadApprovedBy?: string;
    leadApprovedAt?: Date;
    hqApprovedBy?: string;
    hqApprovedAt?: Date;
    approvedBy?: string;
    approvedAt?: Date;
  };
  stageRole: ApprovalRole | null;
} {
  // 새 수행자 기준 결재 체인 합성용 Goal (organizationId 만 필요)
  const synthetic = { organizationId: params.newOwnerOrgId } as unknown as Goal;
  const chain = buildApprovalChain(synthetic, params.allOrgs, params.newOwnerRole);
  const idx = myStageIdxIn(chain, params.submitterId, params.submitterRole, params.submitterOrgId);

  if (idx < 0 || idx >= chain.length) {
    return { status: 'PENDING_APPROVAL', fields: {}, stageRole: null };
  }

  const st = chain[idx];
  const now = new Date();

  if (st.role === 'TEAM_LEAD') {
    return {
      status: 'LEAD_APPROVED',
      fields: { leadApprovedBy: params.submitterId, leadApprovedAt: now },
      stageRole: 'TEAM_LEAD',
    };
  }
  if (st.role === 'HQ_HEAD') {
    return {
      status: 'LEAD_APPROVED',
      fields: { hqApprovedBy: params.submitterId, hqApprovedAt: now },
      stageRole: 'HQ_HEAD',
    };
  }
  // EXEC
  return {
    status: 'APPROVED',
    fields: { approvedBy: params.submitterId, approvedAt: now },
    stageRole: 'EXEC',
  };
}

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
 * 사용자가 처리해야 할 목표(또는 상위 단계 모니터링용) 목록.
 * 본인 단계가 현재 처리 stage 이상이면 모두 포함 — 상위 단계자는 "검토 중" 표시로 활용.
 * 본인이 owner 인 목표는 제외.
 */
export function filterMyActionableGoals(
  goals: Goal[],
  allOrgs: Organization[],
  usersMap: Record<string, User>,
  currentUserId: string,
  currentUserRole: string,
): Goal[] {
  const myOrgId = usersMap[currentUserId]?.organizationId;
  return goals.filter(g => {
    if (g.userId === currentUserId) return false;
    const ownerRole = usersMap[g.userId]?.role;
    const chain = buildApprovalChain(g, allOrgs, ownerRole);
    const currentIdx = currentPendingStageIdx(g, chain);
    if (currentIdx < 0) return false;  // 처리할 단계 없음
    const myIdx = myStageIdxIn(chain, currentUserId, currentUserRole, myOrgId);
    if (myIdx < 0) return false;  // 체인 미포함
    return myIdx >= currentIdx;  // 현재 단계자 + 상위 단계자(모니터링) 포함
  });
}

/**
 * 특정 목표에 대해 사용자가 "이번 단계 처리자(active)" 인지, "상위 단계자(검토 중 표시용)" 인지 판정.
 */
export function getApprovalRowState(
  goal: Goal,
  allOrgs: Organization[],
  usersMap: Record<string, User>,
  currentUserId: string,
  currentUserRole: string,
): {
  state: 'NEXT' | 'UPSTREAM' | 'NONE';
  myStage?: ApprovalStage;
  pendingStage?: ApprovalStage;
} {
  if (goal.userId === currentUserId) return { state: 'NONE' };
  const ownerRole = usersMap[goal.userId]?.role;
  const chain = buildApprovalChain(goal, allOrgs, ownerRole);
  const currentIdx = currentPendingStageIdx(goal, chain);
  if (currentIdx < 0) return { state: 'NONE' };
  const myOrgId = usersMap[currentUserId]?.organizationId;
  const myIdx = myStageIdxIn(chain, currentUserId, currentUserRole, myOrgId);
  if (myIdx < 0) return { state: 'NONE' };
  if (myIdx === currentIdx) return { state: 'NEXT', myStage: chain[myIdx], pendingStage: chain[currentIdx] };
  if (myIdx > currentIdx) return { state: 'UPSTREAM', myStage: chain[myIdx], pendingStage: chain[currentIdx] };
  return { state: 'NONE' };
}
