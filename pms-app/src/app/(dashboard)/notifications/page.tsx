'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteNotifications,
  deleteAllNotifications,
  approveMentoringFormEdit,
  rejectMentoringFormEdit,
  getMentoringForm,
  getUser,
  createNotification,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Bell, Target, ClipboardList, MessageCircle, Award, MessageSquareHeart, CheckCircle2, XCircle, Trash2, CheckSquare, Square, RefreshCw, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { AppNotification, NotificationCategory } from '@/types';

const CATEGORY_META: Record<NotificationCategory, { label: string; icon: React.ReactNode; color: string }> = {
  GOAL:        { label: '핵심목표',     icon: <Target className="h-4 w-4" />,             color: 'text-blue-600 bg-blue-50' },
  WEEKLY_TASK: { label: '주간업무',     icon: <ClipboardList className="h-4 w-4" />,      color: 'text-green-600 bg-green-50' },
  ONEONONE:    { label: '1on1',        icon: <MessageCircle className="h-4 w-4" />,      color: 'text-purple-600 bg-purple-50' },
  EVALUATION:  { label: '평가',         icon: <Award className="h-4 w-4" />,              color: 'text-orange-600 bg-orange-50' },
  MENTORING:   { label: '육성면담서',   icon: <MessageSquareHeart className="h-4 w-4" />, color: 'text-pink-600 bg-pink-50' },
};

