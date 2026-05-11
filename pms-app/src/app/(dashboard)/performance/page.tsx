'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getGoalsByUser, getYearEndEval, upsertYearEndEval } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Send, Save, CheckCircle2, ClipboardList, ListChecks } from 'lucide-react';
import type { Goal, YearEndEval, TaskSummaryEntry } from '@/types';

// 목표 상태 한글 표시
const STATUS_LABEL: Partial<Record<string, string>> = {
  COMPLETED:      '완료',
  ABANDONED:      '포기',
  REJECTED:       '반려',
  IN_PROGRESS:    '진행 중',
  APPROVED:       '승인됨',
  PENDING_APPROVAL: '승인 대기',
  DRAFT:          '작성 중',
};
const STATUS_COLOR: Partial<Record<string, string>> = {
  COMPLETED:   'bg-green-100 text-green-700',
  ABANDONED:   'bg-gray-100 text-gray-500',
  REJECTED:    'bg-red-100 text-red-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  APPROVED:    'bg-emerald-100 text-emerald-700',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700',
  DRAFT:       'bg-gray-100 text-gray-500',
};

export default function PerformancePage() {
  return (
    <AuthGuard allowedRoles={['MEMBER', 'TEAM_LEAD']}>
      <PerformanceContent />
    </AuthGuard>
  );
}

function PerformanceContent() {
  const { userProfile } = useAuth();
  const year = new Date().getFullYear();

  const [taskGoals, setTaskGoals] = useState<Goal[]>([]);    // 과제업무
  const [generalGoals, setGeneralGoals] = useState<Goal[]>([]); // 일반업무
  const [summaries, setSummaries] = useState<Record<string, string>>({}); // goalId → 세부요약
  const [evalRecord, setEvalRecord] = useState<YearEndEval | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [goals, record] = await Promise.all([
        getGoalsByUser(userProfile.id, year),
        getYearEndEval(userProfile.id, year),
      ]);

      // swpark 브랜치에서 category 필드 추가 예정
      // category 없을 경우 임시로 전체를 과제업무로 분류 (swpark 병합 후 정상 동작)
      const taskList = goals.filter(g => g.category === 'TASK' || (!g.category));
      const generalList = goals.filter(g => g.category === 'GENERAL');

      setTaskGoals(taskList);
      setGeneralGoals(generalList);
      setEvalRecord(record);

      // 저장된 세부요약 불러오기
      if (record?.taskSummaries) {
        const map: Record<string, string> = {};
        record.taskSummaries.forEach(s => { map[s.goalId] = s.summary; });
        setSummaries(map);
      }
    } finally {
      setLoading(false);
    }
  }, [userProfile, year]);

  useEffect(() => { load(); }, [load]);

  const isSubmitted = evalRecord?.status === 'SUBMITTED';

  async function handleSave(submit: boolean) {
    if (!userProfile) return;
    setSaving(true);
    try {
      const taskSummaries: TaskSummaryEntry[] = taskGoals.map(g => ({
        goalId: g.id,
        goalTitle: g.title,
        summary: summaries[g.id] ?? '',
      }));

      await upsertYearEndEval(userProfile.id, year, {
        userId: userProfile.id,
        organizationId: userProfile.organizationId,
        cycleYear: year,
        taskSummaries,
        status: submit ? 'SUBMITTED' : 'DRAFT',
        ...(submit ? { submittedAt: new Date() } : {}),
      });

      toast.success(submit ? '제출 완료되었습니다.' : '임시저장 되었습니다.');
      await load();
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="평가" />
        <div className="p-6 space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="평가" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">

          {/* 상단 안내 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{year}년 연말 인사평가</span>
              {isSubmitted ? (
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> 제출 완료
                </span>
              ) : evalRecord ? (
                <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                  임시저장
                </span>
              ) : null}
            </div>
          </div>

          {/* ── Section 1: 과제업무 ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-800">과제업무</h2>
              <span className="text-xs text-gray-400">{taskGoals.length}건</span>
            </div>

            {taskGoals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
                등록된 과제업무가 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {taskGoals.map(goal => (
                  <div key={goal.id} className="rounded-xl border border-blue-100 bg-white overflow-hidden">
                    {/* 목표 정보 */}
                    <div className="px-4 py-3 bg-blue-50 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{goal.title}</p>
                        {goal.description && (
                          <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{goal.description}</p>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[goal.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABEL[goal.status] ?? goal.status}
                      </span>
                    </div>
                    {/* 세부요약 작성칸 */}
                    <div className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-500 mb-1.5">세부요약 작성</p>
                      {isSubmitted ? (
                        <p className="text-sm text-gray-700 whitespace-pre-wrap min-h-[40px]">
                          {summaries[goal.id] || <span className="text-gray-300">작성 내용 없음</span>}
                        </p>
                      ) : (
                        <Textarea
                          value={summaries[goal.id] ?? ''}
                          onChange={e => setSummaries(prev => ({ ...prev, [goal.id]: e.target.value }))}
                          placeholder="이 과제에 대한 세부 성과를 작성해주세요."
                          className="resize-none text-sm min-h-[80px]"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Section 2: 일반업무 ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-green-600" />
              <h2 className="text-sm font-semibold text-gray-800">일반업무</h2>
              <span className="text-xs text-gray-400">{generalGoals.length}건</span>
            </div>

            {generalGoals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
                등록된 일반업무가 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {generalGoals.map(goal => (
                  <div key={goal.id} className="rounded-xl border border-green-100 bg-white px-4 py-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{goal.title}</p>
                      {goal.description && (
                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{goal.description}</p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[goal.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[goal.status] ?? goal.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 버튼 영역 ── */}
          {!isSubmitted && (
            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <Button
                variant="outline"
                onClick={() => handleSave(false)}
                disabled={saving}
                className="flex-1 gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? '저장 중...' : '임시저장'}
              </Button>
              <Button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="flex-1 gap-2"
              >
                <Send className="h-4 w-4" />
                {saving ? '제출 중...' : '제출하기'}
              </Button>
            </div>
          )}

          {isSubmitted && (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              평가가 제출되었습니다. 수정이 필요하면 담당자에게 문의하세요.
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
