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
  getAllUsers,
  getOrganizations,
  createNotification,
  COLLECTIONS,
} from '@/lib/firestore';
import { notifyNextApprover, notifyAllChainParties, type GoalBroadcastEvent } from '@/lib/goal-notifications';
import { approverTitle } from '@/lib/approval-filters';
import TaskGoalForm from '@/components/goals/TaskGoalForm';
import MemberInfoModal from '@/components/members/MemberInfoModal';
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
import type { Goal, GoalHistory, GoalFieldChanges, ProgressUpdate, User, Organization } from '@/types';
import { fromTimestamp } from '@/lib/firestore';
import { Timestamp } from 'firebase/firestore';
import { cn, shiftEnterSubmit } from '@/lib/utils';

// ── 변경 항목 diff 표시 컴포넌트 ──
function FieldChangesView({ changes, usersMap }: { changes: GoalFieldChanges; usersMap: Record<string, User> }) {
  const userName = (id: string) => usersMap[id]?.name ?? id;
  const collabsToText = (ids: string[]) => ids.length === 0 ? '없음' : ids.map(userName).join(', ');
  type Row = { label: string; from: string; to: string; multiline?: boolean };
  const rows: Row[] = [];
  if (changes.title)        rows.push({ label: '제목',       from: changes.title.from || '—',                        to: changes.title.to || '—' });
  if (changes.description)  rows.push({ label: '세부내용',   from: changes.description.from || '—',                  to: changes.description.to || '—', multiline: true });
  if (changes.dueDate)      rows.push({ label: '추진기한',   from: changes.dueDate.from || '—',                      to: changes.dueDate.to || '—' });
  if (changes.progress)     rows.push({ label: '진행률',     from: `${changes.progress.from}%`,                      to: `${changes.progress.to}%` });
  if (changes.ownerId)      rows.push({ label: '수행자',     from: userName(changes.ownerId.from),                   to: userName(changes.ownerId.to) });
  if (changes.collaboratorIds) rows.push({ label: '공동수행자', from: collabsToText(changes.collaboratorIds.from),  to: collabsToText(changes.collaboratorIds.to) });
  if (changes.isConfidential) rows.push({ label: '대내비',     from: changes.isConfidential.from ? '설정' : '해제', to: changes.isConfidential.to ? '설정' : '해제' });

  if (rows.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2">
      <div className="text-[11px] font-semibold text-amber-700 mb-1.5">변경 사항</div>
      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.label} className="grid grid-cols-[5rem_1fr_auto_1fr] gap-2 text-xs items-start">
            <div className="text-gray-600 font-medium pt-0.5">{r.label}</div>
            <div className={cn('text-gray-500 line-through pt-0.5 break-words', r.multiline && 'whitespace-pre-wrap')}>{r.from}</div>
            <div className="text-gray-400 pt-0.5">→</div>
            <div className={cn(
              'pt-0.5 break-words font-semibold text-gray-900 bg-yellow-200/70 rounded px-1.5 -mx-1.5 py-0.5',
              r.multiline && 'whitespace-pre-wrap',
            )}>{r.to}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const GOAL_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  'TASK': { label: '과제업무', cls: 'bg-blue-100 text-blue-700' },
  'MAJOR': { label: '주요업무', cls: 'bg-green-100 text-green-700' },
  'OTHER': { label: '기타업무', cls: 'bg-gray-100 text-gray-600' },
  'COLLAB': { label: '공동과제업무', cls: 'bg-purple-100 text-purple-700' },
  'TRANSFERRED': { label: '이관업무', cls: 'bg-amber-100 text-amber-700' },
};

