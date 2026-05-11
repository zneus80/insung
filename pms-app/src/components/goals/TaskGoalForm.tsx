'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createGoal, updateGoal, addGoalHistory } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import type { Goal, AnnualGoal, TaskCategory } from '@/types';

interface TaskGoalFormProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editGoal?: Goal;
  divisionGoal: AnnualGoal | null;
  currentTaskWeight: number; // 현재 사용 중인 총 가중치
}

export default function TaskGoalForm({
  open, onClose, onSave, editGoal, divisionGoal, currentTaskWeight,
}: TaskGoalFormProps) {
  const { userProfile } = useAuth();
  const [category, setCategory] = useState<TaskCategory>('PERSONAL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [weight, setWeight] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!editGoal;
  // 수정 시 현재 목표의 가중치는 제외하고 잔여 계산
  const usedWithoutThis = isEdit ? currentTaskWeight - (editGoal.weight ?? 0) : currentTaskWeight;
  const remaining = 80 - usedWithoutThis;

  useEffect(() => {
    if (!open) return;
    if (editGoal) {
      setCategory(editGoal.taskCategory ?? 'PERSONAL');
      setTitle(editGoal.title);
      setDescription(editGoal.description);
      setDueDate(editGoal.dueDate.toISOString().split('T')[0]);
      setWeight(editGoal.weight ?? 10);
    } else {
      setCategory('PERSONAL');
      setTitle('');
      setDescription('');
      setDueDate('');
      setWeight(Math.min(10, remaining));
    }
    setError('');
  }, [open, editGoal]);

  async function handleSubmit(isDraft: boolean) {
    if (!userProfile) return;
    if (!title.trim()) { setError('업무명을 입력하세요.'); return; }
    if (!description.trim()) { setError('세부내용을 입력하세요.'); return; }
    if (!dueDate) { setError('추진기한을 선택하세요.'); return; }
    if (weight < 1) { setError('가중치는 1% 이상이어야 합니다.'); return; }
    if (weight > remaining && !isEdit) { setError(`가중치 초과: 잔여 ${remaining}%`); return; }

    setSubmitting(true);
    try {
      const payload = {
        goalType: 'TASK' as const,
        taskCategory: category,
        linkedOrgGoalId: category === 'TEAM_LINKED' ? divisionGoal?.id : undefined,
        linkedOrgGoalTitle: category === 'TEAM_LINKED' ? divisionGoal?.content?.slice(0, 40) : undefined,
        title: title.trim(),
        description: description.trim(),
        dueDate: new Date(dueDate),
        weight,
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
          <DialogTitle>{isEdit ? '과제업무 수정' : '과제업무 추가'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 카테고리 */}
          <div className="space-y-1.5">
            <Label>카테고리</Label>
            <div className="flex gap-2">
              {([['TEAM_LINKED', '팀/부문 목표 연동'], ['PERSONAL', '개인 목표']] as [TaskCategory, string][]).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setCategory(val)}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                    category === val ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 연동 목표 표시 */}
          {category === 'TEAM_LINKED' && (
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
              <p className="font-medium mb-1">연동 부문 목표</p>
              {divisionGoal ? (
                <p>{divisionGoal.content}</p>
              ) : (
                <p className="text-blue-400">등록된 부문 목표가 없습니다.</p>
              )}
            </div>
          )}

          {/* 업무명 */}
          <div className="space-y-1.5">
            <Label>업무명 <span className="text-red-500">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 신제품 라인 생산성 10% 향상" />
          </div>

          {/* 세부내용 */}
          <div className="space-y-1.5">
            <Label>세부내용 <span className="text-red-500">*</span></Label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="구체적인 실행 계획을 입력하세요" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* 추진기한 */}
            <div className="space-y-1.5">
              <Label>추진기한 <span className="text-red-500">*</span></Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>

            {/* 가중치 */}
            <div className="space-y-1.5">
              <Label>가중치 (%) <span className="text-red-500">*</span></Label>
              <Input
                type="number" min={1} max={remaining}
                value={weight}
                onChange={e => setWeight(Number(e.target.value))}
              />
              <p className="text-xs text-gray-400">잔여: {remaining}%</p>
            </div>
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
