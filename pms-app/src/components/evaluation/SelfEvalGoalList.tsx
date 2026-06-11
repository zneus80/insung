'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { getGoalHistories } from '@/lib/firestore';
import type { Goal, SelfEvaluation, User, GoalHistory } from '@/types';

/** 평가 화면 → 목표 상세 → 뒤로 가기 시 팝업 복원용 sessionStorage 키 */
export const EVAL_RETURN_KEY = 'evalReturnState';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  APPROVED:        { label: '승인됨',     color: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS:     { label: '진행 중',    color: 'bg-indigo-100 text-indigo-700' },
  COMPLETED:       { label: '완료',       color: 'bg-green-100 text-green-700' },
  PENDING_ABANDON: { label: '포기 요청',  color: 'bg-orange-100 text-orange-600' },
  ABANDONED:      { label: '포기 확정',  color: 'bg-gray-200 text-gray-500' },
};

interface Props {
  /** 자기평가 대상 업무 목록 (이미 필터링됨 — 완료 / 포기 요청 / 포기 확정) */
  goals: Goal[];
  /** 자기평가 답안 — COMPLETED 만 의견 존재 */
  goalEvals: SelfEvaluation['goalEvals'];
  /** 수행자·공동수행자 이름 표시용 */
  usersById: Record<string, User>;
  /** 평가 대상자 userId — 뒤로 가기 시 어느 멤버 행을 펼쳐야 할지 식별용 */
  memberId: string;
}

/**
 * 인사평가/평가등급확정 화면의 "자기평가 : 핵심업무" 섹션.
 * 업무 행을 클릭하면 팝업으로 상세 정보 표시:
 *  - 완료: 목표 내용 / 수행자(공동시 함께한 인원) / 수정이력 / 자기평가 의견 / 세부보기
 *  - 포기 요청·확정: 제목 + 상태만 (세부보기 가능)
 */
