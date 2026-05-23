'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Bell, Target, ClipboardList, MessageCircle, Award, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { AppNotification, NotificationCategory } from '@/types';

const CATEGORY_META: Record<NotificationCategory, { label: string; icon: React.ReactNode; color: string }> = {
  GOAL:        { label: '핵심목표',   icon: <Target className="h-4 w-4" />,        color: 'text-blue-600 bg-blue-50' },
  WEEKLY_TASK: { label: '주간업무',   icon: <ClipboardList className="h-4 w-4" />, color: 'text-green-600 bg-green-50' },
  ONEONONE:    { label: '1on1',      icon: <MessageCircle className="h-4 w-4" />, color: 'text-purple-600 bg-purple-50' },
  EVALUATION:  { label: '평가',      icon: <Award className="h-4 w-4" />,         color: 'text-orange-600 bg-orange-50' },
};

export default function NotificationsPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<NotificationCategory | 'ALL'>('ALL');

  async function load() {
    if (!userProfile) return;
    setLoading(true);
    try {
      const list = await getNotifications(userProfile.id);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [userProfile]);

  async function handleClick(n: AppNotification) {
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

  const unreadCount = items.filter(i => !i.read).length;
  const filtered = filter === 'ALL' ? items : items.filter(i => i.category === filter);

  return (
    <div className="flex flex-col h-full">
      <Header title="알림" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">

        {/* 상단 액션 */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            전체 {items.length}건 · 미읽음 <span className="text-red-600 font-semibold">{unreadCount}</span>건
          </p>
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleMarkAllRead}>
              모두 읽음 처리
            </Button>
          )}
        </div>

        {/* 카테고리 필터 */}
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'GOAL', 'WEEKLY_TASK', 'ONEONONE', 'EVALUATION'] as const).map(c => (
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
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'w-full text-left flex items-start gap-3 rounded-xl border bg-white p-4 transition-colors hover:shadow-sm',
                    !n.read && 'border-blue-200 bg-blue-50/30',
                  )}
                >
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
                  </div>
                  {n.read && (
                    <CheckCircle2 className="h-4 w-4 text-gray-300 shrink-0 mt-1" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
