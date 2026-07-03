'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import AuthGuard from '@/components/layout/AuthGuard';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Sparkles, Send, Loader2, Database, Square, SlidersHorizontal, RotateCcw } from 'lucide-react';
import {
  getAllUsers, getOrganizations, getAllGoalsByYear, getAllIndividualEvaluations,
  getSelfEvaluationsByUsers, getMentoringFormsByUsers, getAllWeeklyTasksByYear,
  listInnovationActivities, listAllInnovationActivities, getAllAwards, getAllMileages, createAuditLog,
  getSystemSettings, updateSystemSettings, getAllOrgAnnualGoals,
  getAttendancesByYear, getOrgEvaluations,
} from '@/lib/firestore';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import { getMyScopeOrgIds } from '@/lib/approval-filters';
import { computePromotion, computeSmartProjectCounts } from '@/lib/promotion';
import { compareUserByRolePositionHire } from '@/lib/user-sort';
import { computeSelfEvalTotal, reconcileSelfEval } from '@/components/evaluation/SelfEvalBody';
import { askAssistant, type AssistantTurn } from '@/lib/ai-assistant';
import { EVAL_CRITERIA_BODY, buildAnnualGoalContext } from '@/lib/ai-eval';
import { computeLeaderTeamAchievement } from '@/lib/team-achievement';
import { cn } from '@/lib/utils';
import MarkdownLite from '@/components/ui/MarkdownLite';
import type { Goal, IndividualEvaluation, SelfEvaluation, MentoringForm, WeeklyTask, SimpleTaskItem, InnovationActivity, Award, Attendance, OrganizationEvaluation } from '@/types';

const NOW_YEAR = new Date().getFullYear();
const YEAR_OPTIONS: (number | 'all')[] = [NOW_YEAR, NOW_YEAR - 1, NOW_YEAR - 2, 'all'];

const EXAMPLES = [
  '회사 내 직무별 JD(직무기술서)를 만들어줘.',
  '전체 인원 기준 성과를 요약하고 서열을 매겨줘.',
  '핵심목표 완료율이 낮은 인원과 그 원인을 분석해줘.',
  '팀별 업무 추진 효율성을 비교해줘.',
];

export default function AiAssistantPage() {
  return (
    <AuthGuard allowedRoles={['CEO', 'EXECUTIVE']} requireHrMaster>
      <AssistantContent />
    </AuthGuard>
  );
}

