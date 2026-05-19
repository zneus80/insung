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

interface GeneralGoalFormProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editGoal?: Goal;
}

export default function GeneralGoalForm({ open, onClose, onSave, editGoal }: GeneralGoalFormProps) {
  const { userProfile } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [requestPromotion, setRequestPromotion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!editGoal;

  useEffect(() => {
    if (!open) return;
    if (editGoal) {
      setTitle(editGoal.title);
      setDescription(editGoal.description ?? '');
      setDueDate(editGoal.dueDate ? editGoal.dueDate.toISOString().split('T')[0] : '');
      setRequestPromotion(editGoal.requestPromotion ?? false);
    } else {
      setTitle('');
      setDescription('');
      setDueDate('');
      setRequestPromotion(false);
    }
    setError('');
  }, [open, editGoal]);

  async function handleSubmit(isDraft: boolean) {
    if (!userProfile) return;
    if (!title.trim()) { setError('업무명을 입력하세요.'); return; }
    if (!dueDate) { setError('추진기한을 선택하세요.'); return; }

    setSubmitting(true);
    try {
      const status = isDraft ? 'DRAFT' : 'PENDING_APPROVAL';

      const payload = {
        goalType: 'GENERAL' as const,
        generalType: 'MAJOR' as const,
        title: title.trim(),
        description: description.trim(),
        dueDate: new Date(dueDate),
        progress: 0,
        requestPromotion,
        promotionStatus: requestPromotion ? 'PENDING' as const : 'NONE' as const,
      };

      if (isEdit) {
        await updateGoal(editGoal.id, {
          ...payload,
          status: editGoal.status === 'DRAFT' && !isDraft ? 'PENDING_APPROVAL' : editGoal.status,
        });
      } else {
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
          <DialogTitle>{isEdit ? '일반업무 수정' : '일반업무 추가'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 업무명 */}
          <div className="space-y-1.5">
            <Label>업무명 <span className="text-red-500">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 팀 내 업무 프로세스 개선" />
          </div>

          {/* 세부내용 */}
          <div className="space-y-1.5">
            <Label>세부내용</Label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="업무 내용을 간략히 설명하세요" />
          </div>

          {/* 추진기한 */}
          <div className="space-y-1.5">
            <Label>추진기한 <span className="text-red-500">*</span></Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          {/* 과제 반영 요청 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={requestPromotion}
              onChange={e => setRequestPromotion(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">과제업무 반영 요청</span>
            <span className="text-xs text-gray-400">(팀장 승인 시 과제업무로 전환)</span>
          </label>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>취소</Button>
          <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting}>임시저장</Button>
          <Button onClick={() => handleSubmit(false)} disabled={submitting}>
            {isEdit ? '수정' : '상신'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
