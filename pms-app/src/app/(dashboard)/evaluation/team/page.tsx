'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getGoalsByOrganization,
  getGoalsByOrganizations,
  getSelfEvaluationsByUsers,
  getMentoringFormsByUsers,
  upsertIndividualEvaluation,
  getIndividualEvaluationsByOrg,
  getUsersByOrganization,
  getAllUsers,
  getOrganizations,
  getWeeklyTasksByUsersAndYear,
  listInnovationActivities,
} from '@/lib/firestore';
import type { Organization } from '@/types';
import Header from '@/components/layout/Header';
import MentoringFormModal from '@/components/evaluation/MentoringFormModal';
import WeeklyTasksGrid from '@/components/evaluation/WeeklyTasksGrid';
import InnovationList from '@/components/evaluation/InnovationList';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from 'lucide-react';
import type {
  Goal, SelfEvaluation, IndividualEvaluation,
  EvaluationGrade, User, MentoringForm, WeeklyTask, InnovationActivity,
} from '@/types';

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

function LoadingSpinner() {
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  );
}

export default function EvaluationTeamPage() {
  const { userProfile, effectiveEvalRole } = useAuth();

  if (!userProfile) return null;

  // 팀장 또는 본부장(HQ leader — TEAM_LEAD/EXECUTIVE role 무관) 진입 허용
  // 조직 체인 기반 effectiveEvalRole 로 판단 — role 필드는 보조 fallback
  const canEnter =
    effectiveEvalRole === 'TEAM_LEAD' ||
    effectiveEvalRole === 'HQ_HEAD' ||
    userProfile.role === 'TEAM_LEAD'; // legacy fallback
  if (!canEnter) {
    return (
      <div className="flex flex-col h-full">
        <Header title="팀원 평가 의견 제출" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400">접근 권한이 없습니다.</p>
        </div>
      </div>
    );
  }

  return <TeamLeadEvalView />;
}

