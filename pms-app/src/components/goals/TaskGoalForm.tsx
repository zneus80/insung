'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createGoal, updateGoal } from '@/lib/firestore';
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
        // DRAFT 목표 수정
        await updateGoal(editGoal.id, {
          ...payload,
          status: isDraft ? 'DRAFT' : 'PENDING_APPROVAL',
        });
      } else if (isApprovedGoal && !isDraft) {
        // 승인된 목표 → 수정 상신: 기존 목표를 PENDING_MODIFY 상태로 업데이트
        await updateGoal(editGoal.id, {
          ...payload,
          status: 'PENDING_MODIFY',
        });
      } else {
        // 신규 목표 또는 승인된 목표의 임시저장(새 DRAFT 생성)
        await createGoal({
          ...payload,
          status: isDraft ? 'DRAFT' : 'PENDING_APPROVAL',
          userId: userProfile.id,
          organizationId: userProfile.organizationId,
          cycleYear: new Date().getFullYear(),
        });
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
        className="max-w-3xl"
        onShake={triggerShake}
        showCloseButton={false}
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
          {/* 목표명 */}
          <div className="space-y-1.5">
            <Label>목표명 <span className="text-red-500">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 신제품 라인 생산성 10% 향상" />
          </div>

          {/* 세부내용 */}
          <div className="space-y-1.5">
            <Label>세부내용 <span className="text-red-500">*</span></Label>
            <Textarea rows={10} value={description} onChange={e => setDescription(e.target.value)} placeholder="구체적인 실행 계획을 입력하세요" />
          </div>

          {/* 추진기한 */}
          <div className="space-y-1.5">
            <Label>추진기한 <span className="text-red-500">*</span></Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

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
