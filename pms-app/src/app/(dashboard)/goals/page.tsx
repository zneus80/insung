'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Target, Trash2, Users, ChevronDown, ChevronRight, Calendar, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getGoalsByUser, getGoalsByOrganization, getGoalsByOrganizations, getOrganizations, getAllUsers, getUser, updateGoal, deleteGoal } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Header from '@/components/layout/Header';
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

  const [myGoals, setMyGoals] = useState<Goal[]>([]);
  const [teamGoals, setTeamGoals] = useState<Goal[]>([]);
  const [teamUsers, setTeamUsers] = useState<Record<string, User>>({});

  const [loading, setLoading] = useState(true);
  const [teamLoading, setTeamLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | undefined>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [previewGoal, setPreviewGoal] = useState<Goal | null>(null);
  const [activeTab, setActiveTab] = useState('my');
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  const year = new Date().getFullYear();

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
      const list = await getGoalsByOrganization(userProfile.organizationId, year);
      // DRAFT 제외, ABANDONED는 포기 승인된 것(approvedBy 있음)만 표시
      const active = list.filter(g => g.status !== 'DRAFT' && (g.status !== 'ABANDONED' || !!g.approvedBy));
      setTeamGoals(active);

      // 팀원 프로필 조회
      const uniqueIds = [...new Set(active.map(g => g.userId))];
      const fetched = await Promise.all(uniqueIds.map(uid => getUser(uid)));
      const map: Record<string, User> = {};
      uniqueIds.forEach((uid, i) => { if (fetched[i]) map[uid] = fetched[i]!; });
      setTeamUsers(map);

      // 첫 번째 멤버 기본 펼침
      if (uniqueIds.length > 0) setExpandedMembers(new Set([uniqueIds[0]]));
    } finally {
      setTeamLoading(false);
    }
  }, [userProfile, year]);

  useEffect(() => { loadMy(); }, [loadMy]);
  useEffect(() => {
    if (activeTab === 'team' && teamGoals.length === 0 && !teamLoading) loadTeam();
  }, [activeTab]);

  // 포기 승인됨(approvedBy 있음)은 목표함에 표시, 직접 삭제한 것만 휴지통
  const myActive = myGoals.filter(g => g.status !== 'ABANDONED' || !!g.approvedBy);
  const trashGoals = myGoals.filter(g => g.status === 'ABANDONED' && !g.approvedBy);

  // 전체 진행률 계산 — 포기됨(ABANDONED) 제외
  const myProgressGoals = myActive.filter(g => g.status !== 'ABANDONED');
  const myAvgProgress = myProgressGoals.length > 0
    ? Math.round(myProgressGoals.reduce((s, g) => s + g.progress, 0) / myProgressGoals.length)
    : 0;
  const teamProgressGoals = teamGoals.filter(g => g.status !== 'ABANDONED');
  const teamAvgProgress = teamProgressGoals.length > 0
    ? Math.round(teamProgressGoals.reduce((s, g) => s + g.progress, 0) / teamProgressGoals.length)
    : 0;

  // 팀 목표를 멤버별로 그룹핑
  const teamByMember = teamGoals.reduce<Record<string, Goal[]>>((acc, g) => {
    (acc[g.userId] ??= []).push(g);
    return acc;
  }, {});

  function toggleMember(uid: string) {
    setExpandedMembers(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  function handleEdit(goal: Goal) { setEditGoal(goal); setFormOpen(true); }
  function handleAdd() { setEditGoal(undefined); setFormOpen(true); }
  function handleSave() { loadMy(); if (activeTab === 'team') loadTeam(); }

  async function handleRestore(goalId: string) {
    if (!confirm('목표를 복구하시겠습니까? 임시저장 상태로 복원됩니다.')) return;
    await updateGoal(goalId, { status: 'DRAFT' });
    setPreviewGoal(null);
    loadMy();
  }

  async function handlePermanentDelete(goalId: string) {
    if (!confirm('목표를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    await deleteGoal(goalId);
    setPreviewGoal(null);
    loadMy();
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="목표관리" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">

          {/* 상단 버튼 */}
          <div className="flex justify-end gap-2">
            {activeTab === 'my' && (
              <Button size="sm" onClick={handleAdd} className="gap-1.5">
                <Plus className="h-4 w-4" /> 목표 추가
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setTrashOpen(true)} className="gap-1.5 text-gray-500">
              <Trash2 className="h-4 w-4" />
              휴지통{trashGoals.length > 0 && ` (${trashGoals.length})`}
            </Button>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="my">내 목표</TabsTrigger>
              <TabsTrigger value="team" className="gap-1.5">
                <Users className="h-3.5 w-3.5" /> 팀 목표
              </TabsTrigger>
            </TabsList>

            {/* ── 내 목표 ── */}
            <TabsContent value="my" className="mt-4 space-y-4">
              {/* 내 전체 진행률 */}
              {!loading && myActive.length > 0 && (
                <div className="rounded-xl border bg-white px-5 py-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-medium">전체 목표 진행률</span>
                    <span className="font-bold text-blue-600">{myAvgProgress}%</span>
                  </div>
                  <Progress value={myAvgProgress} className="h-2" />
                  <p className="text-xs text-gray-400">목표 {myProgressGoals.length}개 평균{myActive.length > myProgressGoals.length ? ` (포기됨 ${myActive.length - myProgressGoals.length}개 제외)` : ''}</p>
                </div>
              )}

              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
                </div>
              ) : myActive.length === 0 ? (
                <EmptyState icon={<Target className="h-10 w-10" />} label="등록된 목표가 없습니다." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {myActive.map(g => <GoalCard key={g.id} goal={g} onEdit={!['COMPLETED', 'ABANDONED'].includes(g.status) ? handleEdit : undefined} />)}
                </div>
              )}
            </TabsContent>

            {/* ── 팀 목표 ── */}
            <TabsContent value="team" className="mt-4 space-y-4">
              {/* 팀 전체 진행률 */}
              {!teamLoading && teamGoals.length > 0 && (
                <div className="rounded-xl border bg-white px-5 py-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-medium">팀 전체 진행률</span>
                    <span className="font-bold text-blue-600">{teamAvgProgress}%</span>
                  </div>
                  <Progress value={teamAvgProgress} className="h-2" />
                  <p className="text-xs text-gray-400">
                    팀원 {Object.keys(teamByMember).length}명 · 목표 {teamProgressGoals.length}개 평균{teamGoals.length > teamProgressGoals.length ? ` (포기됨 ${teamGoals.length - teamProgressGoals.length}개 제외)` : ''}
                  </p>
                </div>
              )}

              {teamLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
                </div>
              ) : Object.keys(teamByMember).length === 0 ? (
                <EmptyState icon={<Users className="h-10 w-10" />} label="팀 목표가 없습니다." />
              ) : (
                <div className="space-y-3">
                  {Object.entries(teamByMember).map(([uid, goals]) => {
                    const user = teamUsers[uid];
                    const isExpanded = expandedMembers.has(uid);
                    const memberAvg = goals.length > 0
                      ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / goals.length)
                      : 0;
                    const completedCount = goals.filter(g =>
                      ['COMPLETED', 'PENDING_COMPLETION', 'APPROVED', 'IN_PROGRESS'].includes(g.status)
                    ).length;

                    return (
                      <div key={uid} className="rounded-xl border bg-white overflow-hidden">
                        {/* 멤버 헤더 — 클릭으로 펼침/닫힘 */}
                        <button
                          onClick={() => toggleMember(uid)}
                          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                              : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                            }
                            <div className="text-left min-w-0">
                              <p className="font-semibold text-gray-900 text-sm">
                                {user?.name ?? uid}
                                <span className="ml-1.5 text-xs font-normal text-gray-400">
                                  {user ? ROLE_LABEL[user.role] ?? user.role : ''}
                                </span>
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                목표 {goals.length}개 · 진행 {completedCount}개
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-4">
                            <div className="w-24 space-y-1 text-right">
                              <span className="text-xs font-bold text-blue-600">{memberAvg}%</span>
                              <Progress value={memberAvg} className="h-1.5" />
                            </div>
                          </div>
                        </button>

                        {/* 펼쳐진 목표 목록 */}
                        {isExpanded && (
                          <div className="border-t px-4 py-4">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {goals.map(g => (
                                <GoalCard
                                  key={g.id}
                                  goal={g}
                                  onEdit={g.userId === userProfile?.id ? handleEdit : undefined}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>

        </div>
      </div>

      <TaskGoalForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        editGoal={editGoal}
      />

      {/* 휴지통 */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-gray-500" /> 휴지통
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-400 mb-3">삭제된 목표가 보관됩니다.</p>
          {trashGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Trash2 className="h-10 w-10 mb-2 opacity-20" />
              <p className="text-sm">휴지통이 비어 있습니다.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {trashGoals.map(g => (
                <GoalCard
                  key={g.id} goal={g}
                  onCardClick={g => setPreviewGoal(g)}
                  onRestore={g => handleRestore(g.id)}
                  onDelete={g => handlePermanentDelete(g.id)}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* 휴지통 목표 미리보기 팝업 */}
      <Dialog open={!!previewGoal} onOpenChange={v => { if (!v) setPreviewGoal(null); }}>
        <DialogContent className="max-w-md">
          {previewGoal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {previewGoal.title}
                  <GoalStatusBadge status={previewGoal.status} />
                </DialogTitle>
              </DialogHeader>
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
              <div className="flex justify-between gap-2 pt-1">
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-red-500 border-red-300 hover:bg-red-50"
                  onClick={() => handlePermanentDelete(previewGoal.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> 영구 삭제
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreviewGoal(null)}>닫기</Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                    onClick={() => handleRestore(previewGoal.id)}
                  >
                    복구
                  </Button>
                </div>
              </div>
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
  const [goals, setGoals] = useState<Goal[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [userMap, setUserMap] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  const year = new Date().getFullYear();
  const isCeo = userProfile?.role === 'CEO';

  useEffect(() => {
    if (!userProfile) return;
    (async () => {
      setLoading(true);
      try {
        const allOrgs = await getOrganizations();
        setOrgs(allOrgs);

        // 조회 대상 조직 결정
        const orgIds = isCeo
          ? allOrgs.map(o => o.id)
          : getDescendantOrgIds(userProfile.organizationId, allOrgs);

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
      <Header title="목표관리" />
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
                                  {user?.name ?? uid}
                                </span>
                                {user?.position && (
                                  <span className="text-xs text-gray-400">{user.position}</span>
                                )}
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
                                    <GoalCard key={g.id} goal={g} ownerName={user?.name} />
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
