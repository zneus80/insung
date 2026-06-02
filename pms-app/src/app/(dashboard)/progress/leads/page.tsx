'use client';

/**
 * 임원 핵심목표 진행현황 — 팀별 그룹 뷰 (v0.9.1).
 *
 * 구조:
 *   [팀1]  평균 진척도 N% (포기 제외)
 *     팀장: A (n건 — 완료/추진중/포기)
 *       완료 (k): 목표 리스트
 *       추진중 (k): 목표 리스트
 *       포기 (k): 목표 리스트
 *     팀원: B / C / ...
 *
 *   - 모든 카드는 펼친 채로 표시 (접지 않음)
 *   - 포기 목표는 팀 평균 진척도 산정에서 제외
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getAllUsers, getOrganizations, getAllGoalsByYear } from '@/lib/firestore';
import { compareByHireThenName } from '@/lib/user-sort';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Progress } from '@/components/ui/progress';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import { Users, Target, Crown, ChevronUp, ChevronDown } from 'lucide-react';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import type { Goal, User, Organization } from '@/types';

/** 임원 확정된 목표만 — 임시저장·반려·승인대기·승인진행중 등 미확정 상태 제외 */
const CONFIRMED_STATUSES = new Set<Goal['status']>(['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED']);

function filterConfirmed(goals: Goal[]): Goal[] {
  return goals.filter(g => CONFIRMED_STATUSES.has(g.status) && !g.trashedAt && !g.softDeletedAt);
}

/** 포기 제외 + 평균 진척도 */
function avgProgressExcludingAbandoned(goals: Goal[]): number {
  const active = goals.filter(g => g.status !== 'ABANDONED');
  if (!active.length) return 0;
  return Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length);
}

