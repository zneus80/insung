// 핵심목표 결재 체인 알림 통합 헬퍼.
// approval-filters.ts 의 buildApprovalChain / currentPendingStageIdx 를 사용해
// "다음 단계 담당자" 를 일관되게 결정한다.
//
// 사용처:
//  - 신규 상신 / 재상신 / 수행자 변경 후 재상신 (TaskGoalForm)
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

/** Broadcast 이벤트 — 결재 체인 전원에게 동일 알림 */
export type GoalBroadcastEvent =
  | 'SUBMITTED'             // 신규 상신
  | 'LEAD_APPROVED'         // 팀장 1차 승인
  | 'HQ_APPROVED'           // 본부장 2차 승인
  | 'EXEC_APPROVED'         // 임원 최종 승인
  | 'REJECTED'              // 반려
  | 'COMPLETION_REQUESTED'  // 완료 요청
  | 'COMPLETION_APPROVED'   // 완료 최종 확인
  | 'ABANDON_REQUESTED'     // 포기 요청
  | 'ABANDON_APPROVED'      // 포기 최종 승인
  | 'MODIFY_WITHDRAWN';     // 수정 요청 회수

export interface NotifyNextApproverParams {
  /** 알림 발송 기준이 되는 목표 상태. 결재 단계 변경 직후에는 새 상태/필드를 반영한 객체를 전달할 것 */
  goal: Goal;
  allOrgs: Organization[];
  allUsers: User[];
  fromUserId: string;
  fromUserName: string;
  action: GoalNotifyAction;
  /** 알림 메시지에 표시할 owner 이름 강제 지정 (수행자 변경 시 "기존 수행자" 명의로 표기) */
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
    const chain = buildApprovalChain(goal, allOrgs, ownerRole, allUsers);
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

/**
 * F7: 결재 체인 전원에게 동일 알림 broadcast.
 * 대상: 목표 수행자(userId) + 공동수행자 + 결재 체인의 모든 단계 담당자(팀장·본부장·임원).
 * 트리거 당사자(fromUserId)는 제외. 중복 수신자 제거.
 */
export interface NotifyAllChainParams {
  goal: Goal;
  allOrgs: Organization[];
  allUsers: User[];
  fromUserId: string;
  fromUserName: string;
  event: GoalBroadcastEvent;
  /** 알림 메시지에 표시할 owner 이름 강제 지정 */
  ownerNameOverride?: string;
  /** 추가 수신자 (예: 변경 예정 새 수행자) */
  extraRecipients?: string[];
}

function buildBroadcastMessage(event: GoalBroadcastEvent, ownerName: string, title: string): { message: string; type: 'GOAL_SUBMITTED' | 'COMPLETION_REQUESTED' | 'ABANDON_REQUESTED' | 'GOAL_APPROVED' | 'GOAL_LEAD_APPROVED' | 'GOAL_REJECTED' | 'COMPLETION_APPROVED' | 'ABANDON_APPROVED' } {
  switch (event) {
    case 'SUBMITTED':
      return { message: `${ownerName}님이 '${title}' 핵심목표를 상신했습니다.`, type: 'GOAL_SUBMITTED' };
    case 'LEAD_APPROVED':
      return { message: `${ownerName}님의 '${title}' 핵심목표가 팀장 1차 승인되었습니다.`, type: 'GOAL_LEAD_APPROVED' };
    case 'HQ_APPROVED':
      return { message: `${ownerName}님의 '${title}' 핵심목표가 본부장 2차 승인되었습니다.`, type: 'GOAL_LEAD_APPROVED' };
    case 'EXEC_APPROVED':
      return { message: `${ownerName}님의 '${title}' 핵심목표가 최종 승인되었습니다.`, type: 'GOAL_APPROVED' };
    case 'REJECTED':
      return { message: `${ownerName}님의 '${title}' 핵심목표가 반려되었습니다.`, type: 'GOAL_REJECTED' };
    case 'COMPLETION_REQUESTED':
      return { message: `${ownerName}님이 '${title}' 핵심목표 완료를 요청했습니다.`, type: 'COMPLETION_REQUESTED' };
    case 'COMPLETION_APPROVED':
      return { message: `${ownerName}님의 '${title}' 핵심목표가 완료 확정되었습니다.`, type: 'COMPLETION_APPROVED' };
    case 'ABANDON_REQUESTED':
      return { message: `${ownerName}님이 '${title}' 핵심목표 포기를 요청했습니다.`, type: 'ABANDON_REQUESTED' };
    case 'ABANDON_APPROVED':
      return { message: `${ownerName}님의 '${title}' 핵심목표 포기가 최종 승인되었습니다.`, type: 'ABANDON_APPROVED' };
    case 'MODIFY_WITHDRAWN':
      return { message: `'${title}' 핵심목표 수정 요청이 회수되었습니다.`, type: 'GOAL_SUBMITTED' };
  }
}

export async function notifyAllChainParties(params: NotifyAllChainParams): Promise<number> {
  const { goal, allOrgs, allUsers, fromUserId, fromUserName, event, ownerNameOverride, extraRecipients } = params;
  try {
    const owner = allUsers.find(u => u.id === goal.userId);
    const ownerRole = owner?.role;
    const ownerName = ownerNameOverride ?? owner?.name ?? fromUserName;

    // 체인 단계 담당자 수집 — TEAM_LEAD/HQ_HEAD/EXEC
    const chain = buildApprovalChain(goal, allOrgs, ownerRole, allUsers);
    const chainUserIds: string[] = [];
    for (const stage of chain) {
      if (stage.userId) {
        chainUserIds.push(stage.userId);
      } else {
        // leaderId 미지정 fallback
        const cand = allUsers.find(u =>
          u.organizationId === stage.orgId &&
          (u.role === 'TEAM_LEAD' || u.role === 'EXECUTIVE') &&
          u.isActive !== false,
        );
        if (cand) chainUserIds.push(cand.id);
      }
    }

    // 수신자 집합: 수행자(owner) + 공동수행자 + 체인 단계 담당자 + extra. fromUser 제외.
    const recipients = new Set<string>();
    if (goal.userId) recipients.add(goal.userId);
    (goal.collaboratorIds ?? []).forEach(id => recipients.add(id));
    chainUserIds.forEach(id => recipients.add(id));
    (extraRecipients ?? []).forEach(id => recipients.add(id));
    recipients.delete(fromUserId);

    if (recipients.size === 0) return 0;

    const { message, type } = buildBroadcastMessage(event, ownerName, goal.title);

    await Promise.all(Array.from(recipients).map(uid =>
      createNotification({
        userId: uid,
        goalId: goal.id,
        goalTitle: goal.title,
        type,
        message,
        read: false,
      }).catch(err => console.error(`[broadcast] ${uid} 발송 실패:`, err))
    ));

    console.log(`[broadcast] ${event} → ${recipients.size}명 발송 완료 (goal=${goal.id}, from=${fromUserId})`);
    return recipients.size;
  } catch (err) {
    console.error('[broadcast] notifyAllChainParties 실패:', err);
    return 0;
  }
}
