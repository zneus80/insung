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
  getAllOrgAnnualGoals,
  getAttendancesByYear,
  createNotification,
} from '@/lib/firestore';
import { approverTitle } from '@/lib/approval-filters';
import { compareUserByRoleHire } from '@/lib/user-sort';
import { isEvalUnitOrg, nearestEvalUnitId } from '@/lib/org-eval';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import Header from '@/components/layout/Header';
import { useEvalPeriod, EvalPeriodNotice } from '@/components/evaluation/EvalPeriodGate';
import YearLockBanner from '@/components/layout/YearLockBanner';
import MentoringFormModal from '@/components/evaluation/MentoringFormModal';
import SelfEvalGoalList, { EVAL_RETURN_KEY } from '@/components/evaluation/SelfEvalGoalList';
import InnovationList from '@/components/evaluation/InnovationList';
import WeeklyTasksGrid from '@/components/evaluation/WeeklyTasksGrid';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import AiEvalPanel from '@/components/evaluation/AiEvalPanel';
import MentoringPerfBody from '@/components/evaluation/MentoringPerfBody';
import AttendanceBody from '@/components/evaluation/AttendanceBody';
import SelfEvalBody, { computeSelfEvalTotal, reconcileSelfEval } from '@/components/evaluation/SelfEvalBody';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, ChevronRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { cn, shiftEnterSubmit } from '@/lib/utils';
import type {
  EvaluationCycle, Goal, SelfEvaluation, IndividualEvaluation,
  EvaluationGrade, User, Organization, DivisionGradeQuota, MentoringForm, WeeklyTask,
  InnovationActivity, AnnualGoal, Attendance,
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
  const { userProfile, effectiveEvalRole, leadsEvalUnit } = useAuth();

  if (!userProfile) return null;
  // 평가등급확정 — 최상위 임원(EXEC_TOP) + 평가단위(부문/지정 본부)의 리더(본부 임원).
  // 본부가 평가단위이면 그 본부 임원이 자기 본부를 확정해야 하므로 HQ_HEAD 라도 진입 허용.
  if (effectiveEvalRole === 'EXEC_TOP' || leadsEvalUnit) return <ExecutiveEvalView />;
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
  const { beforePeriod, startDate } = useEvalPeriod(); // 평가기간 전 — 등급 확정만 차단

  const [allOrgs, setAllOrgs]         = useState<Organization[]>([]);
  const [members, setMembers]         = useState<User[]>([]);
  const [selfEvals, setSelfEvals]     = useState<Record<string, SelfEvaluation>>({});
  const [indivEvals, setIndivEvals]   = useState<Record<string, IndividualEvaluation>>({});
  const [mentoringForms, setMentoringForms] = useState<Record<string, MentoringForm>>({});
  const [goalsByMember, setGoalsByMember] = useState<Record<string, Goal[]>>({});
  const [scopeGoals, setScopeGoals] = useState<Goal[]>([]); // 스코프 전체 목표(팀장 가·감점 완료율 계산용)
  const [annualGoals, setAnnualGoals] = useState<AnnualGoal[]>([]); // 회사·조직 연간목표(B⑤ 정렬 가·감점)
  const [attByUser, setAttByUser] = useState<Record<string, Attendance>>({}); // 근태현황(당해년도)
  const [weeklyTasksByMember, setWeeklyTasksByMember] = useState<Record<string, WeeklyTask[]>>({});
  const [innovationsByMember, setInnovationsByMember] = useState<Record<string, InnovationActivity[]>>({});
  // 평가 단위(부문 또는 평가단위로 지정된 본부 등)별 쿼터(CONFIRMED). 평가 단위에 쿼터가 달린다.
  const [quotaByUnit, setQuotaByUnit] = useState<Record<string, DivisionGradeQuota>>({});
  // 멤버 소속 조직 → 가장 가까운 평가 단위 조직 매핑. 멤버의 쿼터/등급 게이트 기준.
  const [unitByOrg, setUnitByOrg]     = useState<Record<string, string>>({});
  const [unitIds, setUnitIds]         = useState<string[]>([]); // 화면에 표시할 평가 단위 목록(멤버가 속한 단위, 정렬)
  // 평가 단위별 내 역할: SOLE(단독 확정·상위 임원 없음) / UNIT(본부 확정 1차) / FINAL(부문 임원 최종 확정·수정요청)
  const [roleByUnit, setRoleByUnit]   = useState<Record<string, 'SOLE' | 'UNIT' | 'FINAL'>>({});
  const [confirmInputs, setConfirm]   = useState<Record<string, { grade: EvaluationGrade | ''; comment: string }>>({});
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null); // 선택된 멤버(하단 상세)
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState<string | null>(null);
  const [finalizing, setFinalizing]   = useState<string | null>(null); // 평가완료 처리 중인 부문(root) id
  const [execUsersCache, setExecUsersCache] = useState<User[]>([]); // 공동수행자 이름 조회용
  const [activeOrgTab, setActiveOrgTab] = useState<string>('');     // 팀별 탭 활성 orgId

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [orgsRaw, allUsers, allQuotas] = await Promise.all([
        getOrganizations(),
        getAllUsers().then(us => { setExecUsersCache(us); return us; }),
        getAllDivisionGradeQuotas(year),
      ]);
      // 보관(archived)된 조직은 평가 스코프에서 제외 — 옛 조직(예: 보관된 총무팀)이 산하 계산에 섞이는 문제 차단
      const orgs = orgsRaw.filter(o => !o.archivedAt);
      setAllOrgs(orgs);

      // ── 내가 관여하는 평가 단위 산출 ──
      // 평가 단위(부문/지정 본부 등) 중 ① 내가 그 단위의 리더이거나 ② 내가 그 단위의 상위 임원(부문 임원)인 단위.
      const userRoleById = new Map(allUsers.map(u => [u.id, u.role]));
      const evalUnits = orgs.filter(o => isEvalUnitOrg(o, orgs));
      // 단위의 상위 임원 — 단위 위쪽에서 가장 가까운 EXECUTIVE 리더(없으면 null = 단독 확정).
      const higherExecOf = (unit: Organization): string | null => {
        let cur = unit.parentId ? orgs.find(o => o.id === unit.parentId) : undefined;
        while (cur) {
          if (cur.leaderId && userRoleById.get(cur.leaderId) === 'EXECUTIVE') return cur.leaderId;
          cur = cur.parentId ? orgs.find(o => o.id === cur!.parentId) : undefined;
        }
        return null;
      };
      const roleMap: Record<string, 'SOLE' | 'UNIT' | 'FINAL'> = {};
      for (const u of evalUnits) {
        const higher = higherExecOf(u);
        if (u.leaderId === userProfile.id) roleMap[u.id] = higher ? 'UNIT' : 'SOLE';
        else if (higher === userProfile.id) roleMap[u.id] = 'FINAL';
      }
      let myUnits = evalUnits.filter(u => roleMap[u.id]);
      // fallback: leaderId 미설정 등으로 관여 단위가 없으면 본인 소속 기준 평가단위
      if (myUnits.length === 0) {
        const fb = userProfile.organizationId ? nearestEvalUnitId(userProfile.organizationId, orgs) : null;
        const fbUnit = fb ? orgs.find(o => o.id === fb) : undefined;
        if (fbUnit) { myUnits = [fbUnit]; roleMap[fbUnit.id] = higherExecOf(fbUnit) ? 'FINAL' : 'SOLE'; }
      }
      setRoleByUnit(roleMap);

      const descIds = [...new Set(myUnits.flatMap(u => getDescendantOrgIds(u.id, orgs)))];

      const active = allUsers.filter(u => (u.role === 'MEMBER' || u.role === 'TEAM_LEAD') && u.isActive && descIds.includes(u.organizationId));
      active.sort(compareUserByRoleHire); // 팀장 → 팀원, 동일 역할 입사일순

      // 멤버 소속 조직 → 가장 가까운 평가 단위 조직 매핑.
      const unitByOrgMap: Record<string, string> = {};
      for (const m of active) {
        if (unitByOrgMap[m.organizationId]) continue;
        const uid = nearestEvalUnitId(m.organizationId, orgs);
        if (uid) unitByOrgMap[m.organizationId] = uid;
      }
      setUnitByOrg(unitByOrgMap);
      // 화면에 표시할 평가 단위 목록 — 멤버가 속한 distinct 평가단위, displayOrder 정렬
      const unitIdSet = new Set(Object.values(unitByOrgMap));
      const orderedUnits = orgs
        .filter(o => unitIdSet.has(o.id))
        .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || a.name.localeCompare(b.name, 'ko'))
        .map(o => o.id);
      setUnitIds(orderedUnits);
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
        // owner + 공동수행자 모두에게 배정 — AI 요약·카드에 공동수행 업무도 반영
        for (const uid of [g.userId, ...(g.collaboratorIds ?? [])]) {
          if (gbMap[uid] && !gbMap[uid].some(x => x.id === g.id)) gbMap[uid].push(g);
        }
      });
      setGoalsByMember(gbMap);
      setScopeGoals(allGoals);
      getAllOrgAnnualGoals(year).then(setAnnualGoals).catch(() => setAnnualGoals([]));
      getAttendancesByYear(year).then(list => setAttByUser(Object.fromEntries(list.map(a => [a.userId, a])))).catch(() => setAttByUser({}));

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

      // 평가 단위별 쿼터 (CONFIRMED 된 것만). 평가 단위(부문/본부 등)에 쿼터가 달리므로 organizationId 그대로 매핑.
      const qByUnit: Record<string, DivisionGradeQuota> = {};
      for (const q of allQuotas) {
        if (q.status === 'CONFIRMED') qByUnit[q.organizationId] = q;
      }
      setQuotaByUnit(qByUnit);

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

  // 멤버의 소속 부문(root) 쿼터 — 없으면 null(해당 부문 조직평가 등급 미확정)
  function quotaOfMember(m: User): DivisionGradeQuota | null {
    return quotaByUnit[unitByOrg[m.organizationId]] ?? null;
  }

  // 해당 부문에서 특정 등급으로 '배정된'(execGrade 저장됨) 멤버 목록.
  // 임시 배정(평가완료 전)과 최종 확정(EXEC_CONFIRMED) 모두 포함 — 쿼터 재조정으로 무효화되면 execGrade 가 삭제되어 자동 제외된다.
  function assignedMembers(rootId: string, grade: EvaluationGrade): User[] {
    return members.filter(m => unitByOrg[m.organizationId] === rootId && indivEvals[m.id]?.execGrade === grade);
  }

  function getUsed(rootId: string, grade: EvaluationGrade): number {
    return assignedMembers(rootId, grade).length;
  }

  // 평가 단위 진행 현황 — 배정/본부확정/최종확정 인원 집계 (버튼 활성·라벨 판단)
  function divisionStats(rootId: string): { total: number; assigned: number; unitConfirmed: number; finalized: number } {
    const list = members.filter(m => unitByOrg[m.organizationId] === rootId);
    let assigned = 0, unitConfirmed = 0, finalized = 0;
    for (const m of list) {
      const ie = indivEvals[m.id];
      if (ie?.execGrade) assigned++;
      if (ie?.status === 'HQ_REVIEWED') unitConfirmed++;
      if (ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED') finalized++;
    }
    return { total: list.length, assigned, unitConfirmed, finalized };
  }

  function getQuotaCount(rootId: string, grade: EvaluationGrade): number {
    const q = quotaByUnit[rootId];
    if (!q) return 999;
    return q[`quota${grade}` as keyof DivisionGradeQuota] as number ?? 0;
  }

  function getRemaining(rootId: string, grade: EvaluationGrade): number {
    return getQuotaCount(rootId, grade) - getUsed(rootId, grade);
  }

  // 멤버가 속한 평가 단위에서 내 역할(SOLE/UNIT/FINAL). 없으면 null(관여 단위 아님).
  function roleOfMember(m: User): 'SOLE' | 'UNIT' | 'FINAL' | null {
    return roleByUnit[unitByOrg[m.organizationId]] ?? null;
  }
  // 평가 대상자가 자기평가·육성면담서를 모두 제출해야 평가(배정·확정) 가능
  function isMemberReadyForEval(memberId: string): boolean {
    return selfEvals[memberId]?.status === 'SUBMITTED' && mentoringForms[memberId]?.status === 'SUBMITTED';
  }
  // 내가 이 멤버의 등급을 '배정/수정'할 수 있는가 — 배정 권한은 SOLE/UNIT 확정자만(FINAL=부문 임원은 배정 불가).
  function canAssignMember(m: User): boolean {
    const role = roleOfMember(m);
    if (role !== 'SOLE' && role !== 'UNIT') return false;
    if (!isMemberReadyForEval(m.id)) return false; // 자기평가·육성면담서 미제출이면 배정 불가
    const s = indivEvals[m.id]?.status;
    // 본부 확정(HQ_REVIEWED)·최종 확정(EXEC_CONFIRMED/PUBLISHED) 이후엔 수정 불가
    return s !== 'HQ_REVIEWED' && s !== 'EXEC_CONFIRMED' && s !== 'PUBLISHED';
  }

  // 개인 등급 '배정' — 임시 저장(편집 가능). 단위 확정/최종 확정 전까지는 status 를 올리지 않는다.
  async function handleConfirm(memberId: string) {
    if (!userProfile) return;
    if (locked) { toast.error(`${year}년은 확정된 연도입니다. 등급 배정/변경이 불가합니다.`); return; }
    const member0 = members.find(m => m.id === memberId);
    if (!member0 || !quotaOfMember(member0)) { toast.error('해당 평가단위의 조직 평가 등급(쿼터)이 확정되지 않았습니다. HR 관리자가 등급 쿼터를 확정한 후 등급을 배정할 수 있습니다.'); return; }
    if (member0 && !isMemberReadyForEval(member0.id) && indivEvals[memberId]?.status !== 'EXEC_CONFIRMED' && indivEvals[memberId]?.status !== 'PUBLISHED') {
      toast.error('평가 대상자가 자기평가와 육성면담서를 모두 제출해야 등급을 배정할 수 있습니다.'); return;
    }
    if (!canAssignMember(member0)) { toast.error('이미 확정되어 수정할 수 없습니다. (수정요청 또는 HR 쿼터 재조정 필요)'); return; }
    const input = confirmInputs[memberId];
    if (!input?.grade) { toast.error('등급을 선택해주세요.'); return; }

    setSaving(memberId);
    try {
      const orgId = member0.organizationId ?? userProfile.organizationId;
      await upsertIndividualEvaluation(memberId, year, {
        organizationId: orgId,
        execGrade: input.grade as EvaluationGrade,
        execComment: input.comment,
      });
      toast.success(`${member0.name ?? ''} 등급을 배정했습니다. (확정 전까지 수정 가능)`);
      await load();
    } catch (err) {
      console.error('[등급배정] 실패:', err);
      toast.error('등급 배정에 실패했습니다.');
    } finally { setSaving(null); }
  }

  // 평가 단위 확정 — 역할별:
  //  SOLE  : 배정 등급을 바로 EXEC_CONFIRMED(최종). (상위 임원 없음)
  //  UNIT  : 배정 등급을 HQ_REVIEWED(본부 확정 1차). 이후 부문 임원의 최종 확정 필요.
  //  FINAL : 본부 확정(HQ_REVIEWED)된 단위를 EXEC_CONFIRMED(최종 확정).
  async function handleUnitAction(rootId: string) {
    if (!userProfile) return;
    if (locked) { toast.error(`${year}년은 확정된 연도입니다.`); return; }
    if (!quotaByUnit[rootId]) { toast.error('조직 평가 등급(쿼터)이 확정되지 않았습니다.'); return; }
    const role = roleByUnit[rootId];
    const orgName = allOrgs.find(o => o.id === rootId)?.name ?? '';
    const list = members.filter(m => unitByOrg[m.organizationId] === rootId);

    if (role === 'FINAL') {
      const notConfirmed = list.filter(m => indivEvals[m.id]?.status !== 'HQ_REVIEWED' && indivEvals[m.id]?.status !== 'EXEC_CONFIRMED' && indivEvals[m.id]?.status !== 'PUBLISHED');
      if (notConfirmed.length > 0) { toast.error(`본부 확정 대기 중입니다. (미확정 ${notConfirmed.length}명) 본부 임원의 본부 확정 후 최종 확정할 수 있습니다.`); return; }
      if (!confirm(`${orgName} ${list.length}명의 평가를 최종 확정합니다.\n최종 확정 후에는 수정하려면 HR 관리자가 쿼터를 재조정해야 합니다.\n진행하시겠습니까?`)) return;
      setFinalizing(rootId);
      try {
        const targets = list.filter(m => indivEvals[m.id]?.status === 'HQ_REVIEWED');
        await Promise.all(targets.map(m => {
          const ie = indivEvals[m.id]!;
          return upsertIndividualEvaluation(m.id, year, {
            organizationId: m.organizationId,
            execGrade: ie.execGrade as EvaluationGrade,
            execComment: ie.execComment ?? '',
            execConfirmedBy: userProfile.id,
            execConfirmedAt: new Date(),
            status: 'EXEC_CONFIRMED',
          });
        }));
        toast.success(`${orgName} 평가가 최종 확정되었습니다. (${list.length}명)`);
        await load();
      } catch (err) { console.error('[최종확정] 실패:', err); toast.error('최종 확정에 실패했습니다.'); }
      finally { setFinalizing(null); }
      return;
    }

    // SOLE / UNIT — 전원 배정 필요
    const unassigned = list.filter(m => !indivEvals[m.id]?.execGrade);
    if (unassigned.length > 0) { toast.error(`미배정 ${unassigned.length}명 — 전원에게 등급을 배정해야 확정할 수 있습니다.`); return; }
    const targetStatus: IndividualEvaluation['status'] = role === 'SOLE' ? 'EXEC_CONFIRMED' : 'HQ_REVIEWED';
    const actionLabel = role === 'SOLE' ? '평가완료(최종 확정)' : '본부 확정';
    const note = role === 'SOLE'
      ? '확정 후에는 수정하려면 HR 관리자가 쿼터를 재조정해야 합니다.'
      : '본부 확정 후에는 부문 임원의 최종 확정이 진행됩니다. 수정이 필요하면 부문 임원의 수정요청 또는 HR 쿼터 재조정이 필요합니다.';
    if (!confirm(`${orgName} ${list.length}명을 ${actionLabel} 처리합니다.\n${note}\n진행하시겠습니까?`)) return;

    setFinalizing(rootId);
    try {
      const targets = list.filter(m => {
        const s = indivEvals[m.id]?.status;
        return s !== 'EXEC_CONFIRMED' && s !== 'PUBLISHED' && s !== 'HQ_REVIEWED';
      });
      await Promise.all(targets.map(m => {
        const ie = indivEvals[m.id]!;
        const patch: Partial<IndividualEvaluation> = {
          organizationId: m.organizationId,
          execGrade: ie.execGrade as EvaluationGrade,
          execComment: ie.execComment ?? '',
          status: targetStatus,
        };
        if (role === 'SOLE') { patch.execConfirmedBy = userProfile.id; patch.execConfirmedAt = new Date(); }
        else { patch.unitConfirmedBy = userProfile.id; patch.unitConfirmedAt = new Date(); }
        return upsertIndividualEvaluation(m.id, year, patch);
      }));
      toast.success(`${orgName} ${actionLabel} 완료 (${list.length}명)`);
      await load();
    } catch (err) { console.error('[단위확정] 실패:', err); toast.error('확정 처리에 실패했습니다.'); }
    finally { setFinalizing(null); }
  }

  // 부문 임원 '수정요청' — 본부 확정(HQ_REVIEWED)을 LEAD_REVIEWED 로 되돌려 본부 임원이 재배정하게 한다.
  async function handleReviseRequest(rootId: string) {
    if (!userProfile) return;
    if (locked) { toast.error(`${year}년은 확정된 연도입니다.`); return; }
    const orgName = allOrgs.find(o => o.id === rootId)?.name ?? '';
    const list = members.filter(m => unitByOrg[m.organizationId] === rootId && indivEvals[m.id]?.status === 'HQ_REVIEWED');
    if (list.length === 0) { toast.error('본부 확정된 인원이 없어 수정요청할 수 없습니다.'); return; }
    const comment = window.prompt(`${orgName} 본부 임원에게 전달할 수정 의견을 입력하세요. (전체 인원 재검토 요청)`);
    if (comment === null) return;
    setFinalizing(rootId);
    try {
      await Promise.all(list.map(m => upsertIndividualEvaluation(m.id, year, {
        organizationId: m.organizationId,
        status: 'LEAD_REVIEWED',
        reviseComment: comment.trim(),
        reviseBy: userProfile.id,
        reviseAt: new Date(),
      })));
      // 본부 임원에게 알림
      const unitLeaderId = allOrgs.find(o => o.id === rootId)?.leaderId;
      if (unitLeaderId && unitLeaderId !== userProfile.id) {
        await createNotification({
          userId: unitLeaderId,
          type: 'EVAL_REVISE_REQUESTED',
          category: 'EVALUATION',
          title: `${orgName} 평가 수정요청`,
          message: `${userProfile.name} 임원이 ${orgName} 평가에 대해 수정을 요청했습니다.${comment.trim() ? ` — "${comment.trim()}"` : ''}`,
          link: '/evaluation',
          read: false,
        }).catch(() => {});
      }
      toast.success(`${orgName} 수정요청을 보냈습니다. (${list.length}명, 본부 임원 재배정 대기)`);
      await load();
    } catch (err) { console.error('[수정요청] 실패:', err); toast.error('수정요청에 실패했습니다.'); }
    finally { setFinalizing(null); }
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
  // 탭 진행도 — 등급이 '배정'된(execGrade 저장) 인원 기준(임시 배정 포함). 평가완료 전 진행 상황을 보여준다.
  function tabProgress(orgId: string): { confirmed: number; total: number } {
    const list = membersByOrg[orgId] ?? [];
    let confirmed = 0;
    for (const m of list) {
      if (indivEvals[m.id]?.execGrade) confirmed++;
    }
    return { confirmed, total: list.length };
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="평가 등급 확정" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <YearLockBanner />
      {beforePeriod && <div className="px-6 pt-4"><EvalPeriodNotice startDate={startDate} /></div>}

        {/* 쿼터 현황 — 평가 단위(부문/본부 등)별로 표시. 한 임원이 여러 평가단위를 담당하면 여러 블록이 표시된다. */}
        {unitIds.map(rid => {
          const q = quotaByUnit[rid];
          const orgName = allOrgs.find(o => o.id === rid)?.name ?? rid;
          if (!q) {
            return (
              <div key={rid} className="rounded-xl border border-orange-200 bg-orange-50 px-5 py-3.5 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-orange-400 shrink-0" />
                <p className="text-sm text-orange-700">
                  <span className="font-semibold">{orgName}</span> — 조직 평가 등급(쿼터)이 확정되지 않았습니다. HR 관리자가 등급 쿼터를 확정한 후 개인 등급을 부여할 수 있습니다.
                </p>
              </div>
            );
          }
          const stats = divisionStats(rid);
          const role = roleByUnit[rid] ?? 'SOLE';
          const allFinalized = stats.total > 0 && stats.finalized === stats.total;
          const allUnitConfirmed = stats.total > 0 && (stats.unitConfirmed + stats.finalized) === stats.total;
          // UNIT 이 본부 확정을 끝내고 부문 임원의 최종 확정을 대기하는 상태
          const unitWaitingFinal = role === 'UNIT' && allUnitConfirmed && !allFinalized;
          // SOLE/UNIT: 전원 배정 & 아직 확정 전 / FINAL: 전원 본부 확정 시 활성
          const canAct = role === 'FINAL'
            ? (allUnitConfirmed && !allFinalized && !locked && !beforePeriod)
            : (stats.total > 0 && stats.assigned === stats.total && !allUnitConfirmed && !allFinalized && !locked && !beforePeriod);
          const actBusy = finalizing === rid;
          const actLabel = role === 'SOLE' ? '평가완료' : role === 'UNIT' ? '본부 확정' : '최종 확정';
          const roleTag = role === 'UNIT' ? '본부 확정(1차)' : role === 'FINAL' ? '부문 최종 확정(2차)' : '평가완료';
          const progressText = role === 'FINAL'
            ? `본부확정 ${stats.unitConfirmed + stats.finalized}/${stats.total}`
            : `배정 ${stats.assigned}/${stats.total}`;
          return (
            <div key={rid} className="rounded-xl border bg-white px-5 py-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold text-gray-500">
                  {unitIds.length > 1 && <span className="text-gray-700">{orgName} · </span>}
                  {year}년 {orgName} 등급 쿼터 (조직 {q.orgGrade}등급 · 총 {q.totalMembers}명)
                  <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{roleTag}</span>
                  <span className="ml-2 font-normal text-gray-400">{progressText}{allFinalized && ' · 최종 확정 완료'}</span>
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {allFinalized ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-bold text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> 최종 확정 완료
                    </span>
                  ) : unitWaitingFinal ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> 본부 확정됨 · 부문 임원 최종 확정 대기
                    </span>
                  ) : (
                    <>
                      {role === 'FINAL' && (stats.unitConfirmed > 0) && (
                        <Button size="sm" variant="outline" disabled={actBusy || locked} onClick={() => handleReviseRequest(rid)}>
                          수정요청
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={!canAct || actBusy}
                        title={
                          locked ? '확정된 연도입니다.'
                            : beforePeriod ? '평가기간에만 확정할 수 있습니다.'
                            : role === 'FINAL'
                              ? (allUnitConfirmed ? '본부 확정된 평가를 최종 확정합니다.' : '본부 임원의 본부 확정 후 최종 확정할 수 있습니다.')
                              : (stats.assigned !== stats.total ? `미배정 ${stats.total - stats.assigned}명 — 전원 배정 후 확정할 수 있습니다.` : `${actLabel} 처리`)
                        }
                        onClick={() => handleUnitAction(rid)}
                      >
                        {actBusy ? '처리 중...' : actLabel}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                {GRADES.map(g => {
                  const quota = getQuotaCount(rid, g);
                  const assignees = assignedMembers(rid, g);
                  const used = assignees.length;
                  const remaining = quota - used;
                  return (
                    <div key={g} className={`rounded-lg border px-4 py-2.5 text-center min-w-[80px] ${
                      remaining <= 0 && quota > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'
                    }`}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold mb-1 ${GRADE_COLOR[g]}`}>{g}</span>
                      <p className="text-lg font-bold text-gray-900">{quota}<span className="text-xs font-normal text-gray-400">명</span></p>
                      <p className="text-xs text-gray-400">잔여 <span className={remaining <= 0 && quota > 0 ? 'text-red-500 font-medium' : 'text-gray-600'}>{remaining}</span></p>
                      {assignees.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-0.5">
                          {assignees.map(m => (
                            <p key={m.id} className="text-[11px] font-medium text-gray-600 leading-tight truncate max-w-[120px]" title={m.name}>{m.name}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

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
                innovationsByMember={innovationsByMember}
                actor={{ id: userProfile.id, name: userProfile.name }}
                scopeLabel="산하 전체"
                allOrgs={allOrgs}
                allScopeGoals={scopeGoals}
                annualGoals={annualGoals}
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
                      const submitted = se?.status === 'SUBMITTED'; // 자기평가 '제출(SUBMITTED)'만 인정 — 임시저장·육성면담서 존재는 미제출
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
                            {ie?.execGrade && (
                              isConfirmed ? (
                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold shrink-0 ${GRADE_COLOR[ie.execGrade]}`}>확정 {ie.execGrade}</span>
                              ) : (
                                <span className="rounded-full px-2.5 py-0.5 text-xs font-bold shrink-0 border border-dashed border-gray-300 text-gray-500" title="임시 배정 — 평가완료 전까지 수정 가능">배정 {ie.execGrade}</span>
                              )
                            )}
                          </div>
                          {/* 이전 평가등급 의견(임원 화면) — 팀장·본부 등급의견 + 자기평가 점수 */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {(() => { const t = computeSelfEvalTotal(reconcileSelfEval(se, goalsByMember[member.id])); return t != null && (
                              <span className="text-[11px] rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-700 font-semibold">자기평가 {t}점</span>
                            ); })()}
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
                    const memberUnit = unitByOrg[member.organizationId];
                    const memberQuota = quotaOfMember(member); // 멤버 소속 평가단위 쿼터(없으면 null = 미확정)
                    const memberRole = roleOfMember(member);          // SOLE/UNIT/FINAL
                    const canAssign = canAssignMember(member);        // 등급 배정·수정 가능 여부
                    const isUnitConfirmed = ie?.status === 'HQ_REVIEWED'; // 본부 확정(1차) 완료
                    const isFinalView = memberRole === 'FINAL';        // 부문 임원(최종 확정자) 시점 — 읽기 전용
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

                        {/* 수정요청 의견 (부문 임원 → 본부 임원) */}
                        {ie?.reviseComment && !isConfirmed && (
                          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                            <p className="text-sm font-bold text-amber-700 mb-1">수정요청 — {approverTitle(ie.reviseBy, execUsersCache, '부문 임원')}</p>
                            <p className="text-sm text-amber-800 whitespace-pre-wrap leading-relaxed">{ie.reviseComment}</p>
                          </div>
                        )}

                        {/* 등급 배정 입력 */}
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 space-y-3">
                          <p className="text-sm font-bold text-indigo-700">
                            {isFinalView ? '배정 등급 (본부 임원)' : `${userProfile?.position || '임원'} 등급 배정`}
                            {isConfirmed ? <span className="text-green-600"> · 최종 확정</span> : isUnitConfirmed && <span className="text-indigo-500"> · 본부 확정(부문 최종 대기)</span>}
                          </p>
                          {!isConfirmed && !isUnitConfirmed && !isMemberReadyForEval(member.id) && (
                            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                              평가 대상자가 <b>자기평가·육성면담서</b>를 모두 제출해야 등급을 배정할 수 있습니다.
                              (자기평가 {selfEvals[member.id]?.status === 'SUBMITTED' ? '제출✓' : '미제출'} · 육성면담서 {mentoringForms[member.id]?.status === 'SUBMITTED' ? '제출✓' : '미제출'})
                            </div>
                          )}
                          <div>
                            <p className="text-xs text-gray-500 mb-2">등급 선택</p>
                            <div className="flex gap-2">
                              {GRADES.map(g => {
                                const remaining = getRemaining(memberUnit, g);
                                const isSelected = input.grade === g;
                                const isFull = !isSelected && remaining <= 0 && memberQuota !== null;
                                return (
                                  <div key={g} className="text-center">
                                    <button
                                      disabled={!canAssign || saving === member.id || isFull || locked || !memberQuota}
                                      onClick={() => setConfirm(p => ({ ...p, [member.id]: { ...p[member.id], grade: g } }))}
                                      className={`w-10 h-10 rounded-lg text-sm font-bold border-2 transition-all ${
                                        isSelected ? `${GRADE_COLOR[g]} border-current`
                                          : isFull ? 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
                                          : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400'
                                      } disabled:opacity-50`}>
                                      {g}
                                    </button>
                                    {memberQuota && <p className={`text-[10px] mt-0.5 ${remaining <= 0 ? 'text-red-400' : 'text-gray-400'}`}>잔여{remaining}</p>}
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
                              onKeyDown={shiftEnterSubmit(() => handleConfirm(member.id), canAssign && saving !== member.id && !!input.grade && !locked && !beforePeriod && !!memberQuota)}
                              disabled={!canAssign || saving === member.id || locked || !memberQuota}
                              rows={2}
                              placeholder="등급 부여 이유 또는 의견을 작성해주세요 (Shift+Enter 배정)"
                              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50" />
                          </div>
                          <div className="flex justify-end items-center gap-2">
                            {isConfirmed ? (
                              <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> 최종 확정됨</span>
                            ) : isFinalView ? (
                              isUnitConfirmed
                                ? <span className="text-xs text-indigo-600 font-medium">본부 확정됨 · 상단 ‘최종 확정’으로 확정하세요</span>
                                : <span className="text-xs text-gray-400">본부 임원의 본부 확정 대기 중</span>
                            ) : !isMemberReadyForEval(member.id) ? (
                              <span className="text-xs text-amber-600 font-medium">자기평가·육성면담서 제출 후 배정 가능</span>
                            ) : !canAssign ? (
                              <span className="text-xs text-indigo-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> 본부 확정됨 · 부문 임원 최종 확정 대기</span>
                            ) : (
                              <>
                                {ie?.execGrade && <span className="text-[11px] text-gray-400">배정됨 · 확정 전까지 수정 가능</span>}
                                <Button size="sm" disabled={saving === member.id || !input.grade || locked || beforePeriod || !memberQuota} title={!memberQuota ? '해당 평가단위의 조직 평가 등급(쿼터) 확정 후 등급을 배정할 수 있습니다.' : beforePeriod ? '평가기간에만 배정할 수 있습니다.' : undefined} onClick={() => handleConfirm(member.id)}>
                                {saving === member.id ? '배정 중...' : (ie?.execGrade ? '등급 수정' : '등급 배정')}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* 자기평가 (핵심목표 가중치·점수 / 일반업무 / 혁신) */}
                        <div>
                          <p className="text-sm font-bold text-gray-800 mb-2">
                            자기평가
                            {(() => { const t = computeSelfEvalTotal(reconcileSelfEval(selfEvals[member.id], goalsByMember[member.id])); return t != null && (
                              <span className="ml-1.5 text-indigo-600">(자기평가 점수 {t}점{selfEvals[member.id]?.status !== 'SUBMITTED' && ' · 작성중'})</span>
                            ); })()}
                          </p>
                          {(() => {
                            const cg = (goalsByMember[member.id] ?? []).filter(g =>
                              g.status === 'APPROVED' || g.status === 'IN_PROGRESS' || g.status === 'COMPLETED' ||
                              g.status === 'PENDING_ABANDON' || (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange));
                            const completed = cg.filter(g => g.status === 'COMPLETED').length;
                            // (B) 미제출(작성중) 자기평가도 검토용 표시. goalEvals는 현재 완료된 핵심목표만 반영(정합화).
                            return (
                              <SelfEvalBody form={reconcileSelfEval(selfEvals[member.id], goalsByMember[member.id])}
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
        )}
      </div>
    </div>
  );
}
