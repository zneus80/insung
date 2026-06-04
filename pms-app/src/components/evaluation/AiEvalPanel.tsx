'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { createAuditLog } from '@/lib/firestore';
import type {
  User, Goal, SelfEvaluation, IndividualEvaluation, MentoringForm, WeeklyTask,
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
  /** 감사 로그 actor */
  actor: { id: string; name: string };
  /** 범위 안내 문구 (예: "산하 전체", "○○팀") */
  scopeLabel?: string;
}

export default function AiEvalPanel({
  members, goalsByMember, weeklyTasksByMember, selfEvals, mentoringForms, indivEvals,
  actor, scopeLabel,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<import('@/lib/ai-eval').AiEvalResult | null>(null);

  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? id;

  async function run() {
    if (members.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const { summarizeAndRankMembers } = await import('@/lib/ai-eval');
      const input = members.map(m => {
        const ie = indivEvals[m.id];
        return {
          userId: m.id,
          name: m.name,
          position: m.position,
          currentGrade: ie?.execGrade ?? ie?.hqGrade ?? ie?.leadGrade ?? undefined,
          goals: (goalsByMember[m.id] ?? []).map(g => ({ title: g.title, status: g.status, progress: g.progress })),
          weeklyHighlights: (weeklyTasksByMember[m.id] ?? [])
            .flatMap(wt => (wt.hasDoneItems ?? []).map(i => (i.title || i.content)))
            .filter(Boolean).slice(0, 30),
          selfEvalComments: (selfEvals[m.id]?.goalEvals ?? []).map(ge => ge.comment).filter(Boolean),
          mentoringOpinion: mentoringForms[m.id]?.selfOpinion,
        };
      });
      const res = await summarizeAndRankMembers(input);
      setResult(res);
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
          <p className="text-xs text-violet-500">목표·주간실적·자기평가·면담서를 AI가 요약합니다. 결과는 <b>참고용</b>이며 최종 등급은 직접 결정합니다.</p>
        </div>
        <Button size="sm" disabled={loading || members.length === 0}
          onClick={run}
          className="bg-violet-600 hover:bg-violet-700 shrink-0">
          {loading ? 'AI 분석 중…' : 'AI 요약 생성'}
        </Button>
      </div>
      {result && (
        <div className="space-y-2">
          {result.ranking.length > 0 && (
            <p className="text-xs text-violet-700">
              <span className="font-semibold">참고 순위:</span> {result.ranking.map(r => nameOf(r.userId)).join(' · ')}
            </p>
          )}
          {result.summaries.map(s => (
            <div key={s.userId} className="rounded-lg bg-white border border-violet-100 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">{nameOf(s.userId)}</span>
                {s.suggestedGrade && <span className="text-[11px] rounded-full bg-violet-100 text-violet-700 px-2 py-0.5">추천 {s.suggestedGrade}</span>}
              </div>
              <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{s.summary}</p>
              {s.strengths?.length > 0 && <p className="text-[11px] text-green-600 mt-0.5">강점: {s.strengths.join(', ')}</p>}
              {s.issues?.length > 0 && <p className="text-[11px] text-amber-600">보완: {s.issues.join(', ')}</p>}
            </div>
          ))}
          {result.disclaimer && <p className="text-[11px] text-gray-400">{result.disclaimer}</p>}
        </div>
      )}
    </div>
  );
}