export default function SelfEvalGoalList({ goals, goalEvals, usersById, memberId }: Props) {
  const router = useRouter();
  const [openGoalId, setOpenGoalId] = useState<string | null>(null);
  const [histories, setHistories] = useState<GoalHistory[]>([]);
  const [historiesLoading, setHistoriesLoading] = useState(false);

  // 마운트 시 sessionStorage 확인 — 목표 상세에서 뒤로 가기로 돌아온 경우 팝업 자동 복원
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(EVAL_RETURN_KEY);
      if (!raw) return;
      const st = JSON.parse(raw) as { memberId?: string; goalId?: string };
      if (st.memberId === memberId && st.goalId && goals.some(g => g.id === st.goalId)) {
        setOpenGoalId(st.goalId);
      }
      sessionStorage.removeItem(EVAL_RETURN_KEY);
    } catch { /* 무시 */ }
  }, [memberId, goals]);

  function handleViewDetail(goalId: string) {
    try {
      sessionStorage.setItem(EVAL_RETURN_KEY, JSON.stringify({ memberId, goalId }));
    } catch { /* 무시 */ }
    setOpenGoalId(null);              // 다이얼로그 즉시 닫기
    router.push(`/goals/${goalId}`);  // 같은 탭에서 이동
  }

  const evalsByGoalId = new Map(goalEvals.map(ge => [ge.goalId, ge]));
  const openGoal = openGoalId ? goals.find(g => g.id === openGoalId) ?? null : null;
  const openEval = openGoalId ? evalsByGoalId.get(openGoalId) : undefined;
  const st = openGoal ? STATUS_LABEL[openGoal.status] ?? { label: openGoal.status, color: 'bg-gray-100 text-gray-500' } : null;

  // 다이얼로그 열릴 때마다 수정 이력 lazy load (COMPLETED 일 때만)
  useEffect(() => {
    if (!openGoal || openGoal.status !== 'COMPLETED') { setHistories([]); return; }
    setHistoriesLoading(true);
    getGoalHistories(openGoal.id)
      .then(setHistories)
      .catch(err => { console.error('[수정이력 조회] 실패:', err); setHistories([]); })
      .finally(() => setHistoriesLoading(false));
  }, [openGoal]);

  const legacyComment = (ge: SelfEvaluation['goalEvals'][number]) => [
    ge.good ? `[잘된 점]\n${ge.good}` : '',
    ge.regret ? `[아쉬운 점]\n${ge.regret}` : '',
  ].filter(Boolean).join('\n\n');

  // 수행자 표기 — 공동수행자가 있으면 "공동 (A, B, ...)" 형태
  function renderOwnerLabel(g: Goal) {
    const owner = usersById[g.userId];
    const ownerName = owner?.name ?? '수행자';
    const collabs = (g.collaboratorIds ?? [])
      .map(id => usersById[id]?.name)
      .filter(Boolean) as string[];
    if (collabs.length === 0) return ownerName;
    return `공동 (${ownerName}, ${collabs.join(', ')})`;
  }

  // 수정 이력 요약 1줄로 — 변경된 항목 키워드만 나열
  function renderHistoryLine(h: GoalHistory): string | null {
    if (h.changeType === 'OWNER_REASSIGNED' || h.changeType === 'OWNER_TRANSFERRED') return '수행자 변경';
    if (!h.fieldChanges) return null;
    const keys: string[] = [];
    if (h.fieldChanges.title) keys.push('제목');
    if (h.fieldChanges.description) keys.push('내용');
    if (h.fieldChanges.dueDate) keys.push('기한');
    if (h.fieldChanges.progress) keys.push('진행률');
    if (h.fieldChanges.ownerId) keys.push('수행자');
    if (h.fieldChanges.collaboratorIds) keys.push('공동수행자');
    if (h.fieldChanges.isConfidential) keys.push('대내외비');
    return keys.length ? keys.join(' · ') : null;
  }

  return (
    <>
      <div className="space-y-1.5">
        {goals.length === 0 && (
          <p className="text-sm text-gray-400">표시할 업무가 없습니다.</p>
        )}
        {goals.map(g => {
          const gst = STATUS_LABEL[g.status] ?? { label: g.status, color: 'bg-gray-100 text-gray-500' };
          const isAbandon = g.status === 'PENDING_ABANDON' || g.status === 'ABANDONED';
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setOpenGoalId(g.id)}
              className="w-full flex items-center gap-3 rounded-lg border bg-white px-3 py-2 hover:bg-gray-50 transition-colors text-left"
            >
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${gst.color}`}>{gst.label}</span>
              <span className="flex-1 text-sm text-gray-800 truncate">{g.title}</span>
              {!isAbandon && <span className="text-xs text-gray-400 shrink-0">{g.progress}%</span>}
              <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
            </button>
          );
        })}
      </div>

      <Dialog open={!!openGoalId} onOpenChange={v => { if (!v) setOpenGoalId(null); }}>
        <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          {openGoal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-baseline gap-2 flex-wrap">
                  <span>{openGoal.title}</span>
                  {st && (
                    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${st.color}`}>{st.label}</span>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                {/* 포기 요청·확정: 상세 정보 생략 */}
                {(openGoal.status === 'PENDING_ABANDON' || openGoal.status === 'ABANDONED') ? (
                  <p className="text-sm text-gray-500">
                    {openGoal.status === 'PENDING_ABANDON' ? '포기 요청 상태인 업무입니다.' : '포기 확정된 업무입니다.'}
                  </p>
                ) : (
                  <>
                    {/* 목표 정보 */}
                    <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
                        <span>기한: {openGoal.dueDate.toLocaleDateString('ko-KR')}</span>
                        <span>진행률 {openGoal.progress}%</span>
                      </div>
                      <Progress value={openGoal.progress} className="h-1.5" />
                      <div>
                        <p className="text-xs font-bold text-gray-700 mb-1">수행자</p>
                        <p className="text-sm text-gray-700">{renderOwnerLabel(openGoal)}</p>
                      </div>
                      {openGoal.description && (
                        <div>
                          <p className="text-xs font-bold text-gray-700 mb-1">목표 내용</p>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{openGoal.description}</p>
                        </div>
                      )}
                    </div>

                    {/* 수정 이력 */}
                    <div>
                      <p className="text-sm font-bold text-gray-800 mb-1.5">수정 이력</p>
                      {historiesLoading ? (
                        <p className="text-xs text-gray-400">불러오는 중...</p>
                      ) : histories.filter(h => renderHistoryLine(h)).length === 0 ? (
                        <p className="text-xs text-gray-400">수정 이력 없음</p>
                      ) : (
                        <ul className="space-y-1 text-xs text-gray-600">
                          {histories.filter(h => renderHistoryLine(h)).map(h => (
                            <li key={h.id} className="flex items-center gap-2">
                              <span className="text-gray-400 shrink-0">{h.createdAt.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
                              <span>{renderHistoryLine(h)}</span>
                              {h.submitComment && <span className="text-gray-400">— {h.submitComment.slice(0, 40)}{h.submitComment.length > 40 ? '…' : ''}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 자기평가 의견 */}
                    <div>
                      <p className="text-sm font-bold text-blue-700 mb-1.5">자기평가 의견 (팀원 작성)</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap rounded-lg border border-blue-100 bg-blue-50/30 px-3 py-2 leading-relaxed">
                        {openEval ? (openEval.comment || legacyComment(openEval) || '—') : '—'}
                      </p>
                    </div>
                  </>
                )}

                {/* 세부보기 버튼 — 같은 탭에서 이동, 뒤로 가기 시 팝업 자동 복원 */}
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleViewDetail(openGoal.id)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    세부내역 보기
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
