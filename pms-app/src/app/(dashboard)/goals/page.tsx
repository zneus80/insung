'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Plus, Target, Trash2, Users, ChevronDown, ChevronRight, Calendar, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getMyScopeOrgIds } from '@/lib/approval-filters';
import { getGoalsByUser, getGoalsByOrganization, getGoalsByOrganizations, getOrganizations, getAllUsers, getUser, updateGoal, deleteGoal, addGoalHistory } from '@/lib/firestore';
import { notifyNextApprover } from '@/lib/goal-notifications';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Header from '@/components/layout/Header';
import YearLockBanner from '@/components/layout/YearLockBanner';
import GoalCard from '@/components/goals/GoalCard';
import GoalStatusBadge from '@/components/goals/GoalStatusBadge';
import TaskGoalForm from '@/components/goals/TaskGoalForm';
import type { Goal, User, Organization } from '@/types';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// 특정 orgId의 모든 하위 조직 ID 반환 (자신 포함)
function getDescendantOrgIds(orgId: string, orgs: Organization[]): string[] {
  const result: string[] = [orgId];
  const children = orgs.filter(o => o.parentId === orgId);
  for (const child of children) result.push(...getDescendantOrgIds(child.id, orgs));
  return result;
}

const ROLE_LABEL: Record<string, string> = {
  MEMBER: '팀원', TEAM_LEAD: '팀장', EXECUTIVE: '임원', CEO: '최고관리자',
};

export default function GoalsPage() {
  const { userProfile } = useAuth();
  if (userProfile?.role === 'EXECUTIVE' || userProfile?.role === 'CEO') {
    return <OrgGoalsView />;
  }
  return <MyGoalsView />;
}

