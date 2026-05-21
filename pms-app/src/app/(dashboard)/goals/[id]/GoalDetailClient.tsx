'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ArrowLeft, Calendar, Weight, Send, XCircle, CheckCircle2, Flag, CheckCheck, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  updateGoal,
  addGoalHistory,
  getGoalHistories,
  addProgressUpdate,
  getProgressUpdates,
  getUser,
  getOrganizations,
  createNotification,
  COLLECTIONS,
} from '@/lib/firestore';
import TaskGoalForm from '@/components/goals/TaskGoalForm';
import GeneralGoalForm from '@/components/goals/GeneralGoalForm';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Header from '@/components/layout/Header';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import { toast } from 'sonner';
import type { Goal, GoalHistory, ProgressUpdate, User, Organization } from '@/types';
import { fromTimestamp } from '@/lib/firestore';
import { Timestamp } from 'firebase/firestore';

const GOAL_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  'TASK': { label: '과제업무', cls: 'bg-blue-100 text-blue-700' },
  'MAJOR': { label: '주요업무', cls: 'bg-green-100 text-green-700' },
  'OTHER': { label: '기타업무', cls: 'bg-gray-100 text-gray-600' },
};

function getGoalTypeBadge(goal: Goal) {
  if (goal.goalType === 'TASK') return GOAL_TYPE_BADGE['TASK'];
  if (goal.goalType === 'GENERAL') {
    return goal.generalType === 'MAJOR' ? GOAL_TYPE_BADGE['MAJOR'] : GOAL_TYPE_BADGE['OTHER'];
  }
  return null;
}

const IMPORTANCE_LABEL: Record<string, string> = {
  HIGH: '높음',
  MEDIUM: '보통',
  LOW: '낮음',
};

