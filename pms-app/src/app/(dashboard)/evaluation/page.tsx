'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getActiveCycle,
  getGoalsByUser,
  getGoalsByOrganizations,
  getSelfEvaluation,
  getSelfEvaluationsByUsers,
  getMentoringFormsByUsers,
  upsertSelfEvaluation,
  getIndividualEvaluation,
  upsertIndividualEvaluation,
  getIndividualEvaluationsByOrg,
  getAllUsers,
  getOrganizations,
  getAllDivisionGradeQuotas,
  getWeeklyTasksByUsersAndYear,
  listInnovationActivities,
} from '@/lib/firestore';
import { notifyEvalReviewer } from '@/lib/eval-notifications';
import { approverTitle } from '@/lib/approval-filters';
import { compareUserByRoleHire } from '@/lib/user-sort';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import Header from '@/components/layout/Header';
import MentoringFormModal from '@/components/evaluation/MentoringFormModal';
import SelfEvalGoalList, { EVAL_RETURN_KEY } from '@/components/evaluation/SelfEvalGoalList';
import InnovationList from '@/components/evaluation/InnovationList';
import WeeklyTasksGrid from '@/components/evaluation/WeeklyTasksGrid';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, ChevronRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  EvaluationCycle, Goal, SelfEvaluation, IndividualEvaluation,
  EvaluationGrade, User, Organization, DivisionGradeQuota, MentoringForm, WeeklyTask,
  InnovationActivity,
} from '@/types';

// ─ TeamLeadEvalView는 /evaluation/team/page.tsx 로 분리됨 ─

const GRADES: EvaluationGrade[] = ['A', 'B', 'C', 'D', 'E'];

const GRADE_COLOR: Record<EvaluationGrade, string> = {
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-green-100 text-green-700',
  C: 'bg-gray-100 text-gray-700',
  D: 'bg-orange-100 text-orange-700',
  E: 'bg-red-100 text-red-600',
};

const GOAL_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DRAFT:            { label: '초안',       color: 'bg-gray-100 text-gray-500' },
  PENDING_APPROVAL: { label: '승인 요청',  color: 'bg-yellow-100 text-yellow-700' },
  LEAD_APPROVED:    { label: '1차 승인',   color: 'bg-blue-100 text-blue-600' },
  APPROVED:         { label: '승인됨',     color: 'bg-blue-100 text-blue-700' },
  REJECTED:         { label: '반려',       color: 'bg-red-100 text-red-600' },
  IN_PROGRESS:      { label: '진행 중',    color: 'bg-indigo-100 text-indigo-700' },
  COMPLETED:        { label: '완료',       color: 'bg-green-100 text-green-700' },
  PENDING_ABANDON:  { label: '포기 요청',  color: 'bg-orange-100 text-orange-600' },
  ABANDONED:        { label: '포기됨',     color: 'bg-gray-100 text-gray-400' },
};

function getDescendantOrgIds(orgId: string, orgs: Organization[]): string[] {
  const result: string[] = [orgId];
  for (const child of orgs.filter(o => o.parentId === orgId)) {
    result.push(...getDescendantOrgIds(child.id, orgs));
  }
  return result;
}

function LoadingSpinner() {
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  );
}

// ─── 라우터 ───────────────────────────────────────────────
export default function EvaluationPage() {
  const { userProfile, effectiveEvalRole } = useAuth();

  if (!userProfile) return null;
  const { role } = userProfile;
  // 자기평가는 본인이 평가 대상이면 모두(팀원·팀장·본부장·차순위임원) 진입 가능
  // → MEMBER / TEAM_LEAD / HQ_HEAD / EXEC_SUB
  if (
    role === 'MEMBER' ||
    role === 'TEAM_LEAD' ||
    effectiveEvalRole === 'HQ_HEAD' ||
    effectiveEvalRole === 'EXEC_SUB'
  ) return <MemberEvalView />;
  // 평가등급확정은 EXEC_TOP(최상위 임원) 만 — 차순위 임원·본부장은 인사평가로 이동
  if (effectiveEvalRole === 'EXEC_TOP') return <ExecutiveEvalView />;
  return (
    <div className="flex flex-col h-full">
      <Header title="평가 관리" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">접근 권한이 없습니다.</p>
      </div>
    </div>
  );
}

