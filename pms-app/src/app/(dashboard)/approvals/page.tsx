'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CheckSquare, User, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getPendingGoalsByOrganizations, getAllUsers, getOrganizations, updateGoal, addGoalHistory, getPendingWeightChangeRequestsForApprover, approveWeightChangeRequest, rejectWeightChangeRequest } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Goal, User as AppUser, Organization, WeightChangeRequest } from '@/types';
import {
  getDescendantOrgIds as sharedGetDescendantOrgIds,
  getOrgChain as sharedGetOrgChain,
  getMyApprovalRole as sharedGetMyApprovalRole,
  getApprovalRowState,
  stageLabel,
  approverTitle,
  type ApprovalRole,
} from '@/lib/approval-filters';

export default function ApprovalsPage() {
  return (
    <AuthGuard allowedRoles={['TEAM_LEAD', 'EXECUTIVE']}>
      <ApprovalsContent />
    </AuthGuard>
  );
}

// ── 유틸 ──────────────────────────────────────────────
// 공유 유틸(src/lib/approval-filters.ts) 사용 — 대시보드 카운트와 항상 일치하도록
const getDescendantOrgIds = sharedGetDescendantOrgIds;
const getOrgChain = sharedGetOrgChain;
const getMyApprovalRole = sharedGetMyApprovalRole;

// ── 뱃지 ─────────────────────────────────────────────────────

const GOAL_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  TASK:          { label: '과제업무',     cls: 'bg-blue-50 text-blue-700' },
  GENERAL_MAJOR: { label: '주요업무',     cls: 'bg-green-50 text-green-700' },
  COLLAB:        { label: '공동과제업무', cls: 'bg-purple-50 text-purple-700' },
  TRANSFERRED:   { label: '이관업무',     cls: 'bg-amber-50 text-amber-700' },
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────