/** 상태별 분류 — 완료/추진중/포기 (확정 목표 한정) */
function bucketize(goals: Goal[]): { completed: Goal[]; inProgress: Goal[]; abandoned: Goal[] } {
  const completed: Goal[] = [];
  const inProgress: Goal[] = [];
  const abandoned: Goal[] = [];
  for (const g of goals) {
    if (g.status === 'COMPLETED') completed.push(g);
    else if (g.status === 'ABANDONED') abandoned.push(g);
    else if (g.status === 'APPROVED' || g.status === 'IN_PROGRESS') inProgress.push(g);
  }
  return { completed, inProgress, abandoned };
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
  const [scopedUsers, setScopedUsers] = useState<User[]>([]);
  const [goalsByUser, setGoalsByUser] = useState<Record<string, Goal[]>>({});
  const [teamOrgs, setTeamOrgs] = useState<Organization[]>([]);
  // 활성 팀 탭 — 뒤로가기 복원 위해 sessionStorage 에 보존
  const ACTIVE_TEAM_KEY = 'progressLeads.activeTeamId';
  const [activeTeamId, setActiveTeamIdRaw] = useState<string>('');
  const setActiveTeamId = (id: string) => {
    setActiveTeamIdRaw(id);
    try { sessionStorage.setItem(ACTIVE_TEAM_KEY, id); } catch { /* 무시 */ }
  };

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        const [allUsers, allOrgs, allGoals] = await Promise.all([
          getAllUsers(), getOrganizations(), getAllGoalsByYear(year),
        ]);
        // 내가 leaderId 인 모든 조직 → 산하 ID 집합 (fallback: home 조직)
        const myLeadOrgs = allOrgs.filter(o => o.leaderId === userProfile!.id);
        const rootIds = myLeadOrgs.length > 0
          ? myLeadOrgs.map(o => o.id)
          : [userProfile!.organizationId];
        const descIds = [...new Set(rootIds.flatMap(id => findDescendantIds(id, allOrgs)))];

        // 산하 사용자
        const usersInScope = allUsers.filter(u => u.isActive && descIds.includes(u.organizationId));
        setScopedUsers(usersInScope);

        // 산하 TEAM 조직만 추출 (팀장/팀원 그룹핑 기준)
        const teams = allOrgs
          .filter(o => o.type === 'TEAM' && descIds.includes(o.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        setTeamOrgs(teams);
        if (teams.length > 0) {
          // 뒤로가기 복원 — 저장된 탭이 유효하면 그 탭, 아니면 첫 팀
          let restored = '';
          try { restored = sessionStorage.getItem(ACTIVE_TEAM_KEY) ?? ''; } catch { /* 무시 */ }
          const valid = restored && teams.some(t => t.id === restored) ? restored : teams[0].id;
          setActiveTeamIdRaw(valid);
        }

        // 사용자별 목표 = owner 본인 + 공동수행자, 임원 확정된 것만 (임시저장·반려·승인대기 제외)
        const COLLAB_VISIBLE = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETED']);
        const gMap: Record<string, Goal[]> = {};
        usersInScope.forEach(u => {
          const own = allGoals.filter(g => g.userId === u.id);
          const collab = allGoals.filter(g =>
            g.userId !== u.id &&
            (g.collaboratorIds ?? []).includes(u.id) &&
            COLLAB_VISIBLE.has(g.status) &&
            !g.trashedAt && !g.softDeletedAt,
          );
          const seen = new Set<string>();
          const merged = [...own, ...collab].filter(g => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
          });
          // 확정된 목표만 (APPROVED/IN_PROGRESS/COMPLETED/ABANDONED)
          gMap[u.id] = filterConfirmed(merged);
        });
        setGoalsByUser(gMap);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userProfile, year]);

  const activeTeam = teamOrgs.find(t => t.id === activeTeamId);
  const teamMembers = activeTeam ? scopedUsers.filter(u => u.organizationId === activeTeam.id) : [];
  const teamLeads = teamMembers.filter(u => u.role === 'TEAM_LEAD').sort(compareByHireThenName);
  const teamMembersOnly = teamMembers.filter(u => u.role === 'MEMBER').sort(compareByHireThenName);
  const allTeamGoals = teamMembers.flatMap(u => goalsByUser[u.id] ?? []);
  const teamAvg = avgProgressExcludingAbandoned(allTeamGoals);
  const teamCounts = bucketize(allTeamGoals);

  return (
    <div className="flex flex-col h-full">
      <Header title="핵심목표 진행현황" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          <p className="text-sm text-gray-500">{year}년 소관 조직 팀별 업무 진행현황 (임원 확정 목표만)</p>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-48 animate-pulse rounded-2xl bg-gray-100" />)}
            </div>
          ) : teamOrgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Target className="mb-3 h-10 w-10" />
              <p className="text-sm">소관 조직에 팀이 없습니다.</p>
            </div>
          ) : (
            <>
              {/* 팀 탭 */}
              <div className="flex flex-wrap gap-1 border-b">
                {teamOrgs.map(team => {
                  const isActive = team.id === activeTeamId;
                  return (
                    <button
                      key={team.id}
                      onClick={() => setActiveTeamId(team.id)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        isActive
                          ? 'border-blue-600 text-blue-700'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {team.name}
                    </button>
                  );
                })}
              </div>

              {activeTeam && (
                <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                  {/* 팀 헤더 — 평균 진척도 */}
                  <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-base font-bold text-gray-900">{activeTeam.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <Users className="inline h-3.5 w-3.5 mr-1" />
                          팀장 {teamLeads.length}명 · 팀원 {teamMembersOnly.length}명
                          {' '}· 완료 <span className="font-medium text-green-700">{teamCounts.completed.length}</span>
                          {' '}/ 추진중 <span className="font-medium text-blue-700">{teamCounts.inProgress.length}</span>
                          {teamCounts.abandoned.length > 0 && (
                            <> / 포기 <span className="font-medium text-gray-600">{teamCounts.abandoned.length}</span> (평균 제외)</>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400">팀 평균 진척도</p>
                        <p className="text-2xl font-bold text-gray-800">{teamAvg}%</p>
                      </div>
                    </div>
                    <Progress value={teamAvg} className="h-2 mt-3" />
                  </div>

                  {/* 팀장 → 팀원 차례로 한 그리드에 배열 (인원 많으면 줄바꿈) */}
                  {teamMembers.length > 0 ? (
                    <div className="p-4 grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                      {[...teamLeads, ...teamMembersOnly].map(user => (
                        <UserCard
                          key={user.id}
                          user={user}
                          goals={goalsByUser[user.id] ?? []}
                          isLead={teamLeads.some(l => l.id === user.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="px-5 py-6 text-xs text-gray-400 text-center">소속 인원이 없습니다.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 사용자 1명 카드 — 완료/추진중 펼침, 포기는 접힘 토글. 팀장은 배지·강조 테두리 */
function UserCard({ user, goals, isLead }: { user: User; goals: Goal[]; isLead?: boolean }) {
  const { completed, inProgress, abandoned } = bucketize(goals);
  const userAvg = avgProgressExcludingAbandoned(goals);
  const [showAbandoned, setShowAbandoned] = useState(false);

  return (
    <div className={`rounded-xl border bg-white p-3 flex flex-col ${isLead ? 'border-amber-300 ring-1 ring-amber-100' : ''}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-1.5 mb-1">
        {isLead && <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
        <MemberInfoModal userId={user.id} userName={user.name} targetRole={user.role} />
        {user.position && <span className="text-xs text-gray-400">{user.position}</span>}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Progress value={userAvg} className="h-1.5 flex-1" />
        <span className="text-xs font-semibold text-gray-600 w-8 text-right">{userAvg}%</span>
      </div>
      <p className="text-[11px] text-gray-500 mb-2">
        전체 {goals.length}건 · 완료 <span className="font-medium text-green-600">{completed.length}</span>
        {' '}/ 추진중 <span className="font-medium text-blue-600">{inProgress.length}</span>
        {' '}/ 포기 <span className="font-medium text-gray-500">{abandoned.length}</span>
      </p>

      {goals.length === 0 ? (
        <p className="text-xs text-gray-400">등록된 목표가 없습니다.</p>
      ) : (
        <div className="space-y-2 flex-1">
          {completed.length > 0 && <GoalGroup label="완료" color="green" goals={completed} />}
          {inProgress.length > 0 && <GoalGroup label="추진중" color="blue" goals={inProgress} />}
          {abandoned.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowAbandoned(v => !v)}
                className="text-[11px] font-semibold inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-500 hover:bg-gray-100"
              >
                포기 {abandoned.length}
                {showAbandoned ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showAbandoned && (
                <div className="mt-1">
                  <GoalGroup label="" color="gray" goals={abandoned} muted hideLabel />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoalGroup({ label, color, goals, muted, hideLabel }: { label: string; color: 'green' | 'blue' | 'gray'; goals: Goal[]; muted?: boolean; hideLabel?: boolean }) {
  const colorMap = {
    green: 'bg-green-50 border-green-200 text-green-700',
    blue:  'bg-blue-50 border-blue-200 text-blue-700',
    gray:  'bg-gray-50 border-gray-200 text-gray-500',
  };
  return (
    <div>
      {!hideLabel && (
        <p className={`text-[11px] font-semibold inline-block px-1.5 py-0.5 rounded ${colorMap[color]} mb-1`}>
          {label} {goals.length}
        </p>
      )}
      <div className="space-y-1">
        {goals.map(goal => (
          <Link key={goal.id} href={`/goals/${goal.id}`}>
            <div className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 hover:shadow-sm hover:border-blue-200 transition-all cursor-pointer ${muted ? 'bg-gray-50' : 'bg-white'}`}>
              <GoalStatusBadge goal={goal} />
              <span className={`text-sm flex-1 truncate ${muted ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{goal.title}</span>
              {!muted && (
                <div className="flex items-center gap-2 min-w-[72px]">
                  <Progress value={goal.progress} className="h-1.5 flex-1" />
                  <span className="text-xs text-gray-500 w-8 text-right">{goal.progress}%</span>
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
