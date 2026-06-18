'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getGoalsByOrganization,
  getGoalsByOrganizations,
  getSelfEvaluationsByUsers,
  getMentoringFormsByUsers,
  upsertIndividualEvaluation,
  withdrawLeadOpinion,
  withdrawHqOpinion,
  getIndividualEvaluationsByOrg,
  getUsersByOrganization,
  getAllUsers,
  getOrganizations,
  getWeeklyTasksByMembersAndYear,
  listInnovationActivities,
  getOrgEvaluations,
  getOrgEvalPublish,
  getAllOrgAnnualGoals,
  getAttendancesByYear,
} from '@/lib/firestore';
import type { Organization, OrganizationEvaluation } from '@/types';
import { notifyEvalReviewer } from '@/lib/eval-notifications';
import { approverTitle } from '@/lib/approval-filters';
import { compareUserByRoleHire } from '@/lib/user-sort';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import Header from '@/components/layout/Header';
import { useEvalPeriod, EvalPeriodNotice } from '@/components/evaluation/EvalPeriodGate';
import YearLockBanner from '@/components/layout/YearLockBanner';
import MentoringFormModal from '@/components/evaluation/MentoringFormModal';
import SelfEvalGoalList, { EVAL_RETURN_KEY } from '@/components/evaluation/SelfEvalGoalList';
import WeeklyTasksGrid from '@/components/evaluation/WeeklyTasksGrid';
import InnovationList from '@/components/evaluation/InnovationList';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import AiEvalPanel from '@/components/evaluation/AiEvalPanel';
import MentoringPerfBody from '@/components/evaluation/MentoringPerfBody';
import AttendanceBody from '@/components/evaluation/AttendanceBody';
import SelfEvalBody, { computeSelfEvalTotal } from '@/components/evaluation/SelfEvalBody';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn, shiftEnterSubmit } from '@/lib/utils';
import type {
  Goal, SelfEvaluation, IndividualEvaluation,
  EvaluationGrade, User, MentoringForm, WeeklyTask, InnovationActivity, AnnualGoal, Attendance,
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
  const { userProfile, effectiveEvalRole, leadsEvalUnit } = useAuth();
  const router = useRouter();

  // 평가 단위(부문/지정 본부)의 리더(본부 임원)는 '본부 2차 의견' 단계를 생략하고
  // 평가등급확정 화면에서 직접 본부 확정한다 → 그쪽으로 이동.
  useEffect(() => {
    if (leadsEvalUnit) router.replace('/evaluation');
  }, [leadsEvalUnit, router]);

  if (!userProfile) return null;
  if (leadsEvalUnit) {
    return (
      <div className="flex flex-col h-full">
        <Header title="팀원 평가 의견 제출" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400 text-sm">평가등급확정 화면으로 이동 중…</p>
        </div>
      </div>
    );
  }

  // 팀장 또는 본부장(HQ leader) 또는 차순위 임원(EXEC_SUB) 진입 허용
  // 조직 체인 기반 effectiveEvalRole 로 판단 — role 필드는 보조 fallback
  const canEnter =
    effectiveEvalRole === 'TEAM_LEAD' ||
    effectiveEvalRole === 'HQ_HEAD' ||
    effectiveEvalRole === 'EXEC_SUB' ||
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
  const { userProfile, effectiveEvalRole } = useAuth();
  const { activeYear: year, isYearLocked } = useActiveYear();
  const locked = isYearLocked(year);
  const { beforePeriod, startDate } = useEvalPeriod(); // 평가기간 전 — 의견 제출만 차단

  const [members, setMembers]             = useState<User[]>([]);
  const [goalsByMember, setGoalsByMember] = useState<Record<string, Goal[]>>({});
  const [scopeGoals, setScopeGoals] = useState<Goal[]>([]); // 스코프 전체 목표(팀장 가·감점 완료율 계산용)
  const [annualGoals, setAnnualGoals] = useState<AnnualGoal[]>([]); // 회사·조직 연간목표(B⑤ 정렬 가·감점)
  const [attByUser, setAttByUser] = useState<Record<string, Attendance>>({}); // 근태현황(당해년도)
  const [selfEvals, setSelfEvals]         = useState<Record<string, SelfEvaluation>>({});
  const [indivEvals, setIndivEvals]       = useState<Record<string, IndividualEvaluation>>({});
  const [mentoringForms, setMentoringForms] = useState<Record<string, MentoringForm>>({});
  const [weeklyTasksByMember, setWeeklyTasksByMember] = useState<Record<string, WeeklyTask[]>>({});
  const [innovationsByMember, setInnovationsByMember] = useState<Record<string, InnovationActivity[]>>({});
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [opinions, setOpinions]           = useState<Record<string, { grade: EvaluationGrade | ''; comment: string }>>({});
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState<string | null>(null);
  // 본부장 여부 (TEAM_LEAD role + HEADQUARTERS 리더 또는 소속) — load() 안에서 계산
  const [isHQHead, setIsHQHead] = useState(false);
  // 멤버별 팀장 의견 (본부장 화면에서 표시용)
  const [leadOpinionByMember, setLeadOpinionByMember] = useState<Record<string, { name: string; grade?: EvaluationGrade; comment?: string; at?: Date }>>({});
  // 알림 발송용 — 전체 조직/사용자 캐시
  const [allOrgsCache, setAllOrgsCache] = useState<Organization[]>([]);
  const [activeOrgTab, setActiveOrgTab] = useState<string>(''); // 팀별 탭 활성 orgId
  const [allUsersCache, setAllUsersCache] = useState<User[]>([]);
  // 본인 소속 부문/공장의 조직평가 등급
  const [myDivision, setMyDivision] = useState<Organization | null>(null);
  const [myDivisionGrade, setMyDivisionGrade] = useState<EvaluationGrade | null>(null);

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
      const allOrgsRaw = await getOrganizations();
      const allOrgs = allOrgsRaw.filter(o => !o.archivedAt); // 보관 조직 제외 — 옛 조직이 스코프에 섞이는 문제 차단
      setAllOrgsCache(allOrgs);
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

      // 본인 소속 조직평가 단위 찾기 — 가장 가까운 평가 단위(체크된 본부 우선, 없으면 부문/공장)
      // (§6-1 가시성 규칙: 본인 소속 평가 단위의 조직등급만 볼 수 있음)
      let curForDiv: Organization | undefined = myOrg;
      while (curForDiv && !((curForDiv.type === 'DIVISION' && curForDiv.isEvalUnit !== false) || curForDiv.isEvalUnit === true)) {
        curForDiv = curForDiv.parentId ? allOrgs.find(o => o.id === curForDiv!.parentId) : undefined;
      }
      const myDiv = (curForDiv && ((curForDiv.type === 'DIVISION' && curForDiv.isEvalUnit !== false) || curForDiv.isEvalUnit === true)) ? curForDiv : null;
      setMyDivision(myDiv);
      if (myDiv) {
        try {
          // §6-1: 조직평가등급은 HR마스터/CEO 의 '조직평가결과 공개' 이후에만 일반 사용자에게 노출
          const published = await getOrgEvalPublish(year);
          if (!published) {
            setMyDivisionGrade(null);
          } else {
            const orgEvals = await getOrgEvaluations(year);
            const myDivEval = orgEvals.find(e =>
              e.organizationId === myDiv.id && (e.cycleYear === undefined || e.cycleYear === year)
            );
            setMyDivisionGrade(myDivEval?.grade && myDivEval.status === 'APPROVED' ? myDivEval.grade : null);
          }
        } catch {
          setMyDivisionGrade(null);
        }
      }

      // scope orgIds 결정
      //  - EXEC_SUB (차순위 임원 — DIVISION 소속 비-leader EXECUTIVE): home DIVISION 의 산하 모두
      //  - 본부장 (HQ leader / HQ 소속 비-leader EXECUTIVE): HQ descendants
      //  - 일반 팀장: home + 본인이 leader 인 모든 팀
      let scopeOrgIds: string[];
      if (effectiveEvalRole === 'EXEC_SUB' && userProfile.organizationId) {
        // 차순위 임원 — 본인 소속 DIVISION 의 산하 모두 read 가능 (CLAUDE.md §2 케이스 B)
        const ledOrgs = allOrgs.filter(o => o.leaderId === userProfile.id);
        const ledIds = ledOrgs.flatMap(o => getDescendantIds(o.id, allOrgs));
        const homeIds = getDescendantIds(userProfile.organizationId, allOrgs);
        scopeOrgIds = Array.from(new Set([...homeIds, ...ledIds]));
      } else if (detectedHQHead) {
        scopeOrgIds = [...new Set(hqOrgs.flatMap(o => getDescendantIds(o.id, allOrgs)))];
      } else {
        // 다중 팀 겸직 지원 — home team + 본인이 leaderId 인 모든 team descendants
        const ledTeams = allOrgs.filter(o => o.leaderId === userProfile.id);
        const ledIds = ledTeams.flatMap(o => getDescendantIds(o.id, allOrgs));
        scopeOrgIds = Array.from(new Set([userProfile.organizationId, ...ledIds]));
      }

      // 사용자·목표·평가 fetch
      const [allUsers, allGoals, evalLists] = await Promise.all([
        getAllUsers().then(us => { setAllUsersCache(us); return us; }),
        scopeOrgIds.length > 1
          ? getGoalsByOrganizations(scopeOrgIds, year)
          : getGoalsByOrganization(scopeOrgIds[0] ?? userProfile.organizationId, year),
        Promise.all(scopeOrgIds.map(id => getIndividualEvaluationsByOrg(id, year))),
      ]);
      const evalList = evalLists.flat();
      const memberList = allUsers.filter(u => scopeOrgIds.includes(u.organizationId));
      // 일반 팀장: 본인 팀의 MEMBER 만
      // 본부장 / 차순위 임원: 산하의 MEMBER + TEAM_LEAD (본인 제외) — 다른 임원은 평가 대상 X
      // (CLAUDE.md §6-1: 임원 가시 범위 = 본인 + 책임조직의 본부장(TEAM_LEAD)·팀장·팀원)
      const isExecSub = effectiveEvalRole === 'EXEC_SUB';
      const active = memberList.filter(u => {
        if (!u.isActive) return false;
        if (u.id === userProfile.id) return false; // 본인 제외
        if (isExecSub || detectedHQHead) return u.role === 'MEMBER' || u.role === 'TEAM_LEAD';
        return u.role === 'MEMBER';
      });
      active.sort(compareUserByRoleHire); // 팀장 → 팀원, 동일 역할 입사일순
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
      // owner + 공동수행자 모두에게 배정 — AI 요약·카드에 공동수행 업무 반영
      active.forEach(m => { gMap[m.id] = allGoals.filter(g => g.userId === m.id || (g.collaboratorIds ?? []).includes(m.id)); });
      setGoalsByMember(gMap);
      setScopeGoals(allGoals);
      getAllOrgAnnualGoals(year).then(setAnnualGoals).catch(() => setAnnualGoals([]));
      getAttendancesByYear(year).then(list => setAttByUser(Object.fromEntries(list.map(a => [a.userId, a])))).catch(() => setAttByUser({}));

      const [seList, mfList, weeklyTasks, innovations] = await Promise.all([
        getSelfEvaluationsByUsers(active.map(m => m.id), year),
        getMentoringFormsByUsers(active.map(m => m.id), year),
        getWeeklyTasksByMembersAndYear(active.map(m => ({ id: m.id, organizationId: m.organizationId })), year),
        listInnovationActivities(year),
      ]);

      // 혁신활동 — 멤버별 참여 매핑
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

  async function handleSubmitOpinion(memberId: string) {
    if (!userProfile) return;
    if (locked) { toast.error(`${year}년은 확정된 연도입니다. 평가 의견 제출/수정이 불가합니다.`); return; }
    const op = opinions[memberId];
    if (!op?.grade) { toast.error('등급 의견을 선택해주세요.'); return; }

    setSaving(memberId);
    try {
      const member = members.find(m => m.id === memberId);
      const existing = indivEvals[memberId];
      // 본부장이 평가 대상이 팀장(TEAM_LEAD) 인 경우 → 본부장이 1차 의견자 (leadGrade)
      // 본부장이 평가 대상이 팀원(MEMBER) 인 경우 → 본부장은 2차 (hqGrade), 팀장 의견 선행 필요
      let nextStage: 'HQ' | 'EXEC';
      let notifType: 'EVAL_HQ_REVIEWED' | 'EVAL_LEAD_REVIEWED';
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
        toast.success(`${member?.name ?? ''} ${userProfile.position || '본부장'} 2차 의견을 제출했습니다.`);
        nextStage = 'EXEC';
        notifType = 'EVAL_HQ_REVIEWED';
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
        // 본부장이 팀장을 1차 평가 — 다음은 임원
        nextStage = isHQHead && member?.role === 'TEAM_LEAD' ? 'EXEC' : 'HQ';
        notifType = 'EVAL_LEAD_REVIEWED';
      }

      // 알림 — 다음 검토자에게
      try {
        if (member) {
          const res = await notifyEvalReviewer({
            subject: member,
            fromUserId: userProfile.id,
            fromUserName: userProfile.name,
            stage: nextStage,
            type: notifType,
            category: 'EVALUATION',
            title: `${member.name}님 평가 의견 검토 요청`,
            message: `${userProfile.name}님이 ${member.name}님의 평가 의견을 제출했습니다. 다음 단계 검토가 필요합니다.`,
            link: nextStage === 'EXEC' ? '/evaluation' : '/evaluation/team',
            allOrgs: allOrgsCache,
            allUsers: allUsersCache,
          });
          // HQ 가 체인에 없거나 본부장이 없으면 EXEC 폴백
          if (!res.notified && nextStage === 'HQ') {
            await notifyEvalReviewer({
              subject: member, fromUserId: userProfile.id, fromUserName: userProfile.name,
              stage: 'EXEC',
              type: notifType,
              category: 'EVALUATION',
              title: `${member.name}님 평가 의견 검토 요청`,
              message: `${userProfile.name}님이 ${member.name}님의 평가 의견을 제출했습니다.`,
              link: '/evaluation',
              allOrgs: allOrgsCache,
              allUsers: allUsersCache,
            });
          }
        }
      } catch (err) {
        console.error('[평가 알림] 실패:', err);
      }

      await load();
    } finally { setSaving(null); }
  }

  async function handleWithdrawOpinion(memberId: string) {
    if (!userProfile) return;
    if (locked) { toast.error(`${year}년은 확정된 연도입니다. 회수가 불가합니다.`); return; }
    const ie = indivEvals[memberId];
    if (!ie) return;
    const member = members.find(m => m.id === memberId);
    const isHQ2nd = isHQHead && member?.role === 'MEMBER';

    const myTitle = userProfile.position || '본부장';
    if (!confirm(
      isHQ2nd
        ? `${myTitle} 2차 의견을 회수합니다. 회수 후 다시 수정·제출이 가능합니다. 계속하시겠습니까?`
        : '평가 의견을 회수합니다. 회수 시 평가 대상자가 자기평가를 다시 회수·수정할 수 있는 상태로 돌아갑니다. 계속하시겠습니까?',
    )) return;

    setSaving(memberId);
    try {
      if (isHQ2nd) {
        await withdrawHqOpinion(ie);
        toast.success(`${myTitle} 2차 의견을 회수했습니다.`);
      } else {
        await withdrawLeadOpinion(ie);
        toast.success('평가 의견을 회수했습니다.');
      }
      await load();
    } catch (err) {
      console.error('[의견 회수] 실패:', err);
      toast.error('회수에 실패했습니다.');
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
      <Header title={isHQHead ? `${userProfile?.position || '본부장'} 2차 평가 의견` : '팀원 평가 의견 제출'} />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <YearLockBanner />
      {beforePeriod && <div className="px-6 pt-4"><EvalPeriodNotice startDate={startDate} /></div>}
        <p className="text-sm text-gray-500">
          {isHQHead
            ? `산하 팀원의 자기평가와 팀장 의견을 검토한 후 ${userProfile?.position || '본부장'} 2차 의견을 작성하세요. (팀장 의견 제출 후에만 입력 가능)`
            : '팀원의 업무 성과와 자기평가를 검토한 후 등급 의견과 이유를 작성하고 제출하세요.'}
        </p>

        {/* 본인 소속 부문/공장의 조직평가 등급 — 확정된 경우만 (§6-1 가시성 규칙) */}
        {myDivision && myDivisionGrade && (
          <div className="rounded-xl border bg-white px-5 py-3 flex items-center gap-4">
            <span className="text-sm font-semibold text-gray-700">{myDivision.name} 조직평가</span>
            <span className={cn(
              'inline-block rounded-full px-3 py-0.5 text-sm font-bold',
              GRADE_COLOR[myDivisionGrade]
            )}>
              {myDivisionGrade}
            </span>
            <span className="text-xs text-gray-400 ml-auto">{year}년 확정</span>
          </div>
        )}

        {loading ? <LoadingSpinner /> : members.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-gray-400">소속 팀원이 없습니다.</div>
        ) : (() => {
          // 팀별 탭 분류 (F1) — 멤버를 organizationId 기준으로 분할, displayOrder 정렬
          const membersByOrg: Record<string, User[]> = {};
          for (const m of members) {
            (membersByOrg[m.organizationId] ??= []).push(m);
          }
          const orgTabs = allOrgsCache
            .filter(o => membersByOrg[o.id]?.length > 0)
            .slice()
            .sort((a, b) => {
              const ao = a.displayOrder ?? 999;
              const bo = b.displayOrder ?? 999;
              if (ao !== bo) return ao - bo;
              return a.name.localeCompare(b.name, 'ko');
            });
          if (!activeOrgTab && orgTabs.length > 0) setActiveOrgTab(orgTabs[0].id);
          if (activeOrgTab && orgTabs.length > 0 && !orgTabs.some(o => o.id === activeOrgTab)) setActiveOrgTab(orgTabs[0].id);
          // 탭별 진척도
          function tabProgress(orgId: string) {
            const list = membersByOrg[orgId] ?? [];
            let done = 0;
            for (const m of list) {
              const ie = indivEvals[m.id];
              const useHq = isHQHead && m.role === 'MEMBER';
              const isDone = useHq
                ? ['HQ_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'].includes(ie?.status ?? '')
                : ['LEAD_REVIEWED', 'HQ_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'].includes(ie?.status ?? '');
              if (isDone) done++;
            }
            return { done, total: list.length };
          }
          const activeMembers = membersByOrg[activeOrgTab] ?? [];
          return (
          <>
            {/* AI 성과 요약 · 참고 순위 — 평가권자 스코프 전체 일괄 (팀 탭 무관) */}
            {userProfile && (
              <AiEvalPanel
                members={members}
                goalsByMember={goalsByMember}
                weeklyTasksByMember={weeklyTasksByMember}
                selfEvals={selfEvals}
                mentoringForms={mentoringForms}
                indivEvals={indivEvals}
                actor={{ id: userProfile.id, name: userProfile.name }}
                scopeLabel={isHQHead ? '본부 산하' : '팀원'}
                allOrgs={allOrgsCache}
                allScopeGoals={scopeGoals}
                annualGoals={annualGoals}
              />
            )}
            {/* 팀 탭 바 */}
            <div className="flex gap-1 border-b bg-white px-1 pt-1 shrink-0 overflow-x-auto">
              {orgTabs.map(o => {
                const { done, total } = tabProgress(o.id);
                const isActive = activeOrgTab === o.id;
                const allDone = total > 0 && done === total;
                return (
                  <button
                    key={o.id}
                    onClick={() => setActiveOrgTab(o.id)}
                    className={cn(
                      'px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors whitespace-nowrap',
                      isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {o.name}
                    <span className={cn(
                      'ml-1.5 text-xs',
                      allDone ? 'text-green-600' : isActive ? 'text-blue-500' : 'text-gray-400',
                    )}>
                      {done}/{total}
                    </span>
                  </button>
                );
              })}
            </div>
            {(() => {
            const selected = activeMembers.find(m => m.id === selectedMemberId) ?? null;
            return (
            <div className="space-y-4">
              {/* 팀장·팀원 병렬 카드 (이전 의견 미표시) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {activeMembers.map(member => {
                  const se = selfEvals[member.id];
                  const goals = goalsByMember[member.id] ?? [];
                  const summary = goalCountSummary(goals);
                  const isLead = member.role === 'TEAM_LEAD';
                  const isSel = selectedMemberId === member.id;
                  const submitted = se?.status === 'SUBMITTED'; // 자기평가 '제출(SUBMITTED)'만 인정 — 임시저장·육성면담서 존재는 미제출
                  const myDone = isHQHead && member.role === 'MEMBER'
                    ? !!indivEvals[member.id]?.hqReviewedBy
                    : !!indivEvals[member.id]?.leadSubmittedBy;
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
                        {myDone && <span className="text-[11px] rounded-full bg-green-100 text-green-700 px-2 py-0.5 shrink-0">의견 제출</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                        <span>완료 <b className="text-green-600">{summary.completed}</b></span>
                        <span>진행 {summary.inProgress}</span>
                        {submitted
                          ? <span className="text-blue-600">· 자기평가 제출</span>
                          : <span className="text-gray-300">· 미제출</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {(() => { const t = computeSelfEvalTotal(se); return t != null && (
                          <span className="text-[11px] rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-700 font-semibold">자기평가 {t}점</span>
                        ); })()}
                        {/* 본부장 2차 평가 시 — 팀장 1차 등급의견 표시 */}
                        {isHQHead && member.role === 'MEMBER' && indivEvals[member.id]?.leadGrade && (
                          <span className={`text-[11px] rounded-full px-2 py-0.5 ${GRADE_COLOR[indivEvals[member.id]!.leadGrade!]}`}>팀장 {indivEvals[member.id]!.leadGrade}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 선택 멤버 상세 — 등급 의견 제출 + 육성면담 및 업무실적 */}
              {selected && (() => {
            const member = selected;
            const ie = indivEvals[member.id];
            const se = selfEvals[member.id];
            const weeklyTasks = weeklyTasksByMember[member.id] ?? [];
            // 본부장이 팀원 평가 시 → 2차 의견(HQ_REVIEWED) / 팀장 평가 시 → 1차 의견(LEAD_REVIEWED)
            const isHQ2ndOpinion = isHQHead && member.role === 'MEMBER';   // 본부장 2차 의견 케이스
            const isHQ1stOpinion = isHQHead && member.role === 'TEAM_LEAD'; // 본부장 1차 의견 케이스 (팀장 평가)
            const isReviewed = isHQ2ndOpinion
              ? ['EXEC_CONFIRMED', 'PUBLISHED'].includes(ie?.status ?? '')
              : isHQ1stOpinion
                ? ['EXEC_CONFIRMED', 'PUBLISHED'].includes(ie?.status ?? '')
                : ['HQ_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'].includes(ie?.status ?? '');
            const alreadySubmittedByMe = isHQ2ndOpinion ? !!ie?.hqReviewedBy : !!ie?.leadSubmittedBy;
            const canHQInput = isHQ2ndOpinion ? !!ie?.leadSubmittedBy : true;
            const op = opinions[member.id] ?? { grade: '', comment: '' };
            const leadOp = leadOpinionByMember[member.id];
            return (
              <div className="rounded-xl border bg-white p-5 space-y-5">
                <div className="flex items-center gap-2 border-b pb-3">
                  <MemberInfoModal userId={member.id} userName={member.name} targetRole={member.role} />
                  <span className="text-xs text-gray-400">{member.role === 'TEAM_LEAD' ? '팀장' : '팀원'}{member.position ? ` · ${member.position}` : ''}</span>
                  {se?.status === 'SUBMITTED'
                    ? <span className="ml-auto flex items-center gap-1 text-xs text-blue-600"><CheckCircle2 className="h-3 w-3" /> 자기평가 제출</span>
                    : <span className="ml-auto text-xs text-gray-400">자기평가 미제출</span>}
                </div>

                {/* 본부장 2차 평가 시 — 팀장 1차 의견 (읽기 전용) */}
                {isHQ2ndOpinion && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                    <p className="text-sm font-bold text-gray-800">{approverTitle(ie?.leadSubmittedBy, allUsersCache, '팀장')} 의견 (1차)</p>
                    {leadOp ? (
                      <>
                        <div className="flex items-center gap-2">
                          {leadOp.grade && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLOR[leadOp.grade]}`}>{leadOp.grade}등급</span>}
                          <span className="text-xs text-gray-500">{leadOp.name}</span>
                          {leadOp.at && <span className="text-xs text-gray-400">{leadOp.at.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>}
                        </div>
                        {leadOp.comment && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{leadOp.comment}</p>}
                      </>
                    ) : <p className="text-xs text-gray-400 italic">팀장 의견이 아직 제출되지 않았습니다.</p>}
                  </div>
                )}

                {/* 등급 의견 입력 */}
                {canHQInput ? (
                  <div className={`rounded-lg border p-4 space-y-3 ${isHQHead ? 'border-indigo-100 bg-indigo-50' : 'border-blue-100 bg-blue-50'}`}>
                    <p className={`text-sm font-bold ${isHQHead ? 'text-indigo-700' : 'text-blue-700'}`}>
                      {(() => {
                        const myTitle = userProfile?.position || (isHQHead ? '본부장' : '팀장');
                        if (isHQ2ndOpinion) return `${myTitle} 2차 의견`;
                        if (isHQ1stOpinion) return `${myTitle} 1차 의견 (팀장 평가)`;
                        return `${myTitle} 등급 의견`;
                      })()}
                    </p>
                    <div>
                      <p className="text-xs text-gray-500 mb-2">등급 선택</p>
                      <div className="flex gap-2">
                        {GRADES.map(g => (
                          <button key={g} disabled={isReviewed || saving === member.id || locked}
                            onClick={() => setOpinions(p => ({ ...p, [member.id]: { ...p[member.id], grade: g } }))}
                            className={`w-10 h-10 rounded-lg text-sm font-bold border-2 transition-all ${op.grade === g ? `${GRADE_COLOR[g]} border-current` : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">의견 <span className="text-[11px] font-normal text-gray-400">— 육성면담서와 인사평가 등급에 대한 종합의견을 작성하십시오 (필수)</span></p>
                      <textarea value={op.comment}
                        onChange={e => setOpinions(p => ({ ...p, [member.id]: { ...p[member.id], comment: e.target.value } }))}
                        onKeyDown={shiftEnterSubmit(() => handleSubmitOpinion(member.id), !isReviewed && saving !== member.id && !!op.grade && !locked && !beforePeriod)}
                        disabled={isReviewed || saving === member.id || locked} rows={2} placeholder="등급 의견의 이유를 작성해주세요 (Shift+Enter 제출)"
                        className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                    </div>
                    <div className="flex justify-end items-center gap-2 flex-wrap">
                      {isReviewed ? (
                        <span className="text-xs text-green-600 font-medium">제출 완료 (상위 검토 진행됨)</span>
                      ) : alreadySubmittedByMe ? (
                        <>
                          <span className="text-xs text-blue-600 mr-auto">제출됨 · 상위 확정 전</span>
                          <Button variant="outline" size="sm" disabled={saving === member.id} onClick={() => handleWithdrawOpinion(member.id)}>의견 회수</Button>
                          <Button size="sm" disabled={saving === member.id || !op.grade || locked || beforePeriod} title={beforePeriod ? '평가기간에만 제출할 수 있습니다.' : undefined} onClick={() => handleSubmitOpinion(member.id)}>{saving === member.id ? '저장 중...' : '의견 수정'}</Button>
                        </>
                      ) : (
                        <Button size="sm" disabled={saving === member.id || !op.grade || locked || beforePeriod} title={beforePeriod ? '평가기간에만 제출할 수 있습니다.' : undefined} onClick={() => handleSubmitOpinion(member.id)}>{saving === member.id ? '제출 중...' : '의견 제출'}</Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                    <p className="text-xs text-gray-400">팀장 의견 제출 후에 {userProfile?.position || '본부장'} 2차 의견을 입력할 수 있습니다.</p>
                  </div>
                )}

                {/* 자기평가 (핵심목표 가중치·점수 / 일반업무 / 혁신) */}
                <div>
                  <p className="text-sm font-bold text-gray-800 mb-2">
                    자기평가
                    {(() => { const t = computeSelfEvalTotal(selfEvals[member.id]?.status === 'SUBMITTED' ? selfEvals[member.id] : null); return t != null && (
                      <span className="ml-1.5 text-indigo-600">(자기평가 점수 {t}점)</span>
                    ); })()}
                  </p>
                  {(() => {
                    const cg = (goalsByMember[member.id] ?? []).filter(g =>
                      g.status === 'APPROVED' || g.status === 'IN_PROGRESS' || g.status === 'COMPLETED' ||
                      g.status === 'PENDING_ABANDON' || (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange));
                    const completed = cg.filter(g => g.status === 'COMPLETED').length;
                    return (
                      <SelfEvalBody form={selfEvals[member.id]?.status === 'SUBMITTED' ? selfEvals[member.id] : null}
                        abandonedGoals={cg.filter(g => g.status === 'ABANDONED').map(g => ({ goalId: g.id, goalTitle: g.title }))}
                        goalSummary={{ total: cg.length, completed, notCompleted: cg.length - completed }} />
                    );
                  })()}
                </div>

                {/* 육성면담서 (직무·경력·요청·종합의견) */}
                <div>
                  <p className="text-sm font-bold text-gray-800 mb-2">육성면담서</p>
                  <MentoringPerfBody form={mentoringForms[member.id]?.status === 'SUBMITTED' ? mentoringForms[member.id] : null} />
                </div>

                {/* 근태현황 (당해년도) */}
                <AttendanceBody year={year} attendance={attByUser[member.id] ?? null} />
              </div>
            );
              })()}
            </div>
          );
          })()}
          </>
          );
        })()}
      </div>
    </div>
  );
}
