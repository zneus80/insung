'use client';

import type { SelfEvaluation } from '@/types';

/**
 * 자기평가 읽기전용 표시 (평가등급 확정/팀원평가 상세에서 사용).
 * 핵심목표(가중치·점수) / 주요 일반업무(가중치·점수) / 참여 혁신활동(서술).
 */
const SECTION: Record<string, { head: string; bar: string }> = {
  blue: { head: 'text-blue-700', bar: 'bg-blue-400' },
  amber: { head: 'text-amber-700', bar: 'bg-amber-400' },
  emerald: { head: 'text-emerald-700', bar: 'bg-emerald-500' },
};
function Section({ title, color, right, children }: { title: string; color: 'blue' | 'amber' | 'emerald'; right?: React.ReactNode; children: React.ReactNode }) {
  const c = SECTION[color];
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5">
        <span className={`h-3.5 w-1 rounded-full ${c.bar}`} />
        <h4 className={`text-sm font-bold ${c.head}`}>{title}</h4>
        {right && <span className="ml-auto text-xs text-gray-400">{right}</span>}
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </section>
  );
}

function ScoredRow({ title, comment, weight, score }: { title: string; comment?: string; weight?: number; score?: number }) {
  const weighted = (weight != null && score != null) ? Math.round((score * (weight / 100)) * 10) / 10 : null;
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 flex-1 min-w-0">{title}</p>
        <div className="flex items-center gap-1.5 shrink-0 text-xs">
          {weight != null && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 font-semibold">{weight}%</span>}
          {score != null && <span className="text-gray-600">{score}점{weighted != null && <span className="text-indigo-600 font-medium"> · 환산 {weighted}</span>}</span>}
        </div>
      </div>
      {comment?.trim()
        ? <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed">{comment}</p>
        : <p className="text-xs text-gray-300 mt-1">미작성</p>}
    </div>
  );
}

export default function SelfEvalBody({ form }: { form: SelfEvaluation | null }) {
  if (!form) {
    return <p className="text-sm text-gray-400 px-1 py-4">제출된 자기평가가 없습니다.</p>;
  }
  const goals = form.goalEvals ?? [];
  const general = form.generalEvals ?? [];
  const innov = form.innovationEvals ?? [];
  const total = (() => {
    let t = 0;
    goals.forEach(g => { if (g.weight != null && g.score != null) t += g.score * (g.weight / 100); });
    general.forEach(g => { if (g.weight != null && g.score != null) t += g.score * (g.weight / 100); });
    return Math.round(t * 10) / 10;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end text-xs text-gray-500">
        가중 환산 총점 <b className="ml-1 text-indigo-700 text-sm">{total}</b> / 100
      </div>
      <Section title="핵심목표 (완료 · 80%)" color="blue">
        {goals.length === 0 ? <p className="text-xs text-gray-400">없음</p>
          : goals.map(e => <ScoredRow key={e.goalId} title={e.goalTitle} comment={e.comment} weight={e.weight} score={e.score} />)}
      </Section>
      <Section title="주요 일반업무 (★ · 20%)" color="amber">
        {general.length === 0 ? <p className="text-xs text-gray-400">없음</p>
          : general.map(e => <ScoredRow key={e.id} title={e.title} comment={e.comment} weight={e.weight} score={e.score} />)}
      </Section>
      <Section title="참여 혁신활동" color="emerald">
        {innov.length === 0 ? <p className="text-xs text-gray-400">없음</p>
          : innov.map(e => (
            <div key={e.activityId} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
              <p className="text-sm font-medium text-gray-800">{e.name}</p>
              {e.comment?.trim()
                ? <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed">{e.comment}</p>
                : <p className="text-xs text-gray-300 mt-1">미작성</p>}
            </div>
          ))}
      </Section>
    </div>
  );
}
