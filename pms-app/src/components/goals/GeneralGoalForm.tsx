'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { createGoal, updateGoal } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import type { Goal, GeneralType, Importance } from '@/types';

interface GeneralGoalFormProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  editGoal?: Goal;
}

const IMPORTANCE_OPTIONS: { value: Importance; label: string; cls: string }[] = [
  { value: 'HIGH', label: '높음', cls: 'border-red-400 bg-red-50 text-red-700' },
  { value: 'MEDIUM', label: '보통', cls: 'border-yellow-400 bg-yellow-50 text-yellow-700' },
  { value: 'LOW', label: '낮음', cls: 'border-green-400 bg-green-50 text-green-700' },
];

export default function GeneralGoalForm({ open, onClose, onSave, editGoal }: GeneralGoalFormProps) {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const [generalType, setGeneralType] = useState<GeneralType>('MAJOR');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [importance, setImportance] = useState<Importance>('MEDIUM');
  const [requestPromotion, setRequestPromotion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!editGoal;
  const isOther = generalType === 'OTHER';

  useEffect(() => {
    if (!open) return;
    if (editGoal) {
      setGeneralType(editGoal.generalType ?? 'MAJOR');
      setTitle(editGoal.title);
      setDescription(editGoal.description ?? '');
      setDueDate(editGoal.dueDate ? editGoal.dueDate.toISOString().split('T')[0] : '');
      setImportance(editGoal.importance ?? 'MEDIUM');
      setRequestPromotion(editGoal.requestPromotion ?? false);
    } else {
      setGeneralType('MAJOR');
      setTitle('');
      setDescription('');
      setDueDate('');
      setImportance('MEDIUM');
      setRequestPromotion(false);
    }
    setError('');
  }, [open, editGoal]);

  async function handleSubmit(isDraft: boolean) {
    if (!userProfile) return;
    if (!title.trim()) { setError('업무명을 입력하세요.'); return; }
    if (!isOther && !dueDate) { setError('추진기한을 선택하세요.'); return; }

    setSubmitting(true);
    try {
      // 기타업무는 즉시 APPROVED, 주요업무는 DRAFT or PENDING_APPROVAL
      const status = isOther ? 'APPROVED' : isDraft ? 'DRAFT' : 'PENDING_APPROVAL';

      const payload = {
        goalType: 'GENERAL' as const,
        generalType,
        title: title.trim(),
        description: description.trim(),
        dueDate: dueDate ? new Date(dueDate) : new Date(),
        progress: 0,
        ...(isOther ? { importance } : {}),
        requestPromotion: !isOther ? requestPromotion : false,
        promotionStatus: (!isOther && requestPromotion) ? 'PENDING' as const : 'NONE' as const,
      };

      if (isEdit) {
        await updateGoal(editGoal.id, {
          ...payload,
          status: isOther ? 'APPROVED' : editGoal.status === 'DRAFT' && !isDraft ? 'PENDING_APPROVAL' : editGoal.status,
        });
      } else {
        await createGoal({
          ...payload,
          status,
          userId: userProfile.id,
          organizationId: userProfile.organizationId,
          cycleYear: activeYear,  // v0.76: 활성 연도 기준 — 익년초까지 걸친 평가기간 호환
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
          {/* 업무 구분 */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>업무 구분</Label>
              <div className="flex gap-2">
                {([['MAJOR', '주요업무'], ['OTHER', '기타업무']] as [GeneralType, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setGeneralType(val)}
                    className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                      generalType === val ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {isOther && (
                <p className="text-xs text-gray-400">기타업무는 승인 없이 즉시 등록됩니다. 가중치에 반영되지 않습니다.</p>
              )}
            </div>
          )}

          {/* 업무명 */}
          <div className="space-y-1.5">
            <Label>업무명 <span className="text-red-500">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 팀 내 업무 프로세스 개선" />
          </div>

          {/* 세부내용 */}
          <div className="space-y-1.5">
            <Label>세부내용{!isOther && <span className="text-red-500"> *</span>}</Label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="업무 내용을 간략히 설명하세요" />
          </div>

          {/* 기타업무: 중요도 */}
          {isOther && (
            <div className="space-y-1.5">
              <Label>중요도</Label>
              <div className="flex gap-2">
                {IMPORTANCE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setImportance(opt.value)}
                    className={`flex-1 rounded-lg border-2 py-1.5 text-sm font-medium transition-colors ${
                      importance === opt.value ? opt.cls : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 주요업무: 추진기한 + 과제 반영 요청 */}
          {!isOther && (
            <>
              <div className="space-y-1.5">
                <Label>추진기한 <span className="text-red-500">*</span></Label>
                <Input type="date" min="2000-01-01" max="2099-12-31" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
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
            </>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>취소</Button>
          {!isOther && (
            <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting}>임시저장</Button>
          )}
          <Button onClick={() => handleSubmit(false)} disabled={submitting}>
            {isEdit ? '수정' : isOther ? '즉시 등록' : '상신'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
