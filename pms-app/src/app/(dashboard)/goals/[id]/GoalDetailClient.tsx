'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ArrowLeft, Calendar, Weight, Send, XCircle, CheckCircle2, Flag, CheckCheck, Pencil, Trash2, MessageSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  updateGoal,
  deleteGoal,
  addGoalHistory,
  getGoalHistories,
  addProgressUpdate,
  getProgressUpdates,
  getGoalComments,
  addGoalComment,
  updateGoalComment,
  deleteGoalComment,
  getUser,
  getOrganizations,
  createNotification,
  COLLECTIONS,
} from '@/lib/firestore';
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
import type { Goal, GoalHistory, ProgressUpdate, GoalComment, User, Organization } from '@/types';
import { fromTimestamp } from '@/lib/firestore';
import { Timestamp } from 'firebase/firestore';

const GOAL_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  'TASK': { label: '과제업무', cls: 'bg-blue-100 text-blue-700' },
  'MAJOR': { label: '주요업무', cls: 'bg-green-100 text-green-700' },
};

function getGoalTypeBadge(goal: Goal) {
  if (goal.goalType === 'TASK') return GOAL_TYPE_BADGE['TASK'];
  if (goal.goalType === 'GENERAL') return GOAL_TYPE_BADGE['MAJOR'];
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
  const [histories, setHistories] = useState<GoalHistory[]>([]);
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [newProgress, setNewProgress] = useState(0);
  const [progressComment, setProgressComment] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const [showApproveInput, setShowApproveInput] = useState(false);

  // 수정 요청
  const [showModifyRequest, setShowModifyRequest] = useState(false);
  const [modifyTitle, setModifyTitle] = useState('');
  const [modifyDescription, setModifyDescription] = useState('');
  const [modifyComment, setModifyComment] = useState('');

  // 댓글
  const [comments, setComments] = useState<GoalComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentContent, setEditingCommentContent] = useState('');

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
      } as Goal;

      const [owner, h, u, c] = await Promise.all([
        getUser(loadedGoal.userId),
        getGoalHistories(id),
        getProgressUpdates(id),
        getGoalComments(id),
      ]);
      // 이력/진행상황 작성자 이름 맵 구성
      const actorIds = [
        ...new Set([
          ...h.map(x => x.changedBy),
          ...u.map(x => x.userId),
        ]),
      ].filter(Boolean);
      const actorUsers = await Promise.all(actorIds.map(uid => getUser(uid)));
      const map: Record<string, string> = {};
      actorUsers.forEach(user => { if (user) map[user.id] = user.name; });
      setUsersMap(map);
      setGoal(loadedGoal);
      setGoalOwner(owner);
      setNewProgress(loadedGoal.progress);
      setHistories(h);
      setUpdates(u);
      setComments(c);
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
  async function moveToTrash() {
    if (!goal || !userProfile) return;
    if (!confirm('이 목표를 휴지통으로 이동하시겠습니까?')) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'ABANDONED' });
      toast.success('휴지통으로 이동했습니다.');
      router.push('/goals');
    } finally { setActionLoading(false); }
  }

  async function withdrawApproval() {
    if (!goal || !userProfile) return;
    setActionLoading(true);
    try {
      await updateGoal(id, { status: 'DRAFT' });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: 'DRAFT',
        comment: '승인 요청 회수',
      });
      toast.success('승인 요청을 회수했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

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
      // 상위 결재자에게 알림 발송
      try {
        const orgs = await getOrganizations();
        const myOrg = orgs.find(o => o.id === userProfile.organizationId);
        // 팀원 → 팀장 알림
        if (userProfile.role === 'MEMBER' && myOrg?.leaderId) {
          await createNotification({
            userId: myOrg.leaderId, goalId: id, goalTitle: goal.title,
            type: 'GOAL_SUBMITTED',
            message: `${userProfile.name}님이 "${goal.title}" 목표 승인을 요청했습니다.`,
            read: false,
          });
        }
        // 팀장 → 임원 알림 (팀장이 자신의 목표 상신)
        if (userProfile.role === 'TEAM_LEAD') {
          const parentOrg = myOrg?.parentId ? orgs.find(o => o.id === myOrg.parentId) : null;
          const execId = parentOrg?.leaderId;
          if (execId) {
            await createNotification({
              userId: execId, goalId: id, goalTitle: goal.title,
              type: 'GOAL_SUBMITTED',
              message: `${userProfile.name}님이 "${goal.title}" 목표 승인을 요청했습니다.`,
              read: false,
            });
          }
        }
      } catch { /* 알림 실패는 무시 */ }
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
        comment: '포기 요청',
      });
      toast.success('팀장에게 포기 요청을 보냈습니다.');
      await load();
    } finally { setActionLoading(false); }
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

      if (isLead) {
        if (goal.goalType === 'TASK' && goal.status === 'PENDING_APPROVAL' && ownerIsMemberLike) {
          // 과제업무 팀장 1차 승인 → 임원 대기
          newStatus = 'LEAD_APPROVED';
          updateData = { status: 'LEAD_APPROVED', leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          successMsg = '과제업무 1차 승인. 임원의 최종 승인을 기다립니다.';
        } else if (goal.goalType === 'GENERAL' && goal.generalType === 'MAJOR' && goal.status === 'PENDING_APPROVAL' && ownerIsMemberLike) {
          // 주요업무 팀장 최종 승인
          newStatus = 'APPROVED';
          updateData = { status: 'APPROVED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '주요업무 승인 완료.';
        } else if (goal.status === 'COMPLETED' && !goal.leadApprovedBy && ownerIsMemberLike) {
          updateData = { leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          successMsg = '완료 1차 확인. 임원 최종 확인 대기 중.';
        } else if (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike) {
          newStatus = 'ABANDONED';
          updateData = { status: 'ABANDONED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '포기 승인.';
        } else if (goal.status === 'PENDING_MODIFY' && ownerIsMemberLike && goal.pendingModify) {
          // 수정 요청 승인 → 내용 적용
          newStatus = 'APPROVED';
          updateData = {
            status: 'APPROVED',
            title: goal.pendingModify.title,
            description: goal.pendingModify.description,
            pendingModify: null as any,
          };
          successMsg = '수정 요청 승인. 목표 내용이 업데이트되었습니다.';
        }
      } else if (isExec) {
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
          newStatus = 'ABANDONED';
          updateData = { status: 'ABANDONED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '포기 승인.';
        } else if (goal.status === 'PENDING_MODIFY' && goal.pendingModify) {
          newStatus = 'APPROVED';
          updateData = {
            status: 'APPROVED',
            title: goal.pendingModify.title,
            description: goal.pendingModify.description,
            pendingModify: null as any,
          };
          successMsg = '수정 요청 승인. 목표 내용이 업데이트되었습니다.';
        }
      }

      if (Object.keys(updateData).length === 0) return;
      await updateGoal(id, updateData);
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'APPROVED',
        previousStatus: goal.status, newStatus,
        comment: approveComment.trim() || successMsg,
      });
      // 알림 발송
      try {
        const orgs = await getOrganizations();
        if (newStatus === 'LEAD_APPROVED') {
          // 팀장 1차 승인 → 임원에게 알림
          const ownerOrg = orgs.find(o => o.id === goalOwner?.organizationId);
          const parentOrg = ownerOrg?.parentId ? orgs.find(o => o.id === ownerOrg.parentId) : null;
          const execId = parentOrg?.leaderId;
          if (execId) {
            await createNotification({
              userId: execId, goalId: id, goalTitle: goal.title,
              type: 'GOAL_LEAD_APPROVED',
              message: `${goalOwner?.name ?? ''}님의 "${goal.title}" 목표가 1차 승인되어 최종 승인 대기 중입니다.`,
              read: false,
            });
          }
        } else if (newStatus === 'APPROVED') {
          // 최종 승인 → 목표 작성자에게 알림
          await createNotification({
            userId: goal.userId, goalId: id, goalTitle: goal.title,
            type: 'GOAL_APPROVED',
            message: `"${goal.title}" 목표가 최종 승인되었습니다.`,
            read: false,
          });
        }
      } catch { /* 알림 실패는 무시 */ }
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
      // 반려 시 목표 작성자에게 알림
      try {
        await createNotification({
          userId: goal.userId, goalId: id, goalTitle: goal.title,
          type: 'GOAL_REJECTED',
          message: `"${goal.title}" 목표가 반려되었습니다. 사유: ${rejectComment}`,
          read: false,
        });
      } catch { /* 알림 실패는 무시 */ }
      setRejectComment('');
      setShowRejectInput(false);
      toast.success(goal.status === 'COMPLETED' ? '완료 요청을 반려했습니다.' : '반려 처리했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  async function submitModifyRequest() {
    if (!goal || !userProfile || !modifyTitle.trim()) return;
    setActionLoading(true);
    try {
      await updateGoal(id, {
        status: 'PENDING_MODIFY',
        pendingModify: {
          title: modifyTitle.trim(),
          description: modifyDescription.trim(),
          comment: modifyComment.trim() || undefined,
        },
      });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: 'PENDING_MODIFY',
        comment: `수정 요청${modifyComment.trim() ? `: ${modifyComment.trim()}` : ''}`,
      });
      // 결재자에게 알림
      try {
        const orgs = await getOrganizations();
        const myOrg = orgs.find(o => o.id === userProfile.organizationId);
        const approverId = userProfile.role === 'MEMBER'
          ? myOrg?.leaderId
          : (myOrg?.parentId ? orgs.find(o => o.id === myOrg.parentId)?.leaderId : undefined);
        if (approverId) {
          await createNotification({
            userId: approverId, goalId: id, goalTitle: goal.title,
            type: 'GOAL_SUBMITTED',
            message: `${userProfile.name}님이 "${goal.title}" 목표 수정을 요청했습니다.`,
            read: false,
          });
        }
      } catch { /* 알림 실패는 무시 */ }
      setShowModifyRequest(false);
      setModifyTitle(''); setModifyDescription(''); setModifyComment('');
      toast.success('수정 요청을 제출했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  // ── 댓글 액션 ──────────────────────────────────────────
  async function submitComment() {
    if (!goal || !userProfile || !newComment.trim()) return;
    setActionLoading(true);
    try {
      await addGoalComment({
        goalId: id,
        authorId: userProfile.id,
        authorName: userProfile.name,
        content: newComment.trim(),
      });
      setNewComment('');
      await load();
    } catch {
      toast.error('댓글 작성에 실패했습니다.');
    } finally { setActionLoading(false); }
  }

  async function saveEditComment(commentId: string) {
    if (!editingCommentContent.trim()) return;
    setActionLoading(true);
    try {
      await updateGoalComment(commentId, editingCommentContent.trim());
      setEditingCommentId(null);
      setEditingCommentContent('');
      await load();
    } catch {
      toast.error('댓글 수정에 실패했습니다.');
    } finally { setActionLoading(false); }
  }

  async function removeComment(commentId: string) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    setActionLoading(true);
    try {
      await deleteGoalComment(commentId);
      await load();
    } catch {
      toast.error('댓글 삭제에 실패했습니다.');
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
  const isLead = userProfile.role === 'TEAM_LEAD';
  const isExec = userProfile.role === 'EXECUTIVE';
  const ownerRole = goalOwner?.role;

  // HR_ADMIN은 MEMBER와 동일한 승인 흐름을 따름
  const ownerIsMemberLike = ownerRole === 'MEMBER';

  const canEdit = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canMoveToTrash = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canRequestApproval = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canWithdraw = isOwner && goal.status === 'PENDING_APPROVAL';
  const canRequestCompletion = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canRequestAbandon = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canRequestModify = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canUpdateProgress = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);

  const canLeadApprove = isLead && (
    // TASK: 팀원의 1차 승인
    (goal.goalType === 'TASK' && goal.status === 'PENDING_APPROVAL' && ownerIsMemberLike) ||
    // MAJOR: 팀원의 팀장 최종 승인
    (goal.goalType === 'GENERAL' && goal.generalType === 'MAJOR' && goal.status === 'PENDING_APPROVAL' && ownerIsMemberLike) ||
    // 완료 확인 (TASK, MAJOR 모두)
    (goal.status === 'COMPLETED' && !goal.leadApprovedBy && ownerIsMemberLike) ||
    // 포기 승인
    (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike) ||
    // 수정 요청 승인 (팀원)
    (goal.status === 'PENDING_MODIFY' && ownerIsMemberLike)
  );

  const canExecApprove = isExec && (
    // TASK: 임원 최종 승인 (팀원 목표)
    (goal.goalType === 'TASK' && goal.status === 'LEAD_APPROVED') ||
    // TASK: 팀장의 과제업무 승인
    (goal.goalType === 'TASK' && goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') ||
    // MAJOR: 팀장의 주요업무 승인
    (goal.goalType === 'GENERAL' && goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') ||
    // 완료 최종 확인
    (goal.status === 'COMPLETED' && !!goal.leadApprovedBy && ownerIsMemberLike) ||
    (goal.status === 'COMPLETED' && ownerRole === 'TEAM_LEAD') ||
    // 포기 승인
    (goal.status === 'PENDING_ABANDON' && ownerRole === 'TEAM_LEAD') ||
    // 수정 요청 승인 (팀장)
    (goal.status === 'PENDING_MODIFY' && ownerRole === 'TEAM_LEAD')
  );

  const canApprove = canLeadApprove || canExecApprove;

  const canReject = (isLead && ['PENDING_APPROVAL', 'COMPLETED'].includes(goal.status) && ownerIsMemberLike) ||
    (isExec && ['LEAD_APPROVED', 'PENDING_APPROVAL', 'COMPLETED'].includes(goal.status));

  function getApproveLabel() {
    if (isLead) {
      if (goal!.goalType === 'TASK' && goal!.status === 'PENDING_APPROVAL') return '1차 승인';
      if (goal!.goalType === 'GENERAL' && goal!.status === 'PENDING_APPROVAL') return '주요업무 승인';
      if (goal!.status === 'COMPLETED') return '완료 1차 확인';
      if (goal!.status === 'PENDING_ABANDON') return '포기 승인';
    }
    if (isExec) {
      if (goal!.status === 'LEAD_APPROVED') return '최종 승인';
      if (goal!.status === 'COMPLETED') return '완료 확인';
      if (goal!.status === 'PENDING_ABANDON') return '포기 승인';
      return '승인';
    }
    return '승인';
  }

  const completionStep = goal.status === 'COMPLETED'
    ? (!goal.leadApprovedBy && ownerIsMemberLike
        ? '팀장 1차 확인 대기'
        : goal.leadApprovedBy && !goal.approvedBy && ownerIsMemberLike
          ? '임원 최종 확인 대기'
          : ownerRole === 'TEAM_LEAD' && !goal.approvedBy
            ? '임원 확인 대기'
            : null)
    : null;

  const goalTypeBadge = getGoalTypeBadge(goal);

  return (
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
                {canEdit && (
                  <button
                    onClick={() => router.push(`/goals?edit=${goal.id}`)}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors"
                    title="목표 수정"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {canMoveToTrash && (
                  <button
                    onClick={moveToTrash}
                    disabled={actionLoading}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-red-500 transition-colors"
                    title="휴지통으로 이동"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
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

            {(canRequestApproval || canWithdraw || canRequestCompletion || canRequestAbandon || canRequestModify) && (
              <div className="flex gap-2 pt-2 border-t flex-wrap">
                {/* 반려된 목표: 임시저장으로 전환 */}
                {isOwner && goal.status === 'REJECTED' && (
                  <Button
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        await updateGoal(id, { status: 'DRAFT' });
                        await addGoalHistory({ goalId: id, changedBy: userProfile!.id, changeType: 'STATUS_CHANGED', previousStatus: 'REJECTED', newStatus: 'DRAFT', comment: '임시저장으로 전환' });
                        toast.success('임시저장으로 전환했습니다.');
                        await load();
                      } finally { setActionLoading(false); }
                    }}
                    disabled={actionLoading} variant="outline" size="sm" className="gap-1.5 text-gray-600"
                  >
                    임시저장
                  </Button>
                )}
                {canRequestApproval && (
                  <Button onClick={requestApproval} disabled={actionLoading} size="sm" className="gap-1.5">
                    <Send className="h-4 w-4" /> 승인 요청
                  </Button>
                )}
                {canWithdraw && (
                  <Button
                    onClick={withdrawApproval} disabled={actionLoading} variant="outline" size="sm"
                    className="gap-1.5 text-gray-600 border-gray-300 hover:bg-gray-50"
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
                {canRequestModify && (
                  <Button
                    onClick={() => { setShowModifyRequest(true); setModifyTitle(goal.title); setModifyDescription(goal.description); }}
                    disabled={actionLoading} variant="outline" size="sm"
                    className="gap-1.5 text-blue-600 border-blue-300 hover:bg-blue-50"
                  >
                    <Pencil className="h-4 w-4" /> 수정 요청
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
              </div>
            )}

            {/* 수정 요청 폼 */}
            {showModifyRequest && (
              <div className="pt-2 border-t space-y-3">
                <p className="text-sm font-semibold text-blue-700">수정 요청</p>
                <p className="text-xs text-gray-500">기존 내용은 승인 전까지 유지되며, 승인 시 아래 내용으로 변경됩니다.</p>
                <div className="rounded-lg bg-gray-50 px-4 py-3 space-y-1">
                  <p className="text-xs text-gray-400">현재 목표명</p>
                  <p className="text-sm text-gray-600">{goal.title}</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-600">변경할 목표명 <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={modifyTitle}
                    onChange={e => setModifyTitle(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-600">변경할 세부내용</label>
                  <textarea
                    rows={3}
                    value={modifyDescription}
                    onChange={e => setModifyDescription(e.target.value)}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
                    placeholder="변경할 세부 내용을 입력하세요"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-600">수정 사유 (선택)</label>
                  <textarea
                    rows={2}
                    value={modifyComment}
                    onChange={e => setModifyComment(e.target.value)}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
                    placeholder="수정 사유를 입력하세요"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowModifyRequest(false)}>취소</Button>
                  <Button
                    size="sm"
                    onClick={submitModifyRequest}
                    disabled={actionLoading || !modifyTitle.trim()}
                    className="gap-1.5"
                  >
                    <Send className="h-4 w-4" /> 수정 요청 제출
                  </Button>
                </div>
              </div>
            )}

            {/* PENDING_MODIFY: 수정 요청 내용 미리보기 */}
            {goal.status === 'PENDING_MODIFY' && goal.pendingModify && (
              <div className="pt-2 border-t space-y-2">
                <p className="text-xs font-semibold text-blue-700">수정 요청 내용 (승인 대기 중)</p>
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">변경할 목표명</p>
                    <p className="text-sm font-medium text-gray-800">{goal.pendingModify.title}</p>
                  </div>
                  {goal.pendingModify.description && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">변경할 세부내용</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{goal.pendingModify.description}</p>
                    </div>
                  )}
                  {goal.pendingModify.comment && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">수정 사유</p>
                      <p className="text-sm text-gray-600">{goal.pendingModify.comment}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {canApprove && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center gap-2">
                  {isLead && goal.status === 'PENDING_APPROVAL' && goal.goalType === 'TASK' && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 rounded px-2 py-1">팀장 1차 승인 단계</span>
                  )}
                  {isLead && goal.status === 'PENDING_APPROVAL' && goal.goalType === 'GENERAL' && goal.generalType === 'MAJOR' && (
                    <span className="text-xs text-green-600 bg-green-50 rounded px-2 py-1">주요업무 팀장 최종 승인</span>
                  )}
                  {isExec && goal.status === 'LEAD_APPROVED' && (
                    <span className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">임원 최종 승인 단계</span>
                  )}
                  {isExec && goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD' && (
                    <span className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">팀장 목표 승인</span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => setShowApproveInput(v => !v)} disabled={actionLoading} size="sm"
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
                {showApproveInput && (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="승인 의견을 입력하세요 (선택사항)"
                      value={approveComment}
                      onChange={e => setApproveComment(e.target.value)}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button onClick={approveGoal} disabled={actionLoading} size="sm" className="bg-green-600 hover:bg-green-700">
                        승인 확정
                      </Button>
                      <Button onClick={() => { setShowApproveInput(false); setApproveComment(''); }} size="sm" variant="outline">
                        취소
                      </Button>
                    </div>
                  </div>
                )}
                {showRejectInput && (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="반려 사유를 입력하세요"
                      value={rejectComment}
                      onChange={e => setRejectComment(e.target.value)}
                      rows={3}
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
              <TabsTrigger value="progress">진행상황 ({updates.length})</TabsTrigger>
              <TabsTrigger value="comments">
                <MessageSquare className="h-3.5 w-3.5 mr-1" />댓글 ({comments.length})
              </TabsTrigger>
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
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-700">{usersMap[u.userId] ?? '알 수 없음'}</span>
                          <span>·</span>
                          <span>{format(u.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</span>
                        </div>
                        <span className="font-medium text-blue-600">{u.progress}%</span>
                      </div>
                      <p className="text-sm text-gray-700">{u.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="comments" className="mt-4 space-y-4">
              {/* 댓글 작성 폼 */}
              <div className="rounded-xl border bg-white p-4 space-y-3">
                <Textarea
                  placeholder="댓글을 입력하세요..."
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  rows={2}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={submitComment}
                    disabled={actionLoading || !newComment.trim()}
                    size="sm"
                    className="gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" /> 댓글 등록
                  </Button>
                </div>
              </div>

              {comments.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">등록된 댓글이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {comments.map(c => (
                    <div key={c.id} className="rounded-xl border bg-white p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-medium text-gray-800">{c.authorName}</span>
                          <span>·</span>
                          <span>{format(c.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</span>
                          {c.updatedAt.getTime() !== c.createdAt.getTime() && (
                            <span className="text-gray-400">(수정됨)</span>
                          )}
                        </div>
                        {c.authorId === userProfile.id && editingCommentId !== c.id && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setEditingCommentId(c.id); setEditingCommentContent(c.content); }}
                              className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                              title="수정"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => removeComment(c.id)}
                              disabled={actionLoading}
                              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      {editingCommentId === c.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editingCommentContent}
                            onChange={e => setEditingCommentContent(e.target.value)}
                            rows={2}
                            autoFocus
                          />
                          <div className="flex gap-2 justify-end">
                            <Button
                              onClick={() => { setEditingCommentId(null); setEditingCommentContent(''); }}
                              variant="ghost" size="sm"
                            >취소</Button>
                            <Button
                              onClick={() => saveEditComment(c.id)}
                              disabled={actionLoading || !editingCommentContent.trim()}
                              size="sm"
                            >저장</Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.content}</p>
                      )}
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
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-700">{usersMap[h.changedBy] ?? '알 수 없음'}</span>
                            <span>·</span>
                            <span>{format(h.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</span>
                          </div>
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
  );
}
