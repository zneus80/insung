'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getGoalsByUser,
  getGoalsByOrganization,
  getGoalsByOrganizations,
  getPendingGoalsByOrganizations,
  getPendingWeightChangeRequestsForApprover,
  getOneOnOnesForUser,
  hideOneOnOneForUser,
  getMileage,
  getAllUsers,
  getUser,
  getOrganizationsForYear,
  getAllGoalsByYear,
  getAnnualGoal,
  getAllOrgAnnualGoals,
  getAnnouncements,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, TrendingUp, CheckCircle, Clock, Users, ArrowRight, Building2, LayoutList, Bell, ChevronRight, Trash2 } from 'lucide-react';
import GoalCard from '@/components/goals/GoalCard';
import MileageCard from '@/components/mileage/MileageCard';
import { OrgTreeNode, buildTree, findDescendantIds, avgProgress } from '@/components/goals/OrgGoalTree'; // findDescendantIds: ExecDashboard에서 사용
import { CompanyProgressBody } from '@/app/(dashboard)/progress/company/page';
import PolicyGuideButton from '@/components/dashboard/PolicyGuideButton';
import FontScaleControl from '@/components/layout/FontScaleControl';
import OrgStatusModal from '@/components/dashboard/OrgStatusModal';
import { cn } from '@/lib/utils';
import { filterMyActionableGoals } from '@/lib/approval-filters';
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
  const [teamGoals, setTeamGoals] = useState<Goal[]>([]); // 본인 제외 팀 인원 목표
  const [pendingCount, setPendingCount] = useState(0);
  const [upcomingMeetings, setUpcomingMeetings] = useState<OneOnOne[]>([]);
  const [meetingPartners, setMeetingPartners] = useState<Record<string, string>>({});
  const [myMileage, setMyMileage] = useState<Mileage | null>(null);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [orgGoal, setOrgGoal] = useState<AnnualGoal | null>(null);
  const [recentAnnouncements, setRecentAnnouncements] = useState<Announcement[]>([]);
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgStatusOpen, setOrgStatusOpen] = useState(false);
  const [myOrgName, setMyOrgName] = useState<string>('');
  const [myDivisionName, setMyDivisionName] = useState<string>('');

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        // 조직 정보 — 팀 스코프 계산 + 본부장 판별 (확정 연도면 그 해 스냅샷, 아니면 라이브·보관제외)
        const allOrgs = await getOrganizationsForYear(year);
        function getDescendantIds(orgId: string): string[] {
          const ids: string[] = [orgId];
          allOrgs.filter(o => o.parentId === orgId).forEach(child => {
            ids.push(...getDescendantIds(child.id));
          });
          return ids;
        }
        // 본부장 판별: TEAM_LEAD 인데 본인 소속이 HEADQUARTERS 거나 HQ 의 leaderId.
        // 다중 본부 겸직 지원 — filter 로 모든 led HQ 처리.
        const myOrg = allOrgs.find(o => o.id === userProfile!.organizationId);
        if (myOrg?.name) setMyOrgName(myOrg.name);
        // 본인이 속한 부문/공장(DIVISION) 조직 찾기 — 조직 트리를 거슬러 올라가며 type === 'DIVISION'
        function findDivisionAncestor(orgId: string | undefined): typeof allOrgs[number] | null {
          let cur = orgId ? allOrgs.find(o => o.id === orgId) : null;
          while (cur) {
            if (cur.type === 'DIVISION') return cur;
            cur = cur.parentId ? (allOrgs.find(o => o.id === cur!.parentId) ?? null) : null;
          }
          return null;
        }
        const myDivision = findDivisionAncestor(userProfile!.organizationId);
        if (myDivision?.name) setMyDivisionName(myDivision.name);
        const myLedHQs = allOrgs.filter(o => o.leaderId === userProfile!.id && o.type === 'HEADQUARTERS');
        const isHQHead = userProfile!.role === 'TEAM_LEAD' && (myOrg?.type === 'HEADQUARTERS' || myLedHQs.length > 0);
        // 팀 스코프: 본부장이면 본인이 leader 인 모든 HQ + home HQ descendants, 그 외엔 본인 팀
        const hqRootIds = isHQHead
          ? Array.from(new Set([
              ...(myOrg?.type === 'HEADQUARTERS' ? [myOrg.id] : []),
              ...myLedHQs.map(h => h.id),
            ]))
          : [];
        const teamScopeOrgIds = isHQHead
          ? Array.from(new Set(hqRootIds.flatMap(id => getDescendantIds(id))))
          : [userProfile!.organizationId];

        // 팀장(승인대기) 범위 계산 — 본인 leaderId 조직 포함
        let pendingCount = 0;
        if (userProfile!.role === 'TEAM_LEAD') {
          const myLedOrgs = allOrgs.filter(o => o.leaderId === userProfile!.id);
          const rootIdSet = new Set<string>([userProfile!.organizationId]);
          myLedOrgs.forEach(o => rootIdSet.add(o.id));
          const scopeOrgIds = [...new Set([...rootIdSet].flatMap(id => getDescendantIds(id)))];
          const [pending, allUsers] = await Promise.all([
            getPendingGoalsByOrganizations(scopeOrgIds),
            getAllUsers(),
          ]);
          const usersMap = Object.fromEntries(allUsers.map(u => [u.id, u]));
          const weightReqs = await getPendingWeightChangeRequestsForApprover(userProfile!.id).catch(() => []);
          pendingCount = filterMyActionableGoals(
            pending, allOrgs, usersMap, userProfile!.id, userProfile!.role,
          ).length + weightReqs.length;
        }

        const [goalList, teamScopeGoals, meetings, mileage, cGoal, oGoal, announcements] = await Promise.all([
          getGoalsByUser(userProfile!.id, year),
          // 팀 스코프 전체 목표 (본부장이면 본부 descendants)
          getGoalsByOrganizations(teamScopeOrgIds, year),
          getOneOnOnesForUser(userProfile!.id),
          getMileage(userProfile!.id),
          getAnnualGoal('company', year),
          myDivision ? getAnnualGoal('org', year, myDivision.id) : Promise.resolve(null),
          getAnnouncements(),
        ]);

        setGoals(goalList);
        // 팀 목표 — 팀 전체(본인 포함) + 휴지통·소프트삭제 제외.
        // 단, 포기 확정(승인된 ABANDONED)은 본인이 화면에서 제거(softDeletedAt)해도 평가 기록으로 계속 표시.
        setTeamGoals(teamScopeGoals.filter(g =>
          !g.trashedAt && (!g.softDeletedAt || (g.status === 'ABANDONED' && !!g.approvedBy)),
        ));
        setPendingCount(pendingCount);
        setUpcomingMeetings(meetings.slice(0, 3));
        setMyMileage(mileage);
        setCompanyGoal(cGoal);
        setOrgGoal(oGoal);
        setRecentAnnouncements(announcements.slice(0, 3));

        // 1on1 상대방 이름 조회 (역할에 따라 leader 또는 member)
        const shownMeetings = meetings.slice(0, 3);
        const partnerIds = [...new Set(shownMeetings.map(m =>
          userProfile!.role === 'TEAM_LEAD' ? m.memberId : m.leaderId
        ))];
        if (partnerIds.length > 0) {
          const partners = await Promise.all(partnerIds.map(id => getUser(id)));
          const partnerMap: Record<string, string> = {};
          partners.forEach(p => { if (p) partnerMap[p.id] = p.name; });
          setMeetingPartners(partnerMap);
        }
      } catch (e: any) {
        console.error('대시보드 로드 실패:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userProfile]);

  // 반려확정·포기확정 등은 제외하고 카운트
  const EXCLUDE_FROM_TOTAL = ['REJECTED', 'ABANDONED', 'PENDING_ABANDON'];

  // 팀 전체(본인 포함) 목표 통계 — 반려/포기 제외
  const activeTeamGoals = teamGoals.filter(g => !EXCLUDE_FROM_TOTAL.includes(g.status));
  const teamTotal = activeTeamGoals.length;
  const teamInProgress = activeTeamGoals.filter(g => ['APPROVED', 'IN_PROGRESS'].includes(g.status));
  const teamAvgProgress = teamInProgress.length
    ? Math.round(teamInProgress.reduce((s, g) => s + g.progress, 0) / teamInProgress.length)
    : 0;
  const teamCompleted = activeTeamGoals.filter(g => g.status === 'COMPLETED').length;

  return (
    <div className="flex flex-col h-full">
      <Header title="대시보드" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">
              안녕하세요, {userProfile?.name ?? ''}님 👋
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {[myOrgName, userProfile?.position].filter(Boolean).join(' · ')}
              {(myOrgName || userProfile?.position) && ' · '}
              {year}년 목표 현황입니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <FontScaleControl />
            <PolicyGuideButton />
          </div>
        </div>

        {/* ① 연간 목표 배너 — 항상 최상단 (회사 경영목표 + 조직 목표) */}
        {(companyGoal || (orgGoal && myDivisionName)) && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {companyGoal && (
              <div className="rounded-xl border-l-4 border-l-blue-500 bg-blue-50 px-5 py-4 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 uppercase tracking-wide">
                  <Building2 className="h-4 w-4" />
                  {year}년 회사 경영목표
                </div>
                <AnnualGoalBody goal={companyGoal} />
              </div>
            )}
            {orgGoal && myDivisionName && (
              <div className="rounded-xl border-l-4 border-l-green-500 bg-green-50 px-5 py-4 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600 uppercase tracking-wide">
                  <LayoutList className="h-4 w-4" />
                  {year}년 {myDivisionName} 목표
                </div>
                <AnnualGoalBody goal={orgGoal} />
              </div>
            )}
          </div>
        )}

        {/* ② 공지사항 위젯 — 통일된 양식 */}
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
              {recentAnnouncements.slice(0, 3).map(a => (
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

        {/* 마일리지 카드 — 회사 목표 바로 다음 (v0.75) */}
        <MileageCard points={myMileage?.points ?? 0} />

        {/* 요약 카드 — 팀 목표 / 완료된 팀 목표 / 승인대기(팀장) / 조직현황 (한 줄, 폭 꽉 채움) */}
        <div className={`grid grid-cols-2 gap-4 ${userProfile?.role === 'TEAM_LEAD' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <SummaryCard
            title="팀 전체목표"
            value={String(teamTotal)}
            sub={`평균 진행률 ${teamAvgProgress}%`}
            icon={<Users className="h-5 w-5 text-indigo-600" />}
            color="bg-indigo-50"
            href="/goals?tab=team"
          />
          <SummaryCard
            title="완료된 팀 목표"
            value={String(teamCompleted)}
            sub="달성한 팀 목표"
            icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
            color="bg-emerald-50"
            href="/goals?tab=team&status=COMPLETED"
          />
          {userProfile?.role === 'TEAM_LEAD' && (
            <Link href="/approvals">
              <Card className={`cursor-pointer hover:shadow-md transition-shadow h-full ${pendingCount > 0 ? 'border-orange-200 bg-orange-50' : ''}`}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className={`text-sm font-medium ${pendingCount > 0 ? 'text-orange-700' : 'text-gray-500'}`}>승인 대기</CardTitle>
                  <div className={`rounded-lg p-2 ${pendingCount > 0 ? 'bg-orange-100' : 'bg-orange-50'}`}>
                    <Clock className={`h-5 w-5 ${pendingCount > 0 ? 'text-orange-600' : 'text-orange-400'}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-3xl font-bold ${pendingCount > 0 ? 'text-orange-700' : 'text-gray-400'}`}>{pendingCount}</div>
                  <p className="text-xs text-gray-500 mt-1">처리 필요</p>
                </CardContent>
              </Card>
            </Link>
          )}
          <button
            onClick={() => setOrgStatusOpen(true)}
            className="text-left rounded-xl border bg-white p-4 hover:shadow-md transition-shadow h-full"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">조직현황</span>
              <div className="rounded-lg p-2 bg-teal-50">
                <Users className="h-5 w-5 text-teal-600" />
              </div>
            </div>
            <div className="text-base font-bold text-gray-900">소속 인원 보기</div>
            <p className="text-xs text-gray-500 mt-1">마일리지·스마트프로젝트·포상</p>
          </button>
        </div>

      </div>
      {orgStatusOpen && <OrgStatusModal onClose={() => setOrgStatusOpen(false)} />}
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
  const [allOrgsCache, setAllOrgsCache] = useState<Organization[]>([]);
  const [orgSummaries, setOrgSummaries] = useState<OrgSummary[]>([]);
  const [myOrgName, setMyOrgName] = useState<string>('');
  const [orgGoalMap, setOrgGoalMap] = useState<Record<string, AnnualGoal>>({});
  const [myDivisionName, setMyDivisionName] = useState<string>('');
  const [myDivisionId, setMyDivisionId] = useState<string>('');
  const [recentAnnouncements, setRecentAnnouncements] = useState<Announcement[]>([]);
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);
  const [execPendingCount, setExecPendingCount] = useState(0);
  const [upcomingMeetings, setUpcomingMeetings] = useState<OneOnOne[]>([]);
  const [orgStatusOpen, setOrgStatusOpen] = useState(false);

  // 조직트리 드릴다운 → 목표 상세 → 뒤로가기 시 스크롤 위치 복원 (펼침 상태는 OrgGoalTree가 sessionStorage로 보존)
  const scrollRef = useRef<HTMLDivElement>(null);
  const SCROLL_KEY = 'execdash:scroll';
  useEffect(() => {
    if (loading) return;
    let saved = 0;
    try { saved = Number(sessionStorage.getItem(SCROLL_KEY) ?? '0'); } catch { /* 무시 */ }
    if (saved > 0 && scrollRef.current) {
      // 트리 펼침 복원 후 레이아웃이 잡힌 다음 프레임에 스크롤 복원
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = saved; });
    }
  }, [loading]);

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [allUsers, allOrgs, allGoals, cGoal, orgGoals, announcements, meetings] = await Promise.all([
            getAllUsers(),
            getOrganizationsForYear(year),
            getAllGoalsByYear(year),
            getAnnualGoal('company', year),
            getAllOrgAnnualGoals(year),
            getAnnouncements(),
            getOneOnOnesForUser(userProfile!.id),
          ]);
          setCompanyGoal(cGoal);
          setRecentAnnouncements(announcements.slice(0, 3));
          setUpcomingMeetings(meetings.slice(0, 3));
          setAllOrgsCache(allOrgs);
          const myOrg = allOrgs.find(o => o.id === userProfile!.organizationId);
          if (myOrg?.name) setMyOrgName(myOrg.name);
          // 부문/공장(DIVISION) 조상 찾기 — 조직 트리를 거슬러 올라감
          let curForDiv = myOrg;
          while (curForDiv && curForDiv.type !== 'DIVISION') {
            curForDiv = curForDiv.parentId ? allOrgs.find(o => o.id === curForDiv!.parentId) : undefined;
          }
          if (curForDiv?.type === 'DIVISION') {
            setMyDivisionId(curForDiv.id);
            setMyDivisionName(curForDiv.name);
          }

          const goMap: Record<string, AnnualGoal> = {};
          orgGoals.forEach(og => { if (og.organizationId) goMap[og.organizationId] = og; });
          setOrgGoalMap(goMap);

          // 임원: 자신이 속한 조직(본부 또는 부문) 산하 / CEO: 전체
          // root = userProfile.organizationId + leaderId 등록된 조직들
          // 본부장(EXECUTIVE): 본부 + 산하 / 부문장(EXECUTIVE): 부문 + 산하
          let scopeOrgIds: string[];
          if (userProfile!.role === 'CEO') {
            scopeOrgIds = allOrgs.map(o => o.id);
          } else if (userProfile!.role === 'EXECUTIVE') {
            const ledRootIds = allOrgs.filter(o => o.leaderId === userProfile!.id).map(o => o.id);
            const rootIdSet = new Set<string>([userProfile!.organizationId, ...ledRootIds]);
            scopeOrgIds = [...new Set(
              [...rootIdSet].flatMap(id => findDescendantIds(id, allOrgs))
            )];
          } else {
            scopeOrgIds = [];
          }

          // 임원 승인대기 카운트: 승인대기함과 동일한 공유 필터 사용
          const pendingGoals = await getPendingGoalsByOrganizations(scopeOrgIds);
          const usersMap = Object.fromEntries(allUsers.map(u => [u.id, u]));
          const execPending = filterMyActionableGoals(
            pendingGoals, allOrgs, usersMap, userProfile!.id, userProfile!.role,
          );
          const execWeightReqs = await getPendingWeightChangeRequestsForApprover(userProfile!.id).catch(() => []);
          setExecPendingCount(execPending.length + execWeightReqs.length);

          const scopeUsers = allUsers.filter(u => scopeOrgIds.includes(u.organizationId));
          const scopeUserIds = new Set(scopeUsers.map(u => u.id));
          // 목표 = owner 또는 공동수행자가 스코프 인원에 포함되면 포함(공동수행자 업무 누락 방지)
          const scopeGoals = allGoals.filter(g =>
            scopeUserIds.has(g.userId) || (g.collaboratorIds ?? []).some(c => scopeUserIds.has(c))
          );

          const usersByOrg: Record<string, User[]> = {};
          for (const u of scopeUsers) {
            if (!usersByOrg[u.organizationId]) usersByOrg[u.organizationId] = [];
            usersByOrg[u.organizationId].push(u);
          }
          // 목표를 owner + 공동수행자 각각에게 배정 (조직 트리 구성원 행에 표시되도록)
          const goalsByUser: Record<string, Goal[]> = {};
          for (const g of scopeGoals) {
            for (const uid of [g.userId, ...(g.collaboratorIds ?? [])]) {
              if (!scopeUserIds.has(uid)) continue;
              (goalsByUser[uid] ??= []).push(g);
            }
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
      <div
        ref={scrollRef}
        onScroll={e => { try { sessionStorage.setItem(SCROLL_KEY, String(e.currentTarget.scrollTop)); } catch { /* 무시 */ } }}
        className="flex-1 overflow-y-auto p-6 space-y-5"
      >

        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">
              안녕하세요, {userProfile?.name ?? ''}님 👋
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {[myOrgName, userProfile?.position].filter(Boolean).join(' · ')}
              {(myOrgName || userProfile?.position) && ' · '}
              {year}년 조직 목표 진행 현황입니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <FontScaleControl />
            <PolicyGuideButton />
          </div>
        </div>

        {/* ① 연간 목표 배너 — 회사 경영목표 + (있다면) 본인 부문/공장 목표 */}
        {(() => {
          const myDivGoal = myDivisionId ? orgGoalMap[myDivisionId] : null;
          if (!companyGoal && !(myDivGoal && myDivisionName)) return null;
          return (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {companyGoal && (
                <div className="rounded-xl border-l-4 border-l-blue-500 bg-blue-50 px-5 py-4 space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 uppercase tracking-wide">
                    <Building2 className="h-4 w-4" /> {year}년 회사 경영목표
                  </div>
                  <AnnualGoalBody goal={companyGoal} />
                </div>
              )}
              {myDivGoal && myDivisionName && (
                <div className="rounded-xl border-l-4 border-l-green-500 bg-green-50 px-5 py-4 space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600 uppercase tracking-wide">
                    <LayoutList className="h-4 w-4" /> {year}년 {myDivisionName} 목표
                  </div>
                  <AnnualGoalBody goal={myDivGoal} />
                </div>
              )}
            </div>
          );
        })()}

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

        {/* 요약 카드: 승인대기 + 조직현황 (2개 — 폭 꽉 채움) — CEO 는 전체 숨김 */}
        {userProfile?.role !== 'CEO' && (
        <div className="grid grid-cols-2 gap-3">
              <Link href="/approvals">
                <div className={`rounded-xl border px-5 py-4 hover:shadow-sm transition-shadow cursor-pointer ${execPendingCount > 0 ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className={`h-4 w-4 ${execPendingCount > 0 ? 'text-orange-500' : 'text-gray-400'}`} />
                    <span className={`text-sm font-semibold ${execPendingCount > 0 ? 'text-orange-700' : 'text-gray-600'}`}>승인 대기</span>
                  </div>
                  <p className={`text-2xl font-bold ${execPendingCount > 0 ? 'text-orange-700' : 'text-gray-400'}`}>
                    {execPendingCount}<span className="text-sm font-normal ml-1">건</span>
                  </p>
                  <p className={`text-xs mt-1 ${execPendingCount > 0 ? 'text-orange-500' : 'text-gray-400'}`}>처리 필요한 목표</p>
                </div>
              </Link>
          <button
            onClick={() => setOrgStatusOpen(true)}
            className="text-left rounded-xl border border-gray-200 bg-white px-5 py-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-teal-500" />
              <span className="text-sm font-semibold text-gray-600">조직현황</span>
            </div>
            <p className="text-base font-bold text-gray-900">소속 인원 보기</p>
            <p className="text-xs text-gray-400 mt-1">마일리지·스마트프로젝트·포상</p>
          </button>
        </div>
        )}

        {/* 조직 상세 — CEO 는 전사 업무추진현황 임베드, 임원은 조직 트리 */}
        {userProfile?.role === 'CEO' ? (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-3">전사 업무추진현황</h2>
            <CompanyProgressBody embedded />
          </div>
        ) : (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-3">담당 조직 상세 현황</h2>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}
              </div>
            ) : (
              <div className="rounded-xl border bg-white p-4 space-y-1">
                {treeNodes.length === 0
                  ? <p className="text-center text-sm text-gray-400 py-8">표시할 데이터가 없습니다.</p>
                  : treeNodes.map(node => <OrgTreeNode key={node.org.id} node={node} orgGoalMap={orgGoalMap} allOrgs={allOrgsCache} />)}
              </div>
            )}
          </div>
        )}
      </div>
      {orgStatusOpen && <OrgStatusModal onClose={() => setOrgStatusOpen(false)} />}
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

/**
 * 연간 목표 표시 — items 가 있으면 항목별 subject(굵게)/detail(작게, 줄바꿈 보존) 렌더링.
 * items 가 없으면 legacy content 를 굵은 한 줄로 표시.
 */
function AnnualGoalBody({ goal }: { goal: AnnualGoal }) {
  const items = goal.items ?? [];
  if (items.length === 0) {
    return <p className="text-lg font-bold text-gray-900 leading-relaxed whitespace-pre-wrap">{goal.content}</p>;
  }
  return (
    <ol className="space-y-2 list-none">
      {items.map((it, idx) => {
        const subject = it.subject ?? it.content ?? '';
        const detail = it.detail ?? '';
        if (!subject && !detail) return null;
        return (
          <li key={it.id} className="flex items-start gap-2">
            {items.length > 1 && (
              <span className="text-xs font-bold text-gray-400 mt-1 shrink-0 w-5">#{idx + 1}</span>
            )}
            <div className="flex-1 space-y-0.5">
              {subject && <p className="text-base font-bold text-gray-900 leading-snug">{subject}</p>}
              {detail && <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
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