// v0.76: 이관·공동 분류 우선, 없으면 일반 유형 표시.
// 공동과제업무는 owner/collaborator 누가 보든 동일하게 표시 (collaboratorIds 비어있지 않으면).
function getGoalTypeBadge(goal: Goal, _viewerId?: string) {
  if (goal.previousOwnerId) return GOAL_TYPE_BADGE['TRANSFERRED'];
  if ((goal.collaboratorIds ?? []).length > 0) return GOAL_TYPE_BADGE['COLLAB'];
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
  const [usersMap, setUsersMap] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'progress' | 'history'>('progress');
  const [tabInitialized, setTabInitialized] = useState(false);

  // 초기 탭 결정:
  //  - 결재 대기 상태(승인요청·완료요청·포기요청·수정요청·1차승인) → '변경 이력' 기본 (결재자가 변경 내용·요청 의견 즉시 확인)
  //  - 그 외 (진행 중·승인 완료 등 업무 보기) → '진행상황' 기본
  useEffect(() => {
    if (loading || !goal || tabInitialized) return;
    const PENDING_STATES = ['PENDING_APPROVAL', 'LEAD_APPROVED', 'COMPLETED', 'PENDING_ABANDON', 'PENDING_MODIFY'];
    if (PENDING_STATES.includes(goal.status)) {
      setActiveTab('history');
    }
    setTabInitialized(true);
  }, [loading, goal, tabInitialized]);

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

      const [owner, h, u, orgs, allUsers] = await Promise.all([
        getUser(loadedGoal.userId),
        getGoalHistories(id),
        getProgressUpdates(id),
        getOrganizations(),
        getAllUsers(),
      ]);
      setGoal(loadedGoal);
      setGoalOwner(owner);
      setAllOrgs(orgs);
      setNewProgress(loadedGoal.progress);
      setHistories(h);
      setUpdates(u);
      setUsersMap(Object.fromEntries(allUsers.map(usr => [usr.id, usr])));
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
        ...(approvalRequestComment.trim() ? { submitComment: approvalRequestComment.trim() } : {}),
      });
      // ── 결재자 알림 (다음 단계) ──
      await notifyNextApprover({
        goal: { ...goal, status: 'PENDING_APPROVAL' },
        allOrgs, allUsers: Object.values(usersMap),
        fromUserId: userProfile.id, fromUserName: userProfile.name,
        action: 'SUBMIT',
      });
      // ── F7: 체인 전원 broadcast (수행자·공동수행자·체인 담당자) ──
      await notifyAllChainParties({
        goal: { ...goal, status: 'PENDING_APPROVAL' },
        allOrgs, allUsers: Object.values(usersMap),
        fromUserId: userProfile.id, fromUserName: userProfile.name,
        event: 'SUBMITTED',
      });
      setApprovalRequestComment('');
      setShowApprovalRequestInput(false);
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
      // ── 결재자 알림 (다음 단계) ──
      await notifyNextApprover({
        goal: { ...goal, status: 'COMPLETED', progress: 100 },
        allOrgs, allUsers: Object.values(usersMap),
        fromUserId: userProfile.id, fromUserName: userProfile.name,
        action: 'REQUEST_COMPLETION',
      });
      // ── F7: 체인 전원 broadcast ──
      await notifyAllChainParties({
        goal: { ...goal, status: 'COMPLETED', progress: 100 },
        allOrgs, allUsers: Object.values(usersMap),
        fromUserId: userProfile.id, fromUserName: userProfile.name,
        event: 'COMPLETION_REQUESTED',
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
        ...(abandonComment.trim() ? { submitComment: abandonComment.trim() } : {}),
      });
      // ── 결재자 알림 (다음 단계) ──
      await notifyNextApprover({
        goal: { ...goal, status: 'PENDING_ABANDON' },
        allOrgs, allUsers: Object.values(usersMap),
        fromUserId: userProfile.id, fromUserName: userProfile.name,
        action: 'REQUEST_ABANDON',
      });
      // ── F7: 체인 전원 broadcast ──
      await notifyAllChainParties({
        goal: { ...goal, status: 'PENDING_ABANDON' },
        allOrgs, allUsers: Object.values(usersMap),
        fromUserId: userProfile.id, fromUserName: userProfile.name,
        event: 'ABANDON_REQUESTED',
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

  // 수정 요청 회수 — deferred ownership: userId/collaboratorIds 는 변하지 않은 상태이므로
  // 콘텐츠(modifySnapshot)만 원복하고 pending* 필드 제거.
  // 구버전 reassignFromId 데이터도 호환: 있으면 userId/collabs 원복까지 수행.
  async function withdrawModifyRequest() {
    if (!goal || !userProfile) return;
    const isOwnerChangePending = !!goal.pendingOwnerId;
    const isLegacyReassign = !!goal.reassignFromId;
    const msg = (isOwnerChangePending || isLegacyReassign)
      ? `수행자 변경 요청을 회수하시겠습니까? 변경이 취소됩니다.`
      : '수정 요청을 회수하시겠습니까? 이전 승인 상태로 돌아갑니다.';
    if (!confirm(msg)) return;
    setActionLoading(true);
    try {
      const { doc: fsDoc, updateDoc: rawUpdate, serverTimestamp: sts, Timestamp: FsTimestamp, deleteField } = await import('firebase/firestore');
      const revertStatus: Goal['status'] = (goal.progress ?? 0) > 0 ? 'IN_PROGRESS' : 'APPROVED';
      function toDate(v: any): Date | null {
        if (!v) return null;
        if (typeof v?.toDate === 'function') return v.toDate();
        if (v instanceof Date) return v;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      }
      const snap = goal.modifySnapshot;
      const snapDue = snap ? toDate(snap.dueDate) : null;
      // 구버전 호환: reassignFromId 있으면 userId 도 원복 (snapshot/swap 폴백)
      let legacyOwnerRestore: any = {};
      if (isLegacyReassign) {
        legacyOwnerRestore.userId = goal.reassignFromId;
        legacyOwnerRestore.organizationId = goal.reassignFromOrgId ?? goal.organizationId;
        if (snap?.collaboratorIds) {
          legacyOwnerRestore.collaboratorIds = snap.collaboratorIds;
        } else {
          // 폴백: 새 수행자(현 userId)를 collab 로 강등, 기존 수행자(reassignFromId)는 제외
          const currentCollabs = goal.collaboratorIds ?? [];
          legacyOwnerRestore.collaboratorIds = Array.from(new Set([
            goal.userId,
            ...currentCollabs.filter(id => id !== goal.reassignFromId && id !== goal.userId),
          ]));
        }
      }
      const restoreContent: any = {
        ...(snap?.title !== undefined ? { title: snap.title } : {}),
        ...(snap?.description !== undefined ? { description: snap.description } : {}),
        ...(snapDue ? { dueDate: FsTimestamp.fromDate(snapDue) } : {}),
        ...(typeof snap?.isConfidential === 'boolean' ? { isConfidential: snap.isConfidential } : {}),
      };
      await rawUpdate(fsDoc(db, COLLECTIONS.GOALS, id), {
        status: revertStatus,
        ...restoreContent,
        ...legacyOwnerRestore,
        modifyRequestedBy: deleteField(),
        modifySnapshot: deleteField(),
        pendingOwnerId: deleteField(),
        pendingOwnerName: deleteField(),
        pendingOwnerOrgId: deleteField(),
        pendingCollaboratorIds: deleteField(),
        reassignFromId: deleteField(),
        reassignFromName: deleteField(),
        reassignFromOrgId: deleteField(),
        leadApprovedBy: deleteField(),
        leadApprovedAt: deleteField(),
        hqApprovedBy: deleteField(),
        hqApprovedAt: deleteField(),
        approvedBy: deleteField(),
        approvedAt: deleteField(),
        updatedAt: sts(),
      });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: goal.status, newStatus: revertStatus,
        comment: (isOwnerChangePending || isLegacyReassign)
          ? '수행자 변경 요청 회수'
          : '수정 요청 회수',
      });
      toast.success((isOwnerChangePending || isLegacyReassign) ? '수행자 변경 요청을 회수했습니다.' : '수정 요청을 회수했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  // 완료 요청 회수 — COMPLETED → IN_PROGRESS/APPROVED 복귀 (팀장 1차 승인 전에만 가능)
  async function withdrawCompletion() {
    if (!goal || !userProfile) return;
    if (!confirm('완료 요청을 회수하시겠습니까? 이전 진행 상태로 돌아갑니다.')) return;
    setActionLoading(true);
    try {
      const revertStatus: Goal['status'] = (goal.progress ?? 0) > 0 ? 'IN_PROGRESS' : 'APPROVED';
      await updateGoal(id, { status: revertStatus, progress: goal.progress });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: 'COMPLETED', newStatus: revertStatus,
        comment: '완료 요청 회수',
      });
      toast.success('완료 요청을 회수했습니다.');
      await load();
    } finally { setActionLoading(false); }
  }

  // 포기 요청 회수 — PENDING_ABANDON → IN_PROGRESS/APPROVED 복귀 (팀장 1차 승인 전에만 가능)
  async function withdrawAbandon() {
    if (!goal || !userProfile) return;
    if (!confirm('포기 요청을 회수하시겠습니까? 이전 진행 상태로 돌아갑니다.')) return;
    setActionLoading(true);
    try {
      const revertStatus: Goal['status'] = (goal.progress ?? 0) > 0 ? 'IN_PROGRESS' : 'APPROVED';
      await updateGoal(id, { status: revertStatus });
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'STATUS_CHANGED',
        previousStatus: 'PENDING_ABANDON', newStatus: revertStatus,
        comment: '포기 요청 회수',
      });
      toast.success('포기 요청을 회수했습니다.');
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
      // 본인 또는 공동수행자는 진행률 + 코멘트, 그 외(팀장·본부장·임원) 결재자는 코멘트만 저장
      const isGoalOwner = goal.userId === userProfile.id;
      const isGoalCollab = (goal.collaboratorIds ?? []).includes(userProfile.id);
      const canSetProgress = isGoalOwner || isGoalCollab;
      await addProgressUpdate({
        goalId: id, userId: userProfile.id,
        progress: canSetProgress ? newProgress : goal.progress,
        comment: progressComment,
      });
      if (canSetProgress) {
        await updateGoal(id, {
          progress: newProgress,
          status: goal.status === 'APPROVED' ? 'IN_PROGRESS' : goal.status,
        });
      }
      // 결재자가 코멘트 단 경우 → 목표 owner 에게 알림
      if (!canSetProgress && goal.userId !== userProfile.id) {
        try {
          await createNotification({
            userId: goal.userId,
            type: 'GOAL_COMMENT',
            category: 'GOAL',
            title: goal.title,
            message: `${userProfile.name}님이 코멘트를 남겼습니다: ${progressComment.slice(0, 60)}${progressComment.length > 60 ? '…' : ''}`,
            link: `/goals/${id}`,
            read: false,
          });
        } catch { /* 알림 실패 무시 */ }
      }
      setProgressComment('');
      toast.success(canSetProgress ? '진행상황이 업데이트되었습니다.' : '코멘트를 등록했습니다.');
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
      // 승인자 직책 라벨 — 본인 직책(position) 우선
      const usersArr = Object.values(usersMap);
      const teamLeadTitle = approverTitle(teamOrg?.leaderId, usersArr, '팀장');
      const hqTitle = approverTitle(hqOrg?.leaderId, usersArr, '본부장');
      const execTitle = approverTitle(divOrg?.leaderId ?? hqOrg?.leaderId, usersArr, '임원');

      if (iAmTeamLead && ownerIsMemberLike) {
        if (goal.status === 'PENDING_APPROVAL') {
          // 과제업무: 1차 승인 → LEAD_APPROVED (본부/임원 추가 승인 대기)
          // 주요업무: 팀장이 최종 승인 → APPROVED
          // 모든 목표 유형: 팀장 1차 승인 → LEAD_APPROVED → 임원 최종 승인 필요
          newStatus = 'LEAD_APPROVED';
          updateData = { status: 'LEAD_APPROVED', leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          if (goal.goalType === 'TASK') {
            successMsg = hasHQInChain
              ? `과제업무 1차 승인. ${hqTitle} 2차 승인을 기다립니다.`
              : `과제업무 1차 승인. ${execTitle}의 최종 승인을 기다립니다.`;
          } else {
            successMsg = hasHQInChain
              ? `주요업무 1차 승인. ${hqTitle} 2차 승인을 기다립니다.`
              : `주요업무 1차 승인. ${execTitle}의 최종 승인을 기다립니다.`;
          }
        } else if (goal.status === 'COMPLETED' && !goal.completionLeadApprovedBy) {
          updateData = { completionLeadApprovedBy: userProfile.id, completionLeadApprovedAt: new Date() };
          successMsg = hasHQInChain ? `완료 1차 확인. ${hqTitle} 2차 확인 대기 중.` : `완료 1차 확인. ${execTitle} 최종 확인 대기 중.`;
        } else if (goal.status === 'PENDING_ABANDON' && !goal.abandonLeadApprovedBy) {
          // 팀장 포기 1차 승인: 별도 필드 기록, 상태는 PENDING_ABANDON 유지
          updateData = { abandonLeadApprovedBy: userProfile.id, abandonLeadApprovedAt: new Date() };
          successMsg = `포기 1차 승인. ${execTitle}의 최종 승인을 기다립니다.`;
        }
      } else if (iAmHQHead) {
        // 본부장 2차 승인: 상태 변경 없이 hqApprovedBy만 기록
        if (goal.status === 'LEAD_APPROVED' && !goal.hqApprovedBy) {
          updateData = { hqApprovedBy: userProfile.id, hqApprovedAt: new Date() };
          successMsg = `${hqTitle} 2차 승인 완료. ${execTitle}의 최종 승인을 기다립니다.`;
        } else if (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') {
          // 팀장 신규 목표 — 본부장이 1차 승인 (LEAD_APPROVED + hqApprovedBy 동시 기록)
          newStatus = 'LEAD_APPROVED';
          updateData = {
            status: 'LEAD_APPROVED',
            hqApprovedBy: userProfile.id, hqApprovedAt: new Date(),
          };
          successMsg = `${hqTitle} 1차 승인 완료. ${execTitle}의 최종 승인을 기다립니다.`;
        } else if (goal.status === 'COMPLETED' && ownerIsMemberLike && !!goal.completionLeadApprovedBy && !goal.completionHqApprovedBy) {
          // 팀원 목표: 팀장 1차 → 본부장 2차
          updateData = { completionHqApprovedBy: userProfile.id, completionHqApprovedAt: new Date() };
          successMsg = `완료 2차 확인. ${execTitle} 최종 확인 대기 중.`;
        } else if (goal.status === 'COMPLETED' && ownerRole === 'TEAM_LEAD' && !goal.completionHqApprovedBy) {
          // 팀장 목표: 본부장이 1차 (팀장 본인 단계는 건너뜀)
          updateData = { completionHqApprovedBy: userProfile.id, completionHqApprovedAt: new Date() };
          successMsg = `완료 1차 확인. ${execTitle} 최종 확인 대기 중.`;
        } else if (teamHasNoLead && ownerIsMemberLike && goal.status === 'PENDING_APPROVAL') {
          // 팀장 부재 — 본부장이 1차 승인 대행 (LEAD_APPROVED 로 진행)
          newStatus = 'LEAD_APPROVED';
          updateData = { status: 'LEAD_APPROVED', leadApprovedBy: userProfile.id, leadApprovedAt: new Date() };
          successMsg = `팀장 부재로 ${hqTitle}이 1차 승인을 대행했습니다. ${execTitle}의 최종 승인을 기다립니다.`;
        } else if (teamHasNoLead && ownerIsMemberLike && goal.status === 'COMPLETED' && !goal.completionLeadApprovedBy && !goal.completionHqApprovedBy) {
          // 팀장 부재 — 본부장이 완료 1차 대행 (LeadApprovedBy 와 HqApprovedBy 동시 기록)
          updateData = {
            completionLeadApprovedBy: userProfile.id, completionLeadApprovedAt: new Date(),
            completionHqApprovedBy: userProfile.id, completionHqApprovedAt: new Date(),
          };
          successMsg = `팀장 부재로 ${hqTitle}이 완료 1차 확인을 대행했습니다. ${execTitle} 최종 확인 대기 중.`;
        } else if (teamHasNoLead && ownerIsMemberLike && goal.status === 'PENDING_ABANDON' && !goal.abandonLeadApprovedBy) {
          // 팀장 부재 — 본부장이 포기 1차 대행
          updateData = { abandonLeadApprovedBy: userProfile.id, abandonLeadApprovedAt: new Date() };
          successMsg = `팀장 부재로 ${hqTitle}이 포기 1차 승인을 대행했습니다. ${execTitle}의 최종 승인을 기다립니다.`;
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
          updateData = { completionExecApprovedBy: userProfile.id, completionExecApprovedAt: new Date() };
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

      // ── 수행자 변경 최종 확정 (deferred ownership) ──
      // pendingOwnerId 있으면: userId/organizationId/collaboratorIds 를 새 값으로 적용 + previousOwnerId 설정.
      // 구버전 reassignFromId 호환: 있으면 그쪽 데이터 사용.
      if (newStatus === 'APPROVED' && (goal.pendingOwnerId || goal.reassignFromId)) {
        try {
          const { doc: fsDoc, updateDoc: rawUpdate, serverTimestamp: sts, deleteField } = await import('firebase/firestore');
          let newOwnerId: string;
          let newOwnerOrgId: string;
          let newCollabs: string[];
          let prevOwnerIdForBadge: string;
          let prevOwnerNameForBadge: string;
          if (goal.pendingOwnerId) {
            // 신규(deferred) 방식 — userId 는 아직 기존 수행자. 이제 pending 으로 전환.
            newOwnerId = goal.pendingOwnerId;
            newOwnerOrgId = goal.pendingOwnerOrgId ?? goal.organizationId;
            newCollabs = goal.pendingCollaboratorIds ?? (goal.collaboratorIds ?? []);
            prevOwnerIdForBadge = goal.userId;
            prevOwnerNameForBadge = goalOwner.name;
          } else {
            // 구버전(즉시전환) 방식 — userId 가 이미 새 수행자. reassignFromId 가 기존.
            newOwnerId = goal.userId;
            newOwnerOrgId = goal.organizationId;
            newCollabs = goal.collaboratorIds ?? [];
            prevOwnerIdForBadge = goal.reassignFromId!;
            prevOwnerNameForBadge = goal.reassignFromName ?? '';
          }
          // relatedOrgIds 재계산 — 새 owner org + collab들의 org. usersMap 활용.
          const collabOrgIds = newCollabs
            .map(uid => usersMap[uid]?.organizationId)
            .filter((v): v is string => !!v);
          const newRelatedOrgIds = Array.from(new Set([newOwnerOrgId, ...collabOrgIds]));
          // 스왑 판별: 새 책임자(newOwnerId) 가 변경 전 collaborator 였고, 변경 후 collaborator 목록에 이전 책임자(prevOwnerIdForBadge) 가 포함 → 단순 역할 교체이므로 이관업무 분류 X.
          // 변경 전 collaboratorIds: pending 방식이면 goal.collaboratorIds (그대로), 구버전이면 modifySnapshot.collaboratorIds 가 있을 때만 정확.
          const prevCollabs: string[] = goal.pendingOwnerId
            ? (goal.collaboratorIds ?? [])
            : ((goal.modifySnapshot?.collaboratorIds as string[] | undefined) ?? []);
          const isSwap = prevCollabs.includes(newOwnerId) && newCollabs.includes(prevOwnerIdForBadge);
          await rawUpdate(fsDoc(db, COLLECTIONS.GOALS, id), {
            userId: newOwnerId,
            organizationId: newOwnerOrgId,
            collaboratorIds: newCollabs,
            relatedOrgIds: newRelatedOrgIds,
            // 스왑이 아닌 진짜 이관일 때만 previousOwnerId/transferredAt 설정
            ...(isSwap ? {
              previousOwnerId: deleteField(),
              previousOwnerName: deleteField(),
              transferredAt: deleteField(),
            } : {
              previousOwnerId: prevOwnerIdForBadge,
              previousOwnerName: prevOwnerNameForBadge,
              transferredAt: sts(),
            }),
            pendingOwnerId: deleteField(),
            pendingOwnerName: deleteField(),
            pendingOwnerOrgId: deleteField(),
            pendingCollaboratorIds: deleteField(),
            reassignFromId: deleteField(),
            reassignFromName: deleteField(),
            reassignFromOrgId: deleteField(),
            modifyRequestedBy: deleteField(),
            modifySnapshot: deleteField(),
            updatedAt: sts(),
          });
          await addGoalHistory({
            goalId: id, changedBy: userProfile.id,
            changeType: 'OWNER_REASSIGNED',
            previousStatus: goal.status, newStatus: 'APPROVED',
            comment: isSwap
              ? `최종 승인으로 수행자/공동수행자 스왑 확정: ${prevOwnerNameForBadge} ↔ ${goal.pendingOwnerName ?? goalOwner.name}`
              : `최종 승인으로 수행자 변경 확정: ${prevOwnerNameForBadge} → ${goal.pendingOwnerName ?? goalOwner.name}`,
          });
          // 새 수행자에게 확정 알림
          try {
            await createNotification({
              userId: newOwnerId,
              goalId: id,
              goalTitle: goal.title,
              type: 'GOAL_APPROVED',
              message: `'${goal.title}' 핵심목표 수행자 변경이 최종 승인되어 귀하가 수행자로 확정되었습니다.`,
              read: false,
            });
          } catch { /* 알림 실패 무시 */ }
        } catch (err) {
          console.error('[이관] 최종 승인 시 수행자 변경 확정 실패:', err);
        }
      } else if (newStatus === 'APPROVED' && goal.modifyRequestedBy) {
        // 콘텐츠 수정요청만 — modifySnapshot/modifyRequestedBy 정리
        try {
          const { doc: fsDoc, updateDoc: rawUpdate, serverTimestamp: sts, deleteField } = await import('firebase/firestore');
          await rawUpdate(fsDoc(db, COLLECTIONS.GOALS, id), {
            modifyRequestedBy: deleteField(),
            modifySnapshot: deleteField(),
            updatedAt: sts(),
          });
        } catch (err) { console.error('[수정요청] 최종 승인 후 스냅샷 정리 실패:', err); }
      }

      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'APPROVED',
        previousStatus: goal.status, newStatus,
        comment: successMsg,
        ...(approveComment.trim() ? { submitComment: approveComment.trim() } : {}),
      });

      // ── 결재 체인 알림: 승인 후 다음 결재자에게 알림 발송 ──
      // approval-filters 의 buildApprovalChain + currentPendingStageIdx 를 사용해
      // 모든 케이스(신규/완료/포기 × 팀장/본부장 승인) 를 일관되게 처리한다.
      const isCompletionApproval =
        'completionLeadApprovedBy' in updateData ||
        'completionHqApprovedBy' in updateData ||
        'completionExecApprovedBy' in updateData;
      const isAbandonApproval = 'abandonLeadApprovedBy' in updateData;
      const chainAction = isCompletionApproval ? 'APPROVE_COMPLETION'
        : isAbandonApproval ? 'APPROVE_ABANDON'
        : 'APPROVE';
      // updateData 를 반영한 post-update 목표 객체 (status + 결재 필드 모두 반영)
      const updatedGoal: Goal = { ...goal, ...updateData, status: newStatus } as Goal;
      await notifyNextApprover({
        goal: updatedGoal,
        allOrgs, allUsers: Object.values(usersMap),
        fromUserId: userProfile.id, fromUserName: userProfile.name,
        action: chainAction,
      });

      // ── F7: 결재 체인 전원 broadcast ──
      // 어떤 단계 승인이든 수행자·공동수행자·팀장·본부장·임원 모두에게 동일 알림.
      // 다음 단계 결재자에게는 위 notifyNextApprover 에서 별도로 "확인 필요" 알림이 가고,
      // broadcast 는 "어떤 결정이 일어났는지" 를 모두에게 알리는 용도.
      const broadcastEvent: GoalBroadcastEvent | null =
        isCompletionApproval
          ? ('completionExecApprovedBy' in updateData ? 'COMPLETION_APPROVED' : null)
          : isAbandonApproval || newStatus === 'ABANDONED'
            ? (newStatus === 'ABANDONED' ? 'ABANDON_APPROVED' : null)
            : newStatus === 'APPROVED'
              ? 'EXEC_APPROVED'
              : 'leadApprovedBy' in updateData
                ? 'LEAD_APPROVED'
                : 'hqApprovedBy' in updateData
                  ? 'HQ_APPROVED'
                  : null;
      if (broadcastEvent) {
        await notifyAllChainParties({
          goal: updatedGoal,
          allOrgs, allUsers: Object.values(usersMap),
          fromUserId: userProfile.id, fromUserName: userProfile.name,
          event: broadcastEvent,
        });
      }

      // ── 목표 소유자 알림: 임원 최종 결정(승인·포기·완료확인) 시 ──
      if (iAmExec && goal.userId !== userProfile.id) {
        try {
          let ownerMsg = '';
          if (newStatus === 'APPROVED') {
            ownerMsg = `${userProfile.name}님이 '${goal.title}' 핵심목표를 최종 승인했습니다.`;
          } else if (newStatus === 'ABANDONED') {
            ownerMsg = `${userProfile.name}님이 '${goal.title}' 핵심목표 포기를 최종 승인했습니다.`;
          } else if ('completionExecApprovedBy' in updateData) {
            ownerMsg = `${userProfile.name}님이 '${goal.title}' 핵심목표 완료를 최종 확인했습니다.`;
          }
          if (ownerMsg) {
            await createNotification({
              userId: goal.userId,
              goalId: id,
              goalTitle: goal.title,
              type: 'GOAL_APPROVED',
              message: ownerMsg,
              read: false,
            });
          }
        } catch (err) {
          console.error('[알림] 목표 소유자(임원 최종 결정) 알림 발송 실패:', err);
        }
      }

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
      // 수정요청(modifyRequestedBy) 반려: 원본은 이미 승인됐던 목표 → 수정만 거부하고 이전 승인 상태로 복귀.
      //   수행자 변경이면 reassignFromId 로 userId/organizationId 원복.
      const isModifyReject = !!goal.modifyRequestedBy && ['PENDING_APPROVAL', 'LEAD_APPROVED'].includes(goal.status);

      let newStatus: Goal['status'];
      if (isModifyReject) {
        newStatus = (goal.progress ?? 0) > 0 ? 'IN_PROGRESS' : 'APPROVED';
      } else if (goal.status === 'COMPLETED') {
        newStatus = 'IN_PROGRESS';
      } else {
        newStatus = 'REJECTED';
      }

      if (isModifyReject) {
        const { doc: fsDoc, updateDoc: rawUpdate, serverTimestamp: sts, Timestamp: FsTimestamp, deleteField } = await import('firebase/firestore');
        function toDate(v: any): Date | null {
          if (!v) return null;
          if (typeof v?.toDate === 'function') return v.toDate();
          if (v instanceof Date) return v;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }
        const snap = goal.modifySnapshot;
        const snapDue = snap ? toDate(snap.dueDate) : null;
        // 구버전 호환: reassignFromId 있으면 userId/collabs 원복
        let legacyOwnerRestore: any = {};
        if (goal.reassignFromId) {
          legacyOwnerRestore.userId = goal.reassignFromId;
          legacyOwnerRestore.organizationId = goal.reassignFromOrgId ?? goal.organizationId;
          if (snap?.collaboratorIds) {
            legacyOwnerRestore.collaboratorIds = snap.collaboratorIds;
          } else {
            const currentCollabs = goal.collaboratorIds ?? [];
            legacyOwnerRestore.collaboratorIds = Array.from(new Set([
              goal.userId,
              ...currentCollabs.filter(id => id !== goal.reassignFromId && id !== goal.userId),
            ]));
          }
        }
        const restoreContent: any = {
          ...(snap?.title !== undefined ? { title: snap.title } : {}),
          ...(snap?.description !== undefined ? { description: snap.description } : {}),
          ...(snapDue ? { dueDate: FsTimestamp.fromDate(snapDue) } : {}),
          ...(typeof snap?.isConfidential === 'boolean' ? { isConfidential: snap.isConfidential } : {}),
        };
        await rawUpdate(fsDoc(db, COLLECTIONS.GOALS, id), {
          status: newStatus,
          ...restoreContent,
          ...legacyOwnerRestore,
          modifyRequestedBy: deleteField(),
          modifySnapshot: deleteField(),
          pendingOwnerId: deleteField(),
          pendingOwnerName: deleteField(),
          pendingOwnerOrgId: deleteField(),
          pendingCollaboratorIds: deleteField(),
          reassignFromId: deleteField(),
          reassignFromName: deleteField(),
          reassignFromOrgId: deleteField(),
          leadApprovedBy: deleteField(),
          leadApprovedAt: deleteField(),
          hqApprovedBy: deleteField(),
          hqApprovedAt: deleteField(),
          updatedAt: sts(),
        });
      } else {
        await updateGoal(id, {
          status: newStatus,
          ...(newStatus === 'REJECTED' ? { rejectedReason: rejectComment } : {}),
        });
      }
      await addGoalHistory({
        goalId: id, changedBy: userProfile.id,
        changeType: 'REJECTED',
        previousStatus: goal.status, newStatus,
        comment: isModifyReject
          ? (goal.reassignFromId ? `수행자 변경 반려 (${goal.reassignFromName ?? '기존 수행자'}에게 원복)` : '수정 요청 반려')
          : '반려',
        submitComment: rejectComment,
      });

      // ── F7: 반려 시 체인 전원 broadcast ──
      try {
        await notifyAllChainParties({
          goal: { ...goal, status: newStatus } as Goal,
          allOrgs, allUsers: Object.values(usersMap),
          fromUserId: userProfile.id, fromUserName: userProfile.name,
          event: 'REJECTED',
        });
      } catch (err) {
        console.error('[알림] 반려 broadcast 실패:', err);
      }

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
  // 공동 수행자 — F4: 진행률 입력 가능 + 코멘트 권한
  const isCollaborator = (goal.collaboratorIds ?? []).includes(userProfile.id);
  const isOwnerOrCollab = isOwner || isCollaborator;
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
  //   leaderId 미설정 시: 사용자가 본부 조직에 속한 TEAM_LEAD/EXECUTIVE role 이면 본부장으로 추론
  const iAmHQHead = !iAmTeamLead && !!divOrg && (
    hqOrg?.leaderId === userProfile.id ||
    (!hqOrg?.leaderId && userProfile.role === 'TEAM_LEAD' && hqOrg?.id === userProfile.organizationId) ||
    // EXECUTIVE role 본부장 — leaderId 미지정 + 본인 소속이 해당 본부
    (userProfile.role === 'EXECUTIVE' && hqOrg?.id === userProfile.organizationId)
  );

  // 본부장이 1차 승인 대행 가능한지 (팀장 leaderId 미설정 환경)
  const teamHasNoLead = !!teamOrg && !teamOrg.leaderId;

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
  // 수정 요청 회수: modifyRequestedBy 있고 최종 승인 전.
  // 회수 권한: 현 owner (=A, deferred 방식이므로 항상 기존 수행자) 또는 요청자.
  // (구버전 reassignFromId 잔여 데이터도 호환을 위해 owner 권한으로 처리됨)
  const isModifyPending = !!goal.modifyRequestedBy && ['PENDING_APPROVAL', 'LEAD_APPROVED'].includes(goal.status);
  const canWithdrawModifyRequest = isModifyPending && (
    isOwner || goal.modifyRequestedBy === userProfile.id
  );
  // 일반 승인요청 회수(DRAFT 복귀)는 신규 상신일 때만 — 수정요청(modifyRequestedBy)이 아닐 때
  const canWithdraw = isOwner && goal.status === 'PENDING_APPROVAL' && !goal.modifyRequestedBy;
  // 완료 요청 회수: 팀장 1차 승인(completionLeadApprovedBy) 전에만 가능
  const canWithdrawCompletion = isOwner && goal.status === 'COMPLETED' && !goal.completionLeadApprovedBy;
  // 포기 요청 회수: 팀장 1차 승인(abandonLeadApprovedBy) 전에만 가능
  const canWithdrawAbandon = isOwner && goal.status === 'PENDING_ABANDON' && !goal.abandonLeadApprovedBy;
  const canRequestCompletion = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canRequestAbandon = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status) && !showAbandonInput;
  const canRequestModify = isOwner && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  const canUpdateProgress = isOwnerOrCollab && ['APPROVED', 'IN_PROGRESS'].includes(goal.status);
  // 진행 중 목표에 한해 조직 체인 상의 결재자(팀장·본부장·임원) 및 공동 수행자도 코멘트 작성 가능 (v0.75)
  const canComment =
    canUpdateProgress ||
    (['APPROVED', 'IN_PROGRESS', 'COMPLETED'].includes(goal.status) &&
      (iAmTeamLead || iAmHQHead || iAmExec || isCollaborator));

  // 팀장: PENDING_APPROVAL 목표 (팀원 것). 본인 목표는 자기가 승인 불가
  const canLeadApprove = iAmTeamLead && ownerIsMemberLike && !isOwner && (
    (goal.status === 'PENDING_APPROVAL') ||
    (goal.status === 'COMPLETED' && !goal.completionLeadApprovedBy) ||
    (goal.status === 'PENDING_ABANDON' && !goal.abandonLeadApprovedBy)  // 아직 포기 1차 미승인인 것만
  );

  // 본부장: LEAD_APPROVED 목표 중 hqApprovedBy 없는 것
  // 완료 확인: 팀원 목표는 팀장 1차 → 본부장 2차, 팀장 목표는 본부장 1차 (직접)
  // 신규 목표: 팀장 owner 의 PENDING_APPROVAL 본부장 1차 승인
  // 팀장 부재 시(teamHasNoLead): 본부장이 1차 승인·완료확인·포기 모두 대행
  const canHQApprove = iAmHQHead && !isOwner && (
    (goal.status === 'LEAD_APPROVED' && !goal.hqApprovedBy) ||
    (goal.status === 'COMPLETED' && ownerIsMemberLike && !!goal.completionLeadApprovedBy && !goal.completionHqApprovedBy) ||
    (goal.status === 'COMPLETED' && ownerRole === 'TEAM_LEAD' && !goal.completionHqApprovedBy) ||
    // 팀장의 신규 목표 1차 승인 (본부장 거쳐 임원에게)
    (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD') ||
    // 팀장 부재 시 본부장이 팀원 목표 1차 대행
    (teamHasNoLead && ownerIsMemberLike && goal.status === 'PENDING_APPROVAL') ||
    (teamHasNoLead && ownerIsMemberLike && goal.status === 'COMPLETED' && !goal.completionLeadApprovedBy && !goal.completionHqApprovedBy) ||
    (teamHasNoLead && ownerIsMemberLike && goal.status === 'PENDING_ABANDON' && !goal.abandonLeadApprovedBy)
  );

  // 임원: 팀장 목표(PENDING_APPROVAL) 또는 최종 승인 대기(LEAD_APPROVED)
  // 신규/완료/포기 모두: 팀장 목표도 본부 있으면 본부장 확인 후 → 임원 최종
  // 단, owner가 본부 직속(HEADQUARTERS) = 본부장 본인 목표 → 본부 단계 건너뜀
  const ownerOrgForExec = allOrgs.find(o => o.id === goal.organizationId);
  const ownerOrgIsHQ = ownerOrgForExec?.type === 'HEADQUARTERS';
  const canExecApprove = iAmExec && !isOwner && (
    // 팀장 신규 목표: 본부 없거나 본부장 확인 후, 또는 본부장 본인 목표
    (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD' && (!hasHQInChain || !!goal.hqApprovedBy || ownerOrgIsHQ)) ||
    // EXECUTIVE owner (본부장이 임원 role): 부문장이 직접 최종
    (goal.status === 'PENDING_APPROVAL' && ownerRole === 'EXECUTIVE') ||
    (goal.status === 'LEAD_APPROVED' && (!hasHQInChain || !!goal.hqApprovedBy)) ||
    (goal.status === 'COMPLETED' && ownerRole === 'TEAM_LEAD' && !goal.completionExecApprovedBy && (!hasHQInChain || !!goal.completionHqApprovedBy || ownerOrgIsHQ)) ||
    (goal.status === 'COMPLETED' && ownerRole === 'EXECUTIVE' && !goal.completionExecApprovedBy) ||
    (goal.status === 'COMPLETED' && ownerIsMemberLike && !!goal.completionLeadApprovedBy && !goal.completionExecApprovedBy && (!hasHQInChain || !!goal.completionHqApprovedBy)) ||
    (goal.status === 'PENDING_ABANDON' && ownerRole === 'TEAM_LEAD') ||
    (goal.status === 'PENDING_ABANDON' && ownerRole === 'EXECUTIVE') ||
    (goal.status === 'PENDING_ABANDON' && ownerIsMemberLike && !!goal.abandonLeadApprovedBy)
  );

  const canApprove = canLeadApprove || canHQApprove || canExecApprove;

  const canReject = (iAmTeamLead && ['PENDING_APPROVAL', 'COMPLETED'].includes(goal.status) && ownerIsMemberLike) ||
    (iAmHQHead && (
      ['LEAD_APPROVED', 'COMPLETED'].includes(goal.status) ||
      // 팀장 신규 목표(PENDING_APPROVAL) 도 본부장이 반려 가능
      (goal.status === 'PENDING_APPROVAL' && ownerRole === 'TEAM_LEAD')
    )) ||
    (iAmExec && ['LEAD_APPROVED', 'PENDING_APPROVAL', 'COMPLETED'].includes(goal.status));

  function getApproveLabel() {
    if (iAmTeamLead) {
      if (goal!.status === 'PENDING_APPROVAL') return '1차 승인';
      if (goal!.status === 'COMPLETED') return '완료 1차 확인';
      if (goal!.status === 'PENDING_ABANDON') return '포기 1차 승인';
    }
    if (iAmHQHead) {
      // 본인 직책(position) 우선, 없으면 "본부"
      const myTitle = userProfile?.position || '본부';
      if (goal!.status === 'LEAD_APPROVED') return `2차 승인 (${myTitle})`;
      if (goal!.status === 'COMPLETED') return '완료 2차 확인';
    }
    if (iAmExec) {
      const myTitle = userProfile?.position || '임원';
      if (goal!.status === 'LEAD_APPROVED') return `최종 승인 (${myTitle})`;
      if (goal!.status === 'COMPLETED') return `완료 최종 확인 (${myTitle})`;
      if (goal!.status === 'PENDING_ABANDON') return `포기 최종 승인 (${myTitle})`;
      return `승인 (${myTitle})`;
    }
    if (iAmTeamLead) {
      // 팀장 라벨도 본인 직책 표시 가능
      const myTitle = userProfile?.position || '팀장';
      if (goal!.status === 'PENDING_APPROVAL') return `1차 승인 (${myTitle})`;
      if (goal!.status === 'COMPLETED') return `완료 1차 확인 (${myTitle})`;
      if (goal!.status === 'PENDING_ABANDON') return `포기 1차 승인 (${myTitle})`;
    }
    return '승인';
  }

  const completionStep = goal.status === 'COMPLETED'
    ? (
        // 팀원 목표: 팀장 1차 → (본부장 2차) → 임원 최종
        ownerIsMemberLike
          ? (!goal.completionLeadApprovedBy
              ? '팀장 1차 확인 대기'
              : hasHQInChain && !goal.completionHqApprovedBy
                ? '본부장 2차 확인 대기'
                : !goal.completionExecApprovedBy
                  ? '임원 최종 확인 대기'
                  : null)
          // 팀장 목표: (본부장 1차) → 임원 최종
          : ownerRole === 'TEAM_LEAD'
            ? (hasHQInChain && !goal.completionHqApprovedBy
                ? '본부장 1차 확인 대기'
                : !goal.completionExecApprovedBy
                  ? '임원 최종 확인 대기'
                  : null)
            : null
      )
    : null;

  const goalTypeBadge = getGoalTypeBadge(goal, userProfile?.id);

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
                <GoalStatusBadge goal={goal} />
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

            {/* 공동 수행자 — 임원 승인 후 collaborator 들도 본인 목표로 보임 + 코멘트 가능 */}
            {(goal.collaboratorIds?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 border-t pt-3">
                <span className="text-xs font-semibold text-gray-500">공동 수행자</span>
                <div className="flex flex-wrap gap-1.5">
                  {(goal.collaboratorIds ?? []).map(id => {
                    const u = usersMap[id];
                    if (!u) return null;
                    const orgName = allOrgs.find(o => o.id === u.organizationId)?.name;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">
                        <MemberInfoModal userId={u.id} userName={u.name} />
                        {orgName && <span className="text-blue-400">· {orgName}</span>}
                        {u.position && <span className="text-blue-400">· {u.position}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

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

            {(canEdit || canDelete || canRequestApproval || canWithdraw || canWithdrawModifyRequest || canWithdrawCompletion || canWithdrawAbandon || canRequestCompletion || canRequestAbandon || canRequestModify) && (
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
                  {canWithdrawModifyRequest && (
                    <Button
                      onClick={withdrawModifyRequest} disabled={actionLoading} size="sm" variant="outline"
                      className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                      <XCircle className="h-4 w-4" />
                      {goal.reassignFromId ? '수행자 변경 요청 회수' : '수정 요청 회수'}
                    </Button>
                  )}
                  {canWithdrawCompletion && (
                    <Button
                      onClick={withdrawCompletion} disabled={actionLoading} size="sm" variant="outline"
                      className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                      <XCircle className="h-4 w-4" /> 완료 요청 회수
                    </Button>
                  )}
                  {canWithdrawAbandon && (
                    <Button
                      onClick={withdrawAbandon} disabled={actionLoading} size="sm" variant="outline"
                      className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                      <XCircle className="h-4 w-4" /> 포기 요청 회수
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
                      placeholder="승인 요청 시 전달할 의견을 입력하세요 (Shift+Enter 제출)"
                      value={approvalRequestComment}
                      onChange={e => setApprovalRequestComment(e.target.value)}
                      onKeyDown={shiftEnterSubmit(requestApproval, !actionLoading)}
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
                      placeholder="포기 요청 사유를 입력하세요 (Shift+Enter 제출)"
                      value={abandonComment}
                      onChange={e => setAbandonComment(e.target.value)}
                      onKeyDown={shiftEnterSubmit(requestAbandon, !actionLoading)}
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
                    <span className="text-xs text-indigo-600 bg-indigo-50 rounded px-2 py-1">1차 승인 단계</span>
                  )}
                  {iAmHQHead && goal.status === 'LEAD_APPROVED' && (
                    <span className="text-xs text-purple-600 bg-purple-50 rounded px-2 py-1">2차 승인 단계</span>
                  )}
                  {iAmExec && goal.status === 'LEAD_APPROVED' && (
                    <span className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">최종 승인 단계</span>
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
                      placeholder="승인 의견을 입력하세요 (Shift+Enter 제출)"
                      value={approveComment}
                      onChange={e => setApproveComment(e.target.value)}
                      onKeyDown={shiftEnterSubmit(approveGoal, !actionLoading)}
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
                      placeholder="반려 사유를 입력하세요 (Shift+Enter 제출)"
                      value={rejectComment}
                      onChange={e => setRejectComment(e.target.value)}
                      onKeyDown={shiftEnterSubmit(rejectGoal, !actionLoading && !!rejectComment.trim())}
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

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'progress' | 'history')}>
            <TabsList>
              <TabsTrigger value="progress">진행상황 ({updates.length})</TabsTrigger>
              <TabsTrigger value="history" className="relative gap-1.5">
                변경 이력 ({histories.length})
                {histories.some(h => h.fieldChanges) && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
                    title="변경 항목이 포함된 이력이 있습니다"
                  />
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="progress" className="mt-4 space-y-4">
              {canComment && (
                <div className="rounded-xl border bg-white p-5 space-y-4">
                  <h4 className="font-medium text-gray-900">
                    {canUpdateProgress ? '진행상황 업데이트' : '코멘트 작성'}
                  </h4>
                  {canUpdateProgress && (
                    <div className="space-y-1.5">
                      <Label>진행률: {newProgress}%</Label>
                      <input
                        type="range" min={0} max={100} step={5}
                        value={newProgress}
                        onChange={e => setNewProgress(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>코멘트 *</Label>
                    <Textarea
                      placeholder={canUpdateProgress
                        ? "진행 내용을 기록하세요 (Shift+Enter 제출)"
                        : "조직 체인 상의 결재자로서 코멘트를 작성하세요 (Shift+Enter 제출)"}
                      value={progressComment}
                      onChange={e => setProgressComment(e.target.value)}
                      onKeyDown={shiftEnterSubmit(submitProgress, !actionLoading && !!progressComment.trim())}
                      rows={3}
                    />
                  </div>
                  <Button onClick={submitProgress} disabled={actionLoading || !progressComment.trim()} size="sm">
                    {canUpdateProgress ? '업데이트' : '코멘트 등록'}
                  </Button>
                </div>
              )}
              {updates.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">진행상황 기록이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {updates.map(u => {
                    const author = usersMap[u.userId];
                    const isOwnerUpdate = u.userId === goal.userId;
                    return (
                      <div key={u.id} className="rounded-xl border bg-white p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-700">
                              {author ? <MemberInfoModal userId={author.id} userName={author.name} /> : '알 수 없음'}
                            </span>
                            {!isOwnerUpdate && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">코멘트</span>
                            )}
                            <span className="text-gray-400">
                              {format(u.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
                            </span>
                          </div>
                          {isOwnerUpdate && (
                            <span className="font-medium text-blue-600">{u.progress}%</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{u.comment}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              {histories.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">변경 이력이 없습니다.</p>
              ) : (
                <div className="relative pl-5">
                  <div className="absolute left-2 top-0 bottom-0 w-px bg-gray-200" />
                  {histories.map(h => {
                    const changer = usersMap[h.changedBy];
                    return (
                      <div key={h.id} className="relative mb-4 pl-4">
                        <div className="absolute -left-0.5 top-1.5 h-2 w-2 rounded-full bg-blue-400" />
                        <div className="rounded-xl border bg-white p-3">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-700">
                                {changer ? <MemberInfoModal userId={changer.id} userName={changer.name} /> : '시스템'}
                              </span>
                              <span className="text-gray-400">{format(h.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}</span>
                            </div>
                            {h.newStatus && <GoalStatusBadge status={h.newStatus} />}
                          </div>
                          {h.comment && <p className="text-sm text-gray-700 whitespace-pre-wrap">{h.comment}</p>}

                          {/* 상신 의견 (사용자가 적은 의견) */}
                          {h.submitComment && (
                            <div className="mt-2 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2">
                              <div className="text-[11px] font-semibold text-blue-700 mb-0.5">상신 의견</div>
                              <p className="text-sm text-gray-800 whitespace-pre-wrap">{h.submitComment}</p>
                            </div>
                          )}

                          {/* 변경 항목 diff */}
                          {h.fieldChanges && <FieldChangesView changes={h.fieldChanges} usersMap={usersMap} />}
                        </div>
                      </div>
                    );
                  })}
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