function MyGoalsView() {
  const { userProfile } = useAuth();
  const { activeYear: year, isYearLocked } = useActiveYear();
  const locked = isYearLocked(year);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [myGoals, setMyGoals] = useState<Goal[]>([]);
  const [teamGoals, setTeamGoals] = useState<Goal[]>([]);
  const [teamUsers, setTeamUsers] = useState<Record<string, User>>({});
  const [teamScopeOrgs, setTeamScopeOrgs] = useState<Organization[]>([]);
  const [activeTeamOrgId, setActiveTeamOrgId] = useState<string>(''); // 다중 팀 겸직 시 활성 팀
  const [orgsMap, setOrgsMap] = useState<Record<string, string>>({}); // orgId → 조직명
  const [nameById, setNameById] = useState<Record<string, string>>({}); // userId → 이름 (공동수행자 표시용)
  const [goalKind, setGoalKind] = useState<'joint' | 'solo'>('joint'); // 공동업무 / 단독업무 탭

  const [loading, setLoading] = useState(true);
  const [teamLoading, setTeamLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | undefined>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [previewGoal, setPreviewGoal] = useState<Goal | null>(null);
  const [activeTab, setActiveTab] = useState('my');
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  // 대시보드 등 외부에서 ?new=1 로 진입 시 목표 추가 모달 자동 오픈
  useEffect(() => {
    if (searchParams?.get('new') === '1') {
      setFormOpen(true);
      setEditGoal(undefined);
      // URL 정리 (히스토리에 ?new=1 남기지 않음)
      router.replace('/goals');
    }
  }, [searchParams, router]);

  // 대시보드 카드 → ?tab=team 진입 시 팀 탭 자동 활성화
  useEffect(() => {
    const t = searchParams?.get('tab');
    if (t === 'team' || t === 'my') setActiveTab(t);
  }, [searchParams]);

  // ?status=COMPLETED 진입 시 완료 목표만 필터
  const statusFilter = searchParams?.get('status') ?? null;

  const loadMy = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const list = await getGoalsByUser(userProfile.id, year);
      setMyGoals(list);
    } finally {
      setLoading(false);
    }
  }, [userProfile, year]);

  const loadTeam = useCallback(async () => {
    if (!userProfile) return;
    setTeamLoading(true);
    try {
      // 같은 조직 구성원 전체 조회 (팀장 포함)
      const [orgs, allUsers] = await Promise.all([getOrganizations(), getAllUsers()]);
      setOrgsMap(Object.fromEntries(orgs.map(o => [o.id, o.name])));
      setNameById(Object.fromEntries(allUsers.map(u => [u.id, u.name])));
      const myOrg = orgs.find(o => o.id === userProfile!.organizationId);

      // 다중 팀·본부 겸직 지원 — home org descendants ∪ 본인이 leaderId 인 모든 조직 descendants
      const scopeOrgIds = getMyScopeOrgIds(userProfile!.id, userProfile!.role, userProfile!.organizationId, orgs);
      // 팀 탭으로 분리할 "팀 단위" 조직 — TEAM 타입 또는 leader 인 조직만 (본부 descendants 중 leaf 만)
      // 단순 처리: scope 의 leaf 조직(자식이 scope 에 없는 조직) 들을 탭으로 노출
      const scopeOrgSet = new Set(scopeOrgIds);
      let teamTabs = orgs
        .filter(o => scopeOrgSet.has(o.id))
        .filter(o => !orgs.some(c => c.parentId === o.id && scopeOrgSet.has(c.id))) // leaf
        .slice()
        .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || a.name.localeCompare(b.name, 'ko'));
      // 본인 home 조직이 leaf 탭에 없으면(본부장 등) 맨 앞에 추가 — 본인 목표 표시 누락 방지
      if (!teamTabs.some(o => o.id === userProfile!.organizationId)) {
        const home = orgs.find(o => o.id === userProfile!.organizationId);
        if (home) teamTabs = [home, ...teamTabs];
      }
      setTeamScopeOrgs(teamTabs);
      if (teamTabs.length > 0 && !teamTabs.some(o => o.id === activeTeamOrgId)) {
        setActiveTeamOrgId(teamTabs[0].id);
      }

      // 스코프 내 모든 멤버
      const teamMemberIds = new Set(
        allUsers
          .filter(u => scopeOrgIds.includes(u.organizationId) && u.id !== userProfile!.id)
          .map(u => u.id)
      );
      if (myOrg?.leaderId && myOrg.leaderId !== userProfile!.id) {
        teamMemberIds.add(myOrg.leaderId);
      }

      // 스코프 내 모든 조직의 목표 + 팀장 userId 기반 목표 병렬 조회 (org 이동 누락 대비)
      const leaderId = myOrg?.leaderId;
      const [list, leadGoals] = await Promise.all([
        getGoalsByOrganizations(scopeOrgIds, year),
        leaderId && leaderId !== userProfile!.id
          ? getGoalsByUser(leaderId, year)
          : Promise.resolve([] as Goal[]),
      ]);

      // 중복 제거 (팀장이 같은 org에 있으면 list에도 포함될 수 있음)
      const seenIds = new Set<string>();
      const combined: Goal[] = [];
      for (const g of [...list, ...leadGoals]) {
        if (!seenIds.has(g.id)) { seenIds.add(g.id); combined.push(g); }
      }
      // 핵심목표관리 팀 목표 탭 — 결재 진행 중 + 진행 중 + 완료 모두 표시
      // 신규 상신·승인 진행 중 목표도 산하 팀에 보이도록 PENDING_APPROVAL / LEAD_APPROVED / PENDING_MODIFY 포함
      // 숨김: 포기(ABANDONED) · 반려(REJECTED) · 임시저장(DRAFT) · 휴지통(trashedAt)
      const VISIBLE_STATUSES = new Set<string>([
        'PENDING_APPROVAL', 'LEAD_APPROVED', 'PENDING_MODIFY',
        'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_ABANDON',
      ]);
      const active = combined.filter(g => {
        if (!VISIBLE_STATUSES.has(g.status) || g.trashedAt) return false;
        // 본인이 owner 인 목표는 "내 목표" 탭에서 별도 처리 — 팀 탭에서는 제외
        if (g.userId === userProfile!.id) return false;
        // owner 또는 공동 수행자 중 한 명이라도 스코프 내 인원이면 표시
        if (teamMemberIds.has(g.userId)) return true;
        if ((g.collaboratorIds ?? []).some(id => teamMemberIds.has(id))) return true;
        // relatedOrgIds 가 스코프와 교차 (단, 본인 owner 는 위에서 이미 제외)
        if ((g.relatedOrgIds ?? []).some(orgId => scopeOrgIds.includes(orgId))) return true;
        return false;
      });
      setTeamGoals(active);

      // 팀원 프로필 조회 (본인 포함 — 통합 팀 뷰)
      const uniqueIds = [...new Set(active.map(g => g.userId))];
      const map: Record<string, User> = {};
      uniqueIds.forEach(uid => {
        const u = allUsers.find(u => u.id === uid);
        if (u) map[uid] = u;
      });
      const selfUser = allUsers.find(u => u.id === userProfile!.id);
      if (selfUser) map[selfUser.id] = selfUser;
      setTeamUsers(map);

      // 기본 펼침 — 본인 + 산하 팀원 전체(접힘으로 인한 '목표 안 보임' 방지)
      setExpandedMembers(new Set([userProfile!.id, ...uniqueIds]));
    } finally {
      setTeamLoading(false);
    }
  }, [userProfile, year]);

  useEffect(() => { loadMy(); }, [loadMy]);
  useEffect(() => { loadTeam(); }, [loadTeam]);

  // 소프트 삭제된 목표는 본인 화면(휴지통 포함)에서 완전히 숨김 (평가 페이지에서는 계속 표시)
  const visibleMyGoals = myGoals.filter(g => !g.softDeletedAt);
  // 휴지통: 본인이 trashedAt 설정한 목표 (또는 구버전 호환: ABANDONED && !approvedBy && !leadApprovedBy)
  const trashGoals = visibleMyGoals.filter(g =>
    !!g.trashedAt || (g.status === 'ABANDONED' && !g.approvedBy && !g.leadApprovedBy)
  );
  const trashIds = new Set(trashGoals.map(g => g.id));
  // 내 목표함: 휴지통에 없는 항목 (포기 확정 ABANDONED+approvedBy 는 인사평가용으로 계속 표시)
  const myActiveAll = visibleMyGoals.filter(g => !trashIds.has(g.id));
  const myActive = statusFilter === 'COMPLETED'
    ? myActiveAll.filter(g => g.status === 'COMPLETED')
    : myActiveAll;

  // 전체 진행률 계산 — 포기됨(ABANDONED) 제외
  const myProgressGoals = myActive.filter(g => g.status !== 'ABANDONED');
  const myAvgProgress = myProgressGoals.length > 0
    ? Math.round(myProgressGoals.reduce((s, g) => s + g.progress, 0) / myProgressGoals.length)
    : 0;
  const teamProgressGoals = teamGoals.filter(g => g.status !== 'ABANDONED');
  const teamAvgProgress = teamProgressGoals.length > 0
    ? Math.round(teamProgressGoals.reduce((s, g) => s + g.progress, 0) / teamProgressGoals.length)
    : 0;

  // 팀 목표를 멤버별로 그룹핑 (status 필터 반영)
  const teamGoalsFiltered = statusFilter === 'COMPLETED'
    ? teamGoals.filter(g => g.status === 'COMPLETED')
    : teamGoals;
  const teamByMember = teamGoalsFiltered.reduce<Record<string, Goal[]>>((acc, g) => {
    (acc[g.userId] ??= []).push(g);
    return acc;
  }, {});
  // 통합 뷰: 본인 목표(초안·반려 등 전체 상태)를 본인 팀 그룹에 포함
  if (userProfile && myActive.length > 0) {
    teamByMember[userProfile.id] = myActive;
  }

  // 공동업무 참가자 이름(수행자+공동수행자, 구분 없이 차례대로)
  function participantNamesOf(g: Goal): string[] {
    const ids = [g.userId, ...(g.collaboratorIds ?? [])];
    const seen = new Set<string>();
    return ids
      .filter(id => id && !seen.has(id) && (seen.add(id), true))
      .map(id => nameById[id] ?? (id === userProfile?.id ? (userProfile?.name ?? '') : ''))
      .filter(Boolean);
  }

  function toggleMember(uid: string) {
    setExpandedMembers(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  function handleEdit(goal: Goal) { setEditGoal(goal); setFormOpen(true); }
  function handleAdd() { setEditGoal(undefined); setFormOpen(true); }
  function handleSave() { loadMy(); loadTeam(); }

  async function handleTrash(goal: Goal) {
    if (locked) { toast.error(`${year}년은 확정된 연도입니다.`); return; }
    const isFinalAbandoned = goal.status === 'ABANDONED' && !!goal.approvedBy;
    const message = isFinalAbandoned
      ? '포기 확정된 목표를 휴지통으로 이동합니다.\n\n' +
        '※ 인사평가 기록 보존을 위해 복구는 불가능하며 영구 삭제만 가능합니다.\n' +
        '※ 팀장·임원 화면에는 인사평가 자료로 계속 표시됩니다.\n\n계속하시겠습니까?'
      : '이 목표를 휴지통으로 이동하시겠습니까?\n(팀장·임원 화면에는 인사평가 자료로 계속 표시됩니다)';
    if (!confirm(message)) return;
    try {
      // 상태는 그대로 유지 (포기 확정·반려 정보 보존 — 인사평가용)
      await updateGoal(goal.id, { trashedAt: new Date() });
      toast.success('휴지통으로 이동했습니다.');
      loadMy();
    } catch { toast.error('오류가 발생했습니다.'); }
  }

  async function handleWithdraw(goal: Goal) {
    if (!confirm('승인 요청을 회수하시겠습니까? 임시저장 상태로 돌아갑니다.')) return;
    try {
      await updateGoal(goal.id, { status: 'DRAFT' });
      if (userProfile) {
        await addGoalHistory({ goalId: goal.id, changedBy: userProfile.id, changeType: 'STATUS_CHANGED', previousStatus: 'PENDING_APPROVAL', newStatus: 'DRAFT', comment: '승인 요청 회수' });
      }
      toast.success('승인 요청을 회수했습니다.');
      loadMy();
    } catch { toast.error('오류가 발생했습니다.'); }
  }

  async function handleResubmit(goal: Goal) {
    if (!confirm('승인 요청을 다시 제출하시겠습니까?')) return;
    try {
      await updateGoal(goal.id, { status: 'PENDING_APPROVAL' });
      if (userProfile) {
        await addGoalHistory({ goalId: goal.id, changedBy: userProfile.id, changeType: 'STATUS_CHANGED', previousStatus: 'REJECTED', newStatus: 'PENDING_APPROVAL', comment: '재상신' });
        try {
          const [orgs, allUsers] = await Promise.all([getOrganizations(), getAllUsers()]);
          await notifyNextApprover({
            goal: { ...goal, status: 'PENDING_APPROVAL' },
            allOrgs: orgs,
            allUsers,
            fromUserId: userProfile.id,
            fromUserName: userProfile.name,
            action: 'SUBMIT',
          });
        } catch (err) { console.error('[알림] 재상신 알림 발송 실패:', err); }
      }
      toast.success('승인 요청을 제출했습니다.');
      loadMy();
    } catch { toast.error('오류가 발생했습니다.'); }
  }

  async function handleRestore(goalId: string) {
    if (locked) { toast.error(`${year}년은 확정된 연도입니다. 복구할 수 없습니다.`); return; }
    const target = myGoals.find(g => g.id === goalId);
    // 포기 확정 목표는 인사평가 기록 보존을 위해 복구 불가 (영구 삭제만 가능)
    // 단, 조직 변경에 의한 자동 이관(autoAbandonedByOrgChange) 은 본인 의사가 아니므로 복구 가능
    if (target?.status === 'ABANDONED' && !!target.approvedBy && !target.autoAbandonedByOrgChange) {
      toast.error('포기 확정된 목표는 인사평가 기록 보존을 위해 복구할 수 없습니다.');
      return;
    }
    if (!confirm('목표를 복구하시겠습니까? 임시저장 상태로 복원됩니다.')) return;
    try {
      // trashedAt 해제(null 저장) + 상태를 DRAFT 로 복원
      // 자동 이관(autoAbandonedByOrgChange) 목표는 approvedBy/At 도 함께 초기화
      const update: any = {
        status: 'DRAFT',
        trashedAt: null,
      };
      if (target?.autoAbandonedByOrgChange) {
        update.approvedBy = null;
        update.approvedAt = null;
        update.autoAbandonedByOrgChange = false;
      }
      await updateGoal(goalId, update);
      if (userProfile) {
        await addGoalHistory({
          goalId, changedBy: userProfile.id,
          changeType: 'STATUS_CHANGED',
          previousStatus: target?.status ?? 'ABANDONED', newStatus: 'DRAFT',
          comment: '휴지통에서 복구',
        });
      }
      toast.success('임시저장 상태로 복구되었습니다.');
      setPreviewGoal(null);
      loadMy();
    } catch {
      toast.error('복구 중 오류가 발생했습니다.');
    }
  }

  async function handlePermanentDelete(goalId: string) {
    if (locked) { toast.error(`${year}년은 확정된 연도입니다. 삭제할 수 없습니다.`); return; }
    const target = myGoals.find(g => g.id === goalId);
    const isFinalAbandoned = target?.status === 'ABANDONED' && !!target.approvedBy;
    const message = isFinalAbandoned
      ? '본인 화면에서 완전히 제거합니다.\n\n' +
        '※ 인사평가 자료는 보존되어 팀장·임원의 평가 화면에는 계속 표시됩니다.\n\n계속하시겠습니까?'
      : '목표를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.';
    if (!confirm(message)) return;
    try {
      if (isFinalAbandoned) {
        // 포기 확정 목표는 소프트 삭제(인사평가 기록 보존)
        await updateGoal(goalId, { softDeletedAt: new Date() });
        toast.success('본인 화면에서 제거되었습니다. (평가 자료는 보존됩니다)');
      } else {
        // 임시저장·반려 목표는 Firestore에서 완전 삭제
        await deleteGoal(goalId);
        toast.success('목표가 영구 삭제되었습니다.');
      }
      setPreviewGoal(null);
      loadMy();
    } catch {
      toast.error('삭제 중 오류가 발생했습니다.');
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="핵심목표관리" showBack />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">

          <YearLockBanner />

          {/* 액션 버튼 (내목표/팀목표 통합 — 팀명 탭으로 구분) */}
          <div className="flex items-center justify-end gap-2">
            {!locked && (
              <Button size="sm" onClick={handleAdd} className="gap-1.5">
                <Plus className="h-4 w-4" /> 목표 추가
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setTrashOpen(true)} className="gap-1.5 text-gray-500">
              <Trash2 className="h-4 w-4" />
              휴지통{trashGoals.length > 0 && ` (${trashGoals.length})`}
            </Button>
          </div>

            {/* 상태 필터 표시 */}
            {statusFilter === 'COMPLETED' && (
              <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm">
                <span className="text-purple-700 font-medium">완료된 목표만 표시 중</span>
                <button
                  onClick={() => router.replace('/goals')}
                  className="text-purple-700 hover:underline"
                >
                  전체 보기
                </button>
              </div>
            )}

            {/* ── 핵심목표 (산하 팀 탭 → 공동/단독 하위 탭) ── */}
            <div className="mt-4 space-y-4">
              {/* 상단: 산하 팀 탭 — 2개 이상 팀을 겸직하는 팀장만 노출 */}
              {teamScopeOrgs.length >= 2 && (
                <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
                  {teamScopeOrgs.map(o => (
                    <button key={o.id} onClick={() => setActiveTeamOrgId(o.id)}
                      className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
                        activeTeamOrgId === o.id
                          ? 'border-blue-600 text-blue-700'
                          : 'border-transparent text-gray-500 hover:text-gray-700')}>
                      {o.name}
                    </button>
                  ))}
                </div>
              )}

              {/* 하위: 공동업무 / 단독업무 탭 */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                {([['joint', '공동업무'], ['solo', '단독업무']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setGoalKind(k)}
                    className={cn('px-5 py-1.5 rounded-md text-sm font-medium transition-colors',
                      goalKind === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}>
                    {label}
                  </button>
                ))}
              </div>

              {/* 산하 팀 + 공동/단독 필터링 (공동 = collaboratorIds 있음) */}
              {(() => {
                const showTeamTabs = teamScopeOrgs.length >= 2;
                // 산하 팀 탭 필터 — 목표의 소속 조직(organizationId) 또는 연관 조직(공동업무)이 해당 팀일 때만.
                // ※ 수행자 home 조직(ownerOrg) 기준 필터는 사용하지 않음 — 겸직 인원의 타 팀 목표가
                //    home 팀 탭에 중복으로 끌려오는 문제 방지.
                const teamFilter = (g: Goal) => {
                  if (!showTeamTabs || !activeTeamOrgId) return true;
                  return g.organizationId === activeTeamOrgId
                    || (g.relatedOrgIds ?? []).includes(activeTeamOrgId);
                };
                const matchKind = (g: Goal) => goalKind === 'joint'
                  ? (g.collaboratorIds?.length ?? 0) > 0
                  : (g.collaboratorIds?.length ?? 0) === 0;
                // 사람(멤버) 그룹핑 없이 평면 카드 그리드 — 카드의 수행자/공동수행자 이름으로 구분.
                const allGoals = Object.values(teamByMember).flat();
                // 동일 목표 중복 제거(본인 목표가 teamByMember 와 myActive 양쪽에 들어갈 수 있음)
                const seen = new Set<string>();
                const filteredTeamGoals = allGoals
                  .filter(g => !seen.has(g.id) && (seen.add(g.id), true))
                  .filter(g => teamFilter(g) && matchKind(g))
                  .sort((a, b) => {
                    // 본인 목표 우선, 이후 수행자명 가나다순
                    const am = a.userId === userProfile?.id ? 0 : 1;
                    const bm = b.userId === userProfile?.id ? 0 : 1;
                    if (am !== bm) return am - bm;
                    const an = teamUsers[a.userId]?.name ?? '';
                    const bn = teamUsers[b.userId]?.name ?? '';
                    return an.localeCompare(bn, 'ko');
                  });
                const filteredProgressGoals = filteredTeamGoals.filter(g => g.status !== 'ABANDONED');
                const filteredAvgProgress = filteredProgressGoals.length > 0
                  ? Math.round(filteredProgressGoals.reduce((s, g) => s + g.progress, 0) / filteredProgressGoals.length)
                  : 0;
                const memberCount = new Set(filteredTeamGoals.map(g => g.userId)).size;
                return (
                  <>
                    {/* 전체 진행률 */}
                    {!teamLoading && filteredTeamGoals.length > 0 && (
                      <div className="rounded-xl border bg-white px-5 py-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500 font-medium">{goalKind === 'joint' ? '공동업무' : '단독업무'} 진행률</span>
                          <span className="font-bold text-blue-600">{filteredAvgProgress}%</span>
                        </div>
                        <Progress value={filteredAvgProgress} className="h-2" />
                        <p className="text-xs text-gray-400">
                          {memberCount}명 · 목표 {filteredProgressGoals.length}개 평균{filteredTeamGoals.length > filteredProgressGoals.length ? ` (포기됨 ${filteredTeamGoals.length - filteredProgressGoals.length}개 제외)` : ''}
                        </p>
                      </div>
                    )}

              {teamLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
                </div>
              ) : filteredTeamGoals.length === 0 ? (
                <EmptyState icon={<Target className="h-10 w-10" />} label={`${goalKind === 'joint' ? '공동업무' : '단독업무'} 목표가 없습니다.`} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTeamGoals.map(g => {
                    const isMine = g.userId === userProfile?.id && !locked;
                    const names = participantNamesOf(g);
                    const canTrash = isMine && (g.status === 'DRAFT' || g.status === 'REJECTED' || (g.status === 'ABANDONED' && !!g.approvedBy));
                    return (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        ownerName={teamUsers[g.userId]?.name ?? (g.userId === userProfile?.id ? userProfile?.name : undefined)}
                        participantNames={names.length > 1 ? names : undefined}
                        onEdit={isMine && ['DRAFT', 'REJECTED', 'APPROVED', 'IN_PROGRESS'].includes(g.status) ? handleEdit : undefined}
                        onTrash={canTrash ? handleTrash : undefined}
                        onWithdraw={isMine && g.status === 'PENDING_APPROVAL' ? handleWithdraw : undefined}
                        onResubmit={isMine && g.status === 'REJECTED' ? handleResubmit : undefined}
                      />
                    );
                  })}
                </div>
              )}
                  </>
                );
              })()}
            </div>

        </div>
      </div>

      <TaskGoalForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        editGoal={editGoal}
        {...(teamScopeOrgs.length >= 2 && activeTeamOrgId && activeTeamOrgId !== userProfile?.organizationId
          ? { targetOrgId: activeTeamOrgId, targetOrgName: orgsMap[activeTeamOrgId] }
          : {})}
      />

      {/* 휴지통 */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-gray-500" /> 휴지통
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-400 mb-3">삭제된 목표를 클릭하면 복구 또는 영구 삭제할 수 있습니다.</p>
          {trashGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Trash2 className="h-10 w-10 mb-2 opacity-20" />
              <p className="text-sm">휴지통이 비어 있습니다.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {trashGoals.map(g => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  ownerName={g.userId === userProfile?.id ? userProfile?.name : (teamUsers[g.userId]?.name ?? undefined)}
                  onClick={() => { setTrashOpen(false); setPreviewGoal(g); }}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* 휴지통 목표 미리보기 팝업 — 복구 / 영구 삭제 */}
      <Dialog open={!!previewGoal} onOpenChange={v => {
        if (!v) {
          setPreviewGoal(null);
          // 모달 닫힐 때 휴지통 다시 열기 (사용자가 다른 항목 처리할 수 있도록)
          if (trashGoals.length > 0) setTrashOpen(true);
        }
      }}>
        <DialogContent className="max-w-md">
          {previewGoal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <Trash2 className="h-4 w-4 text-gray-400" />
                  {previewGoal.title}
                  <GoalStatusBadge goal={previewGoal} />
                </DialogTitle>
              </DialogHeader>
              {(() => {
                const isAutoAbandoned = !!previewGoal.autoAbandonedByOrgChange;
                const isFinalAbandoned = previewGoal.status === 'ABANDONED' && !!previewGoal.approvedBy && !isAutoAbandoned;
                return (
                  <>
                    <p className="text-xs text-gray-400">
                      {isFinalAbandoned
                        ? '포기 확정된 목표는 복구할 수 없습니다. 영구 삭제 시에도 인사평가 자료로 팀장·임원 화면에는 계속 표시됩니다.'
                        : isAutoAbandoned
                          ? '조직 변경으로 자동 이관된 목표입니다. 본인 의사가 아니므로 복구 가능합니다.'
                          : '휴지통에 보관된 목표입니다. 복구하면 임시저장 상태로 돌아가고, 영구 삭제는 되돌릴 수 없습니다.'}
                    </p>
                    <div className="space-y-3 py-1">
                      {previewGoal.description && (
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{previewGoal.description}</p>
                      )}
                      <div className="flex items-center gap-1.5 text-sm text-gray-400">
                        <Calendar className="h-3.5 w-3.5" />
                        추진기한: {format(previewGoal.dueDate, 'yyyy년 MM월 dd일', { locale: ko })}
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm text-gray-500">
                          <span>진행률</span>
                          <span className="font-medium">{previewGoal.progress}%</span>
                        </div>
                        <Progress value={previewGoal.progress} className="h-1.5" />
                      </div>
                    </div>
                    <div className="flex justify-between gap-2 pt-2 border-t mt-2">
                      <Button
                        size="sm" variant="outline"
                        className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
                        onClick={() => handlePermanentDelete(previewGoal.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> 영구 삭제
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPreviewGoal(null)}>닫기</Button>
                        {!isFinalAbandoned && (
                          <Button
                            size="sm"
                            className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                            onClick={() => handleRestore(previewGoal.id)}
                          >
                            복구
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 임원 / CEO 전용 전체 목표 뷰 ─────────────────────────────
function OrgGoalsView() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [userMap, setUserMap] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  const isCeo = userProfile?.role === 'CEO';

  useEffect(() => {
    if (!userProfile) return;
    (async () => {
      setLoading(true);
      try {
        const allOrgs = await getOrganizations();
        setOrgs(allOrgs);

        // 조회 대상 조직 결정
        // EXECUTIVE: 소속 조직 체인에서 DIVISION까지 올라가 하위 전체 포함
        let orgIds: string[];
        if (isCeo) {
          orgIds = allOrgs.map(o => o.id);
        } else if (userProfile.role === 'EXECUTIVE') {
          // 임원 소속 조직 체인을 위로 올라가며 DIVISION 탐색
          const execAncestors: Organization[] = [];
          let cur = allOrgs.find(o => o.id === userProfile.organizationId);
          while (cur) {
            execAncestors.push(cur);
            cur = cur.parentId ? allOrgs.find(o => o.id === cur!.parentId) : undefined;
          }
          const divOrg = execAncestors.find(o => o.type === 'DIVISION');
          const rootId = divOrg?.id ?? userProfile.organizationId;
          orgIds = getDescendantOrgIds(rootId, allOrgs);
        } else {
          orgIds = getDescendantOrgIds(userProfile.organizationId, allOrgs);
        }

        const allGoals = await getGoalsByOrganizations(orgIds, year);
        // DRAFT, 직접삭제(ABANDONED without approvedBy) 제외
        const visible = allGoals.filter(
          g => g.status !== 'DRAFT' && (g.status !== 'ABANDONED' || !!g.approvedBy)
        );
        setGoals(visible);

        // 사용자 정보 로드
        const allUsers = await getAllUsers();
        setUserMap(Object.fromEntries(allUsers.map(u => [u.id, u])));

        // 첫 번째 조직 펼치기
        const topOrgs = isCeo
          ? allOrgs.filter(o => !o.parentId)
          : allOrgs.filter(o => getDescendantOrgIds(userProfile.organizationId, allOrgs).includes(o.id) && o.id !== userProfile.organizationId || o.id === userProfile.organizationId);
        if (topOrgs.length > 0) setExpandedOrgs(new Set([topOrgs[0].id]));
      } finally {
        setLoading(false);
      }
    })();
  }, [userProfile]);

  // 조직별 목표 그룹핑
  const goalsByOrg = goals.reduce<Record<string, Goal[]>>((acc, g) => {
    (acc[g.organizationId] ??= []).push(g);
    return acc;
  }, {});

  // 진행률 계산 대상 (ABANDONED 제외)
  const progressGoals = goals.filter(g => g.status !== 'ABANDONED');
  const avgProgress = progressGoals.length > 0
    ? Math.round(progressGoals.reduce((s, g) => s + g.progress, 0) / progressGoals.length)
    : 0;

  // 표시할 조직 목록 (목표 있는 것만, 정렬)
  const orgIdsWithGoals = Object.keys(goalsByOrg);
  const visibleOrgs = orgs.filter(o => orgIdsWithGoals.includes(o.id));

  function toggleOrg(id: string) {
    setExpandedOrgs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleMember(key: string) {
    setExpandedMembers(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="핵심목표관리" showBack />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* 전체 진행률 */}
        {!loading && progressGoals.length > 0 && (
          <div className="rounded-xl border bg-white px-5 py-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-medium">
                {isCeo ? '전사 목표 진행률' : '부문 목표 진행률'}
              </span>
              <span className="font-bold text-blue-600">{avgProgress}%</span>
            </div>
            <Progress value={avgProgress} className="h-2" />
            <p className="text-xs text-gray-400">
              목표 {progressGoals.length}개 평균
              {goals.length > progressGoals.length ? ` (포기됨 ${goals.length - progressGoals.length}개 제외)` : ''}
            </p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : visibleOrgs.length === 0 ? (
          <EmptyState icon={<Target className="h-10 w-10" />} label="등록된 목표가 없습니다." />
        ) : (
          <div className="space-y-3">
            {visibleOrgs.map(org => {
              const orgGoals = goalsByOrg[org.id] ?? [];
              const isOrgExpanded = expandedOrgs.has(org.id);
              const orgProgressGoals = orgGoals.filter(g => g.status !== 'ABANDONED');
              const orgAvg = orgProgressGoals.length > 0
                ? Math.round(orgProgressGoals.reduce((s, g) => s + g.progress, 0) / orgProgressGoals.length)
                : 0;

              // 조직 내 멤버별 그룹핑
              const byMember = orgGoals.reduce<Record<string, Goal[]>>((acc, g) => {
                (acc[g.userId] ??= []).push(g);
                return acc;
              }, {});

              return (
                <div key={org.id} className="rounded-xl border bg-white overflow-hidden">
                  {/* 조직 헤더 */}
                  <button
                    onClick={() => toggleOrg(org.id)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isOrgExpanded
                        ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                      }
                      <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                      <div className="text-left min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">{org.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          팀원 {Object.keys(byMember).length}명 · 목표 {orgGoals.length}개
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <div className="w-24 space-y-1 text-right">
                        <span className="text-xs font-bold text-blue-600">{orgAvg}%</span>
                        <Progress value={orgAvg} className="h-1.5" />
                      </div>
                    </div>
                  </button>

                  {/* 조직 내 멤버별 목표 */}
                  {isOrgExpanded && (
                    <div className="border-t divide-y">
                      {Object.entries(byMember).map(([uid, memberGoals]) => {
                        const user = userMap[uid];
                        const memberKey = `${org.id}-${uid}`;
                        const isMemberExpanded = expandedMembers.has(memberKey);
                        const memberProgressGoals = memberGoals.filter(g => g.status !== 'ABANDONED');
                        const memberAvg = memberProgressGoals.length > 0
                          ? Math.round(memberProgressGoals.reduce((s, g) => s + g.progress, 0) / memberProgressGoals.length)
                          : 0;

                        return (
                          <div key={uid}>
                            <button
                              onClick={() => toggleMember(memberKey)}
                              className="w-full flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isMemberExpanded
                                  ? <ChevronDown className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                                }
                                <span className="text-sm font-medium text-gray-700">
                                  {user ? <MemberInfoModal userId={user.id} userName={user.name} /> : uid}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {[user ? orgs.find(o => o.id === user.organizationId)?.name : '', user?.position]
                                    .filter(Boolean).join(' · ')}
                                </span>
                                <span className="text-xs text-gray-400 ml-1">
                                  목표 {memberGoals.length}개
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs font-bold text-blue-600">{memberAvg}%</span>
                              </div>
                            </button>
                            {isMemberExpanded && (
                              <div className="px-6 pb-4">
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                  {memberGoals.map(g => (
                                    <GoalCard key={g.id} goal={g} ownerName={userMap[g.userId]?.name} />
                                  ))}
                                </div>
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