export default function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { userProfile } = useAuth();
  const router = useRouter();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [goalOwner, setGoalOwner] = useState<User | null>(null);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [histories, setHistories] = useState<GoalHistory[]>([]);
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [newProgress, setNewProgress] = useState(0);
  const [progressComment, setProgressComment] = useState('');
  // 반려 의견
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  // 승인 의견 (E1)
  const [approveComment, setApproveComment] = useState('');
  const [showApproveInput, setShowApproveInput] = useState(false);
  // 승인요청 의견 (요청자)
  const [approvalRequestComment, setApprovalRequestComment] = useState('');
  const [showApprovalRequestInput, setShowApprovalRequestInput] = useState(false);
  // 포기요청 의견 (E3)
  const [abandonComment, setAbandonComment] = useState('');
  const [showAbandonInput, setShowAbandonInput] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  async function load() {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.GOALS, id));
      if (!snap.exists()) { router.push('/goals'); return; }
      const data = snap.data();
      const loadedGoal: Goal = {
        ...data,
        id: snap.id,
        dueDate: fromTimestamp(data.dueDate as Timestamp) ?? new Date(),
        createdAt: fromTimestamp(data.createdAt as Timestamp) ?? new Date(),
        updatedAt: fromTimestamp(data.updatedAt as Timestamp) ?? new Date(),
        approvedAt: fromTimestamp(data.approvedAt as Timestamp),
        leadApprovedAt: fromTimestamp(data.leadApprovedAt as Timestamp),
        abandonLeadApprovedAt: fromTimestamp(data.abandonLeadApprovedAt as Timestamp),
      } as Goal;

      const [owner, h, u, orgs] = await Promise.all([
        getUser(loadedGoal.userId),
        getGoalHistories(id),
        getProgressUpdates(id),
        getOrganizations(),
      ]);
      setGoal(loadedGoal);
      setGoalOwner(owner);
      setAllOrgs(orgs);
      setNewProgress(loadedGoal.progress);
      setHistories(h);
      setUpdates(u);
    } catch (e: any) {
      toast.error(`목표를 불러오지 못했습니다: ${e?.code ?? e?.message ?? ''}`);
      router.push('/goals');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    load();
  }, [id]);

  // ── 팀원 액션 ──────────────────────────────────────────
  async function requestApproval() {
    if (!goal || !userProfile) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'PENDING_APPROVAL' });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: 'PENDING_APPROVAL',
        comment: approvalRequestComment.trim() ? `승인 요청: ${approvalRequestComment.trim()}` : '승인 요청',
      });
      setApprovalRequestComment('');
      setShowApprovalRequestInput(false);
      toast.success('팀장에게 승인 요청을 보냈습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function requestCompletion() {
    if (!goal || !userProfile) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'COMPLETED', progress: 100 });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: 'COMPLETED',
        comment: '완료 요청',
      });
      toast.success('팀장에게 완료 확인 요청을 보냈습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function requestAbandon() {
    if (!goal || !userProfile) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'PENDING_ABANDON' });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: 'PENDING_ABANDON',
        comment: abandonComment.trim() ? `포기 요청: ${abandonComment.trim()}` : '포기 요청',
      });
      setAbandonComment('');
      setShowAbandonInput(false);
      toast.success('포기 요청을 보냈습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function withdrawApproval() {
    if (!goal || !userProfile) return;
    if (!confirm('승인 요청을 회수하시겠습니까? 임시저장 상태로 돌아갑니다.')) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'DRAFT' });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: 'PENDING_APPROVAL', newStatus: 'DRAFT',
        comment: '승인 요청 회수',
      });
      toast.success('승인 요청을 회수했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function handleDelete() {
    if (!goal || !userProfile) return;
    if (!confirm('이 목표를 휴지통으로 이동하시겠습니까?')) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'ABANDONED' });
      toast.success('휴지통으로 이동했습니다.');
      router.push('/goals');
    } catch {
      toast.error('오류가 발생했습니다.');
      setActionLoading(false);
    }
  }

  async function submitProgress() {
    if (!goal || !userProfile || !progressComment.trim()) return;
    setActionLoading(true);
    try {
      await addProgressUpdate({
        goalId: id, userId: userProfile.id,
        progress: newProgress, comment: progressComment,
      });
      await updateGoal(id, {
        progress: newProgress,
        status: goal.status === 'APPROVED' ? 'IN_PROGRESS' : goal.status,
      });
      setProgressComment('');
      toast.success('진행상황이 업데이트되었습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  // ── 승인 액션 ──────────────────────────────────────────
  async function approveGoal() {
    if (!goal || !userProfile || !goalOwner) return;
    setActionLoading(true);
    try {
      let updateData: Parameters<typeof updateGoal>[1] = {};
      let newStatus: Goal['status'] = goal.status;
      let successMsg = '';

      if (iAmTeamLead && ownerIsMemberLike) {
        if (goal.status === 'PENDING_APPROVAL') {
          // 과제업무: 1차 승인 → LEAD_APPROVED (본부/임원 추가 승인 대기)
          // 주요업무: 팀장이 최종 승인 → APPROVED
          // 모든 목표 유형: 팀장 1차 승인 → LEAD_APPROVED → 임원 최종 승인 필요
          newStatus = 'LEAD_APPROVED';
          updateData = { status: 'LEAD_APPROVED', leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          if (goal.goalType === 'TASK') {
            successMsg = hasHQInChain
              ? '과제업무 1차 승인. 본부장 2차 승인을 기다립니다.'
              : '과제업무 1차 승인. 임원의 최종 승인을 기다립니다.';
          } else {
            successMsg = hasHQInChain
              ? '주요업무 1차 승인. 본부장 2차 승인을 기다립니다.'
              : '주요업무 1차 승인. 임원의 최종 승인을 기다립니다.';
          }
        } else if (goal.status === 'COMPLETED' && !goal.leadApprovedBy) {
          updateData = { leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          successMsg = hasHQInChain ? '완료 1차 확인. 본부장 2차 확인 대기 중.' : '완료 1차 확인. 임원 최종 확인 대기 중.';
        } else if (goal.status === 'PENDING_ABANDON' && !goal.abandonLeadApprovedBy) {
          // 팀장 포기 1차 승인: 별도 필드 기록, 상태는 PENDING_ABANDON 유지
          updateData = { abandonLeadApprovedBy: userProfile.id, abandonLeadApprovedAt: new Date() };
          successMsg = '포기 1차 승인. 임원의 최종 승인을 기다립니다.';
        }
      } else if (iAmHQHead) {
        // 본부장 2차 승인: 상태 변경 없이 hqApprovedBy만 기록
        if (goal.status === 'LEAD_APPROVED' && !goal.hqApprovedBy) {
          updateData = { hqApprovedBy: userProfile.id, hqApprovedAt: new Date() };
          successMsg = '본부 2차 승인 완료. 임원의 최종 승인을 기다립니다.';
        } else if (goal.status === 'COMPLETED' && !!goal.leadApprovedBy && !goal.hqApprovedBy) {
          updateData = { hqApprovedBy: userProfile.id, hqApprovedAt: new Date() };
          successMsg = '완료 2차 확인. 임원 최종 확인 대기 중.';
        }
      } else if (iAmExec) {
        if (goal.status === 'LEAD_APPROVED') {
          newStatus = 'APPROVED';
          updateData = { status: 'APPROVED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '최종 승인 완료.';
        } else if (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') {
          newStatus = 'APPROVED';
          updateData = { status: 'APPROVED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '승인 완료.';
        } else if (goal.status === 'COMPLETED') {
          updateData = { approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '완료 최종 확인.';
        } else if (goal.status === 'PENDING_ABANDON') {
          // 팀원 목표: 팀장 포기 1차 승인 후에만 임원 최종 가능 / 팀장 목표: 바로 최종
          const abandonReady = ownerRole === 'TEAM_LEAD' || (ownerIsMemberLike && !!goal.abandonLeadApprovedBy);
          if (abandonReady) {
            newStatus = 'ABANDONED';
            updateData = { status: 'ABANDONED', approvedBy: userProfile.id, approvedAt: new Date() };
            successMsg = '포기 최종 승인.';
          }
        }
      }

      if (Object.keys(updateData).length === 0) return;
      await updateGoal(id, updateData);
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'APPROVED',
        previousStatus: goal.status, newStatus,
        comment: approveComment.trim() ? `${successMsg} / 의견: ${approveComment.trim()}` : successMsg,
      });

      // ── 결재 체인 알림: 승인 후 다음 결재자에게 알림 발송 ──
      try {
        const hqLeadId = hasHQInChain ? (hqOrg?.leaderId ?? null) : null;
        const execId   = divOrg?.leaderId ?? (!divOrg ? hqOrg?.leaderId : null) ?? null;

        let chainNotifyId: string | null = null;
        let chainMsg = '';

        if (iAmTeamLead && newStatus === 'LEAD_APPROVED') {
          // 팀장 1차 승인 → HQ 있으면 본부장, 없으면 임원에게
          chainNotifyId = hasHQInChain ? hqLeadId : execId;
          chainMsg = `${goalOwner.name}님의 '${goal.title}' 목표 ${hasHQInChain ? '2차' : '최종'} 승인이 필요합니다.`;
        } else if (iAmHQHead && goal.status === 'LEAD_APPROVED') {
          // 본부장 2차 승인 → 임원에게
          chainNotifyId = execId;
          chainMsg = `${goalOwner.name}님의 '${goal.title}' 목표 최종 승인이 필요합니다.`;
        }

        if (chainNotifyId && chainNotifyId !== userProfile.id) {
          await createNotification({
            userId: chainNotifyId,
            goalId: id,
            goalTitle: goal.title,
            type: 'GOAL_SUBMITTED',
            message: chainMsg,
            read: false,
          });
        }
      } catch { /* 알림 실패는 조용히 처리 */ }

      setApproveComment('');
      setShowApproveInput(false);
      toast.success(successMsg);
      await load();
    } finally { setActionLoading(false); }
  }

  async function rejectGoal() {
    if (!goal || !userProfile || !rejectComment.trim()) {
      toast.error('반려 사유를 입력해주세요.');
      return;
    }
    setActionLoading(true);
    try {
      let newStatus: Goal['status'];
      if (goal.status === 'COMPLETED') {
        newStatus = 'IN_PROGRESS';
      } else {
        newStatus = 'REJECTED';
      }
      await updateGoal(id, {
        status: newStatus,
        ...(newStatus === 'REJECTED' ? { rejectedReason: rejectComment } : {}),
      });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'REJECTED',
        previousStatus: goal.status, newStatus,
        comment: rejectComment,
      });
      setRejectComment('');
      setShowRejectInput(false);
      toast.success(goal.status === 'COMPLETED' ? '완료 요청을 반려했습니다.' : '반려 처리했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  if (loading || !goal || !userProfile) {
    return (
      <div className="flex flex-col h-full">
        <Header title="목표 상세" showBack />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  const isOwner = goal.userId === userProfile.id;
  const ownerRole = goalOwner?.role;
  // goalOwner가 로드되었고 팀장/임원 역할이 아니면 팀원으로 취급 (role 미설정 포함)
  const ownerIsMemberLike = !!goalOwner &&
    ownerRole !== 'TEAM_LEAD' &&
    ownerRole !== 'EXECUTIVE' &&
    ownerRole !== 'CEO';

  // ── 조직 체인 기반 결재 역할 판단 ──────────────────────────
  function getOrgChain(orgId: string): Organization[] {
    const chain: Organization[] = [];
    let current = allOrgs.find(o => o.id === orgId);
    while (current) {
      chain.push(current);
      current = current.parentId ? allOrgs.find(o => o.id === current!.parentId) : undefined;
    }
    return chain;
  }

  const goalOrgChain = getOrgChain(goal.organizationId);
  const teamOrg = goalOrgChain.find(o => o.type === 'TEAM');
  const hqOrg   = goalOrgChain.find(o => o.type === 'HEADQUARTERS');
  const divOrg  = goalOrgChain.find(o => o.type === 'DIVISION');

  // ── 조직 체인 기반 역할 판단 (우선순위: 팀장 > 본부장 > 임원) ──
  // 팀장: teamOrg leaderId 일치 또는 leaderId 미설정 시 role+조직 fallback
  const iAmTeamLead = teamOrg?.leaderId === userProfile.id ||
    (!teamOrg?.leaderId && userProfile.role === 'TEAM_LEAD' && teamOrg?.id === userProfile.organizationId);

  // 본부장(중간 승인자): DIVISION이 있을 때만 의미 있음, 팀장인 경우 제외
  //   DIVISION 없는 HQ head(e.g. COMPANY→HQ→TEAM)는 최종 승인자(iAmExec)로 처리
  const iAmHQHead = !iAmTeamLead && !!divOrg && (hqOrg?.leaderId === userProfile.id);

  // 최종 승인자: 팀장·본부장이 아닌 경우에만 (CEO는 승인 권한 없음)
  //   1) DIVISION leaderId 일치
  //   2) HQ leaderId 일치 + DIVISION 없음 (HQ가 최종 레벨인 구조)
  //   3) role 기반 fallback (EXECUTIVE만) — leaderId 미설정 환경
  const iAmExec = !iAmTeamLead && !iAmHQHead && userProfile.role !== 'CEO' && (
    divOrg?.leaderId === userProfile.id ||
    (!divOrg && hqOrg?.leaderId === userProfile.id) ||
    userProfile.role === 'EXECUTIVE'
  );

  // 실질적 HQ 중간 승인 단계: HQ와 DIVISION 모두 존재할 때만
  const hasHQInChain = !!hqOrg && !!divOrg;

  const canEdit = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canDelete = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canRequestApproval = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canWithdraw = isOwner && goal.status === 'PENDING_APPROVAL';
  const canRequestCompletion = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canRequestAbandon = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status) && !showAbandonInput;
  const canRequestModify = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canUpdateProgress = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);

  // 팀장: PENDING_APPROVAL 목표 (팀원 것)
  const canLeadApprove = iAmTeamLead && ownerIsMemberLike && (
    (goal.status === 'PENDING_APPROVAL') ||
    (goal.status === 'COMPLETED' && !goal.leadApprovedBy) ||
    (goal.status === 'PENDING_ABANDON' && !goal.abandonLeadApprovedBy)  // 아직 포기 1차 미승인인 것만
  );

  // 본부장: LEAD_APPROVED 목표 중 hqApprovedBy 없는 것
  const canHQApprove = iAmHQHead && (
    (goal.status === 'LEAD_APPROVED' && !goal.hqApprovedBy) ||
    (goal.status === 'COMPLETED' && !!goal.leadApprovedBy && !goal.hqApprovedBy)
  );

  // 임원: 팀장 목표(PENDING_APPROVAL) 또는 최종 승인 대기(LEAD_APPROVED)
  const canExecApprove = iAmExec && (
    (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') ||
    (goal.status === 'LEAD_APPROVED' && (!hasHQInChain || !!goal.hqApprovedBy)) ||
    (goal.status === 'COMPLETED' && ownerRole === 'TEAM_LEAD' && !goal.approvedBy) ||
    (goal.status === 'COMPLETED' && ownerIsMemberLike && !!goal.leadApprovedBy && !goal.approvedBy && (!hasHQInChain || !!goal.hqApprovedBy)) ||
    (goal.status === 'PENDING_ABANDON' && ownerRole === 'TEAM_LEAD') ||
    (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike && !!goal.abandonLeadApprovedBy)
  );

  const canApprove = canLeadApprove || canHQApprove || canExecApprove;

  const canReject = (iAmTeamLead && ['PENDING_APPROVAL', 'COMPLETED'].includes(goal.status) && ownerIsMemberLike) ||
    (iAmHQHead && ['LEAD_APPROVED', 'COMPLETED'].includes(goal.status)) ||
    (iAmExec && ['LEAD_APPROVED', 'PENDING_APPROVAL', 'COMPLETED'].includes(goal.status));

  function getApproveLabel() {
    if (iAmTeamLead) {
      if (goal!.status === 'PENDING_APPROVAL') return '1차 승인';
      if (goal!.status === 'COMPLETED') return '완료 1차 확인';
      if (goal!.status === 'PENDING_ABANDON') return '포기 1차 승인';
    }
    if (iAmHQHead) {
      if (goal!.status === 'LEAD_APPROVED') return '2차 승인 (본부)';
      if (goal!.status === 'COMPLETED') return '완료 2차 확인';
    }
    if (iAmExec) {
      if (goal!.status === 'LEAD_APPROVED') return '최종 승인';
      if (goal!.status === 'COMPLETED') return '완료 최종 확인';
      if (goal!.status === 'PENDING_ABANDON') return '포기 최종 승인';
      return '승인';
    }
    return '승인';
  }

  const completionStep = goal.status === 'COMPLETED'
    ? (!goal.leadApprovedBy && ownerIsMemberLike
        ? '팀장 1차 확인 대기'
        : goal.leadApprovedBy && !goal.hqApprovedBy && hasHQInChain && ownerIsMemberLike
          ? '본부장 2차 확인 대기'
          : goal.leadApprovedBy && !goal.approvedBy && ownerIsMemberLike
            ? '임원 최종 확인 대기'
            : ownerRole === 'TEAM_LEAD' && !goal.approvedBy
              ? '임원 확인 대기'
              : null)
    : null;

  const goalTypeBadge = getGoalTypeBadge(goal);

  return (
    <>
    <div className="flex flex-col h-full">
      <Header title="목표 상세" showBack />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">

          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" /> 목록으로
          </button>


          <div className="rounded-xl border bg-white p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                {goalTypeBadge && (
                  <span className={`shrink-0 text-xs font-medium rounded-full px-2.5 py-0.5 ${goalTypeBadge.cls}`}>
                    {goalTypeBadge.label}
                  </span>
                )}
                <h2 className="text-xl font-bold text-gray-900">{goal.title}</h2>
                {goal.requestPromotion && (
                  <span className="shrink-0 text-xs font-medium rounded-full px-2.5 py-0.5 bg-amber-50 text-amber-700">
                    과제 반영 요청 중
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <GoalStatusBadge status={goal.status} />
                {completionStep && (
                  <span className="text-xs text-purple-600 bg-purple-50 rounded-full px-2.5 py-0.5">
                    {completionStep}
                  </span>
                )}
              </div>
            </div>

            <p className="text-gray-600 whitespace-pre-wrap">{goal.description}</p>

            <div className="flex flex-wrap items-center gap-5 text-sm text-gray-500 border-t pt-4">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                추진기한: {format(goal.dueDate, 'yyyy년 MM월 dd일', { locale: ko })}
              </span>
              {goal.goalType === 'TASK' && (
                <span className="flex items-center gap-1.5">
                  <Weight className="h-4 w-4" />
                  가중치: {goal.weight}%
                </span>
              )}
              {goal.goalType === 'GENERAL' && goal.generalType === 'OTHER' && goal.importance && (
                <span className="flex items-center gap-1.5">
                  중요도: {IMPORTANCE_LABEL[goal.importance] ?? goal.importance}
                </span>
              )}
              {goal.taskCategory === 'TEAM_LINKED' && (
                <span className="flex items-center gap-1.5 text-blue-600">
                  연동 목표
                </span>
              )}
            </div>

            {goal.status === 'REJECTED' && goal.rejectedReason && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <strong>반려 사유:</strong> {goal.rejectedReason}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">진행률</span>
                <span className="font-semibold text-gray-900">{goal.progress}%</span>
              </div>
              <Progress value={goal.progress} className="h-2" />
            </div>

            {(canEdit || canDelete || canRequestApproval || canWithdraw || canRequestCompletion || canRequestAbandon || canRequestModify) && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex gap-2 flex-wrap">
                  {canEdit && (
                    <Button
                      onClick={() => setShowEditForm(true)} disabled={actionLoading} size="sm" variant="outline"
                      className="gap-1.5"
                    >
                      <Pencil className="h-4 w-4" /> 수정
                    </Button>
                  )}
                  {canRequestModify && (
                    <Button
                      onClick={() => setShowEditForm(true)} disabled={actionLoading} size="sm" variant="outline"
                      className="gap-1.5"
                    >
                      <Pencil className="h-4 w-4" /> 수정 요청
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      onClick={handleDelete} disabled={actionLoading} size="sm" variant="outline"
                      className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" /> 삭제
                    </Button>
                  )}
                  {canRequestApproval && (
                    <Button
                      onClick={() => setShowApprovalRequestInput(v => !v)}
                      disabled={actionLoading} size="sm" className="gap-1.5"
                    >
                      {goal.status === 'REJECTED'
                        ? <><RefreshCw className="h-4 w-4" /> 재 승인요청</>
                        : <><Send className="h-4 w-4" /> 승인 요청</>
                      }
                    </Button>
                  )}
                  {canWithdraw && (
                    <Button
                      onClick={withdrawApproval} disabled={actionLoading} size="sm" variant="outline"
                      className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                      <XCircle className="h-4 w-4" /> 승인 요청 회수
                    </Button>
                  )}
                  {canRequestCompletion && (
                    <Button
                      onClick={requestCompletion} disabled={actionLoading} size="sm"
                      className="gap-1.5 bg-purple-600 hover:bg-purple-700"
                    >
                      <Flag className="h-4 w-4" /> 완료 요청
                    </Button>
                  )}
                  {canRequestAbandon && (
                    <Button
                      onClick={() => setShowAbandonInput(v => !v)}
                      disabled={actionLoading} variant="outline" size="sm"
                      className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                      <XCircle className="h-4 w-4" /> 포기 요청
                    </Button>
                  )}
                </div>

                {/* 승인요청 의견 입력 */}
                {showApprovalRequestInput && (
                  <div className="space-y-2 rounded-lg bg-gray-50 p-3">
                    <p className="text-xs font-medium text-gray-600">승인 요청 의견 <span className="text-gray-400">(선택)</span></p>
                    <Textarea
                      placeholder="승인 요청 시 전달할 의견을 입력하세요"
                      value={approvalRequestComment}
                      onChange={e => setApprovalRequestComment(e.target.value)}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button onClick={requestApproval} disabled={actionLoading} size="sm" className="gap-1.5">
                        <Send className="h-4 w-4" /> 요청 확정
                      </Button>
                      <Button onClick={() => { setShowApprovalRequestInput(false); setApprovalRequestComment(''); }} variant="outline" size="sm">취소</Button>
                    </div>
                  </div>
                )}

                {/* 포기요청 의견 입력 */}
                {showAbandonInput && (
                  <div className="space-y-2 rounded-lg bg-orange-50 border border-orange-200 p-3">
                    <p className="text-xs font-medium text-orange-700">포기 요청 의견 <span className="text-orange-400">(선택)</span></p>
                    <Textarea
                      placeholder="포기 요청 사유를 입력하세요"
                      value={abandonComment}
                      onChange={e => setAbandonComment(e.target.value)}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button onClick={requestAbandon} disabled={actionLoading} size="sm"
                        className="gap-1.5 bg-orange-500 hover:bg-orange-600">
                        <XCircle className="h-4 w-4" /> 포기 요청 확정
                      </Button>
                      <Button onClick={() => { setShowAbandonInput(false); setAbandonComment(''); }} variant="outline" size="sm">취소</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {canApprove && (
              <div className="space-y-3 pt-2 border-t">
                {/* 승인 단계 레이블 */}
                <div className="flex items-center gap-2">
                  {iAmTeamLead && goal.status === 'PENDING_APPROVAL' && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 rounded px-2 py-1">팀장 1차 승인 단계</span>
                  )}
                  {iAmHQHead && goal.status === 'LEAD_APPROVED' && (
                    <span className="text-xs text-purple-600 bg-purple-50 rounded px-2 py-1">본부장 2차 승인 단계</span>
                  )}
                  {iAmExec && goal.status === 'LEAD_APPROVED' && (
                    <span className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">임원 최종 승인 단계</span>
                  )}
                  {iAmExec && goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD' && (
                    <span className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">팀장 목표 승인</span>
                  )}
                </div>

                {/* 승인 의견 입력 (E1) */}
                {showApproveInput ? (
                  <div className="space-y-2 rounded-lg bg-green-50 border border-green-200 p-3">
                    <p className="text-xs font-medium text-green-700">
                      승인 의견 <span className="text-green-500">(선택)</span>
                    </p>
                    <Textarea
                      placeholder="승인 의견을 입력하세요"
                      value={approveComment}
                      onChange={e => setApproveComment(e.target.value)}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={approveGoal} disabled={actionLoading} size="sm"
                        className="gap-1.5 bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle2 className="h-4 w-4" /> {getApproveLabel()} 확정
                      </Button>
                      <Button onClick={() => { setShowApproveInput(false); setApproveComment(''); }} variant="outline" size="sm">취소</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setShowApproveInput(true)} disabled={actionLoading} size="sm"
                      className="gap-1.5 bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {getApproveLabel()}
                    </Button>
                    {canReject && (
                      <Button
                        onClick={() => setShowRejectInput(v => !v)} disabled={actionLoading}
                        variant="outline" size="sm"
                        className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4" /> 반려
                      </Button>
                    )}
                  </div>
                )}

                {/* 반려 의견 입력 (E2) */}
                {showRejectInput && (
                  <div className="space-y-2 rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-xs font-medium text-red-700">
                      {iAmTeamLead ? '1차 반려 의견' : iAmHQHead ? '2차 반려 의견' : '최종 반려 의견'}
                      <span className="text-red-400 ml-1">(필수)</span>
                    </p>
                    <Textarea
                      placeholder="반려 사유를 입력하세요"
                      value={rejectComment}
                      onChange={e => setRejectComment(e.target.value)}
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button onClick={rejectGoal} disabled={actionLoading} size="sm" variant="destructive">
                        반려 확정
                      </Button>
                      <Button onClick={() => { setShowRejectInput(false); setRejectComment(''); }} variant="outline" size="sm">취소</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Tabs defaultValue="progress">
            <TabsList>
              <TabsTrigger value="progress">진행상황 ({updates.length})</TabsTrigger>
              <TabsTrigger value="history">변경 이력 ({histories.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="progress" className="mt-4 space-y-4">
              {canUpdateProgress && (
                <div className="rounded-xl border bg-white p-5 space-y-4">
                  <h4 className="font-medium text-gray-900">진행상황 업데이트</h4>
                  <div className="space-y-1.5">
                    <Label>진행률: {newProgress}%</Label>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={newProgress}
                      onChange={e => setNewProgress(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>코멘트 *</Label>
                    <Textarea
                      placeholder="진행 내용을 기록하세요"
                      value={progressComment}
                      onChange={e => setProgressComment(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button onClick={submitProgress} disabled={actionLoading || !progressComment.trim()} size="sm">
                    업데이트
                  </Button>
                </div>
              )}
              {updates.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">진행상황 기록이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {updates.map(u => (
                    <div key={u.id} className="rounded-xl border bg-white p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{format(u.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</span>
                        <span className="font-medium text-blue-600">{u.progress}%</span>
                      </div>
                      <p className="text-sm text-gray-700">{u.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              {histories.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">변경 이력이 없습니다.</p>
              ) : (
                <div className="relative pl-5">
                  <div className="absolute left-2 top-0 bottom-0 w-px bg-gray-200" />
                  {histories.map(h => (
                    <div key={h.id} className="relative mb-4 pl-4">
                      <div className="absolute -left-0.5 top-1.5 h-2 w-2 rounded-full bg-blue-400" />
                      <div className="rounded-xl border bg-white p-3">
                        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                          <span>{format(h.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</span>
                          {h.newStatus && <GoalStatusBadge status={h.newStatus} />}
                        </div>
                        {h.comment && <p className="text-sm text-gray-700">{h.comment}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>

    {/* 수정 폼 모달 — showEditForm일 때만 마운트하고 open={true} 고정
        (false→true 전환 방식 대신 조건부 마운트로 Dialog가 반드시 열림) */}
    {showEditForm && goal.goalType !== 'GENERAL' && (
      <TaskGoalForm
        open={true}
        onClose={() => setShowEditForm(false)}
        onSave={() => { setShowEditForm(false); load(); }}
        editGoal={goal}
      />
    )}
    {showEditForm && goal.goalType === 'GENERAL' && (
      <GeneralGoalForm
        open={true}
        onClose={() => setShowEditForm(false)}
        onSave={() => { setShowEditForm(false); load(); }}
        editGoal={goal}
      />
    )}
    </>
  );
}
