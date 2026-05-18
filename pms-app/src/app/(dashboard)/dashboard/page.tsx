'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  getGoalsByUser,
  getPendingGoalsByOrganization,
  getOneOnOnesByMember,
  getOneOnOnesByLeader,
  getMileage,
  getAllUsers,
  getOrganizations,
  getAllGoalsByYear,
  getAnnualGoal,
  getWeeklyTask,
  getWeeklyTasksByUsersAndWeek,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, TrendingUp, CheckCircle, Clock, Users, ArrowRight, Building2, LayoutList, ClipboardList, Circle, Check, ChevronDown } from 'lucide-react';
import GoalCard from '@/components/goals/GoalCard';
import MileageCard from '@/components/mileage/MileageCard';
import { OrgTreeNode, buildTree, findDescendantIds } from '@/components/goals/OrgGoalTree';
import { cn } from '@/lib/utils';
import type { Goal, OneOnOne, Mileage, User, AnnualGoal, Organization, WeeklyTask, WeeklyTaskStatus } from '@/types';

// ── 주차 유틸 (dashboard 전용 간소 버전) ──────────────
function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7) };
}
function getWeekRange(year: number, week: number) {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Day + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}
function fmtWeekLabel(start: Date, end: Date) {
  const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${start.getFullYear()}년 ${getISOWeek(start).week}주차 (${f(start)} ~ ${f(end)})`;
}

// ── 상태 설정 ──────────────────────────────────────────
const STATUS_ICON: Record<WeeklyTaskStatus, React.ReactNode> = {
  PLANNED:     <Circle  className="h-3.5 w-3.5 text-gray-400" />,
  IN_PROGRESS: <Clock   className="h-3.5 w-3.5 text-blue-500" />,
  DONE:        <Check   className="h-3.5 w-3.5 text-green-500" />,
};
const STATUS_BADGE: Record<WeeklyTaskStatus, string> = {
  PLANNED:     'bg-gray-100 text-gray-500',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  DONE:        'bg-green-100 text-green-700',
};
const STATUS_LABEL: Record<WeeklyTaskStatus, string> = {
  PLANNED: '계획', IN_PROGRESS: '진행 중', DONE: '완료',
};

export default function DashboardPage() {
  const { userProfile } = useAuth();
  const year = new Date().getFullYear();

  // 임원·CEO는 조직 트리 대시보드
  if (userProfile?.role === 'EXECUTIVE' || userProfile?.role === 'CEO') {
    return <ExecDashboard />;
  }

  const [goals, setGoals] = useState<Goal[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [upcomingMeetings, setUpcomingMeetings] = useState<OneOnOne[]>([]);
  const [myMileage, setMyMileage] = useState<Mileage | null>(null);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [orgGoal, setOrgGoal] = useState<AnnualGoal | null>(null);
  const [weeklyTask, setWeeklyTask] = useState<WeeklyTask | null>(null);
  const [loading, setLoading] = useState(true);
  const { year: thisYear, week: thisWeek } = getISOWeek(new Date());
  const { start: weekStart, end: weekEnd } = getWeekRange(thisYear, thisWeek);

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [goalList, pending, meetings, mileage, cGoal, oGoal, wt] = await Promise.all([
          getGoalsByUser(userProfile!.id, year),
          userProfile!.role === 'TEAM_LEAD'
            ? getPendingGoalsByOrganization(userProfile!.organizationId)
            : Promise.resolve([]),
          userProfile!.role === 'TEAM_LEAD'
            ? getOneOnOnesByLeader(userProfile!.id)
            : getOneOnOnesByMember(userProfile!.id),
          getMileage(userProfile!.id),
          getAnnualGoal('company', year),
          getAnnualGoal('org', year, userProfile!.organizationId),
          getWeeklyTask(userProfile!.id, thisYear, thisWeek),
        ]);
        setGoals(goalList);
        setPendingCount(pending.length);
        setUpcomingMeetings(meetings.slice(0, 3));
        setMyMileage(mileage);
        setCompanyGoal(cGoal);
        setOrgGoal(oGoal);
        setWeeklyTask(wt);
      } catch (e: any) {
        console.error('대시보드 로드 실패:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userProfile]);

  const totalGoals = goals.length;
  const inProgressGoals = goals.filter(g => ['APPROVED', 'IN_PROGRESS'].includes(g.status));
  const completedGoals = goals.filter(g => g.status === 'COMPLETED');
  const avgProgress = inProgressGoals.length
    ? Math.round(inProgressGoals.reduce((s, g) => s + g.progress, 0) / inProgressGoals.length)
    : 0;

  const recentGoals = goals
    .filter(g => ['APPROVED', 'IN_PROGRESS', 'DRAFT', 'REJECTED'].includes(g.status))
    .slice(0, 3);

  return (
    <div className="flex flex-col h-full">
      <Header title="대시보드" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            안녕하세요, {userProfile?.name ?? ''}님 👋
          </h3>
          <p className="mt-1 text-sm text-gray-500">{year}년 목표 현황입니다.</p>
        </div>

        {/* 연간 목표 배너 */}
        {(companyGoal || orgGoal) && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {companyGoal && (
              <div className="rounded-xl border-l-4 border-l-blue-500 bg-blue-50 px-5 py-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 uppercase tracking-wide">
                  <Building2 className="h-3.5 w-3.5" />
                  {year}년 회사 목표
                </div>
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{companyGoal.content}</p>
              </div>
            )}
            {orgGoal && (
              <div className="rounded-xl border-l-4 border-l-green-500 bg-green-50 px-5 py-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-green-600 uppercase tracking-wide">
                  <LayoutList className="h-3.5 w-3.5" />
                  {year}년 우리 조직 목표
                </div>
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{orgGoal.content}</p>
              </div>
            )}
          </div>
        )}

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard title="전체 목표" value={String(totalGoals)} sub="등록된 목표 수"
            icon={<Target className="h-5 w-5 text-blue-600" />} color="bg-blue-50" />
          <SummaryCard title="평균 진행률" value={`${avgProgress}%`} sub="진행 중 목표 기준"
            icon={<TrendingUp className="h-5 w-5 text-green-600" />} color="bg-green-50" />
          <SummaryCard title="완료" value={String(completedGoals.length)} sub="달성한 목표"
            icon={<CheckCircle className="h-5 w-5 text-purple-600" />} color="bg-purple-50" />
          {userProfile?.role === 'TEAM_LEAD' ? (
            <SummaryCard title="승인 대기" value={String(pendingCount)} sub="처리 필요"
              icon={<Clock className="h-5 w-5 text-orange-600" />} color="bg-orange-50" />
          ) : (
            <SummaryCard title="예정 1on1" value={String(upcomingMeetings.length)} sub="다가오는 미팅"
              icon={<Clock className="h-5 w-5 text-orange-600" />} color="bg-orange-50" />
          )}
        </div>

        {/* 마일리지 카드 */}
        <MileageCard points={myMileage?.points ?? 0} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 최근 목표 */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">진행 중인 목표</h4>
              <Link href="/goals" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                전체 보기 <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1,2].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
              </div>
            ) : recentGoals.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-gray-50 p-8 text-center">
                <p className="text-sm text-gray-400">아직 목표가 없습니다.</p>
                <Link href="/goals/new" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
                  첫 목표 등록하기 →
                </Link>
              </div>
            ) : (
              recentGoals.map(g => <GoalCard key={g.id} goal={g} />)
            )}
          </div>

          {/* 오른쪽 사이드 */}
          <div className="space-y-4">
            {/* 이번 주 내 업무 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  <ClipboardList className="h-4 w-4 text-gray-400" />
                  이번 주 업무
                </h4>
                <Link href="/tasks" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  관리 <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {loading ? (
                <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
              ) : !weeklyTask || weeklyTask.items.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-gray-50 p-5 text-center">
                  <p className="text-xs text-gray-400">{fmtWeekLabel(weekStart, weekEnd)}</p>
                  <p className="text-sm text-gray-400 mt-1">등록된 업무가 없습니다.</p>
                  <Link href="/tasks" className="mt-1 inline-block text-xs text-blue-600 hover:underline">
                    업무 추가하기 →
                  </Link>
                </div>
              ) : (
                <div className="rounded-xl border bg-white overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between">
                    <span className="text-xs text-gray-500">{fmtWeekLabel(weekStart, weekEnd)}</span>
                    <span className="text-xs text-green-600 font-medium">
                      {weeklyTask.items.filter(i => i.status === 'DONE').length}/{weeklyTask.items.length} 완료 ·{' '}
                      평균 {weeklyTask.items.length > 0
                        ? Math.round(weeklyTask.items.reduce((s, i) => s + (i.achievement ?? 0), 0) / weeklyTask.items.length)
                        : 0}%
                    </span>
                  </div>
                  <div className="divide-y">
                    {weeklyTask.items.slice(0, 5).map(item => (
                      <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="shrink-0">{STATUS_ICON[item.status]}</span>
                        <span className={cn(
                          'flex-1 text-xs truncate',
                          item.status === 'DONE' ? 'line-through text-gray-400' : 'text-gray-700'
                        )}>
                          {item.title}
                        </span>
                        <span className="shrink-0 text-xs text-gray-500 w-8 text-right">
                          {item.achievement ?? 0}%
                        </span>
                        <span className={cn('shrink-0 text-xs rounded-full px-2 py-0.5', STATUS_BADGE[item.status])}>
                          {STATUS_LABEL[item.status]}
                        </span>
                      </div>
                    ))}
                  </div>
                  {weeklyTask.items.length > 5 && (
                    <Link href="/tasks">
                      <div className="px-3 py-2 text-center text-xs text-blue-600 hover:bg-gray-50 border-t">
                        + {weeklyTask.items.length - 5}개 더 보기
                      </div>
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* 예정 1on1 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-700">예정된 1on1</h4>
                <Link href="/oneon1" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  전체 보기 <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {upcomingMeetings.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-gray-50 p-5 text-center">
                  <p className="text-sm text-gray-400">진행 중인 1on1이 없습니다.</p>
                </div>
              ) : (
                upcomingMeetings.map(m => (
                  <Link key={m.id} href={`/oneon1/${m.id}`}>
                    <div className="rounded-xl border bg-white p-4 hover:shadow-sm transition-shadow cursor-pointer">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-medium text-gray-900">1on1</span>
                        {m.title && <span className="text-xs text-gray-400">· {m.title}</span>}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {m.lastMessagePreview ?? '메시지 없음'}
                      </p>
                    </div>
                  </Link>
                ))
              )}

              {/* 승인 대기 알림 (팀장) */}
              {pendingCount > 0 && (
                <Link href="/approvals">
                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 hover:shadow-sm transition-shadow cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-orange-500" />
                      <span className="text-sm font-medium text-orange-700">
                        승인 대기 {pendingCount}건
                      </span>
                    </div>
                    <p className="text-xs text-orange-500 mt-1">처리가 필요한 항목이 있습니다.</p>
                  </div>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 임원 / CEO 대시보드 ──────────────────────────
function ExecDashboard() {
  const { userProfile } = useAuth();
  const year = new Date().getFullYear();
  const { year: thisYear, week: thisWeek } = getISOWeek(new Date());
  const { start: weekStart, end: weekEnd } = getWeekRange(thisYear, thisWeek);

  const [loading, setLoading] = useState(true);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [treeNodes, setTreeNodes] = useState<ReturnType<typeof buildTree>>([]);
  // 주간 업무: 조직별 { orgId → { user, items[] }[] }
  const [orgTaskMap, setOrgTaskMap] = useState<Record<string, { user: User; doneCount: number; totalCount: number }[]>>({});
  const [orgList, setOrgList] = useState<Organization[]>([]);
  const [taskExpanded, setTaskExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [allUsers, allOrgs, allGoals, cGoal] = await Promise.all([
            getAllUsers(),
            getOrganizations(),
            getAllGoalsByYear(year),
            getAnnualGoal('company', year),
          ]);
          setCompanyGoal(cGoal);

          const scopeOrgIds = userProfile!.role === 'EXECUTIVE'
            ? (() => {
                const byOrg = userProfile!.organizationId
                  ? findDescendantIds(userProfile!.organizationId, allOrgs)
                  : [];
                const byLead = allOrgs
                  .filter(o => o.leaderId === userProfile!.id)
                  .flatMap(o => findDescendantIds(o.id, allOrgs));
                return [...new Set([...byOrg, ...byLead])];
              })()
            : allOrgs.map(o => o.id);

          const scopeUsers = allUsers.filter(u => scopeOrgIds.includes(u.organizationId));
          const scopeGoals = allGoals.filter(g => new Set(scopeUsers.map(u => u.id)).has(g.userId));
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
          const treeRootParentId = userProfile!.role === 'EXECUTIVE'
            ? (allOrgs.find(o => o.id === userProfile!.organizationId)?.parentId ?? null)
            : null;
          setTreeNodes(buildTree(treeRootParentId, scopeOrgs, usersByOrg, goalsByUser));

          // ── 주간 업무 로드 ──
          const weeklyTasks = await getWeeklyTasksByUsersAndWeek(
            scopeUsers.map(u => u.id), thisYear, thisWeek
          );
          const taskByUser: Record<string, { doneCount: number; totalCount: number }> = {};
          weeklyTasks.forEach(wt => {
            taskByUser[wt.userId] = {
              totalCount: wt.items.length,
              doneCount: wt.items.filter(i => i.status === 'DONE').length,
            };
          });
          // 팀 단위로 그룹핑 (TEAM 타입 조직만)
          const teamOrgs = scopeOrgs.filter(o => o.type === 'TEAM');
          const map: Record<string, { user: User; doneCount: number; totalCount: number }[]> = {};
          teamOrgs.forEach(org => {
            const members = scopeUsers.filter(u => u.organizationId === org.id);
            map[org.id] = members.map(u => ({
              user: u,
              doneCount: taskByUser[u.id]?.doneCount ?? 0,
              totalCount: taskByUser[u.id]?.totalCount ?? 0,
            }));
          });
          setOrgList(teamOrgs);
          setOrgTaskMap(map);
          // 기본: 첫 번째 팀 펼침
          if (teamOrgs.length > 0) setTaskExpanded({ [teamOrgs[0].id]: true });
      } catch (e: any) {
        console.error('임원 대시보드 로드 실패:', e);
      } finally { setLoading(false); }
    }
    load();
  }, [userProfile]);

  const totalTaskUsers = Object.values(orgTaskMap).flat().length;
  const totalDone = Object.values(orgTaskMap).flat().reduce((s, r) => s + r.doneCount, 0);
  const totalTasks = Object.values(orgTaskMap).flat().reduce((s, r) => s + r.totalCount, 0);

  return (
    <div className="flex flex-col h-full">
      <Header title="대시보드" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            안녕하세요, {userProfile?.name ?? ''}님 👋
          </h3>
          <p className="mt-1 text-sm text-gray-500">{year}년 조직 목표 진행 현황입니다.</p>
        </div>

        {/* 회사 경영목표 */}
        {companyGoal && (
          <div className="rounded-xl border-l-4 border-l-blue-500 bg-blue-50 px-5 py-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 uppercase tracking-wide">
              <Building2 className="h-3.5 w-3.5" /> {year}년 회사 경영목표
            </div>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{companyGoal.content}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* 조직 목표 트리 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">
              {userProfile?.role === 'CEO' ? '전체 조직' : '담당 조직'} 목표 현황
            </h4>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}
              </div>
            ) : (
              <div className="rounded-xl border bg-white p-4 space-y-1">
                {treeNodes.length === 0
                  ? <p className="text-center text-sm text-gray-400 py-8">표시할 데이터가 없습니다.</p>
                  : treeNodes.map(node => <OrgTreeNode key={node.org.id} node={node} />)}
              </div>
            )}
          </div>

          {/* 이번 주 조직 업무 현황 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4 text-gray-400" />
                이번 주 업무 현황
              </h4>
              <Link href="/tasks" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                상세 보기 <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1,2].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}
              </div>
            ) : (
              <div className="rounded-xl border bg-white overflow-hidden">
                {/* 주차 + 전체 요약 헤더 */}
                <div className="px-4 py-2.5 bg-gray-50 border-b flex items-center justify-between">
                  <span className="text-xs text-gray-500">{fmtWeekLabel(weekStart, weekEnd)}</span>
                  {totalTasks > 0 && (
                    <span className="text-xs font-medium text-green-600">
                      전체 {totalDone}/{totalTasks} 완료
                    </span>
                  )}
                </div>
                {orgList.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-8">표시할 팀이 없습니다.</p>
                ) : (
                  <div className="divide-y">
                    {orgList.map(org => {
                      const members = orgTaskMap[org.id] ?? [];
                      const orgTotal = members.reduce((s, r) => s + r.totalCount, 0);
                      const orgDone  = members.reduce((s, r) => s + r.doneCount,  0);
                      const isOpen = taskExpanded[org.id] ?? false;
                      return (
                        <div key={org.id}>
                          <button
                            onClick={() => setTaskExpanded(p => ({ ...p, [org.id]: !isOpen }))}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                          >
                            <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', !isOpen && '-rotate-90')} />
                            <span className="flex-1 text-left text-sm font-medium text-gray-800">{org.name}</span>
                            <span className="text-xs text-gray-400">{members.length}명</span>
                            {orgTotal > 0
                              ? <span className="text-xs text-green-600 font-medium">{orgDone}/{orgTotal} 완료</span>
                              : <span className="text-xs text-gray-300">업무 없음</span>
                            }
                          </button>
                          {isOpen && (
                            <div className="bg-gray-50 border-t divide-y">
                              {members.map(({ user, doneCount, totalCount }) => (
                                <div key={user.id} className="flex items-center gap-2.5 px-5 py-2">
                                  <div className="h-5 w-5 rounded-full bg-white border flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                                    {user.name[0]}
                                  </div>
                                  <span className="flex-1 text-xs text-gray-700">
                                    {user.name}
                                    {user.position && <span className="ml-1 text-gray-400">{user.position}</span>}
                                  </span>
                                  {totalCount === 0
                                    ? <span className="text-xs text-gray-300">없음</span>
                                    : <span className={cn('text-xs font-medium', doneCount === totalCount ? 'text-green-600' : 'text-blue-600')}>
                                        {doneCount}/{totalCount}
                                      </span>
                                  }
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, sub, icon, color }: {
  title: string; value: string; sub: string;
  icon: React.ReactNode; color: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
        <div className={`rounded-lg p-2 ${color}`}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-gray-900">{value}</div>
        <p className="text-xs text-gray-500 mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
