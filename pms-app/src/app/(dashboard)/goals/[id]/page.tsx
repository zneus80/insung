'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ArrowLeft, Calendar, Send, XCircle, CheckCircle2, Flag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  updateGoal,
  addGoalHistory,
  getGoalHistories,
  addProgressUpdate,
  getProgressUpdates,
  getUser,
  COLLECTIONS,
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
import { toast } from 'sonner';
import type { Goal, GoalHistory, ProgressUpdate, User } from '@/types';
import { fromTimestamp } from '@/lib/firestore';
import { Timestamp } from 'firebase/firestore';

export default function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { userProfile } = useAuth();
  const router = useRouter();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [goalOwner, setGoalOwner] = useState<User | null>(null);
  const [histories, setHistories] = useState<GoalHistory[]>([]);
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [newProgress, setNewProgress] = useState(0);
  const [progressComment, setProgressComment] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

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
      } as Goal;

      const [owner, h, u] = await Promise.all([
        getUser(loadedGoal.userId),
        getGoalHistories(id),
        getProgressUpdates(id),
      ]);
      setGoal(loadedGoal);
      setGoalOwner(owner);
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
        comment: '승인 요청',
      });
      toast.success('승인 요청을 보냈습니다.');
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
      toast.success('포기 요청을 보냈습니다.');
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
        if (goal.status === 'PENDING_APPROVAL' && ownerIsMemberLike) {
          // 팀원 목표 → 팀장 1차 승인 → 임원 대기
          newStatus = 'LEAD_APPROVED';
          updateData = { status: 'LEAD_APPROVED', leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          successMsg = '1차 승인 완료. 임원의 최종 승인을 기다립니다.';
        } else if (goal.status === 'COMPLETED' && !goal.completionLeadApprovedBy && ownerIsMemberLike) {
          // 팀원 완료 1차 확인
          updateData = { completionLeadApprovedBy: userProfile.id, completionLeadApprovedAt: new Date() };
          successMsg = '완료 1차 확인. 임원 최종 확인 대기 중.';
        } else if (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike) {
          newStatus = 'ABANDONED';
          updateData = { status: 'ABANDONED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '포기 승인.';
        }
      } else if (isExec) {
        if (goal.status === 'LEAD_APPROVED' && ownerIsMemberLike) {
          // 팀원 목표 최종 승인
          newStatus = 'APPROVED';
          updateData = { status: 'APPROVED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '최종 승인 완료.';
        } else if (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') {
          // 팀장 목표 임원 승인
          newStatus = 'APPROVED';
          updateData = { status: 'APPROVED', approvedBy: userProfile.id, approvedAt: new Date() };
          successMsg = '승인 완료.';
        } else if (goal.status === 'COMPLETED' && !!goal.completionLeadApprovedBy && !goal.completionApprovedBy && ownerIsMemberLike) {
          // 팀원 완료 최종 확인
          updateData = { completionApprovedBy: userProfile.id, completionApprovedAt: new Date() };
          successMsg = '완료 최종 확인.';
        } else if (goal.status === 'COMPLETED' && !goal.completionApprovedBy && ownerRole === 'TEAM_LEAD') {
          // 팀장 완료 확인
          updateData = { completionApprovedBy: userProfile.id, completionApprovedAt: new Date() };
          successMsg = '완료 확인.';
        } else if (goal.status === 'PENDING_ABANDON' && ownerRole === 'TEAM_LEAD') {
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
        comment: successMsg,
      });
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

  // HR_ADMIN은 MEMBER와 동일한 승인 흐름을 따름
  const ownerIsMemberLike = ownerRole === 'MEMBER';

  const canEdit = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canRequestApproval = isOwner && ['DRAFT', 'REJECTED'].includes(goal.status);
  const canRequestCompletion = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canRequestAbandon = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canUpdateProgress = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);

  const canLeadApprove = isLead && (
    // 팀원 목표 1차 승인
    (ownerIsMemberLike && goal.status === 'PENDING_APPROVAL') ||
    // 팀원 완료 1차 확인
    (ownerIsMemberLike && goal.status === 'COMPLETED' && !goal.completionLeadApprovedBy) ||
    // 팀원 포기 승인
    (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike)
  );

  const canExecApprove = isExec && (
    // 팀원 목표 최종 승인
    (ownerIsMemberLike && goal.status === 'LEAD_APPROVED') ||
    // 팀장 목표 승인
    (ownerRole === 'TEAM_LEAD' && goal.status === 'PENDING_APPROVAL') ||
    // 팀원 완료 최종 확인
    (ownerIsMemberLike && goal.status === 'COMPLETED' && !!goal.completionLeadApprovedBy && !goal.completionApprovedBy) ||
    // 팀장 완료 확인
    (ownerRole === 'TEAM_LEAD' && goal.status === 'COMPLETED' && !goal.completionApprovedBy) ||
    // 포기 승인
    (goal.status === 'PENDING_ABANDON' && ownerRole === 'TEAM_LEAD')
  );

  const canApprove = canLeadApprove || canExecApprove;

  const canReject = (isLead && ['PENDING_APPROVAL', 'COMPLETED'].includes(goal.status) && ownerIsMemberLike) ||
    (isExec && ['LEAD_APPROVED', 'PENDING_APPROVAL', 'COMPLETED'].includes(goal.status));

  function getApproveLabel() {
    if (isLead) {
      if (goal!.status === 'PENDING_APPROVAL') return '목표 승인';
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
    ? (!goal.completionLeadApprovedBy && ownerIsMemberLike
        ? '팀장 1차 확인 대기'
        : goal.completionLeadApprovedBy && !goal.completionApprovedBy && ownerIsMemberLike
          ? '임원 최종 확인 대기'
          : ownerRole === 'TEAM_LEAD' && !goal.completionApprovedBy
            ? '임원 확인 대기'
            : null)
    : null;

  // canEdit is declared above but used as a guard elsewhere; suppress unused warning
  void canEdit;

  return (
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

            {(canRequestApproval || canRequestCompletion || canRequestAbandon) && (
              <div className="flex gap-2 pt-2 border-t flex-wrap">
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
                <div className="flex gap-2">
                  <Button
                    onClick={approveGoal} disabled={actionLoading} size="sm"
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
  );
}
