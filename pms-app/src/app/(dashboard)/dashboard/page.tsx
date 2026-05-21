'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
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
  getAnnouncements,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, TrendingUp, CheckCircle, Clock, Users, ArrowRight, Building2, LayoutList, Bell, ChevronRight } from 'lucide-react';
import GoalCard from '@/components/goals/GoalCard';
import MileageCard from '@/components/mileage/MileageCard';
import { OrgTreeNode, buildTree, findDescendantIds, avgProgress } from '@/components/goals/OrgGoalTree';
import type { Goal, OneOnOne, Mileage, User, AnnualGoal, Organization, Announcement } from '@/types';

export default function DashboardPage() {
  const { userProfile } = useAuth();

  // 임원·CEO는 조직 트리 대시보드 (hooks 규칙: 별도 컴포넌트로 분리)
  if (userProfile?.role === 'EXECUTIVE' || userProfile?.role === 'CEO') {
    return <ExecDashboard />;
  }

  return <MemberDashboard />;
}

function MemberDashboard() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [upcomingMeetings, setUpcomingMeetings] = useState<OneOnOne[]>([]);
  const [myMileage, setMyMileage] = useState<Mileage | null>(null);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [orgGoal, setOrgGoal] = useState<AnnualGoal | null>(null);
  const [recentAnnouncements, setRecentAnnouncements] = useState<Announcement[]>([]);
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [goalList, pending, meetings, mileage, cGoal, oGoal, announcements] = await Promise.all([
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
          getAnnouncements(),
        ]);
        setGoals(goalList);
        setPendingCount(pending.length);
        setUpcomingMeetings(meetings.slice(0, 3));
        setMyMileage(mileage);
        setCompanyGoal(cGoal);
        setOrgGoal(oGoal);
        setRecentAnnouncements(announcements.slice(0, 3));
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

        {/* 공지사항 위젯 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <Bell className="h-4 w-4 text-gray-500" />
              공지사항
            </h4>
            <Link href="/announcements" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
              전체 보기 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <div className="h-12 animate-pulse rounded-xl bg-gray-100" />
          ) : recentAnnouncements.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-gray-50 p-4 text-center">
              <p className="text-sm text-gray-400">등록된 공지사항이 없습니다.</p>
            </div>
          ) : (
            <div className="rounded-xl border bg-white divide-y divide-gray-100">
              {recentAnnouncements.slice(0, 3).map(a => (
                <div key={a.id}>
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    onClick={() => setExpandedAnnouncementId(prev => prev === a.id ? null : a.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {a.isPinned && <span className="text-sm">📌</span>}
                      <span className="text-sm font-medium text-gray-900 truncate">{a.title}</span>
                    </div>
                    <span className="text-xs text-gray-400 ml-3 shrink-0">
                      {a.createdAt.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                    </span>
                  </button>
                  {expandedAnnouncementId === a.id && (
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{a.content}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
                <p className="text-base text-gray-800 leading-relaxed whitespace-pre-wrap">{companyGoal.content}</p>
              </div>
            )}
            {orgGoal && (
              <div className="rounded-xl border-l-4 border-l-green-500 bg-green-50 px-5 py-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-green-600 uppercase tracking-wide">
                  <LayoutList className="h-3.5 w-3.5" />
                  {year}년 우리 조직 목표
                </div>
                <p className="text-base text-gray-800 leading-relaxed whitespace-pre-wrap">{orgGoal.content}</p>
              </div>
            )}
          </div>
        )}

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard title="전체 목표" value={String(totalGoals)} sub="등록된 목표 수"
            icon={<Target className="h-5 w-5 text-blue-600" />} color="bg-blue-50" href="/goals" />
          <SummaryCard title="평균 진행률" value={`${avgProgress}%`} sub="진행 중 목표 기준"
            icon={<TrendingUp className="h-5 w-5 text-green-600" />} color="bg-green-50" href="/goals" />
          <SummaryCard title="완료" value={String(completedGoals.length)} sub="달성한 목표"
            icon={<CheckCircle className="h-5 w-5 text-purple-600" />} color="bg-purple-50" href="/goals" />
          {userProfile?.role === 'TEAM_LEAD' ? (
            <SummaryCard title="승인 대기" value={String(pendingCount)} sub="처리 필요"
              icon={<Clock className="h-5 w-5 text-orange-600" />} color="bg-orange-50" href="/approvals" />
          ) : (
            <SummaryCard title="예정 1on1" value={String(upcomingMeetings.length)} sub="다가오는 미팅"
              icon={<Clock className="h-5 w-5 text-orange-600" />} color="bg-orange-50" href="/oneon1" />
          )}
        </div>

        {/* 마일리지 카드 */}
        <MileageCard
          points={myMileage?.points ?? 0}
          submitTds={myMileage?.submitTds}
          instructTds={myMileage?.instructTds}
        />

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
              recentGoals.map(g => (
                <GoalCard key={g.id} goal={g} />
              ))
            )}
          </div>

          {/* 예정 1on1 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">예정된 1on1</h4>
              <Link href="/oneon1" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                전체 보기 <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {upcomingMeetings.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-gray-50 p-6 text-center">
                <p className="text-sm text-gray-400">진행 중인 1on1이 없습니다.</p>
              </div>
            ) : (
              upcomingMeetings.map(m => (
                <Link key={m.id} href={`/oneon1/${m.id}`}>
                  <div className="rounded-xl border bg-white p-4 hover:shadow-sm transition-shadow cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-medium text-gray-900">1on1</span>
                      {m.title && <span className="text-xs text-gray-400">· {m.title}</span>}
                    </div>
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
  );
}

// ── 임원 / CEO 대시보드 ──────────────────────────
interface OrgSummary {
  org: Organization;
  leads: User[];
  members: User[];
  leadGoals: Goal[];
  memberGoals: Goal[];
}

function ExecDashboard() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();
  const [loading, setLoading] = useState(true);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [treeNodes, setTreeNodes] = useState<ReturnType<typeof buildTree>>([]);
  const [orgSummaries, setOrgSummaries] = useState<OrgSummary[]>([]);
  const [recentAnnouncements, setRecentAnnouncements] = useState<Announcement[]>([]);
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [allUsers, allOrgs, allGoals, cGoal, announcements] = await Promise.all([
            getAllUsers(),
            getOrganizations(),
            getAllGoalsByYear(year),
            getAnnualGoal('company', year),
            getAnnouncements(),
          ]);
          setCompanyGoal(cGoal);
          setRecentAnnouncements(announcements.slice(0, 3));

          // 임원: 자신이 책임진 조직 산하만 / CEO: 전체
          const scopeOrgIds = userProfile!.role === 'EXECUTIVE'
            ? allOrgs.filter(o => o.leaderId === userProfile!.id)
                .flatMap(o => findDescendantIds(o.id, allOrgs))
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
          setTreeNodes(buildTree(null, scopeOrgs, usersByOrg, goalsByUser));

          // 팀 단위 카드 요약 (TEAM 타입 조직만)
          const teamOrgs = scopeOrgs.filter(o => o.type === 'TEAM');
          const summaries: OrgSummary[] = teamOrgs.map(org => {
            const orgUsers = usersByOrg[org.id] ?? [];
            const leads = orgUsers.filter(u => u.role === 'TEAM_LEAD');
            const members = orgUsers.filter(u => u.role === 'MEMBER');
            const leadGoals = leads.flatMap(u => goalsByUser[u.id] ?? []);
            const memberGoals = members.flatMap(u => goalsByUser[u.id] ?? []);
            return { org, leads, members, leadGoals, memberGoals };
          });
          setOrgSummaries(summaries);
      } catch (e: any) {
        console.error('임원 대시보드 로드 실패:', e);
      } finally { setLoading(false); }
    }
    load();
  }, [userProfile]);

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
            <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 uppercase tracking-wide">
              <Building2 className="h-3.5 w-3.5" /> {year}년 회사 경영목표
            </div>
            <p className="text-base text-gray-800 leading-relaxed whitespace-pre-wrap">{companyGoal.content}</p>
          </div>
        )}

        {/* 공지사항 위젯 */}
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-700">공지사항</span>
            </div>
            <Link href="/announcements" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
              전체보기 <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <div className="px-5 py-4 space-y-2">
              {[1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}
            </div>
          ) : recentAnnouncements.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <p className="text-sm text-gray-400">등록된 공지사항이 없습니다.</p>
            </div>
          ) : (
            <div className="divide-y">
              {recentAnnouncements.map(a => (
                <div key={a.id}>
                  <button
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                    onClick={() => setExpandedAnnouncementId(prev => prev === a.id ? null : a.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {a.isPinned && <span className="text-sm">📌</span>}
                      <span className="text-sm font-medium text-gray-900 truncate">{a.title}</span>
                    </div>
                    <span className="text-xs text-gray-400 ml-3 shrink-0">
                      {a.createdAt.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                    </span>
                  </button>
                  {expandedAnnouncementId === a.id && (
                    <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{a.content}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 조직 트리 상세 */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">
            {userProfile?.role === 'CEO' ? '전체 조직' : '담당 조직'} 상세 현황
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
      </div>
    </div>
  );
}

function SummaryCard({ title, value, sub, icon, color, href }: {
  title: string; value: string; sub: string;
  icon: React.ReactNode; color: string; href?: string;
}) {
  const card = (
    <Card className={href ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}>
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
  if (href) return <Link href={href}>{card}</Link>;
  return card;
}

function OrgProgressRow({ label, goals, count }: { label: string; goals: Goal[]; count: number }) {
  const avg = avgProgress(goals);
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500 w-8 shrink-0">{label}</span>
      <span className="text-sm text-gray-400 shrink-0">{count}명</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${avg}%` }} />
      </div>
      <span className="text-sm font-medium text-gray-600 w-8 text-right shrink-0">{avg}%</span>
    </div>
  );
}
