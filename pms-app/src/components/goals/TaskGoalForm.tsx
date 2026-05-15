'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createGoal, updateGoal } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
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

  const isEdit = !!editGoal;

  useEffect(() => {
    if (!open) return;
    if (editGoal) {
      setTitle(editGoal.title);
      setDescription(editGoal.description);
      setDueDate(editGoal.dueDate.toISOString().split('T')[0]);
    } else {
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

      if (isEdit) {
        await updateGoal(editGoal.id, {
          ...payload,
          status: isDraft ? 'DRAFT' : editGoal.status === 'DRAFT' ? 'PENDING_APPROVAL' : editGoal.status,
        });
      } else {
        const status = isDraft ? 'DRAFT' : 'PENDING_APPROVAL';
        await createGoal({
          ...payload,
          status,
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

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '목표 수정' : '목표 추가'}</DialogTitle>
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
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="구체적인 실행 계획을 입력하세요" />
          </div>

          {/* 추진기한 */}
          <div className="space-y-1.5">
            <Label>추진기한 <span className="text-red-500">*</span></Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>취소</Button>
          <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting}>임시저장</Button>
          <Button onClick={() => handleSubmit(false)} disabled={submitting}>
            {isEdit ? '수정 상신' : '상신'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