// ─── 팀원: 자기평가 ──────────────────────────────────────
function MemberEvalView() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();

  const [cycle, setCycle]               = useState<EvaluationCycle | null>(null);
  const [completedGoals, setCompleted]  = useState<Goal[]>([]);
  const [selfEval, setSelfEval]         = useState<SelfEvaluation | null>(null);
  const [myEval, setMyEval]             = useState<IndividualEvaluation | null>(null);
  const [goalEvals, setGoalEvals]       = useState<Record<string, { comment: string }>>({});
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [orgChainHasHQ, setOrgChainHasHQ] = useState(false); // 본부장 단계 포함 여부
  const [editMode, setEditMode] = useState(false);            // SUBMITTED 상태에서 수정 모드

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [cyc, goals, se, ie, allOrgs] = await Promise.all([
        getActiveCycle(year),  // v0.76: 활성 연도를 명시 — 안내문이 activeYear 와 어긋나지 않도록
        getGoalsByUser(userProfile.id, year),
        getSelfEvaluation(userProfile.id, year),
        getIndividualEvaluation(userProfile.id, year),
        getOrganizations(),
      ]);
      setEditMode(false); // 재로드 시 수정 모드 해제
      setCycle(cyc);
      const done = goals.filter(g => g.status === 'COMPLETED');
      setCompleted(done);
      setSelfEval(se);
      setMyEval(ie);
      // 본부장 단계 포함 여부 — 본인 조직에서 부모 체인 따라가며 HEADQUARTERS 가 있고
      // 그 본부의 위에 DIVISION 도 존재할 때만 본부장 단계가 의미 있음
      let cur = allOrgs.find(o => o.id === userProfile.organizationId);
      let hasHQ = false;
      let hasDiv = false;
      while (cur) {
        if (cur.type === 'HEADQUARTERS') hasHQ = true;
        if (cur.type === 'DIVISION') hasDiv = true;
        cur = cur.parentId ? allOrgs.find(o => o.id === cur!.parentId) : undefined;
      }
      setOrgChainHasHQ(hasHQ && hasDiv);

      if (se?.goalEvals?.length) {
        const map: Record<string, { comment: string }> = {};
        se.goalEvals.forEach(ge => {
          // 구버전(good/regret) 데이터를 종합 의견으로 합치기
          const legacy = [
            ge.good ? `[잘된 점]\n${ge.good}` : '',
            ge.regret ? `[아쉬운 점]\n${ge.regret}` : '',
          ].filter(Boolean).join('\n\n');
          map[ge.goalId] = { comment: ge.comment || legacy || '' };
        });
        setGoalEvals(map);
      } else {
        const map: Record<string, { comment: string }> = {};
        done.forEach(g => { map[g.id] = { comment: '' }; });
        setGoalEvals(map);
      }
    } catch (e: any) {
      console.error('평가 화면 로드 실패:', e);
      toast.error('평가 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally { setLoading(false); }
  }

  // userProfile 또는 activeYear(year) 변경 시 재로드 — 연도 전환에 즉시 반응
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userProfile, year]);

  const now = new Date();
  const isInEvalPeriod = cycle
    ? (now >= cycle.evalStartDate && now <= cycle.evalEndDate)
    : false;
  const isSubmitted = selfEval?.status === 'SUBMITTED';
  // 상위 권한자가 검토를 시작했는지 — LEAD_REVIEWED 이상이면 수정 불가
  const upperReviewStarted = !!myEval && myEval.status !== 'NOT_STARTED' && myEval.status !== 'SELF_SUBMITTED';
  // 회수/수정 가능: SUBMITTED 인데 상위 단계 미진행
  const canEditSubmitted = isSubmitted && !upperReviewStarted;

  async function handleSave() {
    if (!userProfile) return;
    setSaving(true);
    try {
      await upsertSelfEvaluation(userProfile.id, year, {
        goalEvals: completedGoals.map(g => ({
          goalId: g.id, goalTitle: g.title,
          comment: goalEvals[g.id]?.comment ?? '',
        })),
        status: 'DRAFT',
      });
      toast.success('임시 저장되었습니다.');
      await load();
    } finally { setSaving(false); }
  }

  async function handleSubmit() {
    if (!userProfile) return;
    setSaving(true);
    try {
      await upsertSelfEvaluation(userProfile.id, year, {
        goalEvals: completedGoals.map(g => ({
          goalId: g.id, goalTitle: g.title,
          comment: goalEvals[g.id]?.comment ?? '',
        })),
        status: 'SUBMITTED',
        submittedAt: new Date(),
      });
      await upsertIndividualEvaluation(userProfile.id, year, {
        organizationId: userProfile.organizationId,
        status: 'SELF_SUBMITTED',
      });

      // 상위 검토자(팀장/본부장/임원) 에게 알림 — subject 의 role 에 따라 stage 결정
      try {
        const [allOrgs, allUsers] = await Promise.all([getOrganizations(), getAllUsers()]);
        const stage = userProfile.role === 'MEMBER' ? 'LEAD'
                    : userProfile.role === 'TEAM_LEAD' ? 'HQ'   // 팀장 → 본부장(없으면 EXEC 폴백)
                    : 'EXEC';                                    // 본부장 등 → 임원
        const subject = allUsers.find(u => u.id === userProfile.id) ?? userProfile;
        const res = await notifyEvalReviewer({
          subject,
          fromUserId: userProfile.id,
          fromUserName: userProfile.name,
          stage,
          type: 'SELF_EVAL_SUBMITTED',
          category: 'EVALUATION',
          title: `${userProfile.name}님 자기평가 제출`,
          message: `${userProfile.name}님이 ${year}년 자기평가를 제출했습니다. 검토 후 의견을 작성해주세요.`,
          link: '/evaluation/team',
          allOrgs,
          allUsers,
        });
        // HQ 스테이지에 본부장이 없으면 EXEC 로 한 번 더 시도
        if (!res.notified && stage === 'HQ') {
          await notifyEvalReviewer({
            subject, fromUserId: userProfile.id, fromUserName: userProfile.name,
            stage: 'EXEC',
            type: 'SELF_EVAL_SUBMITTED',
            category: 'EVALUATION',
            title: `${userProfile.name}님 자기평가 제출`,
            message: `${userProfile.name}님이 ${year}년 자기평가를 제출했습니다.`,
            link: '/evaluation',
            allOrgs, allUsers,
          });
        }
      } catch (err) {
        console.error('[자기평가 알림] 실패:', err);
      }

      toast.success('자기평가를 제출했습니다.');
      await load();
    } finally { setSaving(false); }
  }

  // 제출 회수 — 상위 단계 미진행 시에만 가능
  async function handleWithdraw() {
    if (!userProfile) return;
    if (!confirm('제출한 자기평가를 회수하고 수정 가능 상태로 전환합니다. 계속하시겠습니까?')) return;
    setSaving(true);
    try {
      await upsertSelfEvaluation(userProfile.id, year, {
        goalEvals: completedGoals.map(g => ({
          goalId: g.id, goalTitle: g.title,
          comment: goalEvals[g.id]?.comment ?? '',
        })),
        status: 'DRAFT',
      });
      await upsertIndividualEvaluation(userProfile.id, year, {
        organizationId: userProfile.organizationId,
        status: 'NOT_STARTED',
      });
      toast.success('자기평가를 회수했습니다. 다시 수정 후 제출할 수 있습니다.');
      await load();
    } catch (err) {
      console.error('[자기평가 회수] 실패:', err);
      toast.error('회수에 실패했습니다.');
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="내 업무 성과 평가" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* 평가 기간 배너 */}
        {cycle && (
          <div className={`rounded-xl border px-5 py-3.5 flex items-center gap-4 ${
            isInEvalPeriod ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="flex-1">
              <p className={`text-xs font-semibold ${isInEvalPeriod ? 'text-blue-600' : 'text-gray-500'}`}>
                {year}년 성과 평가 기간
              </p>
              <p className="text-sm text-gray-700 mt-0.5">
                {cycle.evalStartDate.toLocaleDateString('ko-KR')} ~ {cycle.evalEndDate.toLocaleDateString('ko-KR')}
                {isInEvalPeriod && <span className="ml-2 font-semibold text-blue-600">진행 중</span>}
              </p>
            </div>
            {isSubmitted && (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 rounded-full px-3 py-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 제출 완료
                </span>
                {canEditSubmitted && (
                  <Button variant="outline" size="sm" onClick={handleWithdraw} disabled={saving}>
                    회수 후 수정
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 현재 처리 상태 — 사용자 역할·조직 체인에 따라 단계 동적 구성 */}
        {myEval && myEval.status !== 'NOT_STARTED' && (() => {
          // 팀장 본인의 자기평가는 팀장 검토(LEAD_REVIEWED) 단계 불필요
          // 본부장이 있는 조직(본부+부문 모두 존재)이면 HQ_REVIEWED 단계 추가
          const isSelfTeamLead = userProfile?.role === 'TEAM_LEAD';
          // 본부장(임원 role + HQ 산하)이 본인 자기평가 작성 — 별도 분기 (HQ_REVIEWED 도 불필요)
          // 일단 임원 role 은 MemberEvalView 진입 안 함이라 여기서는 신경 X
          type StageKey = 'SELF_SUBMITTED' | 'LEAD_REVIEWED' | 'HQ_REVIEWED' | 'EXEC_CONFIRMED' | 'PUBLISHED';
          const stages: { key: StageKey; label: string }[] = [{ key: 'SELF_SUBMITTED', label: '자기평가 제출' }];
          if (!isSelfTeamLead) stages.push({ key: 'LEAD_REVIEWED', label: '팀장 검토 완료' });
          if (orgChainHasHQ) stages.push({ key: 'HQ_REVIEWED', label: '본부장 검토 완료' });
          stages.push({ key: 'EXEC_CONFIRMED', label: '임원 등급 확정' });
          stages.push({ key: 'PUBLISHED', label: '결과 공개' });

          // 현재 상태가 어디까지 진행됐는지 판정
          // SELF_SUBMITTED < LEAD_REVIEWED < HQ_REVIEWED < EXEC_CONFIRMED < PUBLISHED 의 자연 순서 따름
          const rank: Record<string, number> = {
            NOT_STARTED: -1,
            SELF_SUBMITTED: 0,
            LEAD_REVIEWED: 1,
            HQ_REVIEWED: 2,
            EXEC_CONFIRMED: 3,
            PUBLISHED: 4,
          };
          const currentRank = rank[myEval.status] ?? -1;

          return (
          <div className="rounded-xl border bg-white px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">평가 진행 상태</p>
            <div className="flex items-center gap-2 flex-wrap">
              {stages.map((s, i) => {
                const isDone = currentRank >= rank[s.key];
                return (
                  <span key={s.key} className={`rounded-full px-3 py-1 text-xs font-medium ${
                    isDone ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {i + 1}. {s.label}
                  </span>
                );
              })}
            </div>
            {myEval.status === 'PUBLISHED' && myEval.execGrade && (
              <div className="mt-3 flex items-center gap-3">
                <span className="text-sm text-gray-600">최종 등급</span>
                <span className={`rounded-full px-4 py-1.5 text-xl font-bold ${GRADE_COLOR[myEval.execGrade]}`}>
                  {myEval.execGrade}
                </span>
                {myEval.execComment && (
                  <p className="text-sm text-gray-500">{myEval.execComment}</p>
                )}
              </div>
            )}
          </div>
          );
        })()}

        {/* 평가 기간 아님 */}
        {!isInEvalPeriod && !isSubmitted && (
          <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
            <Clock className="h-8 w-8 mx-auto text-gray-300" />
            <p className="text-gray-500 font-medium">아직 평가 기간이 아닙니다.</p>
            {cycle && (
              <p className="text-sm text-gray-400">
                {cycle.evalStartDate.toLocaleDateString('ko-KR')}부터 성과를 입력할 수 있습니다.
              </p>
            )}
            {!cycle && (
              <p className="text-sm text-gray-400">HR 관리자에게 평가 사이클 설정을 요청해주세요.</p>
            )}
          </div>
        )}

        {/* 제출 완료: 읽기 전용 */}
        {isSubmitted && selfEval && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">제출한 성과 내용</h3>
              {canEditSubmitted && (
                <p className="text-xs text-blue-600">상위 검토 전이라 회수 후 수정이 가능합니다.</p>
              )}
              {!canEditSubmitted && upperReviewStarted && (
                <p className="text-xs text-gray-400">상위 검토가 시작되어 수정할 수 없습니다.</p>
              )}
            </div>
            {selfEval.goalEvals.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">완료된 목표가 없었습니다.</p>
            ) : (
              selfEval.goalEvals.map(ge => {
                // 구버전(잘된 점/아쉬운 점) 데이터는 합쳐서 표시
                const legacyCombined = [
                  ge.good ? `[잘된 점]\n${ge.good}` : '',
                  ge.regret ? `[아쉬운 점]\n${ge.regret}` : '',
                ].filter(Boolean).join('\n\n');
                const displayText = ge.comment || legacyCombined || '—';
                return (
                  <div key={ge.goalId} className="rounded-xl border bg-white p-5 space-y-3">
                    <p className="font-medium text-gray-900">{ge.goalTitle}</p>
                    <div>
                      <p className="text-xs font-semibold text-blue-600 mb-1.5">종합 의견</p>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{displayText}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 평가 입력 폼 */}
        {(isInEvalPeriod || !cycle) && !isSubmitted && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900">완료된 업무 성과 입력</h3>
              <p className="text-xs text-gray-500 mt-0.5">완료된 목표별로 종합 의견을 작성하고 제출하세요.</p>
            </div>

            {loading ? <LoadingSpinner /> : completedGoals.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <AlertCircle className="h-7 w-7 mx-auto text-gray-300 mb-2" />
                <p className="text-gray-400">완료된 목표가 없습니다.</p>
                <p className="text-xs text-gray-400 mt-1">진행 중인 목표를 완료 처리 후 성과를 입력할 수 있습니다.</p>
              </div>
            ) : (
              completedGoals.map(goal => (
                <div key={goal.id} className="rounded-xl border bg-white p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{goal.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        기한: {goal.dueDate.toLocaleDateString('ko-KR')} · 진행률: {goal.progress}%
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">완료</span>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-blue-600 block mb-1.5">종합 의견</label>
                    <textarea
                      value={goalEvals[goal.id]?.comment ?? ''}
                      onChange={e => setGoalEvals(p => ({ ...p, [goal.id]: { ...p[goal.id], comment: e.target.value } }))}
                      rows={4}
                      placeholder="이 업무에서의 종합 의견(잘된 점·아쉬운 점·개선 방향 등)을 자유롭게 작성해주세요"
                      className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))
            )}

            {!loading && completedGoals.length > 0 && (
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={handleSave} disabled={saving}>임시 저장</Button>
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? '제출 중...' : '제출'}
                </Button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── 임원: 최종 등급 확정 ────────────────────────────────
function ExecutiveEvalView() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();

  const [allOrgs, setAllOrgs]         = useState<Organization[]>([]);
  const [members, setMembers]         = useState<User[]>([]);
  const [selfEvals, setSelfEvals]     = useState<Record<string, SelfEvaluation>>({});
  const [indivEvals, setIndivEvals]   = useState<Record<string, IndividualEvaluation>>({});
  const [mentoringForms, setMentoringForms] = useState<Record<string, MentoringForm>>({});
  const [goalsByMember, setGoalsByMember] = useState<Record<string, Goal[]>>({});
  const [weeklyTasksByMember, setWeeklyTasksByMember] = useState<Record<string, WeeklyTask[]>>({});
  const [innovationsByMember, setInnovationsByMember] = useState<Record<string, InnovationActivity[]>>({});
  const [quotas, setQuotas]           = useState<DivisionGradeQuota | null>(null);
  const [confirmInputs, setConfirm]   = useState<Record<string, { grade: EvaluationGrade | ''; comment: string }>>({});
  const [expanded, setExpanded]       = useState<Record<string, boolean>>({});
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState<string | null>(null);
  const [execUsersCache, setExecUsersCache] = useState<User[]>([]); // 공동수행자 이름 조회용
  const [activeOrgTab, setActiveOrgTab] = useState<string>('');     // 팀별 탭 활성 orgId

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [orgs, allUsers, allQuotas] = await Promise.all([
        getOrganizations(),
        getAllUsers().then(us => { setExecUsersCache(us); return us; }),
        getAllDivisionGradeQuotas(year),
      ]);
      setAllOrgs(orgs);

      // 내가 leaderId 인 조직 중 DIVISION 또는 (상위에 DIVISION 없는) HQ 만 — 최상위 임원 영역으로 한정
      // (CLAUDE.md §2 임원 권한 케이스: 차순위 임원/본부장은 이 화면 진입 자체가 차단되어야 함)
      function isTopLevelLeaderOrg(o: Organization): boolean {
        if (o.type === 'DIVISION') return true;
        if (o.type === 'HEADQUARTERS') {
          // 상위 체인에 DIVISION 없으면 최상위 HQ
          let cur = o.parentId ? orgs.find(p => p.id === o.parentId) : null;
          while (cur) {
            if (cur.type === 'DIVISION') return false;
            cur = cur.parentId ? orgs.find(p => p.id === cur!.parentId) : null;
          }
          return true;
        }
        return false;
      }
      const myLeadOrgs = orgs.filter(o => o.leaderId === userProfile.id && isTopLevelLeaderOrg(o));
      const rootIds = myLeadOrgs.length > 0
        ? myLeadOrgs.map(o => o.id)
        : [userProfile.organizationId]; // fallback: leaderId 미설정 환경
      const descIds = [...new Set(rootIds.flatMap(id => getDescendantOrgIds(id, orgs)))];

      const active = allUsers.filter(u => (u.role === 'MEMBER' || u.role === 'TEAM_LEAD') && u.isActive && descIds.includes(u.organizationId));
      active.sort(compareUserByRoleHire); // 팀장 → 팀원, 동일 역할 입사일순
      setMembers(active);

      const evalResults = await Promise.all(
        descIds.map(oid => getIndividualEvaluationsByOrg(oid, year))
      );
      const ieMap: Record<string, IndividualEvaluation> = {};
      evalResults.flat().forEach(ie => { ieMap[ie.userId] = ie; });

      // 데이터 힐링: 조직 기준 쿼리에 잡히지 않은 IE 직접 조회 (과거 organizationId 누락 버그 영향)
      const missingMembers = active.filter(m => !ieMap[m.id]);
      if (missingMembers.length > 0) {
        const orphans = await Promise.all(missingMembers.map(m => getIndividualEvaluation(m.id, year)));
        orphans.forEach((ie, i) => {
          if (!ie) return;
          const m = missingMembers[i];
          ieMap[ie.userId] = { ...ie, organizationId: ie.organizationId ?? m.organizationId };
          // 백그라운드 보강 (UI 차단 안 함)
          if (!ie.organizationId) {
            upsertIndividualEvaluation(ie.userId, year, { organizationId: m.organizationId })
              .catch(err => console.error('[데이터 힐링] IE organizationId 보강 실패:', err));
          }
        });
      }
      setIndivEvals(ieMap);

      const [seList, mfList, weeklyTasks, allGoals, innovations] = await Promise.all([
        getSelfEvaluationsByUsers(active.map(m => m.id), year),
        getMentoringFormsByUsers(active.map(m => m.id), year),
        getWeeklyTasksByUsersAndYear(active.map(m => m.id), year),
        getGoalsByOrganizations(descIds, year),
        listInnovationActivities(year),
      ]);

      // 혁신활동 — 멤버별 참여 매핑 (PM/멤버/수행/지시)
      const innovMap: Record<string, InnovationActivity[]> = {};
      active.forEach(m => { innovMap[m.id] = []; });
      innovations.forEach(a => {
        const involved = new Set<string>([
          ...getPmIds(a),
          ...(a.memberIds ?? []),
          ...getPerformerIds(a),
          ...(a.instructorId ? [a.instructorId] : []),
        ]);
        involved.forEach(uid => { if (innovMap[uid]) innovMap[uid].push(a); });
      });
      setInnovationsByMember(innovMap);

      const gbMap: Record<string, Goal[]> = {};
      active.forEach(m => { gbMap[m.id] = []; });
      allGoals.forEach(g => {
        if (gbMap[g.userId]) gbMap[g.userId].push(g);
      });
      setGoalsByMember(gbMap);

      const seMap: Record<string, SelfEvaluation> = {};
      seList.forEach(se => { seMap[se.userId] = se; });
      setSelfEvals(seMap);

      const mfMap: Record<string, MentoringForm> = {};
      mfList.forEach(mf => { mfMap[mf.userId] = mf; });
      setMentoringForms(mfMap);

      const wtMap: Record<string, WeeklyTask[]> = {};
      active.forEach(m => { wtMap[m.id] = []; });
      weeklyTasks.forEach(wt => {
        if (!wtMap[wt.userId]) wtMap[wt.userId] = [];
        wtMap[wt.userId].push(wt);
      });
      setWeeklyTasksByMember(wtMap);

      // 내 담당 조직 쿼터 (CONFIRMED 된 것만, 복수 조직 중 첫 번째)
      const myQuota = allQuotas.find(q =>
        rootIds.includes(q.organizationId) && q.status === 'CONFIRMED'
      );
      setQuotas(myQuota ?? null);

      const cinMap: Record<string, { grade: EvaluationGrade | ''; comment: string }> = {};
      active.forEach(m => {
        const ie = ieMap[m.id];
        cinMap[m.id] = { grade: ie?.execGrade ?? '', comment: ie?.execComment ?? '' };
      });
      setConfirm(cinMap);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userProfile, year]);

  // 목표 상세 → 뒤로 가기로 돌아왔을 때 — 해당 멤버 행 자동 펼침
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(EVAL_RETURN_KEY);
      if (!raw) return;
      const st = JSON.parse(raw) as { memberId?: string };
      if (st.memberId) setExpanded(p => ({ ...p, [st.memberId!]: true }));
    } catch { /* 무시 */ }
  }, []);

  function getUsed(grade: EvaluationGrade): number {
    return Object.values(indivEvals).filter(ie =>
      members.some(m => m.id === ie.userId) && ie.execGrade === grade
    ).length;
  }

  function getQuotaCount(grade: EvaluationGrade): number {
    if (!quotas) return 999;
    return quotas[`quota${grade}` as keyof DivisionGradeQuota] as number ?? 0;
  }

  function getRemaining(grade: EvaluationGrade): number {
    return getQuotaCount(grade) - getUsed(grade);
  }

  async function handleConfirm(memberId: string) {
    if (!userProfile) return;
    const input = confirmInputs[memberId];
    if (!input?.grade) { toast.error('등급을 선택해주세요.'); return; }

    setSaving(memberId);
    try {
      const member = members.find(m => m.id === memberId);
      // organizationId 누락 시 후속 getIndividualEvaluationsByOrg 쿼리에 잡히지 않아 "확정 표시" 안 되는 버그 방지.
      // 새 문서 생성 경로(팀장 의견 단계 없이 임원이 바로 확정) 에서 반드시 필요.
      const orgId = member?.organizationId ?? userProfile.organizationId;
      await upsertIndividualEvaluation(memberId, year, {
        organizationId: orgId,
        execGrade: input.grade as EvaluationGrade,
        execComment: input.comment,
        execConfirmedBy: userProfile.id,
        execConfirmedAt: new Date(),
        status: 'EXEC_CONFIRMED',
      });
      toast.success(`${member?.name ?? ''} 등급을 확정했습니다.`);
      await load();
    } catch (err) {
      console.error('[등급확정] 실패:', err);
      toast.error('등급 확정에 실패했습니다.');
    } finally { setSaving(null); }
  }

  const membersByOrg = members.reduce<Record<string, User[]>>((acc, m) => {
    if (!acc[m.organizationId]) acc[m.organizationId] = [];
    acc[m.organizationId].push(m);
    return acc;
  }, {});

  const orgNameMap = Object.fromEntries(allOrgs.map(o => [o.id, o.name]));

  // 팀 탭 목록 — displayOrder 정렬, 멤버 있는 조직만
  const orgTabs = allOrgs
    .filter(o => membersByOrg[o.id] && membersByOrg[o.id].length > 0)
    .slice()
    .sort((a, b) => {
      const ao = a.displayOrder ?? 999;
      const bo = b.displayOrder ?? 999;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, 'ko');
    });

  // activeOrgTab 초기값 — 첫 번째 탭
  if (!activeOrgTab && orgTabs.length > 0) {
    setActiveOrgTab(orgTabs[0].id);
  }
  // 활성 탭이 더 이상 유효하지 않으면 첫 탭으로
  if (activeOrgTab && orgTabs.length > 0 && !orgTabs.some(o => o.id === activeOrgTab)) {
    setActiveOrgTab(orgTabs[0].id);
  }

  // 탭별 평가 완료 진척도
  function tabProgress(orgId: string): { confirmed: number; total: number } {
    const list = membersByOrg[orgId] ?? [];
    let confirmed = 0;
    for (const m of list) {
      const ie = indivEvals[m.id];
      if (ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED') confirmed++;
    }
    return { confirmed, total: list.length };
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="평가 등급 확정" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* 쿼터 현황 */}
        {quotas ? (
          <div className="rounded-xl border bg-white px-5 py-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500">
              {year}년 부문 등급 쿼터 (조직 {quotas.orgGrade}등급 · 총 {quotas.totalMembers}명)
            </p>
            <div className="flex gap-3 flex-wrap">
              {GRADES.map(g => {
                const quota = getQuotaCount(g);
                const used = getUsed(g);
                const remaining = quota - used;
                return (
                  <div key={g} className={`rounded-lg border px-4 py-2.5 text-center min-w-[80px] ${
                    remaining <= 0 && quota > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'
                  }`}>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold mb-1 ${GRADE_COLOR[g]}`}>{g}</span>
                    <p className="text-lg font-bold text-gray-900">{quota}<span className="text-xs font-normal text-gray-400">명</span></p>
                    <p className="text-xs text-gray-400">잔여 <span className={remaining <= 0 && quota > 0 ? 'text-red-500 font-medium' : 'text-gray-600'}>{remaining}</span></p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-5 py-3.5 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-orange-400 shrink-0" />
            <p className="text-sm text-orange-700">HR 관리자가 등급 쿼터를 확정한 후 개인 등급을 부여할 수 있습니다.</p>
          </div>
        )}

        {/* 팀원 목록 — 팀별 탭 (F1) */}
        {loading ? <LoadingSpinner /> : members.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-gray-400">산하 팀원이 없습니다.</div>
        ) : (
          <>
            {/* 팀 탭 바 */}
            <div className="flex gap-1 border-b bg-white px-1 pt-1 shrink-0 overflow-x-auto">
              {orgTabs.map(o => {
                const { confirmed, total } = tabProgress(o.id);
                const isActive = activeOrgTab === o.id;
                const allDone = total > 0 && confirmed === total;
                return (
                  <button
                    key={o.id}
                    onClick={() => setActiveOrgTab(o.id)}
                    className={cn(
                      'px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors whitespace-nowrap',
                      isActive
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {o.name}
                    <span className={cn(
                      'ml-1.5 text-xs',
                      allDone ? 'text-green-600' : isActive ? 'text-blue-500' : 'text-gray-400',
                    )}>
                      {confirmed}/{total}
                    </span>
                  </button>
                );
              })}
            </div>
            {(() => {
              const orgMembers = membersByOrg[activeOrgTab] ?? [];
              return (
            <div className="space-y-2 pt-3">
              {orgMembers.map(member => {
                const ie = indivEvals[member.id];
                const se = selfEvals[member.id];
                const isConfirmed = ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED';
                const input = confirmInputs[member.id] ?? { grade: '', comment: '' };
                const isOpen = expanded[member.id] ?? false;

                return (
                  <div key={member.id} className="rounded-xl border bg-white overflow-hidden">
                    {/* 헤더 */}
                    <button
                      className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
                      onClick={() => setExpanded(p => ({ ...p, [member.id]: !isOpen }))}
                    >
                      <div className="flex items-center gap-3">
                        <div>
                          <MemberInfoModal userId={member.id} userName={member.name} targetRole={member.role} />
                          <p className="text-xs text-gray-400">
                            {member.role === 'TEAM_LEAD' ? '팀장' : '팀원'} {member.position && `· ${member.position}`}
                          </p>
                        </div>
                        {ie?.leadGrade && (
                          <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${GRADE_COLOR[ie.leadGrade]}`}>
                            팀장 {ie.leadGrade}
                          </span>
                        )}
                        {ie?.hqGrade && (
                          <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${GRADE_COLOR[ie.hqGrade]}`}>
                            본부 {ie.hqGrade}
                          </span>
                        )}
                        {!ie?.leadGrade && !ie?.hqGrade && (
                          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5">의견 없음</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {isConfirmed && ie.execGrade && (
                          <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${GRADE_COLOR[ie.execGrade]}`}>
                            확정 {ie.execGrade}
                          </span>
                        )}
                        {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </button>

                    {/* 펼친 내용 */}
                    {isOpen && (
                      <div className="border-t px-5 py-5 space-y-5">
                        {/* 자기평가 : 핵심업무 — 완료 + 포기 요청/확정 */}
                        {(() => {
                          const memberGoals = goalsByMember[member.id] ?? [];
                          const evalGoals = memberGoals.filter(g => (
                            g.status === 'COMPLETED' ||
                            g.status === 'PENDING_ABANDON' ||
                            (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange)
                          ));
                          return (
                            <div>
                              <p className="text-sm font-bold text-gray-800 mb-2">자기평가 : 핵심업무 (팀원 작성)</p>
                              <SelfEvalGoalList
                                memberId={member.id}
                                goals={evalGoals}
                                goalEvals={se?.goalEvals ?? []}
                                usersById={Object.fromEntries(execUsersCache.map(u => [u.id, u]))}
                              />
                            </div>
                          );
                        })()}

                        {/* 주간업무보고 내역 — 52주 카드 그리드 */}
                        <div>
                          <p className="text-sm font-bold text-gray-800 mb-2">주간업무보고 내역 ({year}년)</p>
                          <WeeklyTasksGrid tasks={weeklyTasksByMember[member.id] ?? []} year={year} />
                        </div>

                        {/* 혁신활동 실적 ({year}년) */}
                        {(innovationsByMember[member.id]?.length ?? 0) > 0 && (
                          <div>
                            <p className="text-sm font-bold text-gray-800 mb-2">
                              혁신활동 실적 ({year}년) · {innovationsByMember[member.id].length}건
                            </p>
                            <InnovationList items={innovationsByMember[member.id]} memberId={member.id} revealConfidential />
                          </div>
                        )}

                        {/* 육성면담서 */}
                        {mentoringForms[member.id] && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm font-bold text-gray-800">육성면담서 (팀원 작성)</p>
                              <MentoringFormModal
                                form={mentoringForms[member.id]}
                                memberName={member.name}
                                leadOpinion={ie?.leadComment}
                              />
                            </div>
                            <div className="rounded-lg border bg-gray-50 p-4 space-y-2 text-sm text-gray-600">
                              {mentoringForms[member.id].jobRequest !== 'SATISFIED' && (
                                <div>
                                  <span className="text-xs font-semibold text-gray-500">직무 요청: </span>
                                  {{
                                    EXPAND: '직무 확대',
                                    REDUCE: '직무 축소',
                                    CHANGE: '직무 변경',
                                    RELOCATE: '근무지 이동',
                                    SATISFIED: '만족',
                                  }[mentoringForms[member.id].jobRequest]}
                                  {mentoringForms[member.id].jobRequestReason && ` — ${mentoringForms[member.id].jobRequestReason}`}
                                </div>
                              )}
                              {mentoringForms[member.id].careerPlan && (
                                <div>
                                  <span className="text-xs font-semibold text-gray-500">경력개발 방향: </span>
                                  {mentoringForms[member.id].careerPlan}
                                </div>
                              )}
                              {mentoringForms[member.id].selfOpinion && (
                                <div>
                                  <span className="text-xs font-semibold text-gray-500">본인 종합의견: </span>
                                  {mentoringForms[member.id].selfOpinion}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 팀장 의견 — 작성자 직책으로 라벨 */}
                        {ie?.leadGrade && (
                          <div className="rounded-lg bg-gray-50 px-4 py-3">
                            <p className="text-sm font-bold text-gray-800 mb-1.5">{approverTitle(ie.leadSubmittedBy, execUsersCache, '팀장')} 의견 (1차)</p>
                            <div className="flex items-start gap-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold shrink-0 ${GRADE_COLOR[ie.leadGrade]}`}>{ie.leadGrade}</span>
                              {ie.leadComment && <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{ie.leadComment}</p>}
                            </div>
                          </div>
                        )}

                        {/* 본부장 의견 (2차) — 작성자 직책으로 라벨 */}
                        {ie?.hqGrade && (
                          <div className="rounded-lg bg-indigo-50/50 border border-indigo-100 px-4 py-3">
                            <p className="text-sm font-bold text-indigo-700 mb-1.5">{approverTitle(ie.hqReviewedBy, execUsersCache, '본부장')} 의견 (2차)</p>
                            <div className="flex items-start gap-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold shrink-0 ${GRADE_COLOR[ie.hqGrade]}`}>{ie.hqGrade}</span>
                              {ie.hqComment && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{ie.hqComment}</p>}
                            </div>
                          </div>
                        )}

                        {/* 등급 확정 입력 — 본인 직책 표시 */}
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 space-y-3">
                          <p className="text-sm font-bold text-indigo-700">{userProfile?.position || '임원'} 등급 확정</p>
                          <div>
                            <p className="text-xs text-gray-500 mb-2">등급 선택</p>
                            <div className="flex gap-2">
                              {GRADES.map(g => {
                                const remaining = getRemaining(g);
                                const isSelected = input.grade === g;
                                const isFull = !isSelected && remaining <= 0 && quotas !== null;
                                return (
                                  <div key={g} className="text-center">
                                    <button
                                      disabled={isConfirmed || saving === member.id || isFull}
                                      onClick={() => setConfirm(p => ({ ...p, [member.id]: { ...p[member.id], grade: g } }))}
                                      className={`w-10 h-10 rounded-lg text-sm font-bold border-2 transition-all ${
                                        isSelected
                                          ? `${GRADE_COLOR[g]} border-current`
                                          : isFull
                                            ? 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
                                            : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400'
                                      } disabled:opacity-50`}
                                    >
                                      {g}
                                    </button>
                                    {quotas && (
                                      <p className={`text-[10px] mt-0.5 ${remaining <= 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                        잔여{remaining}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1.5">
                              의견 <span className="text-[11px] font-normal text-gray-400">— 육성면담서와 인사평가 등급에 대한 종합의견을 작성하십시오 (필수)</span>
                            </p>
                            <textarea
                              value={input.comment}
                              onChange={e => setConfirm(p => ({ ...p, [member.id]: { ...p[member.id], comment: e.target.value } }))}
                              disabled={isConfirmed || saving === member.id}
                              rows={2}
                              placeholder="등급 부여 이유 또는 의견을 작성해주세요"
                              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                            />
                          </div>
                          <div className="flex justify-end">
                            {isConfirmed ? (
                              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5" /> 확정 완료
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                disabled={saving === member.id || !input.grade}
                                onClick={() => handleConfirm(member.id)}
                              >
                                {saving === member.id ? '확정 중...' : '등급 확정'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
