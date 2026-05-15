'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ArrowLeft, Calendar, Send, XCircle, CheckCircle2, Flag, MessageSquare, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  updateGoal,
  deleteGoal,
  addGoalHistory,
  getGoalHistories,
  addProgressUpdate,
  getProgressUpdates,
  updateProgressUpdate,
  deleteProgressUpdate,
  getUser,
  getOrganizations,
  COLLECTIONS,
  createNotification,
} from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Header from '@/components/layout/Header';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import TaskGoalForm from '@/components/goals/TaskGoalForm';
import { toast } from 'sonner';
import type { Goal, GoalHistory, ProgressUpdate, User, Organization } from '@/types';
import { fromTimestamp } from '@/lib/firestore';
import { Timestamp } from 'firebase/firestore';

export default function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { userProfile } = useAuth();
  const router = useRouter();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [goalOwner, setGoalOwner] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [histories, setHistories] = useState<GoalHistory[]>([]);
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // 진행률 업데이트 (본인 전용)
  const [newProgress, setNewProgress] = useState(0);
  const [progressComment, setProgressComment] = useState('');

  // 코멘트 (팀/부문 자유)
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  // 수정 폼
  const [formOpen, setFormOpen] = useState(false);

  // 반려
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  // 승인 의견
  const [approveComment, setApproveComment] = useState('');
  const [showApproveInput, setShowApproveInput] = useState(false);

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
        completionLeadApprovedAt: fromTimestamp(data.completionLeadApprovedAt as Timestamp),
        completionApprovedAt: fromTimestamp(data.completionApprovedAt as Timestamp),
        abandonLeadApprovedAt: fromTimestamp(data.abandonLeadApprovedAt as Timestamp),
      } as Goal;

      const [owner, h, rawUpdates, allOrgs] = await Promise.all([
        getUser(loadedGoal.userId),
        getGoalHistories(id),
        getProgressUpdates(id),
        getOrganizations(),
      ]);

      // userInfo 없는 기존 데이터: userId로 사용자 정보 동적 보완
      const missingUserIds = [...new Set(
        rawUpdates.filter(u => !u.userInfo?.name).map(u => u.userId)
      )];
      const fetchedUsers = await Promise.all(missingUserIds.map(uid => getUser(uid)));
      const userMap = new Map<string, User | null>(
        missingUserIds.map((uid, i) => [uid, fetchedUsers[i]])
      );

      const enrichedUpdates = rawUpdates.map(u => {
        if (u.userInfo?.name) return u;
        const fetchedUser = userMap.get(u.userId);
        if (!fetchedUser) return u;
        const myOrg = allOrgs.find(o => o.id === fetchedUser.organizationId);
        const parentOrg = myOrg?.parentId ? allOrgs.find(o => o.id === myOrg.parentId) : undefined;
        return {
          ...u,
          userInfo: {
            name: fetchedUser.name,
            position: fetchedUser.position,
            teamName: myOrg?.name,
            divisionName: parentOrg?.name,
          },
        };
      });

      setGoal(loadedGoal);
      setGoalOwner(owner);
      setOrgs(allOrgs);
      setNewProgress(loadedGoal.progress);
      setHistories(h);
      setUpdates(enrichedUpdates);
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

  // 목표 소속 조직의 팀장/임원 ID 조회 (orgs는 이미 로드된 상태)
  function getGoalLeadAndExecIds() {
    const goalOrg = orgs.find(o => o.id === goal?.organizationId);
    const parentOrg = goalOrg?.parentId ? orgs.find(o => o.id === goalOrg.parentId) : undefined;
    return {
      leadId: goalOrg?.leaderId ?? null,
      execId: parentOrg?.leaderId ?? null,
    };
  }

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
        comment: '승인 요청',
      });
      const { leadId, execId } = getGoalLeadAndExecIds();
      const notifBase = {
        goalId: id, goalTitle: goal.title,
        type: 'GOAL_SUBMITTED' as const,
        message: `${userProfile.name}님이 '${goal.title}' 목표 승인을 요청했습니다.`,
        read: false,
      };
      // 팀장 목표 → 임원에게 직접, 팀원 목표 → 팀장에게 (임원은 팀장 승인 후 단계적으로)
      if (userProfile.role === 'TEAM_LEAD') {
        if (execId && execId !== userProfile.id) await createNotification({ userId: execId, ...notifBase });
      } else {
        if (leadId && leadId !== userProfile.id) await createNotification({ userId: leadId, ...notifBase });
      }
      toast.success('승인 요청을 보냈습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function requestCompletion() {
    if (!goal || !userProfile) return;
    setActionLoading(true);
    try {
      setNewProgress(100); // 슬라이더 즉시 반영
      await updateGoal(id, { status: 'PENDING_COMPLETION', progress: 100 });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: 'PENDING_COMPLETION',
        comment: '완료 요청',
      });
      const { leadId: cLeadId, execId: cExecId } = getGoalLeadAndExecIds();
      const notifBase = {
        goalId: id, goalTitle: goal.title,
        type: 'COMPLETION_REQUESTED' as const,
        message: `${userProfile.name}님이 '${goal.title}' 완료 확인을 요청했습니다.`,
        read: false,
      };
      // 팀장 목표 → 임원에게 직접, 팀원 목표 → 팀장에게
      if (userProfile.role === 'TEAM_LEAD') {
        if (cExecId && cExecId !== userProfile.id) await createNotification({ userId: cExecId, ...notifBase });
      } else {
        if (cLeadId && cLeadId !== userProfile.id) await createNotification({ userId: cLeadId, ...notifBase });
      }
      toast.success('완료 확인 요청을 보냈습니다.');
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
        comment: '포기 요청',
      });
      const { leadId: aLeadId, execId: aExecId } = getGoalLeadAndExecIds();
      const notifBase = {
        goalId: id, goalTitle: goal.title,
        type: 'ABANDON_REQUESTED' as const,
        message: `${userProfile.name}님이 '${goal.title}' 포기를 요청했습니다.`,
        read: false,
      };
      // 팀장 목표 → 임원에게 직접, 팀원 목표 → 팀장에게
      if (userProfile.role === 'TEAM_LEAD') {
        if (aExecId && aExecId !== userProfile.id) await createNotification({ userId: aExecId, ...notifBase });
      } else {
        if (aLeadId && aLeadId !== userProfile.id) await createNotification({ userId: aLeadId, ...notifBase });
      }
      toast.success('포기 요청을 보냈습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  // 휴지통 → 복구 (DRAFT로 되돌리기)
  async function handleRestoreGoal() {
    if (!goal) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'DRAFT' });
      toast.success('목표를 복구했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  // DRAFT 목표 삭제 → 휴지통으로 이동
  async function handleDeleteGoal() {
    if (!goal || goal.status !== 'DRAFT') return;
    if (!confirm('임시저장된 목표를 휴지통으로 이동하시겠습니까?')) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'ABANDONED' });
      toast.success('휴지통으로 이동했습니다.');
      router.push('/goals');
    } finally { setActionLoading(false); }
  }

  // 요청 회수 (승인 요청 / 완료 요청 / 포기 요청)
  async function withdrawRequest() {
    if (!goal || !userProfile) return;
    setActionLoading(true);
    try {
      let revertStatus: Goal['status'];
      let msg = '';

      if (goal.status === 'PENDING_APPROVAL') {
        revertStatus = 'DRAFT';
        msg = '승인 요청을 회수했습니다.';
      } else if (goal.status === 'PENDING_COMPLETION') {
        revertStatus = 'IN_PROGRESS';
        msg = '완료 요청을 회수했습니다.';
      } else if (goal.status === 'PENDING_MODIFY') {
        // 반려(REJECTED)된 목표가 잘못 PENDING_MODIFY로 들어온 경우 DRAFT로
        if (goal.rejectedReason && !goal.approvedAt) {
          revertStatus = 'DRAFT';
        } else {
          revertStatus = goal.progress > 0 ? 'IN_PROGRESS' : 'APPROVED';
        }
        msg = '수정 요청을 회수했습니다.';
      } else if (goal.status === 'PENDING_ABANDON') {
        revertStatus = goal.progress > 0 ? 'IN_PROGRESS' : 'APPROVED';
        msg = '포기 요청을 회수했습니다.';
      } else {
        return;
      }

      await updateGoal(id, { status: revertStatus });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: revertStatus,
        comment: msg,
      });
      toast.success(msg);
      await load();
    } finally { setActionLoading(false); }
  }

  // 작성자 조직 정보 스냅샷 빌드
  function buildUserInfo() {
    if (!userProfile) return undefined;
    const myOrg = orgs.find(o => o.id === userProfile.organizationId);
    const parentOrg = myOrg?.parentId ? orgs.find(o => o.id === myOrg.parentId) : undefined;
    return {
      name: userProfile.name,
      position: userProfile.position,
      teamName: myOrg?.name,
      divisionName: parentOrg?.name,
    };
  }

  // 진행률 업데이트 (본인 전용 — progress % 변경)
  async function submitProgress() {
    if (!goal || !userProfile) return;
    setActionLoading(true);
    try {
      await addProgressUpdate({
        goalId: id, userId: userProfile.id,
        progress: newProgress,
        comment: progressComment.trim(),
        type: 'PROGRESS',
        userInfo: buildUserInfo(),
      });
      await updateGoal(id, {
        progress: newProgress,
        status: goal.status === 'APPROVED' ? 'IN_PROGRESS' : goal.status,
      });
      setProgressComment('');
      toast.success('진행률이 업데이트되었습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  // 자유 코멘트 (팀/부문 인원)
  async function submitComment() {
    if (!goal || !userProfile || !commentText.trim()) return;
    setActionLoading(true);
    try {
      await addProgressUpdate({
        goalId: id, userId: userProfile.id,
        progress: undefined,
        comment: commentText.trim(),
        type: 'COMMENT',
        userInfo: buildUserInfo(),
      });
      setCommentText('');
      toast.success('의견을 등록했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function saveEditComment(commentId: string) {
    if (!editingCommentText.trim()) return;
    setActionLoading(true);
    try {
      await updateProgressUpdate(commentId, editingCommentText.trim());
      setEditingCommentId(null);
      setEditingCommentText('');
      toast.success('의견을 수정했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function handleDeleteComment(commentId: string) {
    if (!confirm('이 의견을 삭제하시겠습니까?')) return;
    setActionLoading(true);
    try {
      await deleteProgressUpdate(commentId);
      toast.success('의견을 삭제했습니다.');
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

      if (isLead) {
        if (goal.status === 'PENDING_APPROVAL' && ownerIsMemberLike) {
          newStatus = 'LEAD_APPROVED';
          updateData = { status: 'LEAD_APPROVED', leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          successMsg = '1차 승인 완료. 임원의 최종 승인을 기다립니다.';
        } else if (goal.status === 'PENDING_COMPLETION' && !goal.completionLeadApprovedBy && ownerIsMemberLike) {
          updateData = { completionLeadApprovedBy: userProfile.id, completionLeadApprovedAt: new Date() };
          successMsg = '완료 1차 확인. 임원 최종 확인 대기 중.';
        } else if (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike && !goal.abandonLeadApprovedBy) {
          // 포기 1차 승인 — 상태 유지, 임원 최종 승인 대기
          updateData = { abandonLeadApprovedBy: userProfile.id, abandonLeadApprovedAt: new Date() };
          successMsg = '포기 1차 승인. 임원의 최종 승인을 기다립니다.';
        }
      } else if (isExec) {
        if (goal.status === 'LEAD_APPROVED' && ownerIsMemberLike) {
          newStatus = 'APPROVED';
          updateData = { status: 'APPROVED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '최종 승인 완료.';
        } else if (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') {
          newStatus = 'APPROVED';
          updateData = { status: 'APPROVED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '승인 완료.';
        } else if (goal.status === 'PENDING_COMPLETION' && !!goal.completionLeadApprovedBy && !goal.completionApprovedBy && ownerIsMemberLike) {
          newStatus = 'COMPLETED';
          updateData = { status: 'COMPLETED', completionApprovedBy: userProfile.id, completionApprovedAt: new Date() };
          successMsg = '완료 최종 확인.';
        } else if (goal.status === 'PENDING_COMPLETION' && !goal.completionApprovedBy && ownerRole === 'TEAM_LEAD') {
          newStatus = 'COMPLETED';
          updateData = { status: 'COMPLETED', completionApprovedBy: userProfile.id, completionApprovedAt: new Date() };
          successMsg = '완료 확인.';
        } else if (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike && !!goal.abandonLeadApprovedBy) {
          // 포기 최종 승인 (팀원 → 2단계)
          newStatus = 'ABANDONED';
          updateData = { status: 'ABANDONED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '포기 최종 승인.';
        } else if (goal.status === 'PENDING_ABANDON' && ownerRole === 'TEAM_LEAD') {
          // 팀장 목표 포기 → 임원 단독 승인
          newStatus = 'ABANDONED';
          updateData = { status: 'ABANDONED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '포기 승인.';
        }
      }

      if (Object.keys(updateData).length === 0) return;
      await updateGoal(id, updateData);
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'APPROVED',
        previousStatus: goal.status, newStatus,
        comment: approveComment.trim() || undefined,
      });
      setApproveComment('');
      setShowApproveInput(false);
      toast.success(successMsg);

      // ── 알림 발송 ──
      const { leadId, execId } = getGoalLeadAndExecIds();

      // 목표 승인 흐름 알림 (목표 소유자에게)
      const ownerNotifMap: Record<string, { type: any; message: string }> = {
        LEAD_APPROVED: { type: 'GOAL_LEAD_APPROVED', message: `'${goal.title}' 목표가 1차 승인되었습니다.` },
        APPROVED: { type: 'GOAL_APPROVED', message: `'${goal.title}' 목표가 승인되었습니다.` },
        ABANDONED: { type: 'ABANDON_APPROVED', message: `'${goal.title}' 포기 요청이 최종 승인되었습니다.` },
      };
      const completionMsg = ownerRole === 'TEAM_LEAD'
        ? `'${goal.title}' 완료가 확인되었습니다.`
        : (newStatus === 'COMPLETED' ? `'${goal.title}' 완료가 최종 확인되었습니다.` : `'${goal.title}' 완료가 1차 확인되었습니다.`);

      if (ownerNotifMap[newStatus]) {
        await createNotification({
          userId: goal.userId,
          goalId: id, goalTitle: goal.title,
          type: ownerNotifMap[newStatus].type,
          message: ownerNotifMap[newStatus].message,
          read: false,
        });
      } else if (updateData.completionApprovedBy || updateData.completionLeadApprovedBy) {
        // 소유자에게 알림
        await createNotification({
          userId: goal.userId,
          goalId: id, goalTitle: goal.title,
          type: 'COMPLETION_APPROVED',
          message: completionMsg,
          read: false,
        });
        // 완료 1차 확인 후 임원에게 최종 확인 요청 알림
        if (updateData.completionLeadApprovedBy && execId && execId !== userProfile.id) {
          await createNotification({
            userId: execId,
            goalId: id, goalTitle: goal.title,
            type: 'COMPLETION_REQUESTED',
            message: `'${goal.title}' 완료 최종 확인이 필요합니다. (팀장 1차 확인 완료)`,
            read: false,
          });
        }
      } else if (updateData.abandonLeadApprovedBy) {
        // 포기 1차 승인 — 소유자에게 1차 승인 알림
        await createNotification({
          userId: goal.userId,
          goalId: id, goalTitle: goal.title,
          type: 'ABANDON_LEAD_APPROVED',
          message: `'${goal.title}' 포기 요청이 1차 승인되었습니다. 임원 최종 승인을 기다립니다.`,
          read: false,
        });
        // 임원에게도 최종 승인 요청 알림
        if (execId && execId !== userProfile.id) {
          await createNotification({
            userId: execId,
            goalId: id, goalTitle: goal.title,
            type: 'ABANDON_REQUESTED',
            message: `'${goal.title}' 포기 요청 최종 승인이 필요합니다. (팀장 1차 승인 완료)`,
            read: false,
          });
        }
      }

      // 목표 1차 승인 후 임원에게 최종 승인 요청 알림
      if (newStatus === 'LEAD_APPROVED' && execId && execId !== userProfile.id) {
        await createNotification({
          userId: execId,
          goalId: id, goalTitle: goal.title,
          type: 'GOAL_SUBMITTED',
          message: `'${goal.title}' 목표 최종 승인이 필요합니다. (팀장 1차 승인 완료)`,
          read: false,
        });
      }

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
      if (goal.status === 'PENDING_COMPLETION') {
        newStatus = 'IN_PROGRESS';
      } else if (goal.status === 'PENDING_ABANDON') {
        newStatus = goal.progress > 0 ? 'IN_PROGRESS' : 'APPROVED';
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
      toast.success(
        goal.status === 'PENDING_COMPLETION' ? '완료 요청을 반려했습니다.' :
        goal.status === 'PENDING_ABANDON' ? '포기 요청을 반려했습니다.' :
        '반려 처리했습니다.'
      );
      // 알림 발송
      const rejectNotifType = goal.status === 'PENDING_ABANDON' ? 'ABANDON_REJECTED' :
        goal.status === 'PENDING_COMPLETION' ? 'COMPLETION_REJECTED' : 'GOAL_REJECTED';
      const rejectNotifMsg = goal.status === 'PENDING_ABANDON' ? `'${goal.title}' 포기 요청이 반려되었습니다.` :
        goal.status === 'PENDING_COMPLETION' ? `'${goal.title}' 완료 요청이 반려되었습니다.` :
        `'${goal.title}' 목표가 반려되었습니다.`;
      await createNotification({
        userId: goal.userId,
        goalId: id,
        goalTitle: goal.title,
        type: rejectNotifType,
        message: rejectNotifMsg,
        read: false,
      });
      await load();
    } finally { setActionLoading(false); }
  }

  if (loading || !goal || !userProfile) {
    return (
      <div className="flex flex-col h-full">
        <Header title="목표 상세" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  const isOwner = goal.userId === userProfile.id;
  const isLead = userProfile.role === 'TEAM_LEAD';
  const isExec = userProfile.role === 'EXECUTIVE';
  const ownerRole = goalOwner?.role;

  const ownerIsMemberLike = ownerRole === 'MEMBER';

  const canEdit = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canRequestApproval = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canRequestCompletion = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canRequestAbandon = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canUpdateProgress = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  // 완료됨(COMPLETED)은 회수·삭제 불가
  const canWithdraw = isOwner && ['PENDING_APPROVAL', 'PENDING_COMPLETION', 'PENDING_ABANDON', 'PENDING_MODIFY'].includes(goal.status);
  const canDelete = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  // 포기 승인됨(approvedBy 있음)은 복구 불가 — 직접 삭제한 것만 복구 허용
  const canRestore = isOwner && goal.status === 'ABANDONED' && !goal.approvedBy;

  // 코멘트: 같은 조직 또는 승인 권한자
  const canComment = ['APPROVED', 'IN_PROGRESS', 'PENDING_COMPLETION', 'COMPLETED', 'REJECTED', 'ABANDONED'].includes(goal.status) &&
    (isOwner || userProfile.organizationId === goal.organizationId || isLead || isExec);

  const canLeadApprove = isLead && (
    (ownerIsMemberLike && goal.status === 'PENDING_APPROVAL') ||
    (ownerIsMemberLike && goal.status === 'PENDING_COMPLETION' && !goal.completionLeadApprovedBy) ||
    // 포기 1차 승인: 아직 팀장 승인 안 된 경우만
    (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike && !goal.abandonLeadApprovedBy)
  );

  const canExecApprove = isExec && (
    (ownerIsMemberLike && goal.status === 'LEAD_APPROVED') ||
    (ownerRole === 'TEAM_LEAD' && goal.status === 'PENDING_APPROVAL') ||
    (ownerIsMemberLike && goal.status === 'PENDING_COMPLETION' && !!goal.completionLeadApprovedBy && !goal.completionApprovedBy) ||
    (ownerRole === 'TEAM_LEAD' && goal.status === 'PENDING_COMPLETION' && !goal.completionApprovedBy) ||
    // 포기 최종 승인: 팀원은 반드시 팀장 1차 승인 후에만, 팀장은 바로 승인
    (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike && !!goal.abandonLeadApprovedBy) ||
    (goal.status === 'PENDING_ABANDON' && ownerRole === 'TEAM_LEAD')
  );

  const canApprove = canLeadApprove || canExecApprove;

  const canReject = (isLead && ['PENDING_APPROVAL', 'PENDING_COMPLETION', 'PENDING_ABANDON'].includes(goal.status) && ownerIsMemberLike) ||
    (isExec && ['LEAD_APPROVED', 'PENDING_APPROVAL', 'PENDING_COMPLETION', 'PENDING_ABANDON'].includes(goal.status));

  function getApproveLabel() {
    if (isLead) {
      if (goal!.status === 'PENDING_APPROVAL') return '목표 승인';
      if (goal!.status === 'PENDING_COMPLETION') return '완료 1차 확인';
      if (goal!.status === 'PENDING_ABANDON') return '포기 1차 승인';
    }
    if (isExec) {
      if (goal!.status === 'LEAD_APPROVED') return '최종 승인';
      if (goal!.status === 'PENDING_COMPLETION') return ownerIsMemberLike ? '완료 최종 확인' : '완료 확인';
      if (goal!.status === 'PENDING_ABANDON') return ownerIsMemberLike ? '포기 최종 승인' : '포기 승인';
      return '승인';
    }
    return '승인';
  }

  const completionStep = goal.status === 'PENDING_COMPLETION'
    ? (!goal.completionLeadApprovedBy && ownerIsMemberLike
        ? '팀장 1차 확인 대기'
        : goal.completionLeadApprovedBy && !goal.completionApprovedBy && ownerIsMemberLike
          ? '임원 최종 확인 대기'
          : ownerRole === 'TEAM_LEAD' && !goal.completionApprovedBy
            ? '임원 확인 대기'
            : null)
    : null;

  // 포기 요청 단계 표시 (팀원의 경우 2단계)
  const abandonStep = goal.status === 'PENDING_ABANDON' && ownerIsMemberLike
    ? (!goal.abandonLeadApprovedBy ? '팀장 1차 승인 대기' : '임원 최종 승인 대기')
    : null;

  const progressUpdates = updates.filter(u => u.type !== 'COMMENT');
  const commentUpdates = updates.filter(u => u.type === 'COMMENT');

  // 소속/팀/이름/직급 포맷 빌더 (없는 항목은 생략)
  function formatUserLabel(u: ProgressUpdate) {
    const info = u.userInfo;
    if (!info?.name) return null;
    const parts: string[] = [];
    if (info.divisionName) parts.push(info.divisionName);
    if (info.teamName) parts.push(info.teamName);
    parts.push(info.name);
    if (info.position) parts.push(info.position);
    return parts.join(' / ');
  }

  return (
    <>
    <div className="flex flex-col h-full">
      <Header title="목표 상세" />
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
                <h2 className="text-xl font-bold text-gray-900">{goal.title}</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <GoalStatusBadge status={goal.status} />
                {completionStep && (
                  <span className="text-xs text-purple-600 bg-purple-50 rounded-full px-2.5 py-0.5">
                    {completionStep}
                  </span>
                )}
                {abandonStep && (
                  <span className="text-xs text-orange-600 bg-orange-50 rounded-full px-2.5 py-0.5">
                    {abandonStep}
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
            </div>

            {goal.status === 'REJECTED' && goal.rejectedReason && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <strong>반려 사유:</strong> {goal.rejectedReason}
              </div>
            )}

            {goal.status !== 'ABANDONED' && <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">진행률</span>
                <span className="font-semibold text-gray-900">{goal.progress}%</span>
              </div>
              <Progress value={goal.progress} className="h-2" />
            </div>}

            {(canEdit || canRequestApproval || canRequestCompletion || canRequestAbandon || canWithdraw || canDelete || canRestore) && (
              <div className="flex gap-2 pt-2 border-t flex-wrap">
                {canEdit && (
                  <Button
                    onClick={() => setFormOpen(true)} disabled={actionLoading} size="sm"
                    variant="outline" className="gap-1.5"
                  >
                    <Pencil className="h-4 w-4" /> 수정
                  </Button>
                )}
                {canRequestApproval && (
                  <Button onClick={requestApproval} disabled={actionLoading} size="sm" className="gap-1.5">
                    <Send className="h-4 w-4" /> 승인 요청
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
                    onClick={requestAbandon} disabled={actionLoading} variant="outline" size="sm"
                    className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                  >
                    <XCircle className="h-4 w-4" /> 포기 요청
                  </Button>
                )}
                {canWithdraw && (
                  <Button
                    onClick={withdrawRequest} disabled={actionLoading} variant="outline" size="sm"
                    className="gap-1.5 text-gray-500 border-gray-300 hover:bg-gray-50"
                  >
                    <RotateCcw className="h-4 w-4" /> 회수
                  </Button>
                )}
                {canRestore && (
                  <Button
                    onClick={handleRestoreGoal} disabled={actionLoading} variant="outline" size="sm"
                    className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                  >
                    <RotateCcw className="h-4 w-4" /> 복구
                  </Button>
                )}
                {canDelete && (
                  <Button
                    onClick={handleDeleteGoal} disabled={actionLoading} variant="outline" size="sm"
                    className="gap-1.5 text-red-500 border-red-300 hover:bg-red-50 ml-auto"
                  >
                    <Trash2 className="h-4 w-4" /> 삭제
                  </Button>
                )}
              </div>
            )}

            {canApprove && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center gap-2">
                  {isLead && goal.status === 'PENDING_APPROVAL' && ownerIsMemberLike && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 rounded px-2 py-1">목표 승인</span>
                  )}
                  {isExec && goal.status === 'LEAD_APPROVED' && (
                    <span className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">임원 최종 승인 단계</span>
                  )}
                  {isExec && goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD' && (
                    <span className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">팀장 목표 승인</span>
                  )}
                </div>
                {/* 승인 의견 입력 토글 */}
                {showApproveInput ? (
                  <div className="space-y-2 rounded-lg bg-green-50 border border-green-200 p-3">
                    <Label className="text-sm text-green-800">승인 의견 <span className="text-gray-400 font-normal">(선택)</span></Label>
                    <Textarea
                      placeholder="승인 의견을 입력하세요 (생략 가능)"
                      value={approveComment}
                      onChange={e => setApproveComment(e.target.value)}
                      rows={2}
                      className="bg-white"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={approveGoal} disabled={actionLoading} size="sm"
                        className="gap-1.5 bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {getApproveLabel()} 확정
                      </Button>
                      <Button
                        onClick={() => { setShowApproveInput(false); setApproveComment(''); }}
                        disabled={actionLoading} variant="outline" size="sm"
                      >
                        취소
                      </Button>
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
                {showRejectInput && !showApproveInput && (
                  <div className="space-y-2 rounded-lg bg-red-50 border border-red-200 p-3">
                    <Label className="text-sm text-red-800">반려 사유 <span className="text-red-500">*</span></Label>
                    <Textarea
                      placeholder="반려 사유를 입력하세요"
                      value={rejectComment}
                      onChange={e => setRejectComment(e.target.value)}
                      rows={3}
                      className="bg-white"
                    />
                    <Button onClick={rejectGoal} disabled={actionLoading} size="sm" variant="destructive">
                      반려 확정
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <Tabs defaultValue="progress">
            <TabsList>
              <TabsTrigger value="progress">
                진행상황 ({progressUpdates.length})
              </TabsTrigger>
              <TabsTrigger value="comments">
                Comment ({commentUpdates.length})
              </TabsTrigger>
              <TabsTrigger value="history">변경 이력 ({histories.length})</TabsTrigger>
            </TabsList>

            {/* ── 진행상황 탭 (본인 전용 업데이트) ── */}
            <TabsContent value="progress" className="mt-4 space-y-4">
              {canUpdateProgress && (
                <div className="rounded-xl border bg-white p-5 space-y-4">
                  <h4 className="font-medium text-gray-900">진행률 업데이트</h4>
                  <div className="space-y-1.5">
                    <Label>진행률: <span className="font-semibold text-blue-600">{newProgress}%</span></Label>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={newProgress}
                      onChange={e => setNewProgress(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>메모 <span className="text-gray-400 font-normal text-xs">(선택)</span></Label>
                    <Textarea
                      placeholder="진행 내용을 간략히 기록하세요"
                      value={progressComment}
                      onChange={e => setProgressComment(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <Button onClick={submitProgress} disabled={actionLoading} size="sm">
                    진행률 저장
                  </Button>
                </div>
              )}
              {progressUpdates.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">진행상황 기록이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {progressUpdates.map(u => (
                    <div key={u.id} className="rounded-xl border bg-white p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">{format(u.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</span>
                        <span className="font-bold text-blue-600 text-sm">{u.progress}%</span>
                      </div>
                      {u.comment
                        ? <p className="text-sm text-gray-700">{u.comment}</p>
                        : <p className="text-sm text-gray-400 italic">메모 없음</p>
                      }
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Comment 탭 ── */}
            <TabsContent value="comments" className="mt-4 space-y-4">
              {canComment && (
                <div className="rounded-xl border bg-white p-5 space-y-3">
                  <h4 className="font-medium text-gray-900 flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-gray-400" />
                    Comment 남기기
                  </h4>
                  <Textarea
                    placeholder="목표에 대한 Comment를 남겨보세요"
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    rows={3}
                  />
                  <Button onClick={submitComment} disabled={actionLoading || !commentText.trim()} size="sm" variant="outline">
                    Comment 등록
                  </Button>
                </div>
              )}
              {commentUpdates.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">등록된 의견이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {commentUpdates.map(u => {
                    const label = formatUserLabel(u);
                    const isMyComment = u.userId === userProfile.id;
                    const isEditing = editingCommentId === u.id;
                    return (
                      <div key={u.id} className="rounded-xl border bg-white p-4 space-y-2">
                        {/* 헤더: 작성자 정보 + 날짜 + 액션 */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            {label && <p className="text-xs font-medium text-gray-600">{label}</p>}
                            <p className="text-xs text-gray-400">{format(u.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</p>
                          </div>
                          {isMyComment && !isEditing && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => { setEditingCommentId(u.id); setEditingCommentText(u.comment); }}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                                title="수정"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteComment(u.id)}
                                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                title="삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                        {/* 본문 or 편집 모드 */}
                        {isEditing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editingCommentText}
                              onChange={e => setEditingCommentText(e.target.value)}
                              rows={3}
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => saveEditComment(u.id)}
                                disabled={actionLoading || !editingCommentText.trim()}
                              >
                                저장
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                onClick={() => { setEditingCommentId(null); setEditingCommentText(''); }}
                                disabled={actionLoading}
                              >
                                취소
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{u.comment}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── 변경 이력 탭 ── */}
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

    {/* 수정 폼 */}
    <TaskGoalForm
      open={formOpen}
      onClose={() => setFormOpen(false)}
      onSave={() => { setFormOpen(false); load(); }}
      editGoal={goal ?? undefined}
    />
    </>
  );
}
