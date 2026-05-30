'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { createGoal, updateGoal, getOrganizations, getAllUsers, createNotification, addGoalHistory } from '@/lib/firestore';
import { notifyNextApprover, notifyAllChainParties } from '@/lib/goal-notifications';
import { computeSubmitterAutoApproval, stageLabel } from '@/lib/approval-filters';
import type { Organization, GoalFieldChanges } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { Goal, User } from '@/types';

interface TaskGoalFormProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editGoal?: Goal;
}

export default function TaskGoalForm({
  open, onClose, onSave, editGoal,
}: TaskGoalFormProps) {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [modifyComment, setModifyComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [isConfidential, setIsConfidential] = useState(false);
  const [ownerId, setOwnerId] = useState<string>('');   // 수행자 (Goal.userId) — 기본 본인
  const [ownerSearch, setOwnerSearch] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [userSearch, setUserSearch] = useState('');

  // 폼이 열릴 때의 status를 스냅샷 — 부모 prop 재렌더로 인한 status 변경 방지
  const openedStatusRef = useRef<Goal['status'] | null>(null);

  const isEdit = !!editGoal;
  const isDraftEdit = isEdit && ['DRAFT', 'REJECTED'].includes(editGoal.status);
  const isApprovedEdit = isEdit && !['DRAFT', 'REJECTED'].includes(editGoal.status);

  useEffect(() => {
    if (!open) {
      // 폼이 닫힐 때 스냅샷 초기화
      openedStatusRef.current = null;
      setError('');
      setModifyComment('');
      return;
    }
    if (editGoal) {
      // 폼이 처음 열릴 때만 status 스냅샷 (이후 prop 변경은 무시)
      if (openedStatusRef.current === null) {
        openedStatusRef.current = editGoal.status;
      }
      setTitle(editGoal.title);
      setDescription(editGoal.description);
      setDueDate(editGoal.dueDate.toISOString().split('T')[0]);
      setCollaboratorIds(editGoal.collaboratorIds ?? []);
      setOwnerId(editGoal.userId);
      setIsConfidential(!!editGoal.isConfidential);
    } else {
      openedStatusRef.current = null;
      setTitle('');
      setDescription('');
      setDueDate('');
      setCollaboratorIds([]);
      setOwnerId(userProfile?.id ?? '');  // 본인이 기본 수행자
      setIsConfidential(false);
    }
    setError('');
    setUserSearch('');
    setOwnerSearch('');
    // 사용자 목록 lazy load
    getAllUsers().then(list => setUsers(list.filter(u => u.isActive !== false))).catch(() => {});
    getOrganizations().then(setAllOrgs).catch(() => {});
  }, [open, editGoal]);

  // (sendApprovalNotification 제거됨 — handleSubmit 내 postSubmitNotifications 가 통합 처리)

  async function handleSubmit(isDraft: boolean) {
    if (!userProfile) return;
    if (!title.trim()) { setError('목표명을 입력하세요.'); return; }
    if (!isDraft) {
      if (!description.trim()) { setError('세부내용을 입력하세요.'); return; }
      if (!dueDate) { setError('추진기한을 선택하세요.'); return; }
    }

    setSubmitting(true);
    try {
      // 수행자 결정 — 미선택 시 본인
      const effectiveOwnerId = ownerId || userProfile.id;
      const ownerUser = users.find(u => u.id === effectiveOwnerId);
      const ownerOrgId = ownerUser?.organizationId ?? userProfile.organizationId;
      // collaboratorIds 에서 수행자 자신·중복 제거
      const cleanedCollaborators = collaboratorIds.filter(id => id !== effectiveOwnerId);
      // 연관 조직 — 수행자 organizationId + collaborator 들의 organizationId 합집합
      const collaboratorOrgIds = cleanedCollaborators
        .map(id => users.find(u => u.id === id)?.organizationId)
        .filter((v): v is string => !!v);
      const relatedOrgIds = Array.from(new Set([ownerOrgId, ...collaboratorOrgIds].filter(Boolean)));

      const payload = {
        title: title.trim(),
        description: description.trim(),
        dueDate: dueDate ? new Date(dueDate) : new Date(),
        progress: 0,
        collaboratorIds: cleanedCollaborators,
        relatedOrgIds,
        isConfidential,
      };

      // ── 변경 항목 diff 계산 (편집 모드일 때) ──
      function computeFieldChanges(newOwnerId: string, newCollabs: string[]): GoalFieldChanges | undefined {
        if (!isEdit || !editGoal) return undefined;
        const ch: GoalFieldChanges = {};
        const newTitle = title.trim();
        const newDesc = description.trim();
        const oldTitle = editGoal.title ?? '';
        const oldDesc = editGoal.description ?? '';
        if (oldTitle !== newTitle) ch.title = { from: oldTitle, to: newTitle };
        if (oldDesc !== newDesc) ch.description = { from: oldDesc, to: newDesc };

        // dueDate 비교 (날짜 단위 yyyy-MM-dd)
        const fmtDate = (d: Date | null | undefined) => {
          if (!d) return '';
          const dt = new Date(d);
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const dd = String(dt.getDate()).padStart(2, '0');
          return `${y}-${m}-${dd}`;
        };
        const oldDue = fmtDate(editGoal.dueDate);
        const newDue = dueDate || '';
        if (oldDue !== newDue) ch.dueDate = { from: oldDue, to: newDue };

        if (editGoal.userId !== newOwnerId) {
          ch.ownerId = { from: editGoal.userId, to: newOwnerId };
        }
        // collaborator 비교 (순서 무관 집합 비교)
        const oldCollabs = (editGoal.collaboratorIds ?? []).slice().sort();
        const sortedNew = newCollabs.slice().sort();
        const collabsChanged = oldCollabs.length !== sortedNew.length
          || oldCollabs.some((id, i) => id !== sortedNew[i]);
        if (collabsChanged) {
          ch.collaboratorIds = { from: editGoal.collaboratorIds ?? [], to: newCollabs };
        }

        // 대내비 토글 비교
        const oldConfidential = !!editGoal.isConfidential;
        if (oldConfidential !== isConfidential) {
          ch.isConfidential = { from: oldConfidential, to: isConfidential };
        }
        return Object.keys(ch).length > 0 ? ch : undefined;
      }
      const fieldChanges = computeFieldChanges(effectiveOwnerId, cleanedCollaborators);
      const submitComment = modifyComment.trim() || undefined;

      // 폼이 열릴 때 스냅샷한 status 기준으로 판단 (prop 재렌더 영향 차단)
      const capturedStatus = openedStatusRef.current ?? editGoal?.status ?? 'DRAFT';
      const isApprovedGoal = isEdit && !['DRAFT', 'REJECTED'].includes(capturedStatus);

      // 수행자 변경 감지 — 편집 모드일 때만
      const isOwnerChanged = isEdit && editGoal.userId !== effectiveOwnerId;
      const newOwnerName = isOwnerChanged ? (users.find(u => u.id === effectiveOwnerId)?.name ?? '') : '';

      // 새 수행자에게 알림을 보내는 헬퍼 (본인이 본인에게 재지정하는 경우는 제외)
      async function notifyNewOwner(goalId: string, goalTitle: string, comment?: string) {
        if (!isOwnerChanged || effectiveOwnerId === userProfile!.id) return;
        try {
          await createNotification({
            userId: effectiveOwnerId,
            goalId,
            goalTitle,
            type: 'GOAL_COMMENT',  // 수행자 재지정 전용 type 없어서 GOAL_COMMENT 재활용
            message: comment ?? `${userProfile!.name}님이 '${goalTitle}' 핵심목표의 수행자로 귀하를 지정했습니다.`,
            read: false,
          });
        } catch (err) {
          console.error('[알림] 새 수행자 알림 발송 실패:', err);
        }
      }

      // 이전 수행자(=기안자)에게 알림 — 본인이 변경 행위자이거나 새 수행자와 같으면 skip
      async function notifyPreviousOwner(goalId: string, goalTitle: string) {
        if (!isOwnerChanged) return;
        const prevOwnerId = editGoal!.userId;
        if (!prevOwnerId || prevOwnerId === userProfile!.id || prevOwnerId === effectiveOwnerId) return;
        try {
          await createNotification({
            userId: prevOwnerId,
            goalId,
            goalTitle,
            type: 'GOAL_COMMENT',
            message: `${userProfile!.name}님이 '${goalTitle}' 핵심목표의 수행자를 ${newOwnerName}님으로 변경했습니다.`,
            read: false,
          });
        } catch (err) {
          console.error('[알림] 이전 수행자 알림 발송 실패:', err);
        }
      }

      // ── 자동 승인 계산 ──
      // 변경 행위자(현재 사용자) 가 새 수행자의 결재 체인에 포함되면 그 단계까지 자동 승인.
      // 예) 팀장이 본인 팀 팀원에게 수행자 재지정/대리 작성 → 팀장 단계 자동 통과 → LEAD_APPROVED
      //    임원이 직접 작성/재지정 → 즉시 APPROVED
      const newOwnerRole = users.find(u => u.id === effectiveOwnerId)?.role;
      const autoApproval = (!isDraft)
        ? computeSubmitterAutoApproval({
            newOwnerOrgId: ownerOrgId,
            newOwnerRole,
            allOrgs,
            submitterId: userProfile.id,
            submitterRole: userProfile.role,
            submitterOrgId: userProfile.organizationId,
          })
        : { status: 'DRAFT' as const, fields: {}, stageRole: null };

      const submitStatus = isDraft ? 'DRAFT' : autoApproval.status;
      const autoApprovedHistoryComment = autoApproval.stageRole
        ? ` (${stageLabel(autoApproval.stageRole)} 단계 자동 승인)`
        : '';

      // 변경 후 알림 발송 헬퍼 — 다음 결재자 + 새 수행자 + 이전 수행자
      async function postSubmitNotifications(goalId: string, goalTitle: string, ownerChangedExtraMsg?: string) {
        // ① 다음 결재자에게 알림 (autoApproval 반영된 합성 Goal)
        if (!isDraft) {
          try {
            const synthesizedGoal = {
              id: goalId,
              title: goalTitle,
              userId: effectiveOwnerId,
              organizationId: ownerOrgId,
              status: autoApproval.status,
              collaboratorIds: cleanedCollaborators,
              ...autoApproval.fields,
            } as any;
            const orgsForNotif = allOrgs.length > 0 ? allOrgs : await getOrganizations();
            await notifyNextApprover({
              goal: synthesizedGoal,
              allOrgs: orgsForNotif,
              allUsers: users,
              fromUserId: userProfile!.id,
              fromUserName: userProfile!.name,
              action: 'SUBMIT',
            });
            // F7 broadcast — 체인 전원
            await notifyAllChainParties({
              goal: synthesizedGoal,
              allOrgs: orgsForNotif,
              allUsers: users,
              fromUserId: userProfile!.id,
              fromUserName: userProfile!.name,
              event: 'SUBMITTED',
            });
          } catch (err) {
            console.error('[알림] 다음 결재자 알림 발송 실패:', err);
          }
        }
        // ② 새 수행자 / 이전 수행자 알림
        await notifyNewOwner(goalId, goalTitle, ownerChangedExtraMsg);
        await notifyPreviousOwner(goalId, goalTitle);
      }

      if (isEdit && !isApprovedGoal) {
        // DRAFT/REJECTED 목표 수정 → 상신 (수행자 변경 가능)
        // 수행자 변경 시 → 이관업무로 분류 (previousOwnerId/Name/transferredAt 갱신)
        const prevOwnerName = users.find(u => u.id === editGoal.userId)?.name ?? '';
        await updateGoal(editGoal.id, {
          ...payload,
          userId: effectiveOwnerId,
          organizationId: ownerOrgId,
          ...(isOwnerChanged ? {
            previousOwnerId: editGoal.userId,
            previousOwnerName: prevOwnerName,
            transferredAt: new Date(),
          } : {}),
          status: submitStatus,
          ...(!isDraft ? autoApproval.fields : {}),
        });
        if (isOwnerChanged || autoApproval.stageRole || fieldChanges) {
          await addGoalHistory({
            goalId: editGoal.id,
            changedBy: userProfile.id,
            changeType: isOwnerChanged ? 'OWNER_REASSIGNED' : 'UPDATED',
            previousStatus: editGoal.status,
            newStatus: submitStatus,
            comment: (isOwnerChanged
              ? `수행자 재지정: ${editGoal.userId} → ${effectiveOwnerId} (${newOwnerName})`
              : '재상신') + autoApprovedHistoryComment,
            ...(fieldChanges ? { fieldChanges } : {}),
            ...(submitComment ? { submitComment } : {}),
          });
        }
        await postSubmitNotifications(editGoal.id, payload.title);
      } else if (isApprovedGoal && !isDraft) {
        // 승인된 목표 수정 상신 — 지연 수행자 전환 (deferred ownership) 방식
        //  - 콘텐츠 (title/description/dueDate/isConfidential) 는 즉시 반영 + modifySnapshot 으로 회수·반려 시 원복.
        //  - 수행자/공동수행자 변경은 pendingOwner* / pendingCollaboratorIds 에만 저장.
        //    userId/organizationId/collaboratorIds 는 변하지 않음 → 최종 승인 전까지 모든 권한·노출은 기존 수행자 유지.
        //  - 결재 체인은 goal.userId(=기존 수행자) 기준으로 계산되어 일관성 확보.
        const { doc: fsDoc, updateDoc: rawUpdate, serverTimestamp: sts, Timestamp: FsTimestamp, deleteField } = await import('firebase/firestore');
        const { db: fsDb } = await import('@/lib/firebase');
        const prevOwnerName = users.find(u => u.id === editGoal.userId)?.name ?? '';

        // 회수·반려 시 콘텐츠 원복용 스냅샷 (수행자/공동수행자는 변하지 않으므로 스냅샷 불필요)
        const modifySnapshot = {
          title: editGoal.title,
          description: editGoal.description,
          dueDate: FsTimestamp.fromDate(editGoal.dueDate),
          isConfidential: !!editGoal.isConfidential,
        };

        // 콘텐츠 필드만 즉시 반영. collaboratorIds/relatedOrgIds 는 isOwnerChanged 일 때 pending 으로 분기.
        const liveUpdate: any = {
          title: payload.title,
          description: payload.description,
          dueDate: FsTimestamp.fromDate(dueDate ? new Date(dueDate) : new Date()),
          isConfidential: payload.isConfidential,
          modifyRequestedBy: userProfile.id,
          modifySnapshot,
          status: submitStatus,
          needsReassignment: false,
          // 이전 결재 체인 초기화 (자동 승인 필드는 아래에서 덮어씀)
          leadApprovedBy: deleteField(),
          leadApprovedAt: deleteField(),
          hqApprovedBy: deleteField(),
          hqApprovedAt: deleteField(),
          approvedBy: deleteField(),
          approvedAt: deleteField(),
          ...autoApproval.fields,
          updatedAt: sts(),
        };
        if (isOwnerChanged) {
          // 수행자/공동수행자 변경 — deferred. 현 owner 유지, pending 에 저장.
          liveUpdate.pendingOwnerId = effectiveOwnerId;
          liveUpdate.pendingOwnerName = newOwnerName;
          liveUpdate.pendingOwnerOrgId = ownerOrgId;
          liveUpdate.pendingCollaboratorIds = cleanedCollaborators;
          // 구버전 reassignFromId 가 잔류해있으면 정리
          liveUpdate.reassignFromId = deleteField();
          liveUpdate.reassignFromName = deleteField();
          liveUpdate.reassignFromOrgId = deleteField();
        } else {
          // 수행자 변경 없음 — collaboratorIds/relatedOrgIds 즉시 반영
          liveUpdate.collaboratorIds = cleanedCollaborators;
          liveUpdate.relatedOrgIds = relatedOrgIds;
          // pending 잔류 정리
          liveUpdate.pendingOwnerId = deleteField();
          liveUpdate.pendingOwnerName = deleteField();
          liveUpdate.pendingOwnerOrgId = deleteField();
          liveUpdate.pendingCollaboratorIds = deleteField();
        }
        await rawUpdate(fsDoc(fsDb, 'goals', editGoal.id), liveUpdate);
        await addGoalHistory({
          goalId: editGoal.id,
          changedBy: userProfile.id,
          changeType: isOwnerChanged ? 'OWNER_REASSIGNED' : 'UPDATED',
          previousStatus: editGoal.status,
          newStatus: submitStatus,
          comment: (isOwnerChanged
            ? `수행자 변경 요청: ${prevOwnerName} → ${newOwnerName} (최종 승인 시 확정)`
            : '수정 후 재상신'
          ) + autoApprovedHistoryComment,
          ...(fieldChanges ? { fieldChanges } : {}),
          ...(submitComment ? { submitComment } : {}),
        });
        // 다음 결재자 알림 — goal.userId 는 기존 수행자 그대로. 체인도 기존 수행자 기준.
        try {
          const orgsForNotif = allOrgs.length > 0 ? allOrgs : await getOrganizations();
          await notifyNextApprover({
            goal: {
              id: editGoal.id,
              title: payload.title,
              userId: editGoal.userId,          // 기존 수행자 유지
              organizationId: editGoal.organizationId,
              status: submitStatus,
              ...autoApproval.fields,
            } as any,
            allOrgs: orgsForNotif,
            allUsers: users,
            fromUserId: userProfile.id,
            fromUserName: userProfile.name,
            action: 'SUBMIT',
          });
        } catch (err) {
          console.error('[알림] 다음 결재자 알림 발송 실패:', err);
        }
        // 새 수행자에게 변경 요청 사전 통지
        if (isOwnerChanged && effectiveOwnerId !== userProfile.id) {
          try {
            await createNotification({
              userId: effectiveOwnerId,
              goalId: editGoal.id,
              goalTitle: payload.title,
              type: 'GOAL_COMMENT',
              message: `${prevOwnerName}님의 '${payload.title}' 핵심목표 수행자로 귀하가 지정되어 결재 중입니다. 최종 승인 시 확정됩니다.`,
              read: false,
            });
          } catch (err) { console.error('[알림] 새 수행자 사전 통지 실패:', err); }
        }
      } else {
        // 신규 목표 또는 승인된 목표의 임시저장(새 DRAFT 생성)
        const newGoalId = await createGoal({
          ...payload,
          status: submitStatus,
          userId: effectiveOwnerId,                       // v0.76: 수행자가 owner — 본인 또는 지정된 사용자
          organizationId: ownerOrgId,                     // 수행자의 소속 조직 기준
          cycleYear: activeYear,
          ...(!isDraft ? autoApproval.fields : {}),
        });
        if (!isDraft && autoApproval.stageRole) {
          await addGoalHistory({
            goalId: newGoalId,
            changedBy: userProfile.id,
            changeType: 'APPROVED',
            previousStatus: 'PENDING_APPROVAL',
            newStatus: submitStatus,
            comment: `상신자가 결재자(${stageLabel(autoApproval.stageRole)})임 — 해당 단계 자동 승인`,
          });
        }
        await postSubmitNotifications(newGoalId, payload.title);
      }
      if (isOwnerChanged) {
        // 승인된 목표의 수행자 변경은 최종 승인 시 이관 (보류) / DRAFT·신규는 즉시 반영
        if (isApprovedGoal && !isDraft) {
          toast.success(`${newOwnerName}님으로 수행자 변경을 요청했습니다. 최종 승인 시 이관됩니다.`);
        } else {
          toast.success(`목표가 ${newOwnerName}님에게 이관되었습니다. (해당 사용자의 목표 목록에서 확인 가능)`);
        }
      }
      onSave();
      onClose();
    } catch (e) {
      setError('저장 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editGoal || editGoal.status !== 'DRAFT') return;
    if (!confirm('임시저장된 목표를 휴지통으로 이동하시겠습니까?')) return;
    setSubmitting(true);
    try {
      await updateGoal(editGoal.id, { status: 'ABANDONED' });
      onSave();
      onClose();
    } catch (e) {
      setError('삭제 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  function triggerShake() {
    // React state 없이 직접 DOM 조작 → 리렌더 없음, 깜빡임 없음
    const el = document.querySelector('[data-slot="dialog-content"]') as HTMLElement | null;
    if (!el) return;
    el.classList.remove('animate-shake');
    void el.offsetWidth; // reflow 강제 → 애니메이션 재시작 보장
    el.classList.add('animate-shake');
    const handleEnd = () => {
      el.classList.remove('animate-shake');
      el.removeEventListener('animationend', handleEnd);
    };
    el.addEventListener('animationend', handleEnd);
  }

  // Escape 키로 닫힘 방지 + 흔들기
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); triggerShake(); }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-[78rem] [&>button:last-child]:hidden"
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>
              {isEdit ? '목표 수정' : '목표 추가'}
            </DialogTitle>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 승인된 목표 수정 시 — 기존 내용 읽기전용 표시 */}
          {isApprovedEdit && editGoal && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">현재 내용 (변경 불가)</p>
              <div className="space-y-1">
                <p className="text-xs text-gray-400">목표명</p>
                <p className="text-sm font-medium text-gray-700">{editGoal.title}</p>
              </div>
              {editGoal.description && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400">세부내용</p>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">{editGoal.description}</p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-xs text-gray-400">추진기한</p>
                <p className="text-sm text-gray-600">{editGoal.dueDate.toLocaleDateString('ko-KR')}</p>
              </div>
            </div>
          )}

          {/* 목표명 */}
          <div className="space-y-1.5">
            <Label className="whitespace-nowrap">{isApprovedEdit ? '수정할 목표명' : '목표명'} <span className="text-red-500">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 신제품 라인 생산성 10% 향상" />
          </div>

          {/* 세부내용 */}
          <div className="space-y-1.5">
            <Label className="whitespace-nowrap">{isApprovedEdit ? '수정할 세부내용' : '세부내용'} <span className="text-red-500">*</span></Label>
            <Textarea
              rows={isApprovedEdit ? 5 : 10}
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              placeholder="구체적인 실행 계획을 입력하세요"
            />
          </div>

          {/* 추진기한 */}
          <div className="space-y-1.5">
            <Label className="whitespace-nowrap">{isApprovedEdit ? '수정할 추진기한' : '추진기한'} <span className="text-red-500">*</span></Label>
            <Input type="date" min="2000-01-01" max="2099-12-31" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          {/* 수행자 (owner) — 본인 자동 기본값, 다른 사용자 지정 가능
              UX: 수행자 변경 시 이전 수행자를 자동으로 공동수행자에 추가, 새 수행자가 기존 공동수행자였으면 제거.
                  → 스왑 케이스(원 수행자 → 공동수행자, 공동수행자 → 수행자)도 한 번에 처리됨. */}
          <OwnerPicker
            users={users}
            value={ownerId || (userProfile?.id ?? '')}
            onChange={newOwnerId => {
              const prevOwnerId = ownerId || (userProfile?.id ?? '');
              setOwnerId(newOwnerId);
              if (prevOwnerId && prevOwnerId !== newOwnerId) {
                setCollaboratorIds(curr => {
                  const withoutNewOwner = curr.filter(id => id !== newOwnerId);
                  return withoutNewOwner.includes(prevOwnerId)
                    ? withoutNewOwner
                    : [...withoutNewOwner, prevOwnerId];
                });
              }
            }}
            search={ownerSearch}
            onSearchChange={setOwnerSearch}
            selfId={userProfile?.id ?? ''}
          />

          {/* 공동 수행자 (collaborators) — 수행자는 제외 */}
          <CollaboratorPicker
            users={users.filter(u => u.id !== (ownerId || userProfile?.id))}
            value={collaboratorIds}
            onChange={setCollaboratorIds}
            search={userSearch}
            onSearchChange={setUserSearch}
          />

          {/* 대내비 — 전사 업무추진현황에서 제목 마스킹 */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isConfidential}
              onChange={e => setIsConfidential(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">대내비 (전사 업무추진현황에서 CONFIDENTIAL 로 마스킹)</span>
          </label>

          {/* 수정 요청 의견 (승인된 목표 수정 시) */}
          {isApprovedEdit && (
            <div className="space-y-1.5">
              <Label className="whitespace-nowrap">수정 요청 의견 <span className="text-gray-400 font-normal text-xs">(선택)</span></Label>
              <Textarea
                rows={2}
                value={modifyComment}
                onChange={e => setModifyComment(e.target.value)}
                placeholder="수정을 요청하는 이유를 입력하세요"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          {/* DRAFT 삭제 버튼 — 왼쪽 정렬 */}
          {isDraftEdit && (
            <Button
              variant="outline" onClick={handleDelete} disabled={submitting}
              className="mr-auto text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600"
            >
              삭제
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={submitting}>취소</Button>
          <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting}>임시저장</Button>
          <Button onClick={() => handleSubmit(false)} disabled={submitting}>
            {isApprovedEdit ? '수정 상신' : '상신'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 공동 수행자 검색·선택 픽커 ─────────────────────────
function CollaboratorPicker({ users, value, onChange, search, onSearchChange }: {
  users: User[];
  value: string[];
  onChange: (ids: string[]) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const k = search.toLowerCase();
    return users
      .filter(u => !value.includes(u.id))
      .filter(u => u.name?.toLowerCase().includes(k) || u.email?.toLowerCase().includes(k))
      .slice(0, 12);
  }, [users, value, search]);
  const selected = value.map(id => users.find(u => u.id === id)).filter(Boolean) as User[];
  return (
    <div className="space-y-1.5">
      <Label className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="whitespace-nowrap">공동 수행자</span>
        <span className="text-xs text-gray-400 font-normal">
          (선택) 임원 승인 후 해당 인원의 목표 목록에도 표시됩니다.
        </span>
      </Label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(u => (
            <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">
              {u.name}
              <button
                type="button"
                onClick={() => onChange(value.filter(v => v !== u.id))}
                className="text-blue-400 hover:text-red-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && search.trim() && filtered.length === 1) {
            e.preventDefault();
            onChange([...value, filtered[0].id]);
            onSearchChange('');
          }
        }}
        placeholder="이름·이메일로 검색해서 추가 (1명일 때 Enter 로 자동 추가)"
      />
      {search.trim() && (
        <div className="rounded-lg border max-h-44 overflow-y-auto divide-y bg-white">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2">검색 결과 없음</p>
          ) : filtered.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onChange([...value, u.id]); onSearchChange(''); }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
            >
              <span className="font-medium">{u.name}</span>
              {u.position && <span className="text-xs text-gray-400 ml-2">{u.position}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 수행자 검색·선택 픽커 (단일 선택, 본인 자동 기본값) ──
function OwnerPicker({ users, value, onChange, search, onSearchChange, selfId }: {
  users: User[];
  value: string;
  onChange: (id: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  selfId: string;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return users.slice(0, 8);
    const k = search.toLowerCase();
    return users
      .filter(u => u.name?.toLowerCase().includes(k) || u.email?.toLowerCase().includes(k))
      .slice(0, 12);
  }, [users, search]);
  const selected = users.find(u => u.id === value);
  const isSelf = value === selfId;
  return (
    <div className="space-y-1.5">
      <Label className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="whitespace-nowrap">수행자 <span className="text-red-500">*</span></span>
        <span className="text-xs text-gray-400 font-normal">
          (본인이 추가하면 본인이 기본 수행자, 다른 사용자도 지정 가능)
        </span>
      </Label>
      {selected ? (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${isSelf ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'}`}>
          <span className="text-sm font-medium">{selected.name}</span>
          {selected.position && <span className="text-xs text-gray-400">{selected.position}</span>}
          {isSelf && <span className="text-[10px] font-semibold text-blue-600 rounded-full bg-blue-100 px-2 py-0.5 ml-1">본인</span>}
          {!isSelf && (
            <button type="button" onClick={() => onChange(selfId)} className="ml-auto text-xs text-blue-600 hover:underline">
              본인으로
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-xs text-gray-400">
          (수행자 미설정 — 저장 시 본인으로 기본 설정)
        </div>
      )}
      <Input
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && search.trim() && filtered.length === 1) {
            e.preventDefault();
            onChange(filtered[0].id);
            onSearchChange('');
          }
        }}
        placeholder="다른 사람을 수행자로 지정하려면 이름·이메일로 검색 (1명일 때 Enter)"
      />
      {search.trim() && (
        <div className="rounded-lg border max-h-44 overflow-y-auto divide-y bg-white">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2">검색 결과 없음</p>
          ) : filtered.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onChange(u.id); onSearchChange(''); }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
            >
              <span className="font-medium">{u.name}</span>
              {u.position && <span className="text-xs text-gray-400 ml-2">{u.position}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
