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
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import MentoringFormModal from '@/components/evaluation/MentoringFormModal';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import type {
  EvaluationCycle, Goal, SelfEvaluation, IndividualEvaluation,
  EvaluationGrade, User, Organization, DivisionGradeQuota, MentoringForm, WeeklyTask,
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
  const { userProfile } = useAuth();

  if (!userProfile) return null;
  const { role } = userProfile;
  if (role === 'MEMBER' || role === 'TEAM_LEAD') return <MemberEvalView />;
  if (role === 'EXECUTIVE') return <ExecutiveEvalView />;
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
  const [goalEvals, setGoalEvals]       = useState<Record<string, { good: string; regret: string }>>({});
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [cyc, goals, se, ie] = await Promise.all([
        getActiveCycle(),
        getGoalsByUser(userProfile.id, year),
        getSelfEvaluation(userProfile.id, year),
        getIndividualEvaluation(userProfile.id, year),
      ]);
      setCycle(cyc);
      const done = goals.filter(g => g.status === 'COMPLETED');
      setCompleted(done);
      setSelfEval(se);
      setMyEval(ie);

      if (se?.goalEvals?.length) {
        const map: Record<string, { good: string; regret: string }> = {};
        se.goalEvals.forEach(ge => { map[ge.goalId] = { good: ge.good, regret: ge.regret }; });
        setGoalEvals(map);
      } else {
        const map: Record<string, { good: string; regret: string }> = {};
        done.forEach(g => { map[g.id] = { good: '', regret: '' }; });
        setGoalEvals(map);
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [userProfile]);

  const now = new Date();
  const isInEvalPeriod = cycle
    ? (now >= cycle.evalStartDate && now <= cycle.evalEndDate)
    : false;
  const isSubmitted = selfEval?.status === 'SUBMITTED';

  async function handleSave() {
    if (!userProfile) return;
    setSaving(true);
    try {
      await upsertSelfEvaluation(userProfile.id, year, {
        goalEvals: completedGoals.map(g => ({
          goalId: g.id, goalTitle: g.title,
          good: goalEvals[g.id]?.good ?? '',
          regret: goalEvals[g.id]?.regret ?? '',
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
          good: goalEvals[g.id]?.good ?? '',
          regret: goalEvals[g.id]?.regret ?? '',
        })),
        status: 'SUBMITTED',
        submittedAt: new Date(),
      });
      await upsertIndividualEvaluation(userProfile.id, year, {
        organizationId: userProfile.organizationId,
        status: 'SELF_SUBMITTED',
      });
      toast.success('팀장에게 제출되었습니다.');
      await load();
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
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 rounded-full px-3 py-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> 제출 완료
              </span>
            )}
          </div>
        )}

        {/* 현재 처리 상태 */}
        {myEval && myEval.status !== 'NOT_STARTED' && (
          <div className="rounded-xl border bg-white px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">평가 진행 상태</p>
            <div className="flex items-center gap-2 flex-wrap">
              {(['SELF_SUBMITTED', 'LEAD_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'] as const).map((s, i) => {
                const statusIndex = ['SELF_SUBMITTED', 'LEAD_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'].indexOf(myEval.status);
                const isDone = i <= statusIndex;
                const labels = ['자기평가 제출', '팀장 검토 완료', '임원 등급 확정', '결과 공개'];
                return (
                  <span key={s} className={`rounded-full px-3 py-1 text-xs font-medium ${
                    isDone ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {i + 1}. {labels[i]}
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
        )}

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
            <h3 className="font-semibold text-gray-900">제출한 성과 내용</h3>
            {selfEval.goalEvals.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">완료된 목표가 없었습니다.</p>
            ) : (
              selfEval.goalEvals.map(ge => (
                <div key={ge.goalId} className="rounded-xl border bg-white p-5 space-y-3">
                  <p className="font-medium text-gray-900">{ge.goalTitle}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-green-600 mb-1.5">잘된 점</p>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{ge.good || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-orange-500 mb-1.5">아쉬운 점</p>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{ge.regret || '—'}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 평가 입력 폼 */}
        {(isInEvalPeriod || !cycle) && !isSubmitted && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900">완료된 업무 성과 입력</h3>
              <p className="text-xs text-gray-500 mt-0.5">완료된 목표별로 잘된 점과 아쉬운 점을 입력하고 팀장에게 제출하세요.</p>
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-green-600 block mb-1.5">잘된 점</label>
                      <textarea
                        value={goalEvals[goal.id]?.good ?? ''}
                        onChange={e => setGoalEvals(p => ({ ...p, [goal.id]: { ...p[goal.id], good: e.target.value } }))}
                        rows={3}
                        placeholder="이 업무에서 잘된 점을 작성해주세요"
                        className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-orange-500 block mb-1.5">아쉬운 점</label>
                      <textarea
                        value={goalEvals[goal.id]?.regret ?? ''}
                        onChange={e => setGoalEvals(p => ({ ...p, [goal.id]: { ...p[goal.id], regret: e.target.value } }))}
                        rows={3}
                        placeholder="이 업무에서 아쉬운 점을 작성해주세요"
                        className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}

            {!loading && completedGoals.length > 0 && (
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={handleSave} disabled={saving}>임시 저장</Button>
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? '제출 중...' : '팀장에게 제출'}
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
  const [quotas, setQuotas]           = useState<DivisionGradeQuota | null>(null);
  const [confirmInputs, setConfirm]   = useState<Record<string, { grade: EvaluationGrade | ''; comment: string }>>({});
  const [expanded, setExpanded]       = useState<Record<string, boolean>>({});
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState<string | null>(null);

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [orgs, allUsers, allQuotas] = await Promise.all([
        getOrganizations(),
        getAllUsers(),
        getAllDivisionGradeQuotas(year),
      ]);
      setAllOrgs(orgs);

      // 내가 leaderId인 모든 조직 → 각각 하위 탐색 → 합산 (복수 조직 담당 임원 대응)
      const myLeadOrgs = orgs.filter(o => o.leaderId === userProfile.id);
      const rootIds = myLeadOrgs.length > 0
        ? myLeadOrgs.map(o => o.id)
        : [userProfile.organizationId]; // fallback: leaderId 미설정 환경
      const descIds = [...new Set(rootIds.flatMap(id => getDescendantOrgIds(id, orgs)))];

      const active = allUsers.filter(u => (u.role === 'MEMBER' || u.role === 'TEAM_LEAD') && u.isActive && descIds.includes(u.organizationId));
      setMembers(active);

      const evalResults = await Promise.all(
        descIds.map(oid => getIndividualEvaluationsByOrg(oid, year))
      );
      const ieMap: Record<string, IndividualEvaluation> = {};
      evalResults.flat().forEach(ie => { ieMap[ie.userId] = ie; });
      setIndivEvals(ieMap);

      const [seList, mfList, weeklyTasks, allGoals] = await Promise.all([
        getSelfEvaluationsByUsers(active.map(m => m.id), year),
        getMentoringFormsByUsers(active.map(m => m.id), year),
        getWeeklyTasksByUsersAndYear(active.map(m => m.id), year),
        getGoalsByOrganizations(descIds, year),
      ]);

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

  useEffect(() => { load(); }, [userProfile]);

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
      await upsertIndividualEvaluation(memberId, year, {
        execGrade: input.grade as EvaluationGrade,
        execComment: input.comment,
        execConfirmedBy: userProfile.id,
        execConfirmedAt: new Date(),
        status: 'EXEC_CONFIRMED',
      });
      toast.success(`${member?.name ?? ''} 등급을 확정했습니다.`);
      await load();
    } finally { setSaving(null); }
  }

  const membersByOrg = members.reduce<Record<string, User[]>>((acc, m) => {
    if (!acc[m.organizationId]) acc[m.organizationId] = [];
    acc[m.organizationId].push(m);
    return acc;
  }, {});

  const orgNameMap = Object.fromEntries(allOrgs.map(o => [o.id, o.name]));

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

        {/* 팀원 목록 */}
        {loading ? <LoadingSpinner /> : members.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-gray-400">산하 팀원이 없습니다.</div>
        ) : (
          Object.entries(membersByOrg).map(([orgId, orgMembers]) => (
            <div key={orgId} className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 px-1">{orgNameMap[orgId] ?? orgId}</p>
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
                          <MemberInfoModal userId={member.id} userName={member.name} />
                          <p className="text-xs text-gray-400">
                            {member.role === 'TEAM_LEAD' ? '팀장' : '팀원'} {member.position && `· ${member.position}`}
                          </p>
                        </div>
                        {ie?.leadGrade && (
                          <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${GRADE_COLOR[ie.leadGrade]}`}>
                            팀장 의견 {ie.leadGrade}
                          </span>
                        )}
                        {!ie?.leadGrade && (
                          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5">팀장 의견 없음</span>
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
                      <div className="border-t px-5 py-5 space-y-4">
                        {/* 핵심목표 목록 */}
                        {(() => {
                          const goals = goalsByMember[member.id] ?? [];
                          const activeGoals = goals.filter(g => !['DRAFT', 'PENDING_APPROVAL', 'LEAD_APPROVED'].includes(g.status));
                          if (activeGoals.length === 0) return null;
                          return (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-2">핵심목표 ({activeGoals.length}개)</p>
                              <div className="space-y-1.5">
                                {activeGoals.map(g => (
                                  <div key={g.id} className="flex items-center gap-3 rounded-lg border bg-gray-50 px-3 py-2">
                                    <span className="text-xs text-gray-500 shrink-0">{g.progress}%</span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-gray-800 truncate">{g.title}</p>
                                    </div>
                                    <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 font-medium ${
                                      g.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                                      g.status === 'ABANDONED' ? 'bg-gray-100 text-gray-400' :
                                      'bg-blue-50 text-blue-600'
                                    }`}>
                                      {g.status === 'COMPLETED' ? '완료' : g.status === 'ABANDONED' ? '포기' : '진행중'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* 주간 업무관리 내역 */}
                        {(() => {
                          const weeklyTasks = weeklyTasksByMember[member.id] ?? [];
                          return (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-2">주간 업무관리 내역</p>
                              {weeklyTasks.length === 0 ? (
                                <p className="text-sm text-gray-400">등록된 주간 업무 내역이 없습니다.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {weeklyTasks.map(wt => {
                                    const weekKey = `${member.id}_w${wt.weekNumber}`;
                                    const isWeekOpen = expandedWeeks[weekKey] ?? false;
                                    const hdItems = wt.hasDoneItems ?? [];
                                    const wdItems = wt.willDoItems ?? [];
                                    const totalCount = hdItems.length + wdItems.length;
                                    return (
                                      <div key={wt.id} className="rounded-lg border bg-gray-50 overflow-hidden">
                                        <button
                                          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-100 transition-colors"
                                          onClick={() => setExpandedWeeks(p => ({ ...p, [weekKey]: !isWeekOpen }))}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-gray-700">{wt.weekNumber}주차</span>
                                            <span className="text-xs text-gray-400">
                                              {wt.weekStart.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ~ {wt.weekEnd.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                            </span>
                                            <span className="text-xs text-green-600 font-medium">실적 {hdItems.length}건</span>
                                            <span className="text-xs text-gray-400">계획 {wdItems.length}건</span>
                                          </div>
                                          {isWeekOpen
                                            ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                                            : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                                        </button>
                                        {isWeekOpen && (
                                          <div className="border-t px-3 py-2 space-y-1.5 bg-white">
                                            {totalCount === 0 ? (
                                              <p className="text-xs text-gray-400">등록된 업무가 없습니다.</p>
                                            ) : (
                                              <>
                                                {hdItems.length > 0 && (
                                                  <div>
                                                    <p className="text-[10px] font-bold text-green-700 mb-1">Has Done — 이번 주 실적</p>
                                                    {hdItems.map(item => (
                                                      <div key={item.id} className="flex items-start gap-2 py-1">
                                                        <div className="flex-1 min-w-0">
                                                          <p className="text-xs text-gray-800">{item.title}</p>
                                                          {item.content && <p className="text-xs text-gray-500 mt-0.5">{item.content}</p>}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                                {wdItems.length > 0 && (
                                                  <div className={hdItems.length > 0 ? 'border-t pt-1.5' : ''}>
                                                    <p className="text-[10px] font-bold text-gray-600 mb-1">Will Do — 다음 주 계획</p>
                                                    {wdItems.map(item => (
                                                      <div key={item.id} className="flex items-start gap-2 py-1">
                                                        <div className="flex-1 min-w-0">
                                                          <p className="text-xs text-gray-800">{item.title}</p>
                                                          {item.content && <p className="text-xs text-gray-500 mt-0.5">{item.content}</p>}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                              </>
                                            )}
                                            {wt.summary && (
                                              <div className="border-t pt-1.5 mt-1.5">
                                                <p className="text-xs text-gray-500"><span className="font-semibold">종합 의견: </span>{wt.summary}</p>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* 자기평가 요약 */}
                        {se?.status === 'SUBMITTED' && se.goalEvals.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-2">자기평가 내용</p>
                            <div className="space-y-2">
                              {se.goalEvals.map(ge => (
                                <div key={ge.goalId} className="rounded-lg bg-gray-50 p-3">
                                  <p className="text-xs font-medium text-gray-700 mb-1.5">{ge.goalTitle}</p>
                                  <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                                    <div><span className="font-semibold text-green-600">잘된 점: </span>{ge.good || '—'}</div>
                                    <div><span className="font-semibold text-orange-500">아쉬운 점: </span>{ge.regret || '—'}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 육성면담서 요약 */}
                        {mentoringForms[member.id] && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-gray-500">육성면담서</p>
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

                        {/* 팀장 의견 */}
                        {ie?.leadGrade && (
                          <div className="rounded-lg bg-gray-50 px-4 py-3">
                            <p className="text-xs font-semibold text-gray-500 mb-1">팀장 의견</p>
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${GRADE_COLOR[ie.leadGrade]}`}>{ie.leadGrade}</span>
                              {ie.leadComment && <p className="text-sm text-gray-600">{ie.leadComment}</p>}
                            </div>
                          </div>
                        )}

                        {/* 등급 확정 입력 */}
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 space-y-3">
                          <p className="text-xs font-semibold text-indigo-700">임원 등급 확정</p>
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
                            <p className="text-xs text-gray-500 mb-1.5">의견</p>
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
          ))
        )}
      </div>
    </div>
  );
}
