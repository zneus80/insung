// 인사평가 / 육성면담서 라인 알림 헬퍼.
// 평가 대상자(subject) 의 조직 체인을 따라 다음 검토자를 찾고 알림을 발송한다.
//
// 평가 라인 (목표 결재 체인과 동일한 골격):
//   팀원(MEMBER)      → 팀장 → (본부장) → 임원
//   팀장(TEAM_LEAD)   → (본부장) → 임원        (본인이 책임자인 팀장 단계 스킵)
//   본부장(HQ 직속)   → 임원                   (본부장 단계 스킵)
//
// stage 매개변수:
//   'LEAD'  : 팀장 검토 요청 (자기평가/육성면담서 제출 직후, 또는 본부장이 팀장 평가 시)
//   'HQ'    : 본부장 검토 요청 (팀장 1차 의견 제출 후)
//   'EXEC'  : 임원 등급 확정 요청 (본부장 2차 의견 제출 후, 또는 HQ 단계 미존재 시)

import type { Organization, User, NotificationType, NotificationCategory } from '@/types';
import { createNotification } from './firestore';

export type EvalStage = 'LEAD' | 'HQ' | 'EXEC';

/** subject 의 조직 체인을 거슬러 올라가며 type 별 조직을 수집. */
function getOrgChain(orgId: string | undefined, allOrgs: Organization[]): Organization[] {
  const chain: Organization[] = [];
  let cur = orgId ? allOrgs.find(o => o.id === orgId) : undefined;
  while (cur) {
    chain.push(cur);
    cur = cur.parentId ? allOrgs.find(o => o.id === cur!.parentId) : undefined;
  }
  return chain;
}

/**
 * subject 의 다음 검토 단계 담당자 결정.
 * - 우선순위 1: 해당 조직의 leaderId
 * - 우선순위 2: 해당 조직 소속 TEAM_LEAD/EXECUTIVE (subject 제외)
 * 반환 null = 해당 단계가 체인에 없거나 적격자가 없음 (알림 스킵)
 */
export function findEvalReviewer(
  subject: User,
  stage: EvalStage,
  allOrgs: Organization[],
  allUsers: User[],
): { userId: string; orgId: string } | null {
  const chain = getOrgChain(subject.organizationId, allOrgs);
  const teamOrg = chain.find(o => o.type === 'TEAM');
  const hqOrg = chain.find(o => o.type === 'HEADQUARTERS');
  const divOrg = chain.find(o => o.type === 'DIVISION');

  let targetOrg: Organization | undefined;
  let roleFallback: string[] = [];

  if (stage === 'LEAD') {
    // 팀장: subject 가 팀원일 때만. subject 가 팀장이면 본인이 팀장 단계 → 스킵
    if (subject.role !== 'MEMBER') return null;
    targetOrg = teamOrg;
    roleFallback = ['TEAM_LEAD'];
  } else if (stage === 'HQ') {
    // 본부장: HQ + DIV 둘 다 있고 subject 가 본부 직속이 아닐 때
    const ownerOrg = allOrgs.find(o => o.id === subject.organizationId);
    if (!hqOrg || !divOrg || ownerOrg?.type === 'HEADQUARTERS') return null;
    targetOrg = hqOrg;
    roleFallback = ['TEAM_LEAD', 'EXECUTIVE'];
  } else {
    // 임원: DIV 가 최종, 없으면 HQ leader
    targetOrg = divOrg ?? (hqOrg && allOrgs.find(o => o.id === subject.organizationId)?.type !== 'HEADQUARTERS' ? hqOrg : undefined);
    roleFallback = ['EXECUTIVE'];
  }

  if (!targetOrg) return null;

  // 우선순위 1: leaderId
  if (targetOrg.leaderId && targetOrg.leaderId !== subject.id) {
    return { userId: targetOrg.leaderId, orgId: targetOrg.id };
  }
  // 우선순위 2: 조직 소속 적격자
  const cand = allUsers.find(u =>
    u.organizationId === targetOrg!.id &&
    roleFallback.includes(u.role) &&
    u.isActive !== false &&
    u.id !== subject.id,
  );
  if (cand) return { userId: cand.id, orgId: targetOrg.id };
  return null;
}

export interface NotifyEvalParams {
  subject: User;
  fromUserId: string;
  fromUserName: string;
  stage: EvalStage;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  link: string;
  allOrgs: Organization[];
  allUsers: User[];
}

/** 평가 라인 다음 검토자에게 알림 발송. 본인·subject 가 타깃이면 스킵. */
export async function notifyEvalReviewer(p: NotifyEvalParams): Promise<{ notified: boolean; targetUserId: string | null }> {
  try {
    const target = findEvalReviewer(p.subject, p.stage, p.allOrgs, p.allUsers);
    if (!target) {
      console.log(`[평가알림] stage=${p.stage} 타깃 없음 (subject=${p.subject.id})`);
      return { notified: false, targetUserId: null };
    }
    if (target.userId === p.fromUserId) {
      console.log(`[평가알림] self skip (target=${target.userId})`);
      return { notified: false, targetUserId: target.userId };
    }
    await createNotification({
      userId: target.userId,
      type: p.type,
      category: p.category,
      title: p.title,
      message: p.message,
      link: p.link,
      read: false,
    });
    console.log(`[평가알림] stage=${p.stage} → ${target.userId} 발송 완료`);
    return { notified: true, targetUserId: target.userId };
  } catch (err) {
    console.error('[평가알림] 실패:', err);
    return { notified: false, targetUserId: null };
  }
}
