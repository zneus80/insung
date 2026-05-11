'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Target, Zap, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getGoalsByUser, getActiveCycle, getOrganizations, getAnnualGoal } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import Header from '@/components/layout/Header';
import GoalCard from '@/components/goals/GoalCard';
import TaskGoalForm from '@/components/goals/TaskGoalForm';
import GeneralGoalForm from '@/components/goals/GeneralGoalForm';
import type { Goal, EvaluationCycle, AnnualGoal } from '@/types';

export default function GoalsPage() {
  const { userProfile } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [cycle, setCycle] = useState<EvaluationCycle | null>(null);
  const [divisionGoal, setDivisionGoal] = useState<AnnualGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [generalFormOpen, setGeneralFormOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | undefined>();

  const year = new Date().getFullYear();

  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [goalList, activeCycle, orgs] = await Promise.all([
        getGoalsByUser(userProfile.id, year),
        getActiveCycle(),
        getOrganizations(),
      ]);
      setCycle(activeCycle);
      setGoals(goalList);
      // 부문 목표 로드
      const userOrg = orgs.find(o => o.id === userProfile.organizationId);
      const divId = userOrg?.parentId ?? userProfile.organizationId;
      const dGoal = await getAnnualGoal('org', year, divId);
      setDivisionGoal(dGoal);
    } finally {
      setLoading(false);
    }
  }, [userProfile, year]);

  useEffect(() => { load(); }, [load]);

  // 과제업무
  const taskGoals = goals.filter(g => g.goalType === 'TASK' && !['ABANDONED', 'REJECTED'].includes(g.status));
  const taskWeightUsed = taskGoals.reduce((s, g) => s + (g.weight ?? 0), 0);

  // 일반업무
  const majorGoals = goals.filter(g => g.goalType === 'GENERAL' && g.generalType === 'MAJOR' && !['ABANDONED'].includes(g.status));
  const otherGoals = goals.filter(g => g.goalType === 'GENERAL' && g.generalType === 'OTHER' && !['ABANDONED'].includes(g.status));

  function handleEdit(goal: Goal) {
    setEditGoal(goal);
    if (goal.goalType === 'TASK') setTaskFormOpen(true);
    else setGeneralFormOpen(true);
  }

  function handleAddTask() { setEditGoal(undefined); setTaskFormOpen(true); }
  function handleAddGeneral() { setEditGoal(undefined); setGeneralFormOpen(true); }

  return (
    <div className="flex flex-col h-full">
      <Header title="목표관리" />
      <div className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="task">
          <TabsList className="mb-6">
            <TabsTrigger value="task">
              과제업무 ({taskGoals.length})
            </TabsTrigger>
            <TabsTrigger value="general">
              일반업무 ({majorGoals.length + otherGoals.length})
            </TabsTrigger>
          </TabsList>

          {/* ── 과제업무 탭 ── */}
          <TabsContent value="task" className="space-y-5">
            {/* 가중치 현황 */}
            <div className="rounded-xl border bg-white p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">과제업무 가중치 현황</span>
                <span className={taskWeightUsed > 80 ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                  {taskWeightUsed} / 80%
                </span>
              </div>
              <Progress value={Math.min((taskWeightUsed / 80) * 100, 100)} className="h-2" />
              {taskWeightUsed > 80 && (
                <p className="flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="h-3.5 w-3.5" />
                  가중치 합산이 80%를 초과했습니다.
                </p>
              )}
              <p className="text-xs text-gray-400">팀원 전체 과제업무 합산 최대 80% · 잔여 {Math.max(80 - taskWeightUsed, 0)}%</p>
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={handleAddTask} className="gap-1.5">
                <Plus className="h-4 w-4" />과제업무 추가
              </Button>
            </div>

            {loading ? (
              <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100"/>)}</div>
            ) : taskGoals.length === 0 ? (
              <EmptyState icon={<Target className="h-10 w-10"/>} label="등록된 과제업무가 없습니다." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {taskGoals.map(g => <GoalCard key={g.id} goal={g} onEdit={handleEdit} />)}
              </div>
            )}
          </TabsContent>

          {/* ── 일반업무 탭 ── */}
          <TabsContent value="general" className="space-y-6">
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAddGeneral} className="gap-1.5">
                <Plus className="h-4 w-4" />일반업무 추가
              </Button>
            </div>

            {/* 주요업무 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-green-500" />
                <h3 className="text-sm font-semibold text-gray-700">주요업무 ({majorGoals.length})</h3>
                <span className="text-xs text-gray-400">팀장 승인 후 확정 · 합산 가중치 20%</span>
              </div>
              {loading ? (
                <div className="h-24 animate-pulse rounded-xl bg-gray-100"/>
              ) : majorGoals.length === 0 ? (
                <EmptyState icon={<Zap className="h-8 w-8"/>} label="등록된 주요업무가 없습니다." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {majorGoals.map(g => <GoalCard key={g.id} goal={g} onEdit={handleEdit} />)}
                </div>
              )}
            </section>

            {/* 기타업무 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-gray-300"/>
                <h3 className="text-sm font-semibold text-gray-700">기타업무 ({otherGoals.length})</h3>
                <span className="text-xs text-gray-400">승인 없이 즉시 등록 · 가중치 반영 없음</span>
              </div>
              {loading ? (
                <div className="h-24 animate-pulse rounded-xl bg-gray-100"/>
              ) : otherGoals.length === 0 ? (
                <EmptyState icon={<div className="h-8 w-8 rounded-full bg-gray-200"/>} label="등록된 기타업무가 없습니다." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {otherGoals.map(g => <GoalCard key={g.id} goal={g} onEdit={handleEdit} />)}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <TaskGoalForm
        open={taskFormOpen}
        onClose={() => setTaskFormOpen(false)}
        onSave={load}
        editGoal={editGoal?.goalType === 'TASK' ? editGoal : undefined}
        divisionGoal={divisionGoal}
        currentTaskWeight={taskWeightUsed}
      />
      <GeneralGoalForm
        open={generalFormOpen}
        onClose={() => setGeneralFormOpen(false)}
        onSave={load}
        editGoal={editGoal?.goalType === 'GENERAL' ? editGoal : undefined}
      />
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-12 text-gray-400">
      <div className="mb-2 opacity-30">{icon}</div>
      <p className="text-sm">{label}</p>
    </div>
  );
}
