'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Target } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getGoalsByUser, getOrganizations, getAnnualGoal } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import Header from '@/components/layout/Header';
import GoalCard from '@/components/goals/GoalCard';
import TaskGoalForm from '@/components/goals/TaskGoalForm';
import type { Goal, AnnualGoal } from '@/types';

export default function GoalsPage() {
  const { userProfile } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [divisionGoal, setDivisionGoal] = useState<AnnualGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | undefined>();

  const year = new Date().getFullYear();

  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [goalList, orgs] = await Promise.all([
        getGoalsByUser(userProfile.id, year),
        getOrganizations(),
      ]);
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

  const myGoals = goals.filter(g => !['ABANDONED', 'REJECTED'].includes(g.status));

  function handleEdit(goal: Goal) {
    setEditGoal(goal);
    setFormOpen(true);
  }

  function handleAdd() { setEditGoal(undefined); setFormOpen(true); }

  return (
    <div className="flex flex-col h-full">
      <Header title="목표관리" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-5">
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAdd} className="gap-1.5">
              <Plus className="h-4 w-4" />목표 추가
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100"/>)}</div>
          ) : myGoals.length === 0 ? (
            <EmptyState icon={<Target className="h-10 w-10"/>} label="등록된 목표가 없습니다." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {myGoals.map(g => <GoalCard key={g.id} goal={g} onEdit={handleEdit} />)}
            </div>
          )}
        </div>
      </div>

      <TaskGoalForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={load}
        editGoal={editGoal}
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
