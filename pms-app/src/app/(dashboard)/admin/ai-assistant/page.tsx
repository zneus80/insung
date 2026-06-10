'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import AuthGuard from '@/components/layout/AuthGuard';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Sparkles, Send, Loader2, Database, Square } from 'lucide-react';
import {
  getAllUsers, getOrganizations, getAllGoalsByYear, getAllIndividualEvaluations,
  getSelfEvaluationsByUsers, getMentoringFormsByUsers, getAllWeeklyTasksByYear,
  listInnovationActivities, getAllAwards, createAuditLog,
} from '@/lib/firestore';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import { computeSelfEvalTotal } from '@/components/evaluation/SelfEvalBody';
import { askAssistant, type AssistantTurn } from '@/lib/ai-assistant';
import MarkdownLite from '@/components/ui/MarkdownLite';
import type { Goal, IndividualEvaluation, SelfEvaluation, MentoringForm, WeeklyTask, InnovationActivity, Award } from '@/types';

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
    <AuthGuard allowedRoles={['CEO']} requireHrMaster>
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
  const [building, setBuilding] = useState(false);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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
      const orgName = (id?: string) => orgs.find(o => o.id === id)?.name ?? '';
      // 평가 대상 인원 (임원·CEO 제외)
      const people = allUsers.filter(u => u.isActive && u.role !== 'CEO');
      const ids = people.map(u => u.id);

      // 연도별 데이터 로드
      const perYear: Record<number, {
        goals: Goal[]; ie: IndividualEvaluation[]; se: SelfEvaluation[];
        mf: MentoringForm[]; wt: WeeklyTask[]; innov: InnovationActivity[];
      }> = {};
      await Promise.all(years.map(async y => {
        const [goals, ie, se, mf, wt, innov] = await Promise.all([
          getAllGoalsByYear(y),
          getAllIndividualEvaluations(y),
          getSelfEvaluationsByUsers(ids, y),
          getMentoringFormsByUsers(ids, y),
          getAllWeeklyTasksByYear(y),
          listInnovationActivities(y),
        ]);
        perYear[y] = { goals, ie, se, mf, wt, innov };
      }));
      // 포상 — 전체 연도 단일 조회 후 사용자별 그룹화 (인원수만큼 개별 조회 시 Firestore resource-exhausted 발생)
      const allAwards: Award[] = await getAllAwards().catch(() => []);
      const awardsByUser: Record<string, Award[]> = {};
      for (const a of allAwards) { (awardsByUser[a.userId] ??= []).push(a); }

      const JR: Record<string, string> = { EXPAND: '직무확대', REDUCE: '직무축소', CHANGE: '직무변경', RELOCATE: '근무지이동', SATISFIED: '만족' };
      const dossierArr = people.map(u => {
        const yrs: Record<string, unknown> = {};
        for (const y of years) {
          const d = perYear[y];
          const myGoals = d.goals.filter(g => g.userId === u.id || (g.collaboratorIds ?? []).includes(u.id));
          const evalGoals = myGoals.filter(g => ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_ABANDON'].includes(g.status) || (g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange));
          if (evalGoals.length === 0 && !d.ie.find(e => e.userId === u.id) && !d.se.find(e => e.userId === u.id)) continue;
          const completed = evalGoals.filter(g => g.status === 'COMPLETED').length;
          const abandoned = evalGoals.filter(g => g.status === 'ABANDONED' || g.status === 'PENDING_ABANDON').length;
          const ie = d.ie.find(e => e.userId === u.id);
          const se = d.se.find(e => e.userId === u.id);
          const mf = d.mf.find(e => e.userId === u.id);
          const weeklyHi = d.wt
            .flatMap(w => (w.hasDoneItems ?? []).filter(i => (i.authorId ?? w.userId) === u.id).map(i => (i.title || i.content || '').trim()))
            .filter(Boolean).slice(0, 8);
          const innovNames = d.innov
            .filter(a => getPmIds(a).includes(u.id) || (a.memberIds ?? []).includes(u.id) || getPerformerIds(a).includes(u.id) || a.instructorId === u.id)
            .map(a => `${a.type === 'SMART_PROJECT' ? (getPmIds(a).includes(u.id) ? 'SP-PM' : 'SP') : 'TDS'}:${a.name}`).slice(0, 6);
          yrs[y] = {
            grade: ie && (ie.status === 'EXEC_CONFIRMED' || ie.status === 'PUBLISHED') ? ie.execGrade : undefined,
            coreGoals: evalGoals.map(g => ({ t: g.title, s: g.status === 'COMPLETED' ? '완료' : (g.status === 'ABANDONED' || g.status === 'PENDING_ABANDON') ? '포기' : '추진중', p: g.progress, w: g.weights?.[u.id] ?? g.weight })).slice(0, 15),
            goalStat: { total: completed + (evalGoals.length - completed - abandoned), 완료: completed, 포기: abandoned },
            selfEvalScore: computeSelfEvalTotal(se ?? null) ?? undefined,
            weeklyHighlights: weeklyHi,
            mentoring: mf ? { 직무: mf.mainDuties?.slice(0, 120), 경력개발: mf.careerPlan?.slice(0, 120), 직무요청: mf.jobRequest ? (JR[mf.jobRequest] ?? mf.jobRequest) : undefined, 종합의견: mf.selfOpinion?.slice(0, 150) } : undefined,
            innovation: innovNames,
          };
        }
        if (Object.keys(yrs).length === 0) return null;
        const awards = (awardsByUser[u.id] ?? []).map(a => `${a.title}(${a.awardDate ?? ''})`).slice(0, 6);
        return { name: u.name, position: u.position ?? '', org: orgName(u.organizationId), role: u.role, awards, years: yrs };
      }).filter(Boolean);

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
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={dossier ? '질문을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)' : '먼저 위에서 데이터 준비를 눌러주세요'}
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
