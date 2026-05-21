'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getAllUsers, getOrganizations, getAllGoalsByYear } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import { Target, ChevronDown, ChevronUp, Users } from 'lucide-react';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import type { Goal, User, Organization } from '@/types';

function avgProgress(goals: Goal[]): number {
  const active = goals.filter(g => !['ABANDONED', 'REJECTED'].includes(g.status));
  if (!active.length) return 0;
  return Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length);
}

export default function ProgressMembersPage() {
  return (
    <AuthGuard allowedRoles={['EXECUTIVE']}>
      <ProgressMembersContent />
    </AuthGuard>
  );
}

function ProgressMembersContent() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<User[]>([]);
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
        const teamMembers = allUsers.filter(u =>
          u.role === 'MEMBER' && u.isActive && descIds.includes(u.organizationId)
        );
        setMembers(teamMembers);
        setOrgs(allOrgs);
        const gMap: Record<string, Goal[]> = {};
        teamMembers.forEach(u => {
          gMap[u.id] = allGoals.filter(g => g.userId === u.id);
        });
        setGoalsByUser(gMap);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userProfile]);

  const orgMap = Object.fromEntries(orgs.map(o => [o.id, o]));

  // 팀원을 소속 조직별로 그룹핑
  const membersByOrg = members.reduce<Record<string, User[]>>((acc, m) => {
    if (!acc[m.organizationId]) acc[m.organizationId] = [];
    acc[m.organizationId].push(m);
    return acc;
  }, {});

  // 조직별 평균 진행률
  function orgAvgProgress(orgMembers: User[]): number {
    const allGoals = orgMembers.flatMap(m => goalsByUser[m.id] ?? []);
    return avgProgress(allGoals);
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="팀원 업무 진행사항" showBack />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <p className="text-sm text-gray-500">{year}년 소관 조직 팀원 업무 진행현황</p>
          {loading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-36 animate-pulse rounded-2xl bg-gray-100" />)}
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Target className="mb-3 h-10 w-10" />
              <p className="text-sm">소관 조직에 팀원이 없습니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {Object.entries(membersByOrg).map(([orgId, orgMembers]) => {
                const org = orgMap[orgId];
                const orgAvg = orgAvgProgress(orgMembers);
                const isOpen = expanded[orgId] ?? false;
                return (
                  <div key={orgId} className="rounded-2xl border bg-white overflow-hidden shadow-sm">
                    {/* 카드 헤더 */}
                    <button
                      className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
                      onClick={() => setExpanded(p => ({ ...p, [orgId]: !isOpen }))}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <p className="font-semibold text-gray-900">{org?.name ?? orgId}</p>
                          <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                            <Users className="h-3.5 w-3.5" />
                            팀원 {orgMembers.length}명
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-lg font-bold text-gray-800">{orgAvg}%</span>
                          {isOpen
                            ? <ChevronUp className="h-4 w-4 text-gray-400" />
                            : <ChevronDown className="h-4 w-4 text-gray-400" />}
                        </div>
                      </div>
                      <Progress value={orgAvg} className="h-2" />
                    </button>

                    {/* 팀원별 상세 */}
                    {isOpen && (
                      <div className="border-t divide-y">
                        {orgMembers.map(member => {
                          const goals = goalsByUser[member.id] ?? [];
                          const avg = avgProgress(goals);
                          const isMemberOpen = expanded[member.id] ?? false;
                          return (
                            <div key={member.id}>
                              <button
                                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50 transition-colors"
                                onClick={() => setExpanded(p => ({ ...p, [member.id]: !isMemberOpen }))}
                              >
                                <div>
                                  <MemberInfoModal userId={member.id} userName={member.name} />
                                  <p className="text-xs text-gray-400">{member.position} · 목표 {goals.length}개</p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2 min-w-[100px]">
                                    <Progress value={avg} className="h-1.5 flex-1" />
                                    <span className="text-xs font-semibold text-gray-600 w-8 text-right">{avg}%</span>
                                  </div>
                                  {isMemberOpen
                                    ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                                </div>
                              </button>
                              {isMemberOpen && (
                                <div className="bg-gray-50 px-5 py-3 space-y-1.5">
                                  {goals.length === 0 ? (
                                    <p className="text-xs text-gray-400">등록된 목표가 없습니다.</p>
                                  ) : goals.map(goal => (
                                    <Link key={goal.id} href={`/goals/${goal.id}`}>
                                      <div className="flex items-center gap-3 rounded-lg bg-white border px-3 py-2 hover:shadow-sm hover:border-blue-200 transition-all cursor-pointer">
                                        <GoalStatusBadge status={goal.status} />
                                        <span className="text-sm text-gray-700 flex-1 truncate">{goal.title}</span>
                                        <div className="flex items-center gap-2 min-w-[72px]">
                                          <Progress value={goal.progress} className="h-1.5 flex-1" />
                                          <span className="text-xs text-gray-500 w-8 text-right">{goal.progress}%</span>
                                        </div>
                                      </div>
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
