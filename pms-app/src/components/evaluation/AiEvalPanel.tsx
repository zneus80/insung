'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createAuditLog } from '@/lib/firestore';
import { computeSelfEvalTotal } from '@/components/evaluation/SelfEvalBody';
import { computeLeaderTeamAchievement } from '@/lib/team-achievement';
import type {
  User, Goal, SelfEvaluation, IndividualEvaluation, MentoringForm, WeeklyTask, InnovationActivity, Organization,
} from '@/types';

/**
 * AI 성과 요약 · 참고 순위 패널 (Firebase AI Logic — Vertex AI 백엔드).
 *
 * 분석 범위 = 전달받은 members 전체(팀별 탭 단위가 아님).
 *  · 임원(평가등급확정): 산하 모든 조직 인원
 *  · 본부장(팀원평가): 본부 산하 전원
 *  · 팀장(팀원평가): 본인 팀원
 *
 * 결과는 '참고용' — 최종 등급/순위 결정은 평가권자(사람)가 한다. (CLAUDE.md §6-1 거버넌스)
 * 호출 측이 이미 본인 책임 스코프 멤버만 로드하므로 가시성 원칙 내.
 */

interface Props {
  /** 분석 대상 — 호출 측 스코프 전체 멤버 */
  members: User[];
  goalsByMember: Record<string, Goal[]>;
  weeklyTasksByMember: Record<string, WeeklyTask[]>;
  selfEvals: Record<string, SelfEvaluation>;
  mentoringForms: Record<string, MentoringForm>;
  indivEvals: Record<string, IndividualEvaluation>;
  /** 당해년도 혁신활동 참여(멤버별) — 보조 가점용. 없으면 미반영. */
  innovationsByMember?: Record<string, InnovationActivity[]>;
  /** 감사 로그 actor */
  actor: { id: string; name: string };
  /** 범위 안내 문구 (예: "산하 전체", "○○팀") */
  scopeLabel?: string;
  /** 팀장·본부장 가·감점(책임 팀 완료율) 계산용 — 전체 조직 + 스코프 목표 */
  allOrgs?: Organization[];
  allScopeGoals?: Goal[];
}