function AssistantContent() {
  const { userProfile } = useAuth();
  const [year, setYear] = useState<number | 'all'>(NOW_YEAR);
  const [dossier, setDossier] = useState<string | null>(null);
  const [dossierYear, setDossierYear] = useState<number | 'all' | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [dossierChars, setDossierChars] = useState(0);
  const [annualCtx, setAnnualCtx] = useState(''); // 회사 경영목표·조직 연간목표 컨텍스트(B⑤)
  const [building, setBuilding] = useState(false);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // AI 평가기준 편집 (HR마스터)
  const [showCriteria, setShowCriteria] = useState(false);
  const [criteriaText, setCriteriaText] = useState('');
  const [criteriaSaving, setCriteriaSaving] = useState(false);
  const [criteriaCustom, setCriteriaCustom] = useState(false); // 저장된 커스텀값 사용 중 여부

  useEffect(() => {
    (async () => {
      const s = await getSystemSettings().catch(() => null);
      const cur = (s?.aiEvalCriteria && s.aiEvalCriteria.length > 0) ? s.aiEvalCriteria : EVAL_CRITERIA_BODY;
      setCriteriaText(cur.join('\n'));
      setCriteriaCustom(!!(s?.aiEvalCriteria && s.aiEvalCriteria.length > 0));
    })();
  }, []);

  async function saveCriteria() {
    if (!userProfile) return;
    const lines = criteriaText.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim().length > 0);
    if (lines.length === 0) { toast.error('평가기준이 비어 있습니다.'); return; }
    setCriteriaSaving(true);
    try {
      await updateSystemSettings({ aiEvalCriteria: lines, updatedBy: userProfile.id });
      setCriteriaCustom(true);
      createAuditLog({
        action: 'AI_EVAL_CRITERIA_UPDATE', actorId: userProfile.id, actorName: userProfile.name,
        details: `AI 평가기준 수정 (${lines.length}개 항목)`,
      }).catch(() => {});
      toast.success('AI 평가기준이 저장되었습니다. 이후 성과요약·챗봇에 즉시 반영됩니다.');
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally { setCriteriaSaving(false); }
  }

  function resetCriteriaToDefault() {
    setCriteriaText(EVAL_CRITERIA_BODY.join('\n'));
    toast.info('기본값을 불러왔습니다. 저장해야 적용됩니다.');
  }
  // 스트리밍 자동 스크롤 — 사용자가 위로 올려 읽는 중이면 따라가지 않음
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  useEffect(() => {
    if (followRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  function stop() {
    abortRef.current?.abort();
  }

  const yearLabel = year === 'all' ? '전체 누적' : `${year}년`;

  // 구성원 데이터(dossier) 구성 — CEO·HR마스터(전 직원 열람권) 범위
  async function buildDossier() {
    setBuilding(true);
    const tStart = performance.now();
    try {
      const years = year === 'all' ? [NOW_YEAR, NOW_YEAR - 1, NOW_YEAR - 2] : [year];
      const [allUsers, orgs] = await Promise.all([getAllUsers(), getOrganizations()]);
      const orgById = new Map(orgs.map(o => [o.id, o]));
      // 조직 경로(상위부문 > 본부 > 팀) — AI 가 부문/본부/팀 단위로 정확히 분류하도록. 회사(COMPANY) 최상위는 제외.
      const orgPath = (id?: string): string => {
        const names: string[] = [];
        let cur = id ? orgById.get(id) : undefined;
        let guard = 0;
        while (cur && guard++ < 10) {
          if (cur.type !== 'COMPANY') names.unshift(cur.name);
          cur = cur.parentId ? orgById.get(cur.parentId) : undefined;
        }
        return names.join(' > ');
      };
      // 회사 경영목표·조직 연간목표 컨텍스트(B⑤ 정렬 가·감점) — 대표 연도 기준
      const repYear = year === 'all' ? NOW_YEAR : year;
      getAllOrgAnnualGoals(repYear).then(ag => setAnnualCtx(buildAnnualGoalContext(ag, orgs))).catch(() => setAnnualCtx(''));
      // 분석 대상 범위: CEO·HR마스터는 전사 / 임원은 본인 책임 조직(+산하)만 (§6-1 가시성)
      const isFullAccess = userProfile?.role === 'CEO' || !!userProfile?.isHrMaster;
      const scopeOrgSet = isFullAccess || !userProfile
        ? null
        : new Set(getMyScopeOrgIds(userProfile.id, userProfile.role, userProfile.organizationId, orgs));
      // 평가 대상 인원 (임원·CEO 제외). 임원이면 본인 스코프 조직 소속만.
      // 정렬: 조직(경로)별 묶음 → 그 안에서 팀장→팀원(책임·주임 등 직급순, 동일 직급은 입사일순)
      const people = allUsers
        .filter(u => u.isActive && u.role !== 'CEO' && u.role !== 'EXECUTIVE'
          && (!scopeOrgSet || scopeOrgSet.has(u.organizationId)))
        .sort((a, b) => orgPath(a.organizationId).localeCompare(orgPath(b.organizationId), 'ko') || compareUserByRolePositionHire(a, b));
      const ids = people.map(u => u.id);

      // 연도별 데이터 로드
      const perYear: Record<number, {
        goals: Goal[]; ie: IndividualEvaluation[]; se: SelfEvaluation[];
        mf: MentoringForm[]; wt: WeeklyTask[]; innov: InnovationActivity[];
        att: Attendance[]; orgEval: OrganizationEvaluation[];
      }> = {};
      await Promise.all(years.map(async y => {
        const [goals, ie, se, mf, wt, innov, att, orgEval] = await Promise.all([
          getAllGoalsByYear(y),
          getAllIndividualEvaluations(y),
          getSelfEvaluationsByUsers(ids, y),
          getMentoringFormsByUsers(ids, y),
          getAllWeeklyTasksByYear(y),
          listInnovationActivities(y),
          getAttendancesByYear(y).catch(() => [] as Attendance[]),
          getOrgEvaluations(y).catch(() => [] as OrganizationEvaluation[]),
        ]);
        perYear[y] = { goals, ie, se, mf, wt, innov, att, orgEval };
      }));
      // 승진요건 — 스마트프로젝트는 전체 연도 누적 집계(승진 기준)
      const allInnov = await listAllInnovationActivities().catch(() => [] as InnovationActivity[]);
      const spCounts = computeSmartProjectCounts(allInnov);
      // 포상 — 전체 연도 단일 조회 후 사용자별 그룹화 (인원수만큼 개별 조회 시 Firestore resource-exhausted 발생)
      const allAwards: Award[] = await getAllAwards().catch(() => []);
      const awardsByUser: Record<string, Award[]> = {};
      for (const a of allAwards) { (awardsByUser[a.userId] ??= []).push(a); }
      // 마일리지 — 누적값(연도 무관) 단일 조회 후 사용자별 매핑
      const allMileages = await getAllMileages().catch(() => []);
      const mileageByUser: Record<string, number> = {};
      for (const m of allMileages) { mileageByUser[m.userId] = m.points; }
      const mileageObjByUser = new Map(allMileages.map(m => [m.userId, m]));

      const JR: Record<string, string> = { EXPAND: '직무확대', REDUCE: '직무축소', CHANGE: '직무변경', RELOCATE: '근무지이동', SATISFIED: '만족' };
      const dossierArr = people.map(u => {
        const yrs: Record<string, unknown> = {};
        for (const y of years) {
          const d = perYear[y];
          const myGoals = d.goals.filter(g => g.userId === u.id || (g.collaboratorIds ?? []).includes(u.id));
          const evalGoals = myGoals.filter(g => ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_ABANDON'].includes(g.status) || (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange));
          const completed = evalGoals.filter(g => g.status === 'COMPLETED').length;
          const abandoned = evalGoals.filter(g => g.status === 'ABANDONED' || g.status === 'PENDING_ABANDON').length;
          const ie = d.ie.find(e => e.userId === u.id);
          const se = d.se.find(e => e.userId === u.id);
          const mf = d.mf.find(e => e.userId === u.id);
          // 본인 작성분 + 참여분(핵심업무 실적의 참여인원으로 지정된 항목) — 참여 실적 누락 방지
          const isMine = (i: SimpleTaskItem, w: WeeklyTask) => (i.authorId ?? w.userId) === u.id || (i.participantIds ?? []).includes(u.id);
          const weeklyHi = d.wt
            .slice().sort((a, b) => b.weekNumber - a.weekNumber) // 최신 주차 우선 — 컷오프 시 옛 데이터가 최신을 밀어내지 않도록
            .flatMap(w => (w.hasDoneItems ?? []).filter(i => isMine(i, w)).map(i => (i.title || i.content || '').trim()))
            .filter(Boolean).slice(0, 15);
          const innovNames = d.innov
            .filter(a => a.status !== 'DROPPED')  // Drop(실패·중단)은 성과 집계 제외 — 기록용
            .filter(a => getPmIds(a).includes(u.id) || (a.memberIds ?? []).includes(u.id) || getPerformerIds(a).includes(u.id) || a.instructorId === u.id)
            .map(a => `${a.type === 'SMART_PROJECT' ? (getPmIds(a).includes(u.id) ? 'SP-PM' : 'SP') : 'TDS'}:${a.name}`).slice(0, 6);
          // 5종 데이터(목표·주간보고·자기평가·육성면담서·혁신활동) 중 실제 내용이 하나라도 있는 연도만 기록.
          // 빈 IE 시드(NOT_STARTED·등급 없음)만 있는 연도는 토큰 절약을 위해 비워둔다(인원은 아래에서 그대로 포함).
          const selfHasContent = !!se && ((se.goalEvals ?? []).some(g => g.score != null || !!(g.comment || '').trim())
            || (se.generalEvals ?? []).some(g => g.score != null || !!(g.comment || '').trim())
            || (se.innovationEvals ?? []).some(i => !!(i.comment || '').trim()));
          const mentoringHasContent = !!mf && !!((mf.mainDuties || '').trim() || (mf.careerPlan || '').trim() || mf.jobRequest || (mf.selfOpinion || '').trim() || (mf.educationHistory?.length ?? 0) > 0);
          const hasGrade = !!ie && (ie.status === 'EXEC_CONFIRMED' || ie.status === 'PUBLISHED') && !!ie.execGrade;
          if (evalGoals.length === 0 && weeklyHi.length === 0 && innovNames.length === 0 && !selfHasContent && !mentoringHasContent && !hasGrade) continue;
          // 목표별 주간 추진내용(본인 작성, goalId 연계) — 임팩트·진척 추정 근거
          const goalNotes = (gid: string) => d.wt
            .slice().sort((a, b) => b.weekNumber - a.weekNumber)
            .flatMap(w => (w.hasDoneItems ?? []).filter(i => isMine(i, w) && i.goalId === gid).map(i => (i.title || i.content || '').trim()))
            .filter(Boolean).slice(0, 8);
          yrs[y] = {
            grade: ie && (ie.status === 'EXEC_CONFIRMED' || ie.status === 'PUBLISHED') ? ie.execGrade : undefined,
            // 임팩트 추정 정밀화 — 목표 설명(desc)·목표별 주간 추진내용(notes) 포함(성과요약과 동일 수준)
            coreGoals: evalGoals.map(g => ({
              t: g.title,
              s: g.status === 'COMPLETED' ? '완료' : (g.status === 'ABANDONED' || g.status === 'PENDING_ABANDON') ? '포기' : '추진중',
              p: g.progress, w: g.weights?.[u.id] ?? g.weight,
              desc: g.description?.slice(0, 200) || undefined,
              // KPI·추진기한 — 임팩트/실효성/기한 대비 진척 판단 근거
              kpi: (g.kpis ?? []).slice(0, 6),
              기한: g.dueDate ? new Date(g.dueDate).toISOString().slice(0, 10) : undefined,
              notes: goalNotes(g.id),
            })).slice(0, 15),
            goalStat: { total: completed + (evalGoals.length - completed - abandoned), 완료: completed, 포기: abandoned },
            selfEvalScore: computeSelfEvalTotal(reconcileSelfEval(se ?? null, myGoals)) ?? undefined,
            // 자기평가 상세 — 핵심목표·일반업무 항목별 점수·의견(요약)
            selfEvalCore: (se?.goalEvals ?? []).map(g => ({ t: g.goalTitle, 점수: g.score, 의견: (g.comment || '').slice(0, 100) })).slice(0, 15),
            generalWork: (se?.generalEvals ?? []).map(g => ({ t: g.title, 점수: g.score, 의견: (g.comment || '').slice(0, 100) })).slice(0, 10),
            weeklyHighlights: weeklyHi,
            mentoring: mf ? { 직무: mf.mainDuties?.slice(0, 120), 교육수강: (mf.educationHistory ?? []).map(e => `[${e.type}] ${e.name}`).join(', ') || undefined, 경력개발: mf.careerPlan?.slice(0, 120), 직무요청: mf.jobRequest ? (JR[mf.jobRequest] ?? mf.jobRequest) : undefined, 종합의견: mf.selfOpinion?.slice(0, 150) } : undefined,
            innovation: innovNames,
            // 팀장·본부장 가·감점 — 책임 조직(+산하) 완료율
            teamAchievement: computeLeaderTeamAchievement(u.id, orgs, d.goals) ?? undefined,
            // 근태현황(지각·결근) — HR 입력
            attendance: (() => { const a = d.att.find(x => x.userId === u.id); return a ? { 지각: a.latenessCount, 결근: a.absenceCount } : undefined; })(),
            // 소속 조직의 조직평가등급(확정분만)
            조직평가등급: d.orgEval.find(o => o.organizationId === u.organizationId && o.status === 'APPROVED')?.grade,
          };
        }
        // 데이터가 전혀 없는 인원도 전체 명단에 포함 — years 가 비어 있으면 AI 가 '데이터 없음'으로 처리.
        const awards = (awardsByUser[u.id] ?? []).map(a => `${a.title}(${a.awardDate ?? ''})`).slice(0, 6);
        const noData = Object.keys(yrs).length === 0;
        // 승진요건(누적 기준) — 대상·충족 여부·미충족 사유
        const promo = computePromotion(u, mileageObjByUser.get(u.id), spCounts.get(u.id) ?? { pmCount: 0, pmCompletedCount: 0, memberCount: 0, memberCompletedCount: 0 });
        const promotion = promo.target === '해당 없음' ? undefined : {
          대상: promo.target, 충족: promo.meetsRequirement, 미충족사유: promo.reasonText || undefined,
          SP_PM: promo.pmCount, SP_PM완료: promo.pmCompletedCount, SP_멤버: promo.memberCount, 마일리지: promo.totalPoints,
        };
        return { name: u.name, position: u.position ?? '', org: orgPath(u.organizationId), role: u.role, mileage: mileageByUser[u.id] ?? 0, awards, promotion, years: yrs, ...(noData ? { noData: true } : {}) };
      });

      const json = JSON.stringify(dossierArr);
      setDossier(json);
      setMemberCount(dossierArr.length);
      setDossierChars(json.length);
      setDossierYear(year);
      setTurns([]);
      // 입력 크기 실측 — 한글 기준 대략 글자수÷2 ≈ 토큰
      console.log(`[AI dossier] ${dossierArr.length}명 · ${json.length.toLocaleString()}자 · 약 ${Math.round(json.length / 2).toLocaleString()}토큰 추정 · 준비시간 ${Math.round(performance.now() - tStart)}ms`);
      toast.success(`${dossierArr.length}명 데이터 준비 완료 (${yearLabel})`);
    } catch (e) {
      console.error('[AI 어시스턴트] 데이터 준비 실패:', e);
      toast.error('데이터 준비에 실패했습니다.');
    } finally { setBuilding(false); }
  }

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question || asking) return;
    if (!dossier) { toast.error('먼저 "데이터 준비"를 눌러주세요.'); return; }
    setInput('');
    const history = turns;
    // 사용자 메시지 + 스트리밍용 빈 AI 말풍선 추가
    setTurns(prev => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setAsking(true);
    followRef.current = true;   // 새 답변은 처음부터 따라가기
    const controller = new AbortController();
    abortRef.current = controller;
    // 마지막(AI) 말풍선 내용만 갱신
    const setLast = (content: string) => setTurns(prev => {
      const copy = prev.slice();
      copy[copy.length - 1] = { role: 'assistant', content };
      return copy;
    });
    try {
      const answer = await askAssistant({
        question, history, dossier,
        yearLabel: dossierYear === 'all' ? '전체 누적' : `${dossierYear}년`,
        annualContext: annualCtx,
        onChunk: setLast,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        setLast(answer ? `${answer}\n\n_⏹ 중지됨_` : '_⏹ 중지됨_');
        return;
      }
      setLast(answer);
      createAuditLog({
        action: 'AI_EVAL_SUMMARY',
        actorId: userProfile!.id, actorName: userProfile!.name,
        details: `AI 인사분석 질의(${dossierYear === 'all' ? '전체' : dossierYear}, ${memberCount}명): ${question.slice(0, 80)}`,
      }).catch(() => {});
    } catch (e: any) {
      console.error('[AI 어시스턴트] 응답 실패:', e);
      const msg = String(e?.message ?? '');
      if (/not.*enabled|permission|403|API|backend/i.test(msg)) {
        toast.error('Firebase AI Logic(Vertex AI)이 활성화되지 않았습니다.');
      } else { toast.error('AI 응답 생성에 실패했습니다.'); }
      setLast('⚠️ 응답 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally { setAsking(false); abortRef.current = null; }
  }

  const stale = dossier && dossierYear !== year;

  return (
    <div className="flex flex-col h-full">
      <Header title="AI 인사·성과 분석" showBack />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-violet-700 flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> 누적 업무 실적 기반 AI 분석</p>
            <p className="text-xs text-violet-600">핵심목표·주간업무보고·자기평가·육성면담서·평가등급·혁신·포상을 종합해 답합니다. 결과는 <b>참고용</b>이며 AI는 실수할 수 있습니다. (CEO·HR마스터 전용)</p>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-gray-500">분석 기간</span>
              <select value={String(year)} onChange={e => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="rounded border border-gray-200 px-2 py-1 text-sm">
                {YEAR_OPTIONS.map(y => <option key={String(y)} value={String(y)}>{y === 'all' ? '전체 누적(최근 3년)' : `${y}년`}</option>)}
              </select>
              <Button size="sm" onClick={buildDossier} disabled={building} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {building ? '준비 중…' : '데이터 준비'}
              </Button>
              {dossier && !stale && (
                <span className="text-xs text-green-600 font-medium">
                  ✓ {memberCount}명 준비됨 · {dossierChars.toLocaleString()}자 (입력 약 {Math.round(dossierChars / 2).toLocaleString()}토큰)
                </span>
              )}
              {stale && <span className="text-xs text-amber-600">기간이 변경됨 — 다시 준비하세요</span>}
            </div>
          </div>

          {/* AI 평가기준 편집 (HR마스터) */}
          <div className="rounded-xl border bg-white overflow-hidden">
            <button onClick={() => setShowCriteria(v => !v)}
              className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition-colors">
              <SlidersHorizontal className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-700">AI 평가기준 설정</span>
              <span className={cn('text-[11px] rounded-full px-2 py-0.5', criteriaCustom ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500')}>
                {criteriaCustom ? '사용자 지정' : '기본값'}
              </span>
              <span className="ml-auto text-xs text-gray-400">{showCriteria ? '접기' : '펼치기'}</span>
            </button>
            {showCriteria && (
              <div className="border-t p-4 space-y-3">
                <p className="text-xs text-gray-500">
                  AI 성과요약·챗봇이 순위·등급을 매길 때 적용하는 평가기준입니다. <b>한 줄에 한 항목</b>으로 작성하며, <code>【B. …】</code>처럼 대괄호로 시작하는 줄은 카테고리 제목입니다(가중치·데이터 해석·등급/분포·순위). 저장하면 다음 분석부터 즉시 반영됩니다. 회사 배경(A)·출력 형식·역할 정의 같은 시스템 골격은 자동 적용되며 편집 대상이 아닙니다.
                </p>
                <Textarea value={criteriaText} onChange={e => setCriteriaText(e.target.value)}
                  rows={16} className="font-mono text-xs leading-relaxed resize-y"
                  placeholder="- 평가기준 한 줄에 하나씩..." />
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={resetCriteriaToDefault} disabled={criteriaSaving} className="gap-1.5 text-gray-600">
                    <RotateCcw className="h-3.5 w-3.5" /> 기본값 불러오기
                  </Button>
                  <Button size="sm" onClick={saveCriteria} disabled={criteriaSaving} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                    {criteriaSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}저장
                  </Button>
                </div>
              </div>
            )}
          </div>

          {dossier && turns.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => send(ex)} disabled={asking}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-violet-300 hover:text-violet-700 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
          )}

          {turns.map((t, i) => {
            const streaming = asking && t.role === 'assistant' && i === turns.length - 1;
            return (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={t.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-violet-600 text-white px-4 py-2.5 text-sm whitespace-pre-wrap'
                  : 'max-w-[90%] rounded-2xl rounded-tl-sm bg-white border px-4 py-3 text-sm text-gray-800 leading-relaxed'}>
                  {t.role === 'user'
                    ? t.content
                    : (
                      <>
                        {t.content && <MarkdownLite content={t.content} />}
                        {streaming && (
                          <div className={`flex items-center gap-1.5 text-xs text-violet-500 ${t.content ? 'mt-1.5' : ''}`}>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="animate-pulse">답변 작성 중…</span>
                          </div>
                        )}
                      </>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 입력 */}
      <div className="border-t bg-white p-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={dossier ? '질문을 입력하세요 (Enter 줄바꿈, Shift+Enter 전송)' : '먼저 위에서 데이터 준비를 눌러주세요'}
            rows={2}
            disabled={!dossier || asking}
            className="resize-none flex-1"
          />
          {asking ? (
            <Button onClick={stop} className="gap-1.5 shrink-0 bg-red-600 hover:bg-red-700">
              <Square className="h-4 w-4 fill-current" /> 중지
            </Button>
          ) : (
            <Button onClick={() => send()} disabled={!dossier || !input.trim()} className="gap-1.5 shrink-0 bg-violet-600 hover:bg-violet-700">
              <Send className="h-4 w-4" /> 전송
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