function ApprovalsContent() {
  const { userProfile } = useAuth();
  const { isYearLocked } = useActiveYear();
  const [goals,   setGoals]   = useState<Goal[]>([]);
  const [users,   setUsers]   = useState<Record<string, AppUser>>({});
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [weightReqs, setWeightReqs] = useState<WeightChangeRequest[]>([]); // 가중치 변경 약식 승인 대기

  async function load() {
    if (!userProfile) return;
    try {
      const [orgsData, allUsers] = await Promise.all([getOrganizations(), getAllUsers()]);
      setAllOrgs(orgsData);
      setUsers(Object.fromEntries(allUsers.map(u => [u.id, u])));
      getPendingWeightChangeRequestsForApprover(userProfile.id).then(setWeightReqs).catch(() => {});

      // 내가 leaderId로 등록된 조직 목록
      const myLedOrgs = orgsData.filter(o => o.leaderId === userProfile.id);

      // 조회 범위 루트 조직 결정
      const rootIdSet = new Set<string>([userProfile.organizationId]);
      myLedOrgs.forEach(o => rootIdSet.add(o.id));

      // EXECUTIVE/CEO이고 leaderId 미설정인 경우:
      // 소속 조직 체인을 위로 올라가 DIVISION 또는 COMPANY를 찾아 범위 확장
      if (userProfile.role === 'EXECUTIVE' || userProfile.role === 'CEO') {
        const chain = getOrgChain(userProfile.organizationId, orgsData);
        const divOrg = chain.find(o => o.type === 'DIVISION');
        const companyOrg = chain.find(o => o.type === 'COMPANY');
        const rootOrg = divOrg ?? companyOrg;
        if (rootOrg) rootIdSet.add(rootOrg.id);
      }

      const scopeOrgIds = [...new Set(
        [...rootIdSet].flatMap(id => getDescendantOrgIds(id, orgsData))
      )];

      const pendingGoals = await getPendingGoalsByOrganizations(scopeOrgIds);
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

  async function handleWeightApprove(req: WeightChangeRequest) {
    if (!userProfile) return;
    setActionLoading(`w_${req.id}`);
    try {
      await approveWeightChangeRequest(req.userId, req.cycleYear, userProfile.id);
      toast.success(`${req.userName ?? ''}님 가중치 배분을 승인했습니다.`);
      setWeightReqs(prev => prev.filter(r => r.id !== req.id));
    } catch (e: any) { toast.error(e?.message ?? '승인 실패'); }
    finally { setActionLoading(null); }
  }
  async function handleWeightReject(req: WeightChangeRequest) {
    if (!userProfile) return;
    const comment = prompt('반려 사유를 입력하세요 (선택):') ?? undefined;
    setActionLoading(`w_${req.id}`);
    try {
      await rejectWeightChangeRequest(req.userId, req.cycleYear, userProfile.id, comment);
      toast.success(`${req.userName ?? ''}님 가중치 배분을 반려했습니다.`);
      setWeightReqs(prev => prev.filter(r => r.id !== req.id));
    } catch (e: any) { toast.error(e?.message ?? '반려 실패'); }
    finally { setActionLoading(null); }
  }

  // ── 목록 필터링 ─────────────────────────────────────────────

  function myRole(g: Goal) {
    if (!userProfile) return null;
    const myOrg = allOrgs.find(o => o.id === userProfile.organizationId);
    const chainRole = getMyApprovalRole(g, allOrgs, userProfile.id, userProfile.role, myOrg);
    if (chainRole) return chainRole;
    // 최후 fallback: userProfile.role 기준 (소속 조직도 못 찾는 극단 케이스)
    // CEO 는 인사평가 결재 라인에 참여하지 않음
    if (userProfile.role === 'TEAM_LEAD') return 'TEAM_LEAD' as const;
    if (userProfile.role === 'EXECUTIVE') return 'EXEC' as const;
    return null;
  }

  function hasHQ(g: Goal | undefined) {
    if (!g?.organizationId) return false;
    const chain = getOrgChain(g.organizationId, allOrgs);
    // 실질적인 HQ 중간 승인 단계는 HEADQUARTERS와 DIVISION이 모두 있을 때만 존재
    // HQ만 있고 DIVISION이 없으면 (e.g. COMPANY→HQ→TEAM) HQ head가 최종 승인자
    return chain.some(o => o.type === 'HEADQUARTERS') && chain.some(o => o.type === 'DIVISION');
  }

  // 목표의 팀에 명시적 팀장이 없는 경우(leaderId 미지정) — 본부장/임원이 1차 대행
  function teamHasNoLead(g: Goal): boolean {
    if (!g.organizationId) return false;
    const chain = getOrgChain(g.organizationId, allOrgs);
    const teamOrg = chain.find(o => o.type === 'TEAM');
    return !!teamOrg && !teamOrg.leaderId;
  }

  /** 목표 승인 요청 (PENDING_APPROVAL / LEAD_APPROVED) — 본인 단계 이상 모두 포함 */
  const approvalGoals = goals.filter(g => {
    if (g.status !== 'PENDING_APPROVAL' && g.status !== 'LEAD_APPROVED') return false;
    if (!userProfile) return false;
    const rs = getApprovalRowState(g, allOrgs, users, userProfile.id, userProfile.role);
    return rs.state === 'NEXT' || rs.state === 'UPSTREAM';
  });

  /** 완료 확인 요청 — 완료 승인 전용 필드(completion*) 기준으로 판별 */
  const completionGoals = goals.filter(g => {
    if (g.status !== 'COMPLETED') return false;
    if (!userProfile) return false;
    const rs = getApprovalRowState(g, allOrgs, users, userProfile.id, userProfile.role);
    return rs.state === 'NEXT' || rs.state === 'UPSTREAM';
  });

  /** 포기 요청 */
  const abandonGoals = goals.filter(g => {
    if (g.status !== 'PENDING_ABANDON') return false;
    if (!userProfile) return false;
    const rs = getApprovalRowState(g, allOrgs, users, userProfile.id, userProfile.role);
    return rs.state === 'NEXT' || rs.state === 'UPSTREAM';
  });

  const isEmpty = approvalGoals.length === 0 && completionGoals.length === 0 && abandonGoals.length === 0 && weightReqs.length === 0;

  // ── 과제업무 전환 처리 ────────────────────────────────────────

  async function handlePromotionApprove(goal: Goal, promoteToTask: boolean) {
    if (!userProfile) return;
    if (isYearLocked(goal.cycleYear)) { toast.error(`${goal.cycleYear}년은 확정된 연도입니다. 승인 처리가 불가합니다.`); return; }
    setActionLoading(goal.id);
    try {
      if (promoteToTask) {
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
        await updateGoal(goal.id, {
          promotionStatus: 'REJECTED',
          status: 'LEAD_APPROVED',
          leadApprovedBy: userProfile.id,
          leadApprovedAt: new Date(),
        });
        await addGoalHistory({
          goalId: goal.id, changedBy: userProfile.id,
          changeType: 'APPROVED',
          previousStatus: goal.status, newStatus: 'LEAD_APPROVED',
          comment: '주요업무 1차 승인 완료. 임원의 최종 승인을 기다립니다.',
        });
        toast.success('주요업무 1차 승인. 임원의 최종 승인을 기다립니다.');
      }
      await load();
    } catch {
      toast.error('처리 중 오류가 발생했습니다.');
    } finally {
      setActionLoading(null);
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────

  // 현재 사용자의 대표 역할 (헤더 문구용) — CEO 는 결재 라인 미참여
  const representativeRole = userProfile
    ? (goals.length > 0 ? myRole(goals[0]) : null) ?? (
        userProfile.role === 'EXECUTIVE' ? 'EXEC' :
        userProfile.role === 'TEAM_LEAD' ? 'TEAM_LEAD' : null
      )
    : null;

  const approvalSectionLabel =
    representativeRole === 'TEAM_LEAD' ? '목표 승인 요청 — 1차 승인' :
    representativeRole === 'HQ_HEAD'   ? '목표 승인 요청 — 2차 승인 (본부)' :
    '목표 승인 요청 — 최종 승인';

  const completionSectionLabel =
    representativeRole === 'TEAM_LEAD' ? '완료 확인 요청 — 1차 확인' :
    representativeRole === 'HQ_HEAD'   ? '완료 확인 요청 — 2차 확인 (본부)' :
    '완료 확인 요청 — 최종 확인';

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

        {/* 가중치 배분 변경 요청 (약식 승인) */}
        {weightReqs.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">가중치 배분 변경 요청 ({weightReqs.length})</h3>
            <p className="text-xs text-gray-400">팀원이 제출한 핵심목표 가중치 배분(합 100%)입니다. 변경 전·후를 확인하고 승인하세요.</p>
            {weightReqs.map(req => {
              const keys = Array.from(new Set([...Object.keys(req.after ?? {}), ...Object.keys(req.before ?? {})]));
              const busy = actionLoading === `w_${req.id}`;
              return (
                <div key={req.id} className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
                  <div className="text-sm font-semibold text-gray-900">
                    {req.userName ?? req.userId} <span className="text-xs font-normal text-gray-400">· {req.cycleYear}년 핵심목표 가중치</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b">
                          <th className="py-1.5 text-left font-medium">목표</th>
                          <th className="py-1.5 w-20 text-right font-medium">변경 전</th>
                          <th className="py-1.5 w-20 text-right font-medium">변경 후</th>
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map(k => {
                          const b = req.before?.[k] ?? 0;
                          const a = req.after?.[k] ?? 0;
                          const changed = b !== a;
                          return (
                            <tr key={k} className="border-b last:border-0">
                              <td className="py-1.5 text-gray-700">{req.titles?.[k] ?? k}</td>
                              <td className="py-1.5 text-right text-gray-400">{b}%</td>
                              <td className={cn('py-1.5 text-right font-medium', changed ? 'text-indigo-600' : 'text-gray-500')}>{a}%</td>
                            </tr>
                          );
                        })}
                        <tr className="font-semibold">
                          <td className="py-1.5 text-gray-500 text-xs">합계</td>
                          <td className="py-1.5 text-right text-gray-400">{keys.reduce((s, k) => s + (req.before?.[k] ?? 0), 0)}%</td>
                          <td className="py-1.5 text-right text-indigo-600">{keys.reduce((s, k) => s + (req.after?.[k] ?? 0), 0)}%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => handleWeightReject(req)}>반려</Button>
                    <Button size="sm" disabled={busy} onClick={() => handleWeightApprove(req)}>{busy ? '처리 중…' : '승인'}</Button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* 목표 승인 요청 */}
        {(loading || approvalGoals.length > 0) && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {approvalSectionLabel} ({approvalGoals.length})
            </h3>
            {representativeRole === 'TEAM_LEAD' && (
              <p className="text-xs text-gray-400">
                1차 승인 후{hasHQ(approvalGoals[0] ?? goals[0]) ? ' 본부장 2차 승인을 거쳐' : ''} 임원에게 최종 승인 요청이 갑니다.
              </p>
            )}
            {representativeRole === 'HQ_HEAD' && (
              <p className="text-xs text-gray-400">팀장 1차 승인 완료된 목표입니다. 승인 후 담당 임원에게 최종 승인 요청이 갑니다.</p>
            )}
            {representativeRole === 'EXEC' && (
              <p className="text-xs text-gray-400">팀원 목표(1차 승인 완료) 및 팀장 목표의 최종 승인입니다.</p>
            )}
            {loading ? <SkeletonList /> : (
              <div className="space-y-2">
                {approvalGoals.map(goal => {
                  const rs = userProfile
                    ? getApprovalRowState(goal, allOrgs, users, userProfile.id, userProfile.role)
                    : { state: 'NONE' as const };
                  return (
                    <ApprovalRow
                      key={goal.id}
                      goal={goal}
                      requester={users[goal.userId]}
                      requesterOrgName={allOrgs.find(o => o.id === users[goal.userId]?.organizationId)?.name}
                      approvalRole={myRole(goal) ?? 'TEAM_LEAD'}
                      actionLoading={actionLoading === goal.id}
                      onPromotionApprove={handlePromotionApprove}
                      isUpstream={rs.state === 'UPSTREAM'}
                      pendingStageLabel={rs.pendingStage ? approverTitle(rs.pendingStage.userId, Object.values(users), stageLabel(rs.pendingStage.role)) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 완료 확인 요청 */}
        {(loading || completionGoals.length > 0) && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {completionSectionLabel} ({completionGoals.length})
            </h3>
            {loading ? <SkeletonList /> : (
              <div className="space-y-2">
                {completionGoals.map(goal => {
                  const rs = userProfile
                    ? getApprovalRowState(goal, allOrgs, users, userProfile.id, userProfile.role)
                    : { state: 'NONE' as const };
                  return (
                    <ApprovalRow
                      key={goal.id}
                      goal={goal}
                      requester={users[goal.userId]}
                      requesterOrgName={allOrgs.find(o => o.id === users[goal.userId]?.organizationId)?.name}
                      approvalRole={myRole(goal) ?? 'TEAM_LEAD'}
                      actionLoading={actionLoading === goal.id}
                      onPromotionApprove={handlePromotionApprove}
                      isUpstream={rs.state === 'UPSTREAM'}
                      pendingStageLabel={rs.pendingStage ? approverTitle(rs.pendingStage.userId, Object.values(users), stageLabel(rs.pendingStage.role)) : undefined}
                    />
                  );
                })}
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
                {abandonGoals.map(goal => {
                  const rs = userProfile
                    ? getApprovalRowState(goal, allOrgs, users, userProfile.id, userProfile.role)
                    : { state: 'NONE' as const };
                  return (
                    <ApprovalRow
                      key={goal.id}
                      goal={goal}
                      requester={users[goal.userId]}
                      requesterOrgName={allOrgs.find(o => o.id === users[goal.userId]?.organizationId)?.name}
                      approvalRole={myRole(goal) ?? 'TEAM_LEAD'}
                      actionLoading={actionLoading === goal.id}
                      onPromotionApprove={handlePromotionApprove}
                      isUpstream={rs.state === 'UPSTREAM'}
                      pendingStageLabel={rs.pendingStage ? approverTitle(rs.pendingStage.userId, Object.values(users), stageLabel(rs.pendingStage.role)) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ── ApprovalRow ───────────────────────────────────────────────

interface ApprovalRowProps {
  goal: Goal;
  requester?: AppUser;
  requesterOrgName?: string;
  approvalRole: ApprovalRole;
  actionLoading: boolean;
  onPromotionApprove: (goal: Goal, promoteToTask: boolean) => void;
  isUpstream?: boolean;          // 차하위 승인권자가 처리하기 전 단계 — 비활성 표시
  pendingStageLabel?: string;    // 다음 처리 대기 단계 라벨 (예: '팀장', '본부장')
}

function ApprovalRow({ goal, requester, requesterOrgName, approvalRole, actionLoading, onPromotionApprove, isUpstream, pendingStageLabel }: ApprovalRowProps) {
  // v0.76: 이관·공동 분류 우선
  let typeBadge: { label: string; cls: string } | null = null;
  if (goal.previousOwnerId) typeBadge = GOAL_TYPE_BADGE['TRANSFERRED'];
  else if ((goal.collaboratorIds?.length ?? 0) > 0) typeBadge = GOAL_TYPE_BADGE['COLLAB'];
  else if (goal.goalType === 'TASK') typeBadge = GOAL_TYPE_BADGE['TASK'];
  else if (goal.goalType === 'GENERAL' && goal.generalType === 'MAJOR') typeBadge = GOAL_TYPE_BADGE['GENERAL_MAJOR'];

  const isLead = approvalRole === 'TEAM_LEAD';

  // 팀장이 과제반영 요청된 주요업무를 볼 때 두 버튼 표시
  const showPromotionButtons =
    isLead &&
    goal.goalType === 'GENERAL' &&
    goal.generalType === 'MAJOR' &&
    goal.status === 'PENDING_APPROVAL' &&
    goal.requestPromotion === true;

  return (
    <div className="rounded-xl border bg-white p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/goals/${goal.id}?from=approvals`} className="flex-1 min-w-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {typeBadge && (
                <span className={`shrink-0 text-xs font-medium rounded-full px-2 py-0.5 ${typeBadge.cls}`}>
                  {typeBadge.label}
                </span>
              )}
              <GoalStatusBadge goal={goal} />
              {approvalRole === 'HQ_HEAD' && (
                <span className="shrink-0 text-xs font-medium rounded-full px-2 py-0.5 bg-purple-50 text-purple-700">
                  2차 승인 대기
                </span>
              )}
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
                {requester?.name ?? '알 수 없음'}
                {requesterOrgName ? ` · ${requesterOrgName}` : ''}
                {requester?.position ? ` · ${requester.position}` : ''}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {format(goal.dueDate, 'MM/dd', { locale: ko })}까지
              </span>
              {goal.goalType === 'TASK' && <span>가중치 {goal.weight}%</span>}
            </div>
          </div>
        </Link>
        <div className="shrink-0 flex items-center gap-2">
          {isUpstream ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500"
              title="차하위 승인권자가 먼저 처리해야 합니다"
            >
              {pendingStageLabel ?? '하위 단계'} 검토 중
            </span>
          ) : showPromotionButtons ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={actionLoading}
                onClick={() => onPromotionApprove(goal, false)}
                className="text-green-700 border-green-300 hover:bg-green-50">
                주요업무로 승인
              </Button>
              <Button size="sm" disabled={actionLoading}
                onClick={() => onPromotionApprove(goal, true)}
                className="bg-blue-600 hover:bg-blue-700">
                과제업무로 전환
              </Button>
            </div>
          ) : (
            <Link href={`/goals/${goal.id}?from=approvals`}>
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
      {[1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
    </div>
  );
}
