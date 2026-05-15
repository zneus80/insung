'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getGoalsByUser, getYearEndEval, upsertYearEndEval } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Send, Save, CheckCircle2, ClipboardList } from 'lucide-react';
import type { Goal, YearEndEval, TaskSummaryEntry } from '@/types';

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

// 목업 모드용 샘플 데이터
const MOCK_GOALS: Goal[] = [
  {
    id: 'mock-task-1', userId: 'mock-member-001', organizationId: 'mock-org-001',
    cycleYear: new Date().getFullYear(),
    title: '신규 고객사 영업 프로세스 개선', description: '영업 프로세스 표준화 및 CRM 도입',
    dueDate: new Date(), status: 'COMPLETED', progress: 100,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 'mock-task-2', userId: 'mock-member-001', organizationId: 'mock-org-001',
    cycleYear: new Date().getFullYear(),
    title: '팀 역량 강화 교육 프로그램 운영', description: '분기별 사내 교육 3회 이상 진행',
    dueDate: new Date(), status: 'IN_PROGRESS', progress: 60,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 'mock-task-3', userId: 'mock-member-001', organizationId: 'mock-org-001',
    cycleYear: new Date().getFullYear(),
    title: '원가 절감 프로젝트', description: '구매 비용 5% 절감 달성',
    dueDate: new Date(), status: 'ABANDONED', progress: 30,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 'mock-goal-1', userId: 'mock-member-001', organizationId: 'mock-org-001',
    cycleYear: new Date().getFullYear(),
    title: '주간 업무보고서 작성 및 제출', description: '매주 금요일 업무보고서 제출',
    dueDate: new Date(), status: 'COMPLETED', progress: 100,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 'mock-goal-2', userId: 'mock-member-001', organizationId: 'mock-org-001',
    cycleYear: new Date().getFullYear(),
    title: '부서 회의 준비 및 진행', description: '월간 부서 회의 안건 정리 및 진행',
    dueDate: new Date(), status: 'COMPLETED', progress: 100,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 'mock-goal-3', userId: 'mock-member-001', organizationId: 'mock-org-001',
    cycleYear: new Date().getFullYear(),
    title: '고객 문의 대응', description: '고객 문의 24시간 내 응답',
    dueDate: new Date(), status: 'REJECTED', progress: 0,
    createdAt: new Date(), updatedAt: new Date(),
  },
];

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

  const [allGoals, setAllGoals] = useState<Goal[]>([]);
  const [summaries, setSummaries] = useState<Record<string, string>>({}); // goalId → 세부요약
  const [evalRecord, setEvalRecord] = useState<YearEndEval | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      let goals: Goal[] = [];
      let record: YearEndEval | null = null;

      if (IS_MOCK) {
        // 목업 모드: 샘플 데이터 사용
        goals = MOCK_GOALS;
      } else {
        [goals, record] = await Promise.all([
          getGoalsByUser(userProfile.id, year),
          getYearEndEval(userProfile.id, year),
        ]);
      }

      setAllGoals(goals);
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
      const taskSummaries: TaskSummaryEntry[] = allGoals.map(g => ({
        goalId: g.id,
        goalTitle: g.title,
        summary: summaries[g.id] ?? '',
      }));

      if (!IS_MOCK) {
        await upsertYearEndEval(userProfile.id, year, {
          userId: userProfile.id,
          organizationId: userProfile.organizationId,
          cycleYear: year,
          taskSummaries,
          status: submit ? 'SUBMITTED' : 'DRAFT',
          ...(submit ? { submittedAt: new Date() } : {}),
        });
      }

      // 목업 모드: 로컬 상태만 업데이트
      if (submit) {
        setEvalRecord({
          id: `${userProfile.id}_${year}`,
          userId: userProfile.id,
          organizationId: userProfile.organizationId,
          cycleYear: year,
          taskSummaries,
          status: 'SUBMITTED',
          submittedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      toast.success(submit ? '제출 완료되었습니다.' : '임시저장 되었습니다.');
      if (!IS_MOCK) await load();
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

          {/* ── 목표 목록 ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-800">목표</h2>
              <span className="text-xs text-gray-400">{allGoals.length}건</span>
            </div>

            {allGoals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
                등록된 목표가 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {allGoals.map(goal => (
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
                          placeholder="이 목표에 대한 세부 성과를 작성해주세요."
                          className="resize-none text-sm min-h-[80px]"
                        />
                      )}
                    </div>
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
