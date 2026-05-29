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
import { cn } from '@/lib/utils';
import type { Goal, User, Organization } from '@/types';

function avgProgress(goals: Goal[]): number {
  const active = goals.filter(g => !['ABANDONED', 'REJECTED'].includes(g.status));
  if (!active.length) return 0;
  return Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length);
}

export default function ProgressLeadsPage() {
  return (
    <AuthGuard allowedRoles={['EXECUTIVE']}>
      <ProgressContent />
    </AuthGuard>
  );
}

function ProgressContent() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<User[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [goalsByUser, setGoalsByUser] = useState<Record<string, Goal[]>>({});
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<'leads' | 'members'>('leads');

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [allUsers, allOrgs, allGoals] = await Promise.all([
          getAllUsers(), getOrganizations(), getAllGoalsByYear(year),
        ]);
        // 내가 leaderId인 모든 조직 → 각각 하위 탐색 → 합산 (복수 조직 담당 임원 대응)
        const myLeadOrgs = allOrgs.filter(o => o.leaderId === userProfile!.id);
        const rootIds = myLeadOrgs.length > 0
          ? myLeadOrgs.map(o => o.id)
          : [userProfile!.organizationId]; // fallback: leaderId 미설정 환경
        const descIds = [...new Set(rootIds.flatMap(id => findDescendantIds(id, allOrgs)))];
        const scopedUsers = allUsers.filter(u => u.isActive && descIds.includes(u.organizationId));
        const teamLeads = scopedUsers.filter(u => u.role === 'TEAM_LEAD');
        const teamMembers = scopedUsers.filter(u => u.role === 'MEMBER');
        setLeads(teamLeads);
        setMembers(teamMembers);
        setOrgs(allOrgs);
        // 각 사용자의 목표 = owner 본인 목표 + (임원 승인 후) 공동 수행자로 포함된 목표
        const COLLAB_VISIBLE = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_ABANDON']);
        const gMap: Record<string, Goal[]> = {};
        scopedUsers.forEach(u => {
          const own = allGoals.filter(g => g.userId === u.id);
          const collab = allGoals.filter(g =>
            g.userId !== u.id &&
            (g.collaboratorIds ?? []).includes(u.id) &&
            COLLAB_VISIBLE.has(g.status) &&
            !g.trashedAt && !g.softDeletedAt,
          );
          const seen = new Set<string>();
          gMap[u.id] = [...own, ...collab].filter(g => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
          });
        });
        setGoalsByUser(gMap);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userProfile, year]);

  const orgMap = Object.fromEntries(orgs.map(o => [o.id, o]));

  const activeUsers = tab === 'leads' ? leads : members;
  const emptyMsg = tab === 'leads' ? '소관 조직에 팀장이 없습니다.' : '소관 조직에 팀원이 없습니다.';
  const countLabel = tab === 'leads' ? '팀장' : '팀원';

  // 사용자를 조직별로 그룹핑
  const usersByOrg = activeUsers.reduce<Record<string, User[]>>((acc, u) => {
    if (!acc[u.organizationId]) acc[u.organizationId] = [];
    acc[u.organizationId].push(u);
    return acc;
  }, {});

  function orgAvgProgress(orgUsers: User[]): number {
    const allGoals = orgUsers.flatMap(u => goalsByUser[u.id] ?? []);
    return avgProgress(allGoals);
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="업무 진행사항" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* 탭 */}
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
            <button
              onClick={() => { setTab('leads'); setExpanded({}); }}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                tab === 'leads'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              팀장
            </button>
            <button
              onClick={() => { setTab('members'); setExpanded({}); }}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                tab === 'members'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              팀원
            </button>
          </div>

          <p className="text-sm text-gray-500">{year}년 소관 조직 {countLabel} 업무 진행현황</p>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-36 animate-pulse rounded-2xl bg-gray-100" />)}
            </div>
          ) : activeUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Target className="mb-3 h-10 w-10" />
              <p className="text-sm">{emptyMsg}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {Object.entries(usersByOrg).map(([orgId, orgUsers]) => {
                const org = orgMap[orgId];
                const orgAvg = orgAvgProgress(orgUsers);
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
                            {countLabel} {orgUsers.length}명
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

                    {/* 사용자별 상세 */}
                    {isOpen && (
                      <div className="border-t divide-y">
                        {orgUsers.map(user => {
                          const goals = goalsByUser[user.id] ?? [];
                          const avg = avgProgress(goals);
                          const isUserOpen = expanded[user.id] ?? false;
                          return (
                            <div key={user.id}>
                              <button
                                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50 transition-colors"
                                onClick={() => setExpanded(p => ({ ...p, [user.id]: !isUserOpen }))}
                              >
                                <div>
                                  <MemberInfoModal userId={user.id} userName={user.name} />
                                  <p className="text-xs text-gray-400">{user.position} · 목표 {goals.length}개</p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2 min-w-[100px]">
                                    <Progress value={avg} className="h-1.5 flex-1" />
                                    <span className="text-xs font-semibold text-gray-600 w-8 text-right">{avg}%</span>
                                  </div>
                                  {isUserOpen
                                    ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                                </div>
                              </button>
                              {isUserOpen && (
                                <div className="bg-gray-50 px-5 py-3 space-y-1.5">
                                  {goals.length === 0 ? (
                                    <p className="text-xs text-gray-400">등록된 목표가 없습니다.</p>
                                  ) : goals.map(goal => (
                                    <Link key={goal.id} href={`/goals/${goal.id}`}>
                                      <div className="flex items-center gap-3 rounded-lg bg-white border px-3 py-2 hover:shadow-sm hover:border-blue-200 transition-all cursor-pointer">
                                        <GoalStatusBadge goal={goal} />
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
