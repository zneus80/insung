'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CheckSquare, User, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getPendingGoalsByOrganizations, getAllUsers, getOrganizations, updateGoal, addGoalHistory } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Goal, User as AppUser, Organization } from '@/types';

export default function ApprovalsPage() {
  return (
    <AuthGuard allowedRoles={['TEAM_LEAD', 'EXECUTIVE', 'CEO']}>
      <ApprovalsContent />
    </AuthGuard>
  );
}

// 특정 orgId의 모든 하위 조직 ID 반환 (자신 포함)
function getDescendantOrgIds(orgId: string, orgs: Organization[]): string[] {
  const result: string[] = [orgId];
  const children = orgs.filter(o => o.parentId === orgId);
  for (const child of children) {
    result.push(...getDescendantOrgIds(child.id, orgs));
  }
  return result;
}

const GOAL_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  'TASK': { label: '과제업무', cls: 'bg-blue-50 text-blue-700' },
  'GENERAL_MAJOR': { label: '주요업무', cls: 'bg-green-50 text-green-700' },
};

function ApprovalsContent() {
  const { userProfile } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [users, setUsers] = useState<Record<string, AppUser>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function load() {
    if (!userProfile) return;
    try {
      const [allOrgs, allUsers] = await Promise.all([getOrganizations(), getAllUsers()]);
      const userMap = Object.fromEntries(allUsers.map(u => [u.id, u]));
      setUsers(userMap);

      // 조회할 조직 ID 목록 결정
      let orgIds: string[];
      if (userProfile.role === 'EXECUTIVE') {
        // 임원: 자신의 조직 + 하위 조직 전체
        orgIds = getDescendantOrgIds(userProfile.organizationId, allOrgs);
      } else {
        // 팀장: 본인 팀만
        orgIds = [userProfile.organizationId];
      }

      const pendingGoals = await getPendingGoalsByOrganizations(orgIds);
      setGoals(pendingGoals);
    } catch (e) {
      console.error('승인 대기함 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!userProfile) return;
    load();
  }, [userProfile]);

  const isLead = userProfile?.role === 'TEAM_LEAD';
  const isExec = userProfile?.role === 'EXECUTIVE';

  // 역할별 필터링
  const approvalGoals = goals.filter(g => {
    const ownerRole = users[g.userId]?.role;
    const ownerIsMemberLike = ownerRole === 'MEMBER';

    if (isLead) {
      if (!ownerIsMemberLike) return false;
      // TASK: 팀원의 PENDING_APPROVAL (1차 승인)
      if (g.goalType === 'TASK' && g.status === 'PENDING_APPROVAL') return true;
      // MAJOR: 팀원의 PENDING_APPROVAL (최종 승인)
      if (g.goalType === 'GENERAL' && g.generalType === 'MAJOR' && g.status === 'PENDING_APPROVAL') return true;
      return false;
    }
    if (isExec) {
      // TASK: 팀원의 LEAD_APPROVED (임원 최종)
      if (g.goalType === 'TASK' && g.status === 'LEAD_APPROVED' && ownerIsMemberLike) return true;
      // TASK/GENERAL: 팀장의 PENDING_APPROVAL
      if (g.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') return true;
      return false;
    }
    return g.status === 'PENDING_APPROVAL';
  });

  const completionGoals = goals.filter(g => {
    if (g.status !== 'COMPLETED') return false;
    const ownerRole = users[g.userId]?.role;
    if (isLead) {
      // 팀장: 팀원의 완료 1차 확인 (leadApprovedBy 없는 것)
      return ownerRole === 'MEMBER' && !g.leadApprovedBy;
    }
    if (isExec) {
      // 임원: 팀원의 완료 최종 확인 (leadApprovedBy 있는 것) + 팀장의 완료 확인
      return (ownerRole === 'MEMBER' && !!g.leadApprovedBy && !g.approvedBy) ||
        (ownerRole === 'TEAM_LEAD' && !g.approvedBy);
    }
    return !g.approvedBy;
  });

  const abandonGoals = goals.filter(g => {
    if (g.status !== 'PENDING_ABANDON') return false;
    const ownerRole = users[g.userId]?.role;
    if (isLead) return ownerRole === 'MEMBER';
    if (isExec) return ownerRole === 'TEAM_LEAD';
    return true;
  });

  const isEmpty = approvalGoals.length === 0 && completionGoals.length === 0 && abandonGoals.length === 0;

  // 과제업무 전환 처리 (requestPromotion=true인 주요업무를 팀장이 승인할 때)
  async function handlePromotionApprove(goal: Goal, promoteToTask: boolean) {
    if (!userProfile) return;
    setActionLoading(goal.id);
    try {
      if (promoteToTask) {
        // 과제업무로 전환
        await updateGoal(goal.id, {
          promotionStatus: 'APPROVED',
          goalType: 'TASK',
          generalType: undefined,
          status: 'LEAD_APPROVED',
          leadApprovedBy: userProfile.id,
          leadApprovedAt: new Date(),
        });
        await addGoalHistory({
          goalId: goal.id, changedBy: userProfile.id,
          changeType: 'APPROVED',
          previousStatus: goal.status, newStatus: 'LEAD_APPROVED',
          comment: '과제업무로 전환 승인. 임원의 최종 승인을 기다립니다.',
        });
        toast.success('과제업무로 전환했습니다. 임원의 최종 승인을 기다립니다.');
      } else {
        // 주요업무로 그냥 승인
        await updateGoal(goal.id, {
          promotionStatus: 'REJECTED',
          status: 'APPROVED',
          approvedBy: userProfile.id,
          approvedAt: new Date(),
        });
        await addGoalHistory({
          goalId: goal.id, changedBy: userProfile.id,
          changeType: 'APPROVED',
          previousStatus: goal.status, newStatus: 'APPROVED',
          comment: '주요업무로 승인 완료.',
        });
        toast.success('주요업무로 승인했습니다.');
      }
      await load();
    } catch (e: any) {
      toast.error('처리 중 오류가 발생했습니다.');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="승인 대기함" />
      <div className="flex-1 p-6 space-y-6">

        {isEmpty && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <CheckSquare className="mb-3 h-10 w-10" />
            <p className="text-sm">처리할 항목이 없습니다.</p>
          </div>
        )}

        {/* 목표 승인 요청 */}
        {(loading || approvalGoals.length > 0) && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {isLead ? '목표 승인 요청' : '목표 승인 요청 — 최종 승인'}
              {' '}({approvalGoals.length})
            </h3>
            {isLead && (
              <p className="text-xs text-gray-400">과제업무는 1차 승인 후 임원에게 최종 승인 요청이 갑니다. 주요업무는 팀장이 최종 승인합니다.</p>
            )}
            {isExec && (
              <p className="text-xs text-gray-400">팀원 목표(1차 승인 완료) 및 팀장 목표의 최종 승인입니다.</p>
            )}
            {loading ? <SkeletonList /> : (
              <div className="space-y-2">
                {approvalGoals.map(goal => (
                  <ApprovalRow
                    key={goal.id}
                    goal={goal}
                    requester={users[goal.userId]}
                    isLead={!!isLead}
                    actionLoading={actionLoading === goal.id}
                    onPromotionApprove={handlePromotionApprove}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* 완료 확인 요청 */}
        {(loading || completionGoals.length > 0) && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {isLead ? '완료 확인 요청 — 1차 확인' : '완료 확인 요청 — 최종 확인'}
              {' '}({completionGoals.length})
            </h3>
            {loading ? <SkeletonList /> : (
              <div className="space-y-2">
                {completionGoals.map(goal => (
                  <ApprovalRow
                    key={goal.id}
                    goal={goal}
                    requester={users[goal.userId]}
                    isLead={!!isLead}
                    actionLoading={actionLoading === goal.id}
                    onPromotionApprove={handlePromotionApprove}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* 포기 요청 */}
        {(loading || abandonGoals.length > 0) && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              포기 요청 ({abandonGoals.length})
            </h3>
            {loading ? <SkeletonList /> : (
              <div className="space-y-2">
                {abandonGoals.map(goal => (
                  <ApprovalRow
                    key={goal.id}
                    goal={goal}
                    requester={users[goal.userId]}
                    isLead={!!isLead}
                    actionLoading={actionLoading === goal.id}
                    onPromotionApprove={handlePromotionApprove}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

interface ApprovalRowProps {
  goal: Goal;
  requester?: AppUser;
  isLead: boolean;
  actionLoading: boolean;
  onPromotionApprove: (goal: Goal, promoteToTask: boolean) => void;
}

function ApprovalRow({ goal, requester, isLead, actionLoading, onPromotionApprove }: ApprovalRowProps) {
  // 목표 유형 뱃지 결정
  let typeBadge: { label: string; cls: string } | null = null;
  if (goal.goalType === 'TASK') {
    typeBadge = GOAL_TYPE_BADGE['TASK'];
  } else if (goal.goalType === 'GENERAL' && goal.generalType === 'MAJOR') {
    typeBadge = GOAL_TYPE_BADGE['GENERAL_MAJOR'];
  }

  // 팀장이 requestPromotion=true인 주요업무를 볼 때 두 버튼 표시
  const showPromotionButtons =
    isLead &&
    goal.goalType === 'GENERAL' &&
    goal.generalType === 'MAJOR' &&
    goal.status === 'PENDING_APPROVAL' &&
    goal.requestPromotion === true;

  return (
    <div className="rounded-xl border bg-white p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/goals/${goal.id}`} className="flex-1 min-w-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {typeBadge && (
                <span className={`shrink-0 text-xs font-medium rounded-full px-2 py-0.5 ${typeBadge.cls}`}>
                  {typeBadge.label}
                </span>
              )}
              <GoalStatusBadge status={goal.status} />
              <span className="font-medium text-gray-900 truncate">{goal.title}</span>
              {goal.requestPromotion && (
                <span className="shrink-0 text-xs font-medium rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">
                  과제 반영 요청 중
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {requester?.name ?? '알 수 없음'}{requester?.position ? ` (${requester.position})` : ''}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {format(goal.dueDate, 'MM/dd', { locale: ko })}까지
              </span>
              {goal.goalType === 'TASK' && (
                <span>가중치 {goal.weight}%</span>
              )}
            </div>
          </div>
        </Link>
        <div className="shrink-0 flex items-center gap-2">
          {showPromotionButtons ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={actionLoading}
                onClick={() => onPromotionApprove(goal, false)}
                className="text-green-700 border-green-300 hover:bg-green-50"
              >
                주요업무로 승인
              </Button>
              <Button
                size="sm"
                disabled={actionLoading}
                onClick={() => onPromotionApprove(goal, true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                과제업무로 전환
              </Button>
            </div>
          ) : (
            <Link href={`/goals/${goal.id}`}>
              <span className="text-xs text-blue-600 font-medium">검토하기 →</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[1, 2].map(i => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
      ))}
    </div>
  );
}
