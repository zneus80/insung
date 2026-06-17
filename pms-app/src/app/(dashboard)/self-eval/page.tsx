'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getGoalsByUser, getWeeklyTasksByMembersAndYear, listInnovationActivitiesByUser,
  getSelfEvaluation, upsertSelfEvaluation, upsertIndividualEvaluation,
  getOrganizations, getAllUsers,
  requestSelfEvalEdit, withdrawSelfEvalEditRequest, getHrAdmins, createNotification,
} from '@/lib/firestore';
import { notifyEvalReviewer } from '@/lib/eval-notifications';
import { getPerformerIds } from '@/lib/innovation';
import { normalizeWeights } from '@/lib/goal-weight';
import { shiftEnterSubmit } from '@/lib/utils';
import Header from '@/components/layout/Header';
import { useEvalPeriod, EvalPeriodNotice } from '@/components/evaluation/EvalPeriodGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Target, Star, Lightbulb, CheckCircle2, Lock, Pencil, XCircle, AlertCircle } from 'lucide-react';
import type { Goal } from '@/types';

type Starred = { id: string; title: string };
type Innov = { id: string; name: string; instructed?: boolean };

export default function SelfEvalPage() {
  const { userProfile } = useAuth();
  const { beforePeriod, startDate } = useEvalPeriod(); // 평가기간 전 — 제출만 차단(작성·임시저장 허용)
  const { activeYear: year, isYearLocked } = useActiveYear();
  const locked = isYearLocked(year);

  const [goals, setGoals] = useState<Goal[]>([]);       // 완료 핵심목표
  const [abandoned, setAbandoned] = useState<Goal[]>([]); // 포기 확정 핵심목표 (배지·제목만)
  const [starred, setStarred] = useState<Starred[]>([]); // 별표 일반업무
  const [innov, setInnov] = useState<Innov[]>([]);       // 참여 혁신활동
  const [goalMap, setGoalMap] = useState<Record<string, { comment: string; score: string }>>({});
  const [genMap, setGenMap] = useState<Record<string, { comment: string; score: string }>>({});
  const [innovMap, setInnovMap] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'DRAFT' | 'SUBMITTED'>('DRAFT');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 제출 후 수정 요청 (육성면담서와 동일: 개인 → HR, 확정 전까지)
  const [editRequestPending, setEditRequestPending] = useState(false);
  const [editRequestReason, setEditRequestReason] = useState('');
  const [showEditRequestInput, setShowEditRequestInput] = useState(false);
  const [editRequestInputValue, setEditRequestInputValue] = useState('');

  const readOnly = locked || status === 'SUBMITTED';

  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const [goalsList, wtDocs, innovAll, se] = await Promise.all([
        getGoalsByUser(userProfile.id, year),
        getWeeklyTasksByMembersAndYear([{ id: userProfile.id, organizationId: userProfile.organizationId }], year),
        listInnovationActivitiesByUser(userProfile.id),
        getSelfEvaluation(userProfile.id, year),
      ]);
      const completed = goalsList.filter(g => g.status === 'COMPLETED');
      setGoals(completed);
      // 포기 확정 핵심목표 (임원 승인 + 조직변경 자동포기 제외) — 배지·제목만 표기
      setAbandoned(goalsList.filter(g => g.status === 'ABANDONED' && !!g.approvedBy && !g.autoAbandonedByOrgChange));
      // 별표 일반업무(goalId 없는 hasDone important) — 항목 id 중복 제거
      const seen = new Set<string>();
      const stars = wtDocs
        .flatMap(t => (t.hasDoneItems ?? []).map(i => ({ i, owner: i.authorId ?? t.userId })))
        .filter(x => x.i.important && !x.i.goalId && x.owner === userProfile.id)
        .map(x => ({ id: x.i.id, title: (x.i.title || x.i.content || '').trim() }))
        .filter(x => x.title && !seen.has(x.id) && (seen.add(x.id), true));
      setStarred(stars);
      // TDS 지시자(수행자 아님)는 서술 없이 '(지시)' 표시만 — 상위 평가자 확인용
      setInnov(innovAll.filter(a => a.year === year).map(a => ({
        id: a.id,
        name: a.name,
        instructed: a.type === 'TDS' && a.instructorId === userProfile.id && !getPerformerIds(a).includes(userProfile.id),
      })));

      // 기존 자기평가 프리필
      if (se) {
        setStatus(se.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT');
        setGoalMap(Object.fromEntries((se.goalEvals ?? []).map(e => [e.goalId, { comment: e.comment ?? '', score: e.score != null ? String(e.score) : '' }])));
        setGenMap(Object.fromEntries((se.generalEvals ?? []).map(e => [e.id, { comment: e.comment ?? '', score: e.score != null ? String(e.score) : '' }])));
        setInnovMap(Object.fromEntries((se.innovationEvals ?? []).map(e => [e.activityId, e.comment ?? ''])));
        setEditRequestPending(!!se.editRequestPending);
        setEditRequestReason(se.editRequestReason ?? '');
      } else {
        setEditRequestPending(false);
        setEditRequestReason('');
      }
    } finally {
      setLoading(false);
    }
  }, [userProfile, year]);

  useEffect(() => { load(); }, [load]);

  // 가중치 — 핵심목표: 완료 목표 가중치 정규화 → ×0.8 (핵심 총 80%).
  // 일반업무: 5개 기준 항목당 4% 고정(5개 만점 20%). 5개 미만이면 채우지 않은 만큼 총점에서 미실현(차감 효과).
  // 공동 목표는 사람마다 가중치가 다르므로 본인(weights[uid]) 슬롯을 우선 사용.
  const corePct = useMemo(() => {
    const uid = userProfile?.id ?? '';
    return normalizeWeights(goals.map(g => ({ ...g, weight: g.weights?.[uid] ?? g.weight })));
  }, [goals, userProfile?.id]);
  const coreEff = (id: string) => Math.round((corePct[id] ?? 0) * 0.8 * 10) / 10; // 80% 비율
  const GEN_SLOTS = 5;          // 일반업무 기준 개수
  const genEff = 20 / GEN_SLOTS; // 항목당 4% 고정

  const num = (s: string) => Math.max(0, Math.min(100, Number(s) || 0));
  const totalScore = useMemo(() => {
    let t = 0;
    goals.forEach(g => { t += num(goalMap[g.id]?.score ?? '') * (coreEff(g.id) / 100); });
    starred.forEach(s => { t += num(genMap[s.id]?.score ?? '') * (genEff / 100); });
    return Math.round(t * 10) / 10;
  }, [goals, starred, goalMap, genMap, corePct]);

  async function handleSave(submit: boolean) {
    if (!userProfile) return;
    if (locked) { toast.error(`${year}년은 확정된 연도입니다.`); return; }
    setSaving(true);
    try {
      await upsertSelfEvaluation(userProfile.id, year, {
        organizationId: userProfile.organizationId,
        goalEvals: goals.map(g => ({ goalId: g.id, goalTitle: g.title, comment: goalMap[g.id]?.comment ?? '', score: num(goalMap[g.id]?.score ?? ''), weight: coreEff(g.id) })),
        generalEvals: starred.map(s => ({ id: s.id, title: s.title, comment: genMap[s.id]?.comment ?? '', score: num(genMap[s.id]?.score ?? ''), weight: genEff })),
        innovationEvals: innov.map(a => ({
          activityId: a.id, name: a.name,
          comment: a.instructed ? '' : (innovMap[a.id] ?? ''),
          ...(a.instructed ? { instructed: true } : {}),
        })),
        abandonedGoals: abandoned.map(g => ({ goalId: g.id, goalTitle: g.title })),
        status: submit ? 'SUBMITTED' : 'DRAFT',
        ...(submit ? { submittedAt: new Date() } : {}),
      });
      if (submit) {
        setStatus('SUBMITTED');
        try {
          await upsertIndividualEvaluation(userProfile.id, year, {
            organizationId: userProfile.organizationId,
            status: 'SELF_SUBMITTED',
          });
        } catch (err) { console.error('[평가 체인 시작] 실패:', err); }
        try {
          const [allOrgs, allUsers] = await Promise.all([getOrganizations(), getAllUsers()]);
          const stage = userProfile.role === 'MEMBER' ? 'LEAD' : userProfile.role === 'TEAM_LEAD' ? 'HQ' : 'EXEC';
          const subject = allUsers.find(u => u.id === userProfile.id) ?? userProfile;
          const res = await notifyEvalReviewer({
            subject, fromUserId: userProfile.id, fromUserName: userProfile.name,
            stage, type: 'SELF_EVAL_SUBMITTED', category: 'EVALUATION',
            title: `${userProfile.name}님 자기평가 제출`,
            message: `${userProfile.name}님이 ${year}년 자기평가를 제출했습니다.`,
            link: '/evaluation/team', allOrgs, allUsers,
          });
          if (!res?.notified && stage === 'HQ') {
            await notifyEvalReviewer({
              subject, fromUserId: userProfile.id, fromUserName: userProfile.name,
              stage: 'EXEC', type: 'SELF_EVAL_SUBMITTED', category: 'EVALUATION',
              title: `${userProfile.name}님 자기평가 제출`,
              message: `${userProfile.name}님이 ${year}년 자기평가를 제출했습니다.`,
              link: '/evaluation/team', allOrgs, allUsers,
            });
          }
        } catch (err) { console.error('[자기평가 알림] 실패:', err); }
      }
      toast.success(submit ? '자기평가가 제출되었습니다.' : '임시저장 되었습니다.');
    } catch (e) {
      console.error('[자기평가 저장] 실패:', e);
      toast.error('저장에 실패했습니다.');
    } finally { setSaving(false); }
  }

  // ── 수정 요청 (육성면담서와 동일: 개인 → HR, 평가 확정 전까지) ──
  async function submitEditRequest() {
    if (!userProfile) return;
    if (!editRequestInputValue.trim()) { toast.error('수정 요청 사유를 입력해주세요.'); return; }
    setSaving(true);
    try {
      await requestSelfEvalEdit(userProfile.id, year, editRequestInputValue.trim());
      try {
        const hrAdmins = await getHrAdmins();
        await Promise.all(hrAdmins.map(hr => createNotification({
          userId: hr.id,
          type: 'SELF_EVAL_EDIT_REQUESTED',
          category: 'EVALUATION',
          title: `${userProfile.name}님 자기평가 수정 요청`,
          message: `사유: ${editRequestInputValue.trim().slice(0, 80)}${editRequestInputValue.trim().length > 80 ? '…' : ''}`,
          link: `/self-eval?user=${userProfile.id}&year=${year}`,
          read: false,
        })));
      } catch (err) { console.error('[알림] HR 알림 발송 실패:', err); }
      setEditRequestPending(true);
      setEditRequestReason(editRequestInputValue.trim());
      setEditRequestInputValue('');
      setShowEditRequestInput(false);
      toast.success('HR 관리자에게 수정 요청을 보냈습니다.');
    } catch {
      toast.error('수정 요청 발송에 실패했습니다.');
    } finally { setSaving(false); }
  }
  async function withdrawEditRequest() {
    if (!userProfile) return;
    if (!confirm('수정 요청을 회수하시겠습니까?')) return;
    setSaving(true);
    try {
      await withdrawSelfEvalEditRequest(userProfile.id, year);
      setEditRequestPending(false);
      setEditRequestReason('');
      toast.success('수정 요청을 회수했습니다.');
    } catch {
      toast.error('회수에 실패했습니다.');
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="자기평가" showBack />
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="자기평가" showBack />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {locked && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2.5 text-sm text-gray-600">
              <Lock className="h-4 w-4 shrink-0 text-gray-500" /><span><b>{year}년</b>은 확정된 연도입니다. 조회만 가능합니다.</span>
            </div>
          )}

          {/* 총점 헤더 */}
          <div className="rounded-xl border bg-white px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-700">{year}년 자기평가</p>
              <p className="text-xs text-gray-400 mt-0.5">핵심목표 80% · 일반업무 항목당 4%(5개 만점 20%) · 혁신활동(서술) · 각 항목 0~100점</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">가중 환산 총점</p>
              <p className="text-2xl font-bold text-indigo-700">{totalScore}<span className="text-sm font-normal text-gray-400"> / 100</span></p>
            </div>
          </div>

          {/* 1) 핵심목표 (완료) — 80% */}
          <section className="rounded-xl border bg-white overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-gray-50/70 px-4 py-2.5">
              <Target className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold text-blue-700">핵심목표 <span className="text-xs font-normal text-gray-400">(완료 · 총 80%)</span></h3>
            </div>
            <div className="p-4 space-y-3">
              {goals.length === 0 ? <p className="text-xs text-gray-400">완료된 핵심목표가 없습니다.</p> : goals.map(g => (
                <ItemRow key={g.id} title={g.title} weight={coreEff(g.id)}
                  comment={goalMap[g.id]?.comment ?? ''} score={goalMap[g.id]?.score ?? ''}
                  readOnly={readOnly}
                  onComment={v => setGoalMap(m => ({ ...m, [g.id]: { ...m[g.id], comment: v, score: m[g.id]?.score ?? '' } }))}
                  onScore={v => setGoalMap(m => ({ ...m, [g.id]: { ...m[g.id], score: v, comment: m[g.id]?.comment ?? '' } }))}
                  onShiftEnter={() => handleSave(false)} />
              ))}
              {/* 포기 확정 핵심목표 — 배지·제목만 (점수/가중치 없음) */}
              {abandoned.length > 0 && (
                <div className="pt-1 space-y-1.5">
                  <p className="text-[11px] font-medium text-gray-400">포기된 핵심목표</p>
                  {abandoned.map(g => (
                    <div key={g.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                      <span className="shrink-0 rounded-full bg-gray-200 text-gray-500 px-2 py-0.5 text-[11px] font-medium">포기</span>
                      <span className="text-sm text-gray-500 line-through truncate">{g.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 2) 일반업무 (별표) — 20% */}
          <section className="rounded-xl border bg-white overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-gray-50/70 px-4 py-2.5">
              <Star className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-bold text-amber-700">주요 일반업무 <span className="text-xs font-normal text-gray-400">(주간보고 별표 · 항목당 4%, 5개 만점 20%)</span></h3>
            </div>
            <div className="p-4 space-y-3">
              {starred.length === 0 ? <p className="text-xs text-gray-400">주간보고에서 별표(★)한 일반업무가 없습니다.</p> : starred.map(s => (
                <ItemRow key={s.id} title={s.title} weight={genEff}
                  comment={genMap[s.id]?.comment ?? ''} score={genMap[s.id]?.score ?? ''}
                  readOnly={readOnly}
                  onComment={v => setGenMap(m => ({ ...m, [s.id]: { ...m[s.id], comment: v, score: m[s.id]?.score ?? '' } }))}
                  onScore={v => setGenMap(m => ({ ...m, [s.id]: { ...m[s.id], score: v, comment: m[s.id]?.comment ?? '' } }))}
                  onShiftEnter={() => handleSave(false)} />
              ))}
            </div>
          </section>

          {/* 3) 참여 혁신활동 — 서술만 */}
          <section className="rounded-xl border bg-white overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-gray-50/70 px-4 py-2.5">
              <Lightbulb className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-emerald-700">참여 혁신활동 <span className="text-xs font-normal text-gray-400">(서술)</span></h3>
            </div>
            <div className="p-4 space-y-3">
              {innov.length === 0 ? <p className="text-xs text-gray-400">참여한 혁신활동이 없습니다.</p> : innov.map(a => (
                <div key={a.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                  <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                    {a.name}
                    {a.instructed && <span className="shrink-0 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">지시</span>}
                  </p>
                  {/* TDS 지시자는 서술 없이 표시만 */}
                  {!a.instructed && (
                    <Textarea rows={2} disabled={readOnly} value={innovMap[a.id] ?? ''}
                      onChange={e => setInnovMap(m => ({ ...m, [a.id]: e.target.value }))}
                      onKeyDown={shiftEnterSubmit(() => handleSave(false), !readOnly && !saving)}
                      placeholder="역할·기여도·주요 실적을 작성하세요 (Shift+Enter 임시저장)" className="resize-none mt-1.5" />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 수정 요청 진행 중 배너 (HR 승인 대기) */}
          {editRequestPending && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
              <div className="flex-1 text-blue-800">
                <p className="font-medium">HR 수정 승인 대기 중</p>
                {editRequestReason && <p className="text-xs text-blue-700/80 mt-0.5 whitespace-pre-wrap">사유: {editRequestReason}</p>}
                <p className="text-xs text-blue-700/70 mt-1">HR 관리자가 승인하면 다시 작성 가능 상태로 전환됩니다.</p>
              </div>
            </div>
          )}

          {/* 수정 요청 입력 박스 */}
          {showEditRequestInput && !editRequestPending && status === 'SUBMITTED' && !locked && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700"><Pencil className="h-4 w-4" /> HR 수정 요청</div>
              <p className="text-xs text-gray-600">제출된 자기평가를 수정하려면 HR 관리자에게 사유와 함께 요청하세요. 평가 확정 전까지 HR 승인 후 다시 작성 가능 상태로 전환됩니다.</p>
              <Textarea rows={3} value={editRequestInputValue} onChange={e => setEditRequestInputValue(e.target.value)}
                onKeyDown={shiftEnterSubmit(submitEditRequest, !saving && !!editRequestInputValue.trim())}
                placeholder="수정이 필요한 사유를 구체적으로 입력하세요 (Shift+Enter 요청)" className="resize-none" />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setShowEditRequestInput(false); setEditRequestInputValue(''); }}>취소</Button>
                <Button size="sm" disabled={saving || !editRequestInputValue.trim()} onClick={submitEditRequest}>{saving ? '요청 중...' : 'HR에 요청 보내기'}</Button>
              </div>
            </div>
          )}

          {/* 액션 */}
          {status === 'SUBMITTED' ? (
            <div className="flex items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium"><CheckCircle2 className="h-4 w-4" /> 제출 완료</span>
              {!locked && (
                editRequestPending ? (
                  <Button size="sm" variant="outline" disabled={saving} onClick={withdrawEditRequest} className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50">
                    <XCircle className="h-3.5 w-3.5" /> 수정 요청 회수
                  </Button>
                ) : !showEditRequestInput && (
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => setShowEditRequestInput(true)} className="gap-1.5 text-blue-600 border-blue-300 hover:bg-blue-50">
                    <Pencil className="h-3.5 w-3.5" /> HR 수정 요청
                  </Button>
                )
              )}
            </div>
          ) : !locked && (
            <div className="space-y-2">
              {beforePeriod && <EvalPeriodNotice startDate={startDate} />}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={saving} onClick={() => handleSave(false)}>임시저장</Button>
                <Button disabled={saving || beforePeriod} onClick={() => handleSave(true)}
                  title={beforePeriod ? '평가기간에만 제출할 수 있습니다.' : undefined}>제출</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemRow({ title, weight, comment, score, readOnly, onComment, onScore, onShiftEnter }: {
  title: string; weight: number; comment: string; score: string; readOnly: boolean;
  onComment: (v: string) => void; onScore: (v: string) => void;
  /** Shift+Enter 시 실행할 액션(임시저장) */
  onShiftEnter?: () => void;
}) {
  const weighted = Math.round((Math.max(0, Math.min(100, Number(score) || 0)) * (weight / 100)) * 10) / 10;
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 flex-1 min-w-0">{title}</p>
        <span className="shrink-0 inline-flex items-baseline gap-0.5 rounded-md bg-indigo-50 px-2 py-0.5 text-indigo-700 font-bold text-xs">
          가중치 {weight}%
        </span>
      </div>
      <Textarea rows={2} disabled={readOnly} value={comment} onChange={e => onComment(e.target.value)}
        onKeyDown={onShiftEnter ? shiftEnterSubmit(onShiftEnter, !readOnly) : undefined}
        placeholder="역할·기여도·주요 실적을 작성하세요 (Shift+Enter 임시저장)" className="resize-none" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">자기평가 점수</span>
        <Input type="number" min="0" max="100" disabled={readOnly} value={score}
          onChange={e => onScore(e.target.value)} className="w-24 h-8" placeholder="0~100" />
        <span className="text-xs text-gray-400">점 · 가중환산 <b className="text-indigo-600">{weighted}</b></span>
      </div>
    </div>
  );
}
