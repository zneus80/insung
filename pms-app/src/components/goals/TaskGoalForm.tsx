'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createGoal, updateGoal, getOrganizations, createNotification, addGoalHistory } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';
import type { Goal } from '@/types';

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [modifyComment, setModifyComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
    } else {
      openedStatusRef.current = null;
      setTitle('');
      setDescription('');
      setDueDate('');
    }
    setError('');
  }, [open, editGoal]);

  // 승인 요청 시 팀장/임원에게 알림 발송
  async function sendApprovalNotification(goalId: string, goalTitle: string) {
    try {
      const orgs = await getOrganizations();

      // 조직 체인 탐색 (GoalDetailClient와 동일한 로직)
      function getOrgChain(orgId: string) {
        const chain: typeof orgs = [];
        let cur = orgs.find(o => o.id === orgId);
        while (cur) {
          chain.push(cur);
          cur = cur.parentId ? orgs.find(o => o.id === cur!.parentId) : undefined;
        }
        return chain;
      }

      const chain  = getOrgChain(userProfile!.organizationId);
      const teamOrg = chain.find(o => o.type === 'TEAM');
      const hqOrg   = chain.find(o => o.type === 'HEADQUARTERS');
      const divOrg  = chain.find(o => o.type === 'DIVISION');

      // 팀장 (1차 승인자)
      const teamLeadId = teamOrg?.leaderId ?? null;
      // 임원 (최종 승인자): DIVISION이 있으면 DIV leaderId, 없으면 HQ leaderId
      const execId = divOrg?.leaderId ?? (!divOrg ? hqOrg?.leaderId : null) ?? null;

      const notifBase = {
        goalId,
        goalTitle,
        type: 'GOAL_SUBMITTED' as const,
        message: `${userProfile!.name}님이 '${goalTitle}' 목표 승인을 요청했습니다.`,
        read: false,
      };

      if (userProfile!.role === 'TEAM_LEAD') {
        // 팀장 목표 → 임원에게 직접 (본부장 단계 없음)
        if (execId && execId !== userProfile!.id) {
          await createNotification({ userId: execId, ...notifBase });
        }
      } else {
        // 팀원 목표 → 팀장에게 (1차 승인자)
        if (teamLeadId && teamLeadId !== userProfile!.id) {
          await createNotification({ userId: teamLeadId, ...notifBase });
        }
      }
    } catch {
      // 알림 발송 실패는 조용히 처리 (목표 상신 자체는 성공)
    }
  }

  async function handleSubmit(isDraft: boolean) {
    if (!userProfile) return;
    if (!title.trim()) { setError('목표명을 입력하세요.'); return; }
    if (!isDraft) {
      if (!description.trim()) { setError('세부내용을 입력하세요.'); return; }
      if (!dueDate) { setError('추진기한을 선택하세요.'); return; }
    }

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        dueDate: dueDate ? new Date(dueDate) : new Date(),
        progress: 0,
      };

      // 폼이 열릴 때 스냅샷한 status 기준으로 판단 (prop 재렌더 영향 차단)
      const capturedStatus = openedStatusRef.current ?? editGoal?.status ?? 'DRAFT';
      const isApprovedGoal = isEdit && !['DRAFT', 'REJECTED'].includes(capturedStatus);

      if (isEdit && !isApprovedGoal) {
        // DRAFT 목표 수정 → 상신
        await updateGoal(editGoal.id, {
          ...payload,
          status: isDraft ? 'DRAFT' : 'PENDING_APPROVAL',
        });
        if (!isDraft) {
          await sendApprovalNotification(editGoal.id, payload.title);
        }
      } else if (isApprovedGoal && !isDraft) {
        // 승인된 목표 → 수정 상신: 기존 목표를 PENDING_MODIFY 상태로 업데이트
        await updateGoal(editGoal.id, {
          ...payload,
          status: 'PENDING_MODIFY',
        });
        await addGoalHistory({
          goalId: editGoal.id,
          changedBy: userProfile.id,
          changeType: 'STATUS_CHANGED',
          previousStatus: editGoal.status,
          newStatus: 'PENDING_MODIFY',
          comment: modifyComment.trim() ? `수정 요청: ${modifyComment.trim()}` : '수정 요청',
        });
      } else {
        // 신규 목표 또는 승인된 목표의 임시저장(새 DRAFT 생성)
        const newGoalId = await createGoal({
          ...payload,
          status: isDraft ? 'DRAFT' : 'PENDING_APPROVAL',
          userId: userProfile.id,
          organizationId: userProfile.organizationId,
          cycleYear: new Date().getFullYear(),
        });
        if (!isDraft) {
          await sendApprovalNotification(newGoalId, payload.title);
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
        className="max-w-3xl [&>button:last-child]:hidden"
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
            <Label>{isApprovedEdit ? '수정할 목표명' : '목표명'} <span className="text-red-500">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 신제품 라인 생산성 10% 향상" />
          </div>

          {/* 세부내용 */}
          <div className="space-y-1.5">
            <Label>{isApprovedEdit ? '수정할 세부내용' : '세부내용'} <span className="text-red-500">*</span></Label>
            <Textarea rows={isApprovedEdit ? 5 : 10} value={description} onChange={e => setDescription(e.target.value)} placeholder="구체적인 실행 계획을 입력하세요" />
          </div>

          {/* 추진기한 */}
          <div className="space-y-1.5">
            <Label>{isApprovedEdit ? '수정할 추진기한' : '추진기한'} <span className="text-red-500">*</span></Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          {/* 수정 요청 의견 (승인된 목표 수정 시) */}
          {isApprovedEdit && (
            <div className="space-y-1.5">
              <Label>수정 요청 의견 <span className="text-gray-400 font-normal text-xs">(선택)</span></Label>
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
