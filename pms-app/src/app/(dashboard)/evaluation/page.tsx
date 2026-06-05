'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  getWeeklyTasksByMembersAndYear,
  listInnovationActivities,
} from '@/lib/firestore';
import { notifyEvalReviewer } from '@/lib/eval-notifications';
import { approverTitle } from '@/lib/approval-filters';
import { compareUserByRoleHire } from '@/lib/user-sort';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import Header from '@/components/layout/Header';
import YearLockBanner from '@/components/layout/YearLockBanner';
import MentoringFormModal from '@/components/evaluation/MentoringFormModal';
import SelfEvalGoalList, { EVAL_RETURN_KEY } from '@/components/evaluation/SelfEvalGoalList';
import InnovationList from '@/components/evaluation/InnovationList';
import WeeklyTasksGrid from '@/components/evaluation/WeeklyTasksGrid';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import AiEvalPanel from '@/components/evaluation/AiEvalPanel';
import MentoringPerfBody from '@/components/evaluation/MentoringPerfBody';
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
  // 평가등급확정은 EXEC_TOP(최상위 임원) 만
  if (effectiveEvalRole === 'EXEC_TOP') return <ExecutiveEvalView />;
  // 자기평가는 육성면담서로 통합(v0.9) — 작성 대상자는 /mentoring 으로 이동
  return <RedirectToMentoring />;
}

// 자기평가 → 육성면담서 통합: /evaluation 진입 시 /mentoring 으로 이동
function RedirectToMentoring() {
  const router = useRouter();
  useEffect(() => { router.replace('/mentoring'); }, [router]);
  return (
    <div className="flex flex-col h-full">
      <Header title="평가" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">육성면담서로 이동 중…</p>
      </div>
    </div>
  );
}