export default function NotificationsPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationCategory | 'ALL'>('ALL');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // 인라인 액션 처리 중/처리됨 상태 추적 (육성면담서 수정 요청 등)
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processedMap, setProcessedMap] = useState<Record<string, 'APPROVED' | 'REJECTED' | 'STALE'>>({});

  // 알림 link 에서 user / year 파싱
  function parseMentoringParams(link: string): { userId: string; year: number } | null {
    try {
      const url = new URL(link, 'http://x'); // 상대 URL → 임의 base 로 파싱
      const userId = url.searchParams.get('user');
      const yearStr = url.searchParams.get('year');
      if (!userId || !yearStr) return null;
      const year = Number(yearStr);
      if (!Number.isFinite(year)) return null;
      return { userId, year };
    } catch {
      return null;
    }
  }

  async function handleMentoringEditAction(n: AppNotification, action: 'APPROVE' | 'REJECT') {
    if (!userProfile) return;
    if (!userProfile.isHrAdmin) {
      toast.error('HR 관리자만 처리할 수 있습니다.');
      return;
    }
    const params = parseMentoringParams(n.link);
    if (!params) {
      toast.error('알림 정보가 올바르지 않습니다.');
      return;
    }
    setProcessingId(n.id);
    // 단계별 어느 호출에서 권한 오류가 발생하는지 식별하기 위해 step 추적
    let step: string = 'init';
    try {
      step = 'getMentoringForm';
      const current = await getMentoringForm(params.userId, params.year);
      if (!current || !current.editRequestPending) {
        setProcessedMap(prev => ({ ...prev, [n.id]: 'STALE' }));
        step = 'markNotificationRead(stale)';
        await markNotificationRead(n.id);
        setItems(prev => prev.map(it => it.id === n.id ? { ...it, read: true } : it));
        toast.info('이미 처리된 요청입니다.');
        return;
      }
      step = 'getUser';
      const requester = await getUser(params.userId);
      if (action === 'APPROVE') {
        step = 'approveMentoringFormEdit';
        await approveMentoringFormEdit(params.userId, params.year, userProfile.id);
        try {
          step = 'createNotification(approved)';
          await createNotification({
            userId: params.userId,
            type: 'MENTORING_EDIT_APPROVED',
            category: 'MENTORING',
            title: `${params.year}년 육성면담서 수정 허가`,
            message: `${userProfile.name}님이 수정 요청을 승인했습니다. 다시 작성/제출이 가능합니다.`,
            link: '/mentoring',
            read: false,
          });
        } catch (err) { console.error('[알림] 승인 결과 알림 발송 실패:', err); }
        setProcessedMap(prev => ({ ...prev, [n.id]: 'APPROVED' }));
        toast.success(`${requester?.name ?? ''}님의 수정 요청을 승인했습니다.`);
      } else {
        step = 'rejectMentoringFormEdit';
        await rejectMentoringFormEdit(params.userId, params.year);
        try {
          step = 'createNotification(rejected)';
          await createNotification({
            userId: params.userId,
            type: 'MENTORING_EDIT_REJECTED',
            category: 'MENTORING',
            title: `${params.year}년 육성면담서 수정 요청 거절`,
            message: `${userProfile.name}님이 수정 요청을 거절했습니다.`,
            link: '/mentoring',
            read: false,
          });
        } catch (err) { console.error('[알림] 거절 결과 알림 발송 실패:', err); }
        setProcessedMap(prev => ({ ...prev, [n.id]: 'REJECTED' }));
        toast.success(`${requester?.name ?? ''}님의 수정 요청을 거절했습니다.`);
      }
      step = 'markNotificationRead(final)';
      await markNotificationRead(n.id);
      setItems(prev => prev.map(it => it.id === n.id ? { ...it, read: true } : it));
    } catch (err: any) {
      console.error(`[알림 인라인액션 실패] step=${step}:`, err);
      toast.error('처리에 실패했습니다.');
    } finally {
      setProcessingId(null);
    }
  }

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    setLoadError(null);
    try {
      const list = await getNotifications(userProfile.id);
      setItems(list);

      // 육성면담서 수정요청 알림 — 다른 HR이 이미 처리했는지 자동 감지 (실제 폼 상태 확인)
      // editRequestPending === false 이면 '이미 처리된 요청'으로 표시 (다른 HR 처리분 자동 반영)
      if (userProfile.isHrAdmin) {
        const editReqs = list.filter(n => n.type === 'MENTORING_EDIT_REQUESTED');
        if (editReqs.length > 0) {
          const pendingCache = new Map<string, boolean>(); // user_year → 아직 대기중인가
          const staleIds: string[] = [];
          await Promise.all(editReqs.map(async n => {
            const params = parseMentoringParams(n.link);
            if (!params) return;
            const key = `${params.userId}_${params.year}`;
            let pending = pendingCache.get(key);
            if (pending === undefined) {
              try {
                const form = await getMentoringForm(params.userId, params.year);
                pending = !!form?.editRequestPending;
              } catch { pending = true; /* 조회 실패 시 보수적으로 대기중 취급 */ }
              pendingCache.set(key, pending);
            }
            if (!pending) staleIds.push(n.id);
          }));
          if (staleIds.length > 0) {
            // 이번 세션에서 본인이 직접 처리(APPROVED/REJECTED)한 건 덮어쓰지 않음
            setProcessedMap(prev => {
              const next = { ...prev };
              for (const sid of staleIds) if (!next[sid]) next[sid] = 'STALE';
              return next;
            });
          }
        }
      }
    } catch (e: any) {
      console.error('알림 로드 오류:', e);
      setLoadError(e?.message ?? '알림을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [userProfile]);

  // 선택 모드 종료 시 선택 초기화
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(n => n.id)));
    }
  }

  async function handleClick(n: AppNotification) {
    if (selectMode) {
      toggleSelect(n.id);
      return;
    }
    if (!n.read) {
      try { await markNotificationRead(n.id); } catch { /* 무시 */ }
    }
    if (n.link) router.push(n.link);
  }

  async function handleMarkAllRead() {
    if (!userProfile) return;
    if (!confirm('모든 알림을 읽음 처리하시겠습니까?')) return;
    await markAllNotificationsRead(userProfile.id);
    await load();
  }

  async function handleDeleteOne(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('이 알림을 삭제하시겠습니까?')) return;
    setDeleting(true);
    try {
      await deleteNotification(id);
      setItems(prev => prev.filter(n => n.id !== id));
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}건의 알림을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      await deleteNotifications(Array.from(selected));
      setItems(prev => prev.filter(n => !selected.has(n.id)));
      exitSelectMode();
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteAll() {
    if (!userProfile) return;
    if (!confirm(`전체 알림 ${items.length}건을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    try {
      await deleteAllNotifications(userProfile.id);
      setItems([]);
      exitSelectMode();
    } finally {
      setDeleting(false);
    }
  }

  const unreadCount = items.filter(i => !i.read).length;
  const filtered = filter === 'ALL' ? items : items.filter(i => i.category === filter);
  const allFilteredSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="flex flex-col h-full">
      <Header title="알림" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">

        {/* 오류 표시 */}
        {loadError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{loadError}</span>
            <button onClick={load} className="text-xs font-medium underline">다시 시도</button>
          </div>
        )}

        {/* 상단 액션 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm text-gray-500">
            전체 {items.length}건 · 미읽음 <span className="text-red-600 font-semibold">{unreadCount}</span>건
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-40"
              title="새로고침"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            {unreadCount > 0 && !selectMode && (
              <Button size="sm" variant="outline" onClick={handleMarkAllRead} disabled={deleting}>
                모두 읽음 처리
              </Button>
            )}
            {!selectMode ? (
              <>
                {items.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setSelectMode(true)} disabled={deleting}>
                    선택 삭제
                  </Button>
                )}
                {items.length > 0 && (
                  <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200" onClick={handleDeleteAll} disabled={deleting}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    전체 삭제
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={exitSelectMode} disabled={deleting}>
                  취소
                </Button>
                <Button size="sm" variant="outline" onClick={toggleSelectAll} disabled={deleting}>
                  {allFilteredSelected ? '전체 해제' : '전체 선택'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200"
                  onClick={handleDeleteSelected}
                  disabled={deleting || selected.size === 0}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  삭제 ({selected.size})
                </Button>
              </>
            )}
          </div>
        </div>

        {/* 카테고리 필터 */}
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'GOAL', 'WEEKLY_TASK', 'ONEONONE', 'EVALUATION', 'MENTORING'] as const).map(c => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                filter === c
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
              )}
            >
              {c === 'ALL' ? '전체' : CATEGORY_META[c].label}
            </button>
          ))}
        </div>

        {/* 알림 목록 */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-gray-50 py-16">
            <Bell className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm text-gray-400">표시할 알림이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(n => {
              const meta = CATEGORY_META[n.category] ?? CATEGORY_META.GOAL;
              const isSelected = selected.has(n.id);
              return (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'w-full text-left flex items-start gap-3 rounded-xl border bg-white p-4 transition-colors hover:shadow-sm cursor-pointer group',
                    !n.read && 'border-blue-200 bg-blue-50/30',
                    selectMode && isSelected && 'border-blue-400 bg-blue-50',
                  )}
                >
                  {/* 선택 모드: 체크박스 */}
                  {selectMode && (
                    <div className="shrink-0 mt-0.5 text-blue-500">
                      {isSelected
                        ? <CheckSquare className="h-4 w-4" />
                        : <Square className="h-4 w-4 text-gray-300" />
                      }
                    </div>
                  )}

                  <div className={cn('shrink-0 rounded-full p-2', meta.color)}>
                    {meta.icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-gray-500">{meta.label}</span>
                      {!n.read && <span className="text-[10px] font-bold text-blue-600">NEW</span>}
                      <span className="text-xs text-gray-400 ml-auto">
                        {formatDistanceToNow(n.createdAt, { addSuffix: true, locale: ko })}
                      </span>
                    </div>
                    {n.title && (
                      <p className="text-sm font-medium text-gray-900 truncate">{n.title}</p>
                    )}
                    <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap leading-relaxed">{n.message}</p>

                    {/* 인라인 액션: 육성면담서 수정 요청 (HR 관리자만) */}
                    {!selectMode && n.type === 'MENTORING_EDIT_REQUESTED' && userProfile?.isHrAdmin && (() => {
                      const status = processedMap[n.id];
                      if (status === 'APPROVED') {
                        return <p className="mt-2 text-xs text-green-600 font-medium">✓ 수정 허가됨</p>;
                      }
                      if (status === 'REJECTED') {
                        return <p className="mt-2 text-xs text-red-600 font-medium">✗ 거절됨</p>;
                      }
                      if (status === 'STALE') {
                        return <p className="mt-2 text-xs text-gray-500 font-medium">이미 처리된 요청</p>;
                      }
                      const isBusy = processingId === n.id;
                      return (
                        <div className="mt-2 flex gap-2" onClick={e => e.stopPropagation()}>
                          <Button
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleMentoringEditAction(n, 'APPROVE')}
                            className="gap-1 h-7 px-3 bg-blue-600 hover:bg-blue-700 text-xs"
                          >
                            <CheckCircle2 className="h-3 w-3" /> 수정 허가
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            disabled={isBusy}
                            onClick={() => handleMentoringEditAction(n, 'REJECT')}
                            className="gap-1 h-7 px-3 text-red-600 border-red-300 hover:bg-red-50 text-xs"
                          >
                            <XCircle className="h-3 w-3" /> 거절
                          </Button>
                          {isBusy && <span className="text-xs text-gray-400 self-center">처리 중...</span>}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 일반 모드: 읽음 표시 + 삭제 버튼 */}
                  {!selectMode && (
                    <div className="shrink-0 mt-1 flex items-center gap-1">
                      {n.read && <CheckCircle2 className="h-4 w-4 text-gray-300" />}
                      <button
                        type="button"
                        onClick={e => handleDeleteOne(e, n.id)}
                        disabled={deleting}
                        className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="알림 삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