function TeamLeadEvalView() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();

  const [members, setMembers]             = useState<User[]>([]);
  const [goalsByMember, setGoalsByMember] = useState<Record<string, Goal[]>>({});
  const [selfEvals, setSelfEvals]         = useState<Record<string, SelfEvaluation>>({});
  const [indivEvals, setIndivEvals]       = useState<Record<string, IndividualEvaluation>>({});
  const [mentoringForms, setMentoringForms] = useState<Record<string, MentoringForm>>({});
  const [weeklyTasksByMember, setWeeklyTasksByMember] = useState<Record<string, WeeklyTask[]>>({});
  const [innovationsByMember, setInnovationsByMember] = useState<Record<string, InnovationActivity[]>>({});
  const [expanded, setExpanded]           = useState<Record<string, boolean>>({});
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
  const [opinions, setOpinions]           = useState<Record<string, { grade: EvaluationGrade | ''; comment: string }>>({});
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState<string | null>(null);
  // 본부장 여부 (TEAM_LEAD role + HEADQUARTERS 리더 또는 소속) — load() 안에서 계산
  const [isHQHead, setIsHQHead] = useState(false);
  // 멤버별 팀장 의견 (본부장 화면에서 표시용)
  const [leadOpinionByMember, setLeadOpinionByMember] = useState<Record<string, { name: string; grade?: EvaluationGrade; comment?: string; at?: Date }>>({});

  function getDescendantIds(orgId: string, allOrgs: Organization[]): string[] {
    const ids: string[] = [orgId];
    for (const c of allOrgs.filter(o => o.parentId === orgId)) {
      ids.push(...getDescendantIds(c.id, allOrgs));
    }
    return ids;
  }

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    try {
      const allOrgs = await getOrganizations();
      // 본부장 판별: leaderId 가 본인이고 HEADQUARTERS 인 조직 또는 본인 소속이 HQ
      // (role 이 TEAM_LEAD 든 EXECUTIVE 든 HQ leader 이면 본부장으로 간주 — CLAUDE.md 차순위 임원 케이스)
      const myLedHQ = allOrgs.filter(o => o.leaderId === userProfile.id && o.type === 'HEADQUARTERS');
      const myOrg = allOrgs.find(o => o.id === userProfile.organizationId);
      // fallback: leader 미지정 환경에서 본인 소속이 HQ + 본인이 EXECUTIVE/TEAM_LEAD 면 본부장으로 간주
      const fallbackHQ = myLedHQ.length === 0
        && myOrg?.type === 'HEADQUARTERS'
        && (userProfile.role === 'EXECUTIVE' || userProfile.role === 'TEAM_LEAD')
          ? [myOrg]
          : [];
      const hqOrgs = [...myLedHQ, ...fallbackHQ];
      const detectedHQHead = hqOrgs.length > 0;
      setIsHQHead(detectedHQHead);

      // scope orgIds 결정
      const scopeOrgIds = detectedHQHead
        ? [...new Set(hqOrgs.flatMap(o => getDescendantIds(o.id, allOrgs)))]
        : [userProfile.organizationId];

      // 사용자·목표·평가 fetch
      const [allUsers, allGoals, evalLists] = await Promise.all([
        getAllUsers(),
        detectedHQHead
          ? getGoalsByOrganizations(scopeOrgIds, year)
          : getGoalsByOrganization(userProfile.organizationId, year),
        Promise.all(scopeOrgIds.map(id => getIndividualEvaluationsByOrg(id, year))),
      ]);
      const evalList = evalLists.flat();
      const memberList = allUsers.filter(u => scopeOrgIds.includes(u.organizationId));
      // 일반 팀장: 본인 팀의 MEMBER 만
      // 본부장: 산하 팀의 MEMBER + TEAM_LEAD (본인 제외) 모두 평가 대상
      const active = memberList.filter(u => {
        if (!u.isActive) return false;
        if (u.id === userProfile.id) return false; // 본인 제외
        if (detectedHQHead) return u.role === 'MEMBER' || u.role === 'TEAM_LEAD';
        return u.role === 'MEMBER';
      });
      setMembers(active);

      // 팀장 의견의 작성자 이름 매핑 (본부장 화면용)
      const usersById = Object.fromEntries(allUsers.map(u => [u.id, u]));
      const opByMember: typeof leadOpinionByMember = {};
      evalList.forEach(ie => {
        if (ie.leadSubmittedBy) {
          opByMember[ie.userId] = {
            name: usersById[ie.leadSubmittedBy]?.name ?? '팀장',
            grade: ie.leadGrade,
            comment: ie.leadComment,
            at: ie.leadSubmittedAt,
          };
        }
      });
      setLeadOpinionByMember(opByMember);

      const gMap: Record<string, Goal[]> = {};
      active.forEach(m => { gMap[m.id] = allGoals.filter(g => g.userId === m.id); });
      setGoalsByMember(gMap);

      const [seList, mfList, weeklyTasks, innovations] = await Promise.all([
        getSelfEvaluationsByUsers(active.map(m => m.id), year),
        getMentoringFormsByUsers(active.map(m => m.id), year),
        getWeeklyTasksByUsersAndYear(active.map(m => m.id), year),
        listInnovationActivities(year),
      ]);

      // 혁신활동 — 멤버별 참여 매핑
      const innovMap: Record<string, InnovationActivity[]> = {};
      active.forEach(m => { innovMap[m.id] = []; });
      innovations.forEach(a => {
        const involved = new Set<string>([
          ...(a.pmId ? [a.pmId] : []),
          ...(a.memberIds ?? []),
          ...(a.performerId ? [a.performerId] : []),
          ...(a.instructorId ? [a.instructorId] : []),
        ]);
        involved.forEach(uid => { if (innovMap[uid]) innovMap[uid].push(a); });
      });
      setInnovationsByMember(innovMap);

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

      const ieMap: Record<string, IndividualEvaluation> = {};
      evalList.forEach(ie => { ieMap[ie.userId] = ie; });
      setIndivEvals(ieMap);

      const opMap: Record<string, { grade: EvaluationGrade | ''; comment: string }> = {};
      active.forEach(m => {
        const ie = ieMap[m.id];
        // 본부장 + 팀원(MEMBER) → 2차 의견(hqGrade) / 본부장 + 팀장(TEAM_LEAD) → 1차 의견(leadGrade)
        // 일반 팀장 → 1차 의견(leadGrade)
        const useHq = detectedHQHead && m.role === 'MEMBER';
        opMap[m.id] = useHq
          ? { grade: ie?.hqGrade ?? '', comment: ie?.hqComment ?? '' }
          : { grade: ie?.leadGrade ?? '', comment: ie?.leadComment ?? '' };
      });
      setOpinions(opMap);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [userProfile]);

  async function handleSubmitOpinion(memberId: string) {
    if (!userProfile) return;
    const op = opinions[memberId];
    if (!op?.grade) { toast.error('등급 의견을 선택해주세요.'); return; }

    setSaving(memberId);
    try {
      const member = members.find(m => m.id === memberId);
      const existing = indivEvals[memberId];
      // 본부장이 평가 대상이 팀장(TEAM_LEAD) 인 경우 → 본부장이 1차 의견자 (leadGrade)
      // 본부장이 평가 대상이 팀원(MEMBER) 인 경우 → 본부장은 2차 (hqGrade), 팀장 의견 선행 필요
      if (isHQHead && member?.role === 'MEMBER') {
        if (!existing?.leadSubmittedBy) {
          toast.error('팀장 의견 제출이 먼저 필요합니다.');
          return;
        }
        await upsertIndividualEvaluation(memberId, year, {
          organizationId: member?.organizationId ?? userProfile.organizationId,
          hqGrade: op.grade as EvaluationGrade,
          hqComment: op.comment,
          hqReviewedBy: userProfile.id,
          hqReviewedAt: new Date(),
          status: 'HQ_REVIEWED',
        });
        toast.success(`${member?.name ?? ''} 본부장 2차 의견을 제출했습니다.`);
      } else {
        // (1) 일반 팀장의 팀원 평가 → 1차 의견(leadGrade)
        // (2) 본부장의 팀장 평가 → 1차 의견(leadGrade)
        await upsertIndividualEvaluation(memberId, year, {
          organizationId: member?.organizationId ?? userProfile.organizationId,
          leadGrade: op.grade as EvaluationGrade,
          leadComment: op.comment,
          leadSubmittedBy: userProfile.id,
          leadSubmittedAt: new Date(),
          status: 'LEAD_REVIEWED',
        });
        toast.success(`${member?.name ?? ''} 평가 의견을 제출했습니다.`);
      }
      await load();
    } finally { setSaving(null); }
  }

  const goalCountSummary = (goals: Goal[]) => {
    // 인사평가 대상 목표만 카운트 (반려·미확정 포기·제안 단계 제외)
    const visible = goals.filter(g => (
      g.status === 'APPROVED' ||
      g.status === 'IN_PROGRESS' ||
      g.status === 'COMPLETED' ||
      g.status === 'PENDING_ABANDON' ||
      (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange)
    ));
    return {
      total: visible.length,
      completed: visible.filter(g => g.status === 'COMPLETED').length,
      abandoned: visible.filter(g => g.status === 'ABANDONED').length, // 포기 확정만
      inProgress: visible.filter(g => g.status === 'IN_PROGRESS' || g.status === 'APPROVED').length,
    };
  };

  return (
    <div className="flex flex-col h-full">
      <Header title={isHQHead ? '본부장 2차 평가 의견' : '팀원 평가 의견 제출'} />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <p className="text-sm text-gray-500">
          {isHQHead
            ? '본부 산하 팀원의 자기평가와 팀장 의견을 검토한 후 본부장 2차 의견을 작성하세요. (팀장 의견 제출 후에만 입력 가능)'
            : '팀원의 업무 성과와 자기평가를 검토한 후 등급 의견과 이유를 작성하고 제출하세요.'}
        </p>

        {loading ? <LoadingSpinner /> : members.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-gray-400">소속 팀원이 없습니다.</div>
        ) : (
          members.map(member => {
            const ie = indivEvals[member.id];
            const se = selfEvals[member.id];
            const goals = goalsByMember[member.id] ?? [];
            const weeklyTasks = weeklyTasksByMember[member.id] ?? [];
            const summary = goalCountSummary(goals);
            const isOpen = expanded[member.id] ?? false;
            // 본부장이 팀원 평가 시 → 2차 의견(HQ_REVIEWED) / 팀장 평가 시 → 1차 의견(LEAD_REVIEWED)
            const isHQ2ndOpinion = isHQHead && member.role === 'MEMBER';   // 본부장 2차 의견 케이스
            const isHQ1stOpinion = isHQHead && member.role === 'TEAM_LEAD'; // 본부장 1차 의견 케이스 (팀장 평가)
            const isReviewed = isHQ2ndOpinion
              ? ['HQ_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'].includes(ie?.status ?? '')
              : ['LEAD_REVIEWED', 'HQ_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'].includes(ie?.status ?? '');
            // 본부장 2차 의견은 팀장 1차 의견 선행 필요 / 본부장 1차 의견(팀장 평가)은 즉시 입력 가능
            const canHQInput = isHQ2ndOpinion ? !!ie?.leadSubmittedBy : true;
            const op = opinions[member.id] ?? { grade: '', comment: '' };
            const leadOp = leadOpinionByMember[member.id];

            return (
              <div key={member.id} className="rounded-xl border bg-white overflow-hidden">
                {/* 헤더 */}
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(p => ({ ...p, [member.id]: !isOpen }))}
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <MemberInfoModal userId={member.id} userName={member.name} />
                      <p className="text-xs text-gray-400">{member.position}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>전체 {summary.total}</span>
                      <span className="text-green-600 font-medium">완료 {summary.completed}</span>
                      {summary.abandoned > 0 && <span className="text-gray-400">포기 {summary.abandoned}</span>}
                      {summary.inProgress > 0 && <span className="text-indigo-500">진행중 {summary.inProgress}</span>}
                    </div>
                    {se?.status === 'SUBMITTED' ? (
                      <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 rounded-full px-2.5 py-0.5 font-medium">
                        <CheckCircle2 className="h-3 w-3" /> 자기평가 제출
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5">자기평가 미제출</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ie?.leadGrade && (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLOR[ie.leadGrade]}`}>
                        팀장 {ie.leadGrade}
                      </span>
                    )}
                    {ie?.hqGrade && (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLOR[ie.hqGrade]}`}>
                        본부 {ie.hqGrade}
                      </span>
                    )}
                    {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>
                </button>

                {/* 펼친 내용 */}
                {isOpen && (
                  <div className="border-t px-5 py-5 space-y-5">
                    {/* 업무 목록 — 인사평가에 의미 있는 상태만 (반려·미확정 포기·제안 단계 제외) */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2">업무 목록</p>
                      {(() => {
                        const visibleGoals = goals.filter(g => (
                          g.status === 'APPROVED' ||
                          g.status === 'IN_PROGRESS' ||
                          g.status === 'COMPLETED' ||
                          g.status === 'PENDING_ABANDON' ||
                          (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange)
                        ));
                        if (visibleGoals.length === 0) {
                          return <p className="text-sm text-gray-400">표시할 목표가 없습니다.</p>;
                        }
                        return (
                          <div className="space-y-1.5">
                            {visibleGoals.map(g => {
                              const st = GOAL_STATUS_LABEL[g.status] ?? { label: g.status, color: 'bg-gray-100 text-gray-500' };
                              return (
                                <div key={g.id} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>{st.label}</span>
                                  <span className="text-sm text-gray-700 flex-1">{g.title}</span>
                                  <span className="text-xs text-gray-400">{g.progress}%</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    {/* 주간업무보고 내역 — 52주 카드 그리드 */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2">주간업무보고 내역 ({year}년)</p>
                      <WeeklyTasksGrid tasks={weeklyTasks} year={year} />
                    </div>

                    {/* 혁신활동 실적 ({year}년) */}
                    {(innovationsByMember[member.id]?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2">
                          혁신활동 실적 ({year}년) · {innovationsByMember[member.id].length}건
                        </p>
                        <InnovationList items={innovationsByMember[member.id]} memberId={member.id} />
                      </div>
                    )}

                    {/* 자기평가 내용 */}
                    {se?.status === 'SUBMITTED' && se.goalEvals.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2">자기평가 (팀원 작성)</p>
                        <div className="space-y-3">
                          {se.goalEvals.map(ge => {
                            const legacy = [
                              ge.good ? `[잘된 점]\n${ge.good}` : '',
                              ge.regret ? `[아쉬운 점]\n${ge.regret}` : '',
                            ].filter(Boolean).join('\n\n');
                            const text = ge.comment || legacy || '—';
                            return (
                              <div key={ge.goalId} className="rounded-lg border bg-gray-50 p-4 space-y-2">
                                <p className="text-sm font-medium text-gray-800">{ge.goalTitle}</p>
                                <div>
                                  <p className="text-xs font-semibold text-blue-600 mb-1">종합 의견</p>
                                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{text}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 육성면담서 요약 */}
                    {mentoringForms[member.id] && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-500">육성면담서 (팀원 작성)</p>
                          <MentoringFormModal
                            form={mentoringForms[member.id]}
                            memberName={member.name}
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

                    {/* 본부장이 팀원 평가 시에만 — 팀장 1차 의견 표시 (읽기 전용) */}
                    {isHQ2ndOpinion && (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                        <p className="text-xs font-semibold text-gray-600">팀장 의견 (1차)</p>
                        {leadOp ? (
                          <>
                            <div className="flex items-center gap-2">
                              {leadOp.grade && (
                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLOR[leadOp.grade]}`}>
                                  {leadOp.grade}등급
                                </span>
                              )}
                              <span className="text-xs text-gray-500">{leadOp.name}</span>
                              {leadOp.at && (
                                <span className="text-xs text-gray-400">
                                  {leadOp.at.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                </span>
                              )}
                            </div>
                            {leadOp.comment && (
                              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{leadOp.comment}</p>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-gray-400 italic">팀장 의견이 아직 제출되지 않았습니다.</p>
                        )}
                      </div>
                    )}

                    {/* 등급 의견 입력
                        - 일반 팀장: 1차 의견(blue)
                        - 본부장 + 팀원 평가: 2차 의견(indigo), 팀장 의견 선행 필요
                        - 본부장 + 팀장 평가: 1차 의견(indigo), 즉시 입력 가능 */}
                    {canHQInput ? (
                      <div className={`rounded-lg border p-4 space-y-3 ${isHQHead ? 'border-indigo-100 bg-indigo-50' : 'border-blue-100 bg-blue-50'}`}>
                        <p className={`text-xs font-semibold ${isHQHead ? 'text-indigo-700' : 'text-blue-700'}`}>
                          {isHQ2ndOpinion ? '본부장 2차 의견' : isHQ1stOpinion ? '본부장 1차 의견 (팀장 평가)' : '팀장 등급 의견'}
                        </p>
                        <div>
                          <p className="text-xs text-gray-500 mb-2">등급 선택</p>
                          <div className="flex gap-2">
                            {GRADES.map(g => (
                              <button
                                key={g}
                                disabled={isReviewed || saving === member.id}
                                onClick={() => setOpinions(p => ({ ...p, [member.id]: { ...p[member.id], grade: g } }))}
                                className={`w-10 h-10 rounded-lg text-sm font-bold border-2 transition-all ${
                                  op.grade === g
                                    ? `${GRADE_COLOR[g]} border-current`
                                    : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                              >
                                {g}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1.5">의견 (이유 작성)</p>
                          <textarea
                            value={op.comment}
                            onChange={e => setOpinions(p => ({ ...p, [member.id]: { ...p[member.id], comment: e.target.value } }))}
                            disabled={isReviewed || saving === member.id}
                            rows={2}
                            placeholder="등급 의견의 이유를 작성해주세요"
                            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                          />
                        </div>
                        <div className="flex justify-end">
                          {isReviewed ? (
                            <span className="text-xs text-green-600 font-medium">제출 완료</span>
                          ) : (
                            <Button
                              size="sm"
                              disabled={saving === member.id || !op.grade}
                              onClick={() => handleSubmitOpinion(member.id)}
                            >
                              {saving === member.id ? '제출 중...' : '의견 제출'}
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                        <p className="text-xs text-gray-400">팀장 의견 제출 후에 본부장 2차 의견을 입력할 수 있습니다.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