// ─── 임원: 최종 등급 확정 ────────────────────────────────
function ExecutiveEvalView() {
  const { userProfile } = useAuth();
  const { activeYear: year, isYearLocked } = useActiveYear();
  const locked = isYearLocked(year);

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
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null); // 선택된 멤버(하단 상세)
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
        getWeeklyTasksByMembersAndYear(active.map(m => ({ id: m.id, organizationId: m.organizationId })), year),
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
      if (st.memberId) setSelectedMemberId(st.memberId);
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
    if (locked) { toast.error(`${year}년은 확정된 연도입니다. 등급 확정/변경이 불가합니다.`); return; }
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

        <YearLockBanner />

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
            {/* AI 성과 요약 · 참고 순위 — 산하 전체 일괄 (팀 탭 무관) */}
            {userProfile && (
              <AiEvalPanel
                members={members}
                goalsByMember={goalsByMember}
                weeklyTasksByMember={weeklyTasksByMember}
                selfEvals={selfEvals}
                mentoringForms={mentoringForms}
                indivEvals={indivEvals}
                actor={{ id: userProfile.id, name: userProfile.name }}
                scopeLabel="산하 전체"
              />
            )}
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
              const selected = orgMembers.find(m => m.id === selectedMemberId) ?? null;
              return (
                <div className="space-y-4 pt-3">
                  {/* 팀장·팀원 병렬 카드 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {orgMembers.map(member => {
                      const ie = indivEvals[member.id];
                      const se = selfEvals[member.id];
                      const isConfirmed = ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED';
                      const isLead = member.role === 'TEAM_LEAD';
                      const isSel = selectedMemberId === member.id;
                      const submitted = se?.status === 'SUBMITTED' || !!mentoringForms[member.id];
                      return (
                        <button key={member.id}
                          onClick={() => setSelectedMemberId(isSel ? null : member.id)}
                          className={cn('text-left rounded-xl border bg-white p-4 transition-all hover:shadow-sm',
                            isSel ? 'border-indigo-400 ring-1 ring-indigo-200' : isLead ? 'border-amber-200' : 'border-gray-200')}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {member.name}
                              <span className="ml-1 text-xs font-normal text-gray-400">{isLead ? '팀장' : '팀원'}{member.position ? ` · ${member.position}` : ''}</span>
                            </p>
                            {isConfirmed && ie?.execGrade && (
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold shrink-0 ${GRADE_COLOR[ie.execGrade]}`}>확정 {ie.execGrade}</span>
                            )}
                          </div>
                          {/* 이전 평가등급 의견(임원 화면) — 팀장·본부 의견을 검토중으로 표시 */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {ie?.leadGrade && <span className={`text-[11px] rounded-full px-2 py-0.5 ${GRADE_COLOR[ie.leadGrade]}`}>팀장 {ie.leadGrade}</span>}
                            {ie?.hqGrade && <span className={`text-[11px] rounded-full px-2 py-0.5 ${GRADE_COLOR[ie.hqGrade]}`}>본부 {ie.hqGrade}</span>}
                            {(ie?.leadGrade || ie?.hqGrade)
                              ? (!isConfirmed && <span className="text-[11px] text-amber-600">· 검토중</span>)
                              : <span className="text-[11px] text-gray-400">이전 의견 없음</span>}
                            {!submitted && <span className="text-[11px] text-gray-300">· 미제출</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* 선택 멤버 상세 — 등급 확정 + 육성면담 및 업무실적 */}
                  {selected && (() => {
                    const member = selected;
                    const ie = indivEvals[member.id];
                    const isConfirmed = ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED';
                    const input = confirmInputs[member.id] ?? { grade: '', comment: '' };
                    return (
                      <div className="rounded-xl border bg-white p-5 space-y-5">
                        <div className="flex items-center gap-2 border-b pb-3">
                          <MemberInfoModal userId={member.id} userName={member.name} targetRole={member.role} />
                          <span className="text-xs text-gray-400">{member.role === 'TEAM_LEAD' ? '팀장' : '팀원'}{member.position ? ` · ${member.position}` : ''}</span>
                        </div>

                        {/* 팀장 의견 (1차) */}
                        {ie?.leadGrade && (
                          <div className="rounded-lg bg-gray-50 px-4 py-3">
                            <p className="text-sm font-bold text-gray-800 mb-1.5">{approverTitle(ie.leadSubmittedBy, execUsersCache, '팀장')} 의견 (1차)</p>
                            <div className="flex items-start gap-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold shrink-0 ${GRADE_COLOR[ie.leadGrade]}`}>{ie.leadGrade}</span>
                              {ie.leadComment && <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{ie.leadComment}</p>}
                            </div>
                          </div>
                        )}
                        {/* 본부장 의견 (2차) */}
                        {ie?.hqGrade && (
                          <div className="rounded-lg bg-indigo-50/50 border border-indigo-100 px-4 py-3">
                            <p className="text-sm font-bold text-indigo-700 mb-1.5">{approverTitle(ie.hqReviewedBy, execUsersCache, '본부장')} 의견 (2차)</p>
                            <div className="flex items-start gap-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold shrink-0 ${GRADE_COLOR[ie.hqGrade]}`}>{ie.hqGrade}</span>
                              {ie.hqComment && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{ie.hqComment}</p>}
                            </div>
                          </div>
                        )}

                        {/* 등급 확정 입력 */}
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
                                      disabled={isConfirmed || saving === member.id || isFull || locked}
                                      onClick={() => setConfirm(p => ({ ...p, [member.id]: { ...p[member.id], grade: g } }))}
                                      className={`w-10 h-10 rounded-lg text-sm font-bold border-2 transition-all ${
                                        isSelected ? `${GRADE_COLOR[g]} border-current`
                                          : isFull ? 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
                                          : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400'
                                      } disabled:opacity-50`}>
                                      {g}
                                    </button>
                                    {quotas && <p className={`text-[10px] mt-0.5 ${remaining <= 0 ? 'text-red-400' : 'text-gray-400'}`}>잔여{remaining}</p>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1.5">의견 <span className="text-[11px] font-normal text-gray-400">— 육성면담서와 인사평가 등급에 대한 종합의견 (필수)</span></p>
                            <textarea
                              value={input.comment}
                              onChange={e => setConfirm(p => ({ ...p, [member.id]: { ...p[member.id], comment: e.target.value } }))}
                              disabled={isConfirmed || saving === member.id || locked}
                              rows={2}
                              placeholder="등급 부여 이유 또는 의견을 작성해주세요"
                              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50" />
                          </div>
                          <div className="flex justify-end">
                            {isConfirmed ? (
                              <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> 확정 완료</span>
                            ) : (
                              <Button size="sm" disabled={saving === member.id || !input.grade || locked} onClick={() => handleConfirm(member.id)}>
                                {saving === member.id ? '확정 중...' : '등급 확정'}
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* 육성면담 및 업무실적 (통합 육성면담서 — 핵심목표·일반업무·혁신 자기평가 포함) */}
                        <div>
                          <p className="text-sm font-bold text-gray-800 mb-2">육성면담 및 업무실적</p>
                          <MentoringPerfBody form={mentoringForms[member.id] ?? null} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
