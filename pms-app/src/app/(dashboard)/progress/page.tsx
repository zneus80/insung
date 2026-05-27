'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getAllUsers, getOrganizations, getAllGoalsByYear, getGoalsByUser } from '@/lib/firestore';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import { OrgTreeNode, buildTree, findDescendantIds, type OrgNode } from '@/components/goals/OrgGoalTree';
import { Target, ChevronDown, ChevronUp, Users as UsersIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Goal, User, Organization } from '@/types';

// 노드 + 하위 전체 집계
function flattenNode(node: OrgNode): { members: User[]; goals: Goal[] } {
  const members = [...node.members];
  const goals = [...node.goals];
  for (const child of node.children) {
    const sub = flattenNode(child);
    members.push(...sub.members);
    goals.push(...sub.goals);
  }
  return { members, goals };
}

// 카드로 표시할 단위 = 부문/공장(DIVISION) 레벨.
// COMPANY 루트는 카드로 쓰지 않고 그 자식(부문/공장 등)을 카드로 펼친다.
function getCardNodes(roots: OrgNode[]): OrgNode[] {
  const cards: OrgNode[] = [];
  for (const root of roots) {
    if (root.org.type === 'COMPANY') {
      cards.push(...root.children);   // 회사 직속 = 부문/공장
    } else {
      cards.push(root);               // 스코프 루트가 이미 부문/공장·단독 조직
    }
  }
  return cards;
}

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
              <GoalStatusBadge goal={goal} />
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
                    <GoalStatusBadge goal={goal} />
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
  // 5-1: 카드형 — 선택된 최상위 조직 (해당 조직 트리만 하단 전개)
  // 상세 페이지 이동 후 뒤로가기 시 선택 유지 → sessionStorage 보존
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null);
  function setSelectedOrgId(v: string | null) {
    setSelectedOrgIdState(v);
    try {
      if (v) sessionStorage.setItem('progress.selectedOrgId', v);
      else sessionStorage.removeItem('progress.selectedOrgId');
    } catch { /* 무시 */ }
  }
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('progress.selectedOrgId');
      if (saved) setSelectedOrgIdState(saved);
    } catch { /* 무시 */ }
  }, []);

  // 스크롤 컨테이너 — 위치 보존/복원 (상세→뒤로가기 시 동일 위치)
  const scrollRef = useRef<HTMLDivElement>(null);
  function handleScroll() {
    try { sessionStorage.setItem('progress.scrollTop', String(scrollRef.current?.scrollTop ?? 0)); } catch { /* 무시 */ }
  }
  // 로드 완료 + 트리(펼침 상태 복원)가 렌더된 후 스크롤 위치 복원
  useEffect(() => {
    if (loading) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          const v = Number(sessionStorage.getItem('progress.scrollTop') ?? 0);
          if (v > 0 && scrollRef.current) scrollRef.current.scrollTop = v;
        } catch { /* 무시 */ }
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [loading]);

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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-6">
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
              {/* 5-1: 부문/공장 카드 가로 나열 → 선택 시 하단에 해당 조직 트리 전개 */}
              {getCardNodes(treeNodes).length === 0 ? (
                <div className="rounded-xl border bg-white p-4">
                  <p className="text-center text-sm text-gray-400 py-8">표시할 데이터가 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                    {getCardNodes(treeNodes).map(node => {
                      const agg = flattenNode(node);
                      const prog = avgProgress(agg.goals);
                      const isSel = selectedOrgId === node.org.id;
                      return (
                        <button
                          key={node.org.id}
                          onClick={() => setSelectedOrgId(isSel ? null : node.org.id)}
                          className={cn(
                            'text-left rounded-xl border bg-white p-4 transition-all hover:shadow-sm',
                            isSel ? 'border-blue-500 ring-1 ring-blue-300 shadow-sm' : 'border-gray-200',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="font-semibold text-gray-900 truncate">{node.org.name}</span>
                            {isSel ? <ChevronUp className="h-4 w-4 text-blue-500 shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                            <UsersIcon className="h-3.5 w-3.5" /> {agg.members.length}명
                            <span className="ml-auto font-medium text-gray-700">{prog}%</span>
                          </div>
                          <Progress value={prog} className="h-1.5" />
                          <p className="text-[11px] text-gray-400 mt-1.5">목표 {agg.goals.length}개</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* 선택된 조직의 트리 */}
                  {selectedOrgId && (() => {
                    const sel = getCardNodes(treeNodes).find(n => n.org.id === selectedOrgId);
                    if (!sel) return null;
                    return (
                      <div className="rounded-xl border bg-white p-4 space-y-1">
                        <OrgTreeNode node={sel} persistKey="progress" />
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          ) : (
            <PersonalProgressView goals={myGoals} loading={loading} />
          )}
        </div>
      </div>
    </div>
  );
}
