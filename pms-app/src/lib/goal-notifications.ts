// 핵심목표 결재 체인 알림 통합 헬퍼.
// approval-filters.ts 의 buildApprovalChain / currentPendingStageIdx 를 사용해
// "다음 단계 담당자" 를 일관되게 결정한다.
//
// 사용처:
//  - 신규 상신 / 재상신 / 책임자 변경 후 재상신 (TaskGoalForm)
//  - 승인 요청 / 완료 요청 / 포기 요청 (GoalDetailClient)
//  - 결재 승인 후 다음 단계 알림 (GoalDetailClient.approveGoal)
//
// leaderId 미지정 환경에서는 해당 조직 소속 TEAM_LEAD/EXECUTIVE 로 fallback.
// 본인(fromUser)·owner 가 다음 단계인 경우 skip.

import type { Goal, Organization, User } from '@/types';
import {
  buildApprovalChain,
  currentPendingStageIdx,
  stageLabel,
} from './approval-filters';
import { createNotification } from './firestore';

export type GoalNotifyAction =
  | 'SUBMIT'              // 신규 상신 / 재상신
  | 'APPROVE'             // 결재 승인 후 다음 단계
  | 'REQUEST_COMPLETION'  // 완료 요청
  | 'APPROVE_COMPLETION'  // 완료 결재 승인 후 다음 단계
  | 'REQUEST_ABANDON'     // 포기 요청
  | 'APPROVE_ABANDON';    // 포기 결재 승인 후 다음 단계

export interface NotifyNextApproverParams {
  /** 알림 발송 기준이 되는 목표 상태. 결재 단계 변경 직후에는 새 상태/필드를 반영한 객체를 전달할 것 */
  goal: Goal;
  allOrgs: Organization[];
  allUsers: User[];
  fromUserId: string;
  fromUserName: string;
  action: GoalNotifyAction;
  /** 알림 메시지에 표시할 owner 이름 강제 지정 (책임자 변경 시 "기존 책임자" 명의로 표기) */
  ownerNameOverride?: string;
}

export interface NotifyResult {
  notified: boolean;
  targetUserId: string | null;
  reason:
    | 'sent'
    | 'no_pending_stage'
    | 'no_target'
    | 'self'
    | 'owner_is_target'
    | 'error';
}

/**
 * 결재 체인 다음 단계 담당자에게 알림 발송.
 * 호출자는 goal 객체에 "변경 직후" 상태를 반영해서 넘겨야 한다.
 *
 * 예: 완료 요청 직후 → goal.status = 'COMPLETED'
 * 예: 팀장 1차 승인 직후 → goal.status = 'LEAD_APPROVED', goal.leadApprovedBy = me
 */
export async function notifyNextApprover(
  params: NotifyNextApproverParams,
): Promise<NotifyResult> {
  const { goal, allOrgs, allUsers, fromUserId, fromUserName, action, ownerNameOverride } = params;

  try {
    const owner = allUsers.find(u => u.id === goal.userId);
    const ownerRole = owner?.role;
    const ownerName = ownerNameOverride ?? owner?.name ?? fromUserName;
    const chain = buildApprovalChain(goal, allOrgs, ownerRole);
    const pendingIdx = currentPendingStageIdx(goal, chain);

    if (pendingIdx < 0 || pendingIdx >= chain.length) {
      console.log(`[알림] no_pending_stage (goal=${goal.id}, status=${goal.status})`);
      return { notified: false, targetUserId: null, reason: 'no_pending_stage' };
    }

    const stage = chain[pendingIdx];
    let targetUserId = stage.userId ?? null;

    // leaderId 미지정 fallback: 해당 조직 소속 TEAM_LEAD/EXECUTIVE (owner 제외)
    if (!targetUserId) {
      const cand = allUsers.find(u =>
        u.organizationId === stage.orgId &&
        (u.role === 'TEAM_LEAD' || u.role === 'EXECUTIVE') &&
        u.isActive !== false &&
        u.id !== goal.userId,
      );
      targetUserId = cand?.id ?? null;
    }

    if (!targetUserId) {
      console.warn(`[알림] no_target (stage=${stage.role}, orgId=${stage.orgId}, goal=${goal.id})`);
      return { notified: false, targetUserId: null, reason: 'no_target' };
    }
    if (targetUserId === fromUserId) {
      console.log(`[알림] self skip (goal=${goal.id}, stage=${stage.role})`);
      return { notified: false, targetUserId, reason: 'self' };
    }
    if (targetUserId === goal.userId) {
      console.log(`[알림] owner_is_target skip (goal=${goal.id}, stage=${stage.role})`);
      return { notified: false, targetUserId, reason: 'owner_is_target' };
    }

    const stageLbl = stageLabel(stage.role);
    let message = '';
    let type: 'GOAL_SUBMITTED' | 'COMPLETION_REQUESTED' | 'ABANDON_REQUESTED' = 'GOAL_SUBMITTED';

    switch (action) {
      case 'SUBMIT':
        message = `${ownerName}님이 '${goal.title}' 핵심목표 ${stageLbl} 승인을 요청했습니다.`;
        type = 'GOAL_SUBMITTED';
        break;
      case 'APPROVE':
        message = `${ownerName}님의 '${goal.title}' 핵심목표 ${stageLbl} 승인이 필요합니다.`;
        type = 'GOAL_SUBMITTED';
        break;
      case 'REQUEST_COMPLETION':
        message = `${ownerName}님이 '${goal.title}' 핵심목표 완료를 요청했습니다. ${stageLbl} 확인이 필요합니다.`;
        type = 'COMPLETION_REQUESTED';
        break;
      case 'APPROVE_COMPLETION':
        message = `${ownerName}님의 '${goal.title}' 핵심목표 완료 ${stageLbl} 확인이 필요합니다.`;
        type = 'COMPLETION_REQUESTED';
        break;
      case 'REQUEST_ABANDON':
        message = `${ownerName}님이 '${goal.title}' 핵심목표 포기를 요청했습니다. ${stageLbl} 승인이 필요합니다.`;
        type = 'ABANDON_REQUESTED';
        break;
      case 'APPROVE_ABANDON':
        message = `${ownerName}님의 '${goal.title}' 핵심목표 포기 ${stageLbl} 승인이 필요합니다.`;
        type = 'ABANDON_REQUESTED';
        break;
    }

    await createNotification({
      userId: targetUserId,
      goalId: goal.id,
      goalTitle: goal.title,
      type,
      message,
      read: false,
    });

    console.log(`[알림] ${action} → ${stageLbl}(${targetUserId}) 발송 완료 (goal=${goal.id})`);
    return { notified: true, targetUserId, reason: 'sent' };
  } catch (err) {
    console.error('[알림] notifyNextApprover 실패:', err);
    return { notified: false, targetUserId: null, reason: 'error' };
  }
}
