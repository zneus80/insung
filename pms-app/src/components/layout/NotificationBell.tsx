'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import {
  subscribeNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/firestore';
import type { AppNotification } from '@/types';
import { cn } from '@/lib/utils';

export default function NotificationBell() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);

  // 실시간 리스너 — 새 알림이 Firestore에 쓰이면 즉시 배지/목록 갱신
  useEffect(() => {
    if (!userProfile) return;
    console.debug('[NotificationBell] 구독 시작:', userProfile.id);
    const unsubscribe = subscribeNotifications(userProfile.id, (list) => {
      console.debug('[NotificationBell] 알림 수신:', list.length, '개 (미읽음:', list.filter(n => !n.read).length, ')');
      setNotifications(list);
    });
    return () => {
      console.debug('[NotificationBell] 구독 해제');
      unsubscribe();
    };
  }, [userProfile?.id]); // userProfile.id만 의존성으로 사용 (객체 참조 변경 방지)

  const unreadCount = notifications.filter(n => !n.read).length;

  async function handleClick(n: AppNotification) {
    if (!n.read) await markNotificationRead(n.id);
    setOpen(false);
    router.push(`/goals/${n.goalId}`);
  }

  async function handleMarkAllRead() {
    if (!userProfile) return;
    await markAllNotificationsRead(userProfile.id);
    // 리스너가 자동으로 상태를 갱신하므로 별도 load 불필요
  }

  function getIcon(type: AppNotification['type']) {
    switch (type) {
      case 'GOAL_APPROVED':
      case 'GOAL_LEAD_APPROVED':
      case 'ABANDON_APPROVED':
      case 'ABANDON_LEAD_APPROVED':
      case 'COMPLETION_APPROVED':
        return '✅';
      case 'GOAL_REJECTED':
      case 'ABANDON_REJECTED':
      case 'COMPLETION_REJECTED':
        return '❌';
      case 'GOAL_SUBMITTED':
      case 'COMPLETION_REQUESTED':
      case 'ABANDON_REQUESTED':
        return '📋';
      default: return '🔔';
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="relative rounded-lg p-1.5 hover:bg-gray-100 cursor-pointer outline-none">
        <Bell className="h-5 w-5 text-gray-500" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm text-gray-900">알림</span>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-blue-600 hover:underline"
            >
              모두 읽음
            </button>
          )}
        </div>
        {/* 알림 목록 */}
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Bell className="h-8 w-8 mb-2 opacity-20" />
              <p className="text-xs">알림이 없습니다.</p>
            </div>
          ) : (
            notifications.map(n => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b last:border-0 hover:bg-gray-50 transition-colors',
                  !n.read && 'bg-blue-50 hover:bg-blue-50/80'
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base mt-0.5">{getIcon(n.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm leading-snug', !n.read ? 'font-medium text-gray-900' : 'text-gray-600')}>
                      {n.message}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(n.createdAt, 'MM.dd HH:mm', { locale: ko })}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
