'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getAllUsers, getOrganizations, getAllGoalsByYear, getGoalsByUser } from '@/lib/firestore';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import { OrgTreeNode, buildTree, findDescendantIds } from '@/components/goals/OrgGoalTree';
import { Target, ChevronDown, ChevronUp } from 'lucide-react';
import type { Goal, User, Organization } from '@/types';

function avgProgress(goals: Goal[]): number {
  const active = goals.filter(g => !['ABANDONED', 'REJECTED'].includes(g.status));
  if (!active.length) return 0;
  return Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length);
}

function PersonalProgressView({ goals, loading }: { goals: Goal[]; loading: boolean }) {
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-gray-100" />;
  if (!goals.length) return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <Target className="mb-3 h-10 w-10" />
      <p className="text-sm">등록된 목표가 없습니다.</p>
    </div>
  );
  const avg = avgProgress(goals);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">전체 평균 진행률</span>
            <span className="font-bold text-gray-900">{avg}%</span>
          </div>
          <Progress value={avg} className="h-2" />
        </div>
        <span className="text-2xl font-bold text-gray-900 shrink-0">{avg}%</span>
      </div>
      {goals.map(goal => (
        <Link key={goal.id} href={`/goals/${goal.id}`}>
          <div className="rounded-xl border bg-white p-4 hover:shadow-sm transition-shadow space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-900 truncate">{goal.title}</span>
              <GoalStatusBadge status={goal.status} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>진행률</span><span className="font-medium">{goal.progress}%</span>
              </div>
              <Progress value={goal.progress} className="h-1.5" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── 임원용: 사용자 목록 + 목표 아코디언 ─────────────
function ExecProgressSection({
  title, users, goalsByUser, orgs, expanded, setExpanded,
}: {
  title: string;
  users: User[];
  goalsByUser: Record<string, Goal[]>;
  orgs: Organization[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const orgNameMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));
  if (users.length === 0) return (
    <div className="rounded-xl border border-dashed p-8 text-center text-gray-400 text-sm">
      {title}이(가) 없습니다.
    </div>
  );
  return (
    <div className="space-y-2">
      {users.map(user => {
        const goals = goalsByUser[user.id] ?? [];
        const avg = avgProgress(goals);
        const isOpen = expanded[user.id] ?? false;
        return (
          <div key={user.id} className="rounded-xl border bg-white overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
              onClick={() => setExpanded(p => ({ ...p, [user.id]: !isOpen }))}
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{user.name}</p>
                  <p className="text-xs text-gray-400">
                    {orgNameMap[user.organizationId] ?? ''}{user.position ? ` · ${user.position}` : ''}
                  </p>
                </div>
                <span className="text-xs text-gray-400">목표 {goals.length}개</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 min-w-[120px]">
                  <Progress value={avg} className="h-2 flex-1" />
                  <span className="text-sm font-bold text-gray-700 w-10 text-right">{avg}%</span>
                </div>
                {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </div>
            </button>
            {isOpen && (
              <div className="border-t px-5 py-3 space-y-1.5">
                {goals.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">등록된 목표가 없습니다.</p>
                ) : goals.map(goal => (
                  <div key={goal.id} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                    <GoalStatusBadge status={goal.status} />
                    <span className="text-sm text-gray-700 flex-1 truncate">{goal.title}</span>
                    <div className="flex items-center gap-2 min-w-[80px]">
                      <Progress value={goal.progress} className="h-1.5 flex-1" />
                      <span className="text-xs text-gray-500 w-8 text-right">{goal.progress}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ProgressPage() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();
  const [loading, setLoading] = useState(true);
  const [myGoals, setMyGoals] = useState<Goal[]>([]);
  const [treeNodes, setTreeNodes] = useState<ReturnType<typeof buildTree>>([]);
  // 임원용
  const [execLeads, setExecLeads] = useState<User[]>([]);
  const [execMembers, setExecMembers] = useState<User[]>([]);
  const [execGoalsByUser, setExecGoalsByUser] = useState<Record<string, Goal[]>>({});
  const [execOrgs, setExecOrgs] = useState<Organization[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const role = userProfile?.role;
  const isHrAdmin = !!userProfile?.isHrAdmin;

  useEffect(() => {
    if (!userProfile) return;
    const profile = userProfile;
    async function load() {
      try {
        if (role === 'EXECUTIVE') {
          const [allUsers, allOrgs, allGoals] = await Promise.all([
            getAllUsers(), getOrganizations(), getAllGoalsByYear(year),
          ]);
          const descIds = findDescendantIds(profile.organizationId, allOrgs);
          const leads   = allUsers.filter(u => u.role === 'TEAM_LEAD' && u.isActive && descIds.includes(u.organizationId));
          const members = allUsers.filter(u => u.role === 'MEMBER'    && u.isActive && descIds.includes(u.organizationId));
          const gMap: Record<string, Goal[]> = {};
          [...leads, ...members].forEach(u => { gMap[u.id] = allGoals.filter(g => g.userId === u.id); });
          setExecLeads(leads);
          setExecMembers(members);
          setExecGoalsByUser(gMap);
          setExecOrgs(allOrgs);
        } else if (role === 'TEAM_LEAD') {
          const [allUsers, allOrgs, allGoals] = await Promise.all([
            getAllUsers(), getOrganizations(), getAllGoalsByYear(year),
          ]);
          const scopeOrgIds = findDescendantIds(profile.organizationId, allOrgs);
          const scopeUsers  = allUsers.filter(u => scopeOrgIds.includes(u.organizationId));
          const scopeGoals  = allGoals.filter(g => new Set(scopeUsers.map(u => u.id)).has(g.userId));
          const usersByOrg: Record<string, User[]> = {};
          for (const u of scopeUsers) {
            if (!usersByOrg[u.organizationId]) usersByOrg[u.organizationId] = [];
            usersByOrg[u.organizationId].push(u);
          }
          const goalsByUser: Record<string, Goal[]> = {};
          for (const g of scopeGoals) {
            if (!goalsByUser[g.userId]) goalsByUser[g.userId] = [];
            goalsByUser[g.userId].push(g);
          }
          const scopeOrgs = allOrgs.filter(o => scopeOrgIds.includes(o.id));
          setTreeNodes(buildTree(null, scopeOrgs, usersByOrg, goalsByUser));
        } else if (isHrAdmin || role === 'CEO') {
          const [allUsers, allOrgs, allGoals, ownGoals] = await Promise.all([
            getAllUsers(), getOrganizations(), getAllGoalsByYear(year),
            getGoalsByUser(profile.id, year),
          ]);
          setMyGoals(ownGoals);
          const scopeOrgIds = allOrgs.map(o => o.id);
          const scopeUsers  = allUsers.filter(u => scopeOrgIds.includes(u.organizationId));
          const scopeGoals  = allGoals.filter(g => new Set(scopeUsers.map(u => u.id)).has(g.userId));
          const usersByOrg: Record<string, User[]> = {};
          for (const u of scopeUsers) {
            if (!usersByOrg[u.organizationId]) usersByOrg[u.organizationId] = [];
            usersByOrg[u.organizationId].push(u);
          }
          const goalsByUser: Record<string, Goal[]> = {};
          for (const g of scopeGoals) {
            if (!goalsByUser[g.userId]) goalsByUser[g.userId] = [];
            goalsByUser[g.userId].push(g);
          }
          const scopeOrgs = allOrgs.filter(o => scopeOrgIds.includes(o.id));
          setTreeNodes(buildTree(null, scopeOrgs, usersByOrg, goalsByUser));
        } else {
          setMyGoals(await getGoalsByUser(profile.id, year));
        }
      } catch (e: any) {
        console.error('진행현황 로드 실패:', e);
        toast.error('진행 현황을 불러오지 못했습니다.');
      } finally { setLoading(false); }
    }
    load();
  }, [userProfile, year]);

  const isOrgTree = role === 'TEAM_LEAD' || isHrAdmin || role === 'CEO';

  return (
    <div className="flex flex-col h-full">
      <Header title="진행 현황" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <p className="text-sm text-gray-500">
            {year}년{' '}
            {role === 'EXECUTIVE' ? '소관 조직' : isOrgTree ? '조직' : '내'} 목표 진행 현황
          </p>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : role === 'EXECUTIVE' ? (
            /* 임원: 팀장 / 팀원 두 섹션 */
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">팀장 업무 진행사항</p>
                <ExecProgressSection
                  title="팀장" users={execLeads} goalsByUser={execGoalsByUser}
                  orgs={execOrgs} expanded={expanded} setExpanded={setExpanded}
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">팀원 업무 진행사항</p>
                <ExecProgressSection
                  title="팀원" users={execMembers} goalsByUser={execGoalsByUser}
                  orgs={execOrgs} expanded={expanded} setExpanded={setExpanded}
                />
              </div>
            </div>
          ) : isOrgTree ? (
            <>
              {isHrAdmin && myGoals.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">내 목표</p>
                  <PersonalProgressView goals={myGoals} loading={false} />
                </div>
              )}
              <div className="rounded-xl border bg-white p-4 space-y-1">
                {treeNodes.length === 0
                  ? <p className="text-center text-sm text-gray-400 py-8">표시할 데이터가 없습니다.</p>
                  : treeNodes.map(node => <OrgTreeNode key={node.org.id} node={node} />)}
              </div>
            </>
          ) : (
            <PersonalProgressView goals={myGoals} loading={loading} />
          )}
        </div>
      </div>
    </div>
  );
}
