'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, getOrganizations, getAllGoalsByYear } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import { Target, ChevronDown, ChevronUp } from 'lucide-react';
import type { Goal, User, Organization } from '@/types';

function avgProgress(goals: Goal[]): number {
  const active = goals.filter(g => !['ABANDONED', 'REJECTED'].includes(g.status));
  if (!active.length) return 0;
  return Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length);
}

export default function ProgressLeadsPage() {
  return (
    <AuthGuard allowedRoles={['EXECUTIVE']}>
      <ProgressLeadsContent />
    </AuthGuard>
  );
}

function ProgressLeadsContent() {
  const { userProfile } = useAuth();
  const year = new Date().getFullYear();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<User[]>([]);
  const [goalsByUser, setGoalsByUser] = useState<Record<string, Goal[]>>({});
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [allUsers, allOrgs, allGoals] = await Promise.all([
          getAllUsers(), getOrganizations(), getAllGoalsByYear(year),
        ]);
        const descIds = findDescendantIds(userProfile!.organizationId, allOrgs);
        const teamLeads = allUsers.filter(u =>
          u.role === 'TEAM_LEAD' && u.isActive && descIds.includes(u.organizationId)
        );
        setLeads(teamLeads);
        setOrgs(allOrgs);
        const gMap: Record<string, Goal[]> = {};
        teamLeads.forEach(u => {
          gMap[u.id] = allGoals.filter(g => g.userId === u.id);
        });
        setGoalsByUser(gMap);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userProfile]);

  const orgNameMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));

  return (
    <div className="flex flex-col h-full">
      <Header title="팀장 업무 진행사항" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <p className="text-sm text-gray-500">{year}년 소관 조직 팀장 업무 진행현황</p>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Target className="mb-3 h-10 w-10" />
              <p className="text-sm">소관 조직에 팀장이 없습니다.</p>
            </div>
          ) : (
            leads.map(lead => {
              const goals = goalsByUser[lead.id] ?? [];
              const avg = avgProgress(goals);
              const isOpen = expanded[lead.id] ?? false;
              return (
                <div key={lead.id} className="rounded-xl border bg-white overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                    onClick={() => setExpanded(p => ({ ...p, [lead.id]: !isOpen }))}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="font-semibold text-gray-900">{lead.name}</p>
                        <p className="text-xs text-gray-400">
                          {orgNameMap[lead.organizationId] ?? ''} {lead.position && `· ${lead.position}`}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">목표 {goals.length}개</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={avg} className="h-2 flex-1" />
                        <span className="text-sm font-bold text-gray-700 w-10 text-right">{avg}%</span>
                      </div>
                      {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t px-5 py-4 space-y-2">
                      {goals.length === 0 ? (
                        <p className="text-sm text-gray-400">등록된 목표가 없습니다.</p>
                      ) : (
                        goals.map(goal => (
                          <div key={goal.id} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5">
                            <GoalStatusBadge status={goal.status} />
                            <span className="text-sm text-gray-700 flex-1">{goal.title}</span>
                            <div className="flex items-center gap-2 min-w-[80px]">
                              <Progress value={goal.progress} className="h-1.5 flex-1" />
                              <span className="text-xs text-gray-500 w-8 text-right">{goal.progress}%</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