export default function AiEvalPanel({
  members, goalsByMember, weeklyTasksByMember, selfEvals, mentoringForms, indivEvals,
  innovationsByMember, actor, scopeLabel, allOrgs, allScopeGoals,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0); // 분석 경과 시간(초)
  const [result, setResult] = useState<import('@/lib/ai-eval').AiEvalResult | null>(null);

  // 분석 중 경과 시간 카운트 — 10초 정도 걸리므로 진행 표시
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 펼친 멤버 — 기본 모두 닫힘
  const toggleExpanded = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? id;

  async function run() {
    if (members.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const { summarizeAndRankMembers } = await import('@/lib/ai-eval');
      const input = members.map(m => {
        const ie = indivEvals[m.id];
        const mf = mentoringForms[m.id];
        const se = selfEvals[m.id];
        // 근거 = ①핵심목표관리 각 목표 ②주간업무보고 ③자기평가(점수 포함). 육성면담서는 요약용 종합의견만 별도 전달.
        const selfEvalComments: string[] = [
          ...(se?.goalEvals ?? []).map(e => `[핵심목표] ${e.goalTitle}${e.score != null ? ` (${e.score}점)` : ''}: ${e.comment ?? ''}`),
          ...(se?.generalEvals ?? []).map(e => `[일반업무] ${e.title}${e.score != null ? ` (${e.score}점)` : ''}: ${e.comment ?? ''}`),
          ...(se?.innovationEvals ?? []).map(e => `[혁신] ${e.name}: ${e.comment ?? ''}`),
        ].filter(s => s.split(': ').slice(1).join(': ').trim());
        // 일반업무만 별도 — 요약에서 핵심목표에 묻히지 않도록
        const generalWorkComments: string[] = (se?.generalEvals ?? [])
          .map(e => `${e.title}${e.score != null ? ` (${e.score}점)` : ''}: ${e.comment ?? ''}`)
          .filter(s => s.split(': ').slice(1).join(': ').trim());
        const JR: Record<string, string> = { EXPAND: '직무 확대', REDUCE: '직무 축소', CHANGE: '직무 변경', RELOCATE: '근무지 이동', SATISFIED: '만족' };
        // 핵심목표(평가 대상) — 완료/추진중/포기(확정). 포기는 미달성으로 별도 카운트.
        const coreGoals = (goalsByMember[m.id] ?? []).filter(g =>
          g.status === 'APPROVED' || g.status === 'IN_PROGRESS' || g.status === 'COMPLETED' ||
          g.status === 'PENDING_ABANDON' || (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange)
        );
        const isAbandoned = (g: Goal) => g.status === 'ABANDONED' || g.status === 'PENDING_ABANDON';
        const statusLabelOf = (g: Goal) => g.status === 'COMPLETED' ? '완료' : isAbandoned(g) ? '포기' : '추진중';
        const completedCount = coreGoals.filter(g => g.status === 'COMPLETED').length;
        const abandonedCount = coreGoals.filter(isAbandoned).length;
        const inProgressCount = coreGoals.length - completedCount - abandonedCount;
        return {
          userId: m.id,
          name: m.name,
          position: m.position,
          currentGrade: ie?.execGrade ?? ie?.hqGrade ?? ie?.leadGrade ?? undefined,
          coreGoalCount: completedCount + inProgressCount, // 유효 목표 수(포기 제외)
          completedCount,
          inProgressCount,
          abandonedCount,
          selfEvalTotal: computeSelfEvalTotal(se ?? null) ?? undefined,
          innovationCount: (innovationsByMember?.[m.id] ?? []).length || undefined,
          innovationNames: (innovationsByMember?.[m.id] ?? []).map(a => a.name).filter(Boolean).slice(0, 8),
          goals: coreGoals.map(g => ({
            title: g.title, statusLabel: statusLabelOf(g), progress: g.progress,
            weight: g.weights?.[m.id] ?? g.weight,
            description: g.description?.slice(0, 200),
            // 이 목표의 주간 진행사항(주간업무보고에서 goalId 연계된 항목) — 난도 추정 보조
            weeklyNotes: (weeklyTasksByMember[m.id] ?? [])
              .flatMap(wt => (wt.hasDoneItems ?? []).filter(i => i.goalId === g.id).map(i => (i.title || i.content || '').trim()))
              .filter(Boolean).slice(0, 12),
          })),
          weeklyHighlights: (weeklyTasksByMember[m.id] ?? [])
            .flatMap(wt => (wt.hasDoneItems ?? []).map(i => (i.title || i.content)))
            .filter(Boolean).slice(0, 30),
          selfEvalComments,                            // 자기평가(점수 포함)
          generalWorkComments,                         // 일반업무만 별도
          // 팀장·본부장 가·감점 — 책임 조직(+산하) 완료율
          teamAchievement: (allOrgs && allScopeGoals)
            ? (computeLeaderTeamAchievement(m.id, allOrgs, allScopeGoals) ?? undefined)
            : undefined,
          mentoring: mf ? {
            currentPosition: mf.currentPosition,
            mainDuties: mf.mainDuties,
            careerPlan: mf.careerPlan,
            jobRequest: mf.jobRequest ? (JR[mf.jobRequest] ?? mf.jobRequest) : undefined,
            jobChangeReason: mf.jobChangeReason,
            desiredJobs: [mf.desiredJob1, mf.desiredJob2].filter(Boolean).join(' / ') || undefined,
            desiredLocations: [mf.desiredLocation1, mf.desiredLocation2].filter(Boolean).join(' / ') || undefined,
            locationChangeReason: mf.locationChangeReason,
            selfOpinion: mf.selfOpinion,
            interviewerOpinion: mf.interviewerOpinion,
          } : undefined,
        };
      });
      const res = await summarizeAndRankMembers(input);
      setResult(res);
      setExpanded(new Set()); // 결과는 모두 닫힌 채로 시작
      // 거버넌스: AI 가 누구의 인사평가 데이터를 처리했는지 감사 기록
      createAuditLog({
        action: 'AI_EVAL_SUMMARY',
        actorId: actor.id,
        actorName: actor.name,
        details: `AI 성과 요약·순위 생성 — 대상 ${members.length}명: ${members.map(m => m.name).join(', ')}`,
      }).catch(() => { /* 무시 */ });
    } catch (e: any) {
      console.error('[AI 요약] 실패:', e);
      const msg = String(e?.message ?? '');
      if (/not.*enabled|permission|403|API|backend/i.test(msg)) {
        toast.error('Firebase AI Logic 이 아직 활성화되지 않았습니다. 콘솔에서 AI Logic(Vertex AI) 활성화가 필요합니다.');
      } else {
        toast.error('AI 요약 생성에 실패했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-violet-700">
            AI 성과 요약 · 참고 순위
            {scopeLabel && <span className="ml-1.5 text-xs font-normal text-violet-500">({scopeLabel} {members.length}명 일괄)</span>}
          </p>
          <p className="text-xs text-violet-500">목표, 주간실적, 자기평가, 면담서를 AI가 요약합니다. AI는 실수할 수 있으며, 결과는 <b>참고용</b>이므로 최종 등급은 직접 결정하여야 합니다.</p>
        </div>
        <Button size="sm" disabled={loading || members.length === 0}
          onClick={run}
          className="bg-violet-600 hover:bg-violet-700 shrink-0 gap-1.5">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? `AI 분석 중… ${elapsed}초` : 'AI 요약 생성'}
        </Button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-violet-600">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>AI가 {members.length}명의 목표·주간실적·자기평가·면담서를 종합 분석하고 있습니다… <span className="font-semibold">{elapsed}초</span> (보통 10~20초 소요)</span>
        </div>
      )}
      {result && (
        <div className="space-y-2">
          {result.ranking.length > 0 && (
            <p className="text-xs text-violet-700">
              <span className="font-semibold">참고 순위:</span> {result.ranking.map(r => nameOf(r.userId)).join(' · ')}
            </p>
          )}
          {[...result.summaries].sort((a, b) => {
            // 참고 순위 오름차순(1위 먼저) → 순위 없는 사람은 뒤로
            const ra = result.ranking.find(r => r.userId === a.userId)?.rank ?? 999;
            const rb = result.ranking.find(r => r.userId === b.userId)?.rank ?? 999;
            return ra - rb;
          }).map(s => {
            const rank = result.ranking.find(r => r.userId === s.userId)?.rank;
            const isOpen = expanded.has(s.userId);
            return (
              <div key={s.userId} className="rounded-lg bg-white border border-violet-100">
                <button
                  type="button"
                  onClick={() => toggleExpanded(s.userId)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-50/50 transition-colors"
                >
                  <span className={`text-gray-400 transition-transform text-xs ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  {rank != null && <span className="text-[11px] font-bold text-violet-600 w-5 shrink-0">{rank}위</span>}
                  <span className="text-sm font-semibold text-gray-800">{nameOf(s.userId)}</span>
                  {s.suggestedGrade && <span className="text-[11px] rounded-full bg-violet-100 text-violet-700 px-2 py-0.5">추천 {s.suggestedGrade}</span>}
                </button>
                {isOpen && (
                  <div className="px-3 pb-2.5 pt-0">
                    <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{s.summary}</p>
                    {s.strengths?.length > 0 && <p className="text-[11px] text-green-600 mt-0.5">강점: {s.strengths.join(', ')}</p>}
                    {s.issues?.length > 0 && <p className="text-[11px] text-amber-600">보완: {s.issues.join(', ')}</p>}
                    {s.mentoringSummary?.trim() && (
                      <p className="text-[11px] text-violet-600 mt-1 pt-1 border-t border-violet-50">육성면담서 요약: {s.mentoringSummary}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {result.disclaimer && <p className="text-[11px] text-gray-400">{result.disclaimer}</p>}
        </div>
      )}
    </div>
  );
}
