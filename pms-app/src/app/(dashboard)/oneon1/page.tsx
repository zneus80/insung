'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Plus, MessageCircle, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getOneOnOnesByMember, getOneOnOnesByLeader, getAllUsers, hideOneOnOneForUser } from '@/lib/firestore';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import Header from '@/components/layout/Header';
import type { OneOnOne, User } from '@/types';

export default function OneOnOnePage() {
  const { userProfile } = useAuth();
  const [rooms, setRooms] = useState<OneOnOne[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    async function load() {
      try {
        // role 무관하게 leader/member 양쪽 모두 조회 (병합 + dedupe + hiddenFor 필터)
        const [asLeader, asMember, allUsers] = await Promise.all([
          getOneOnOnesByLeader(userProfile!.id),
          getOneOnOnesByMember(userProfile!.id),
          getAllUsers(),
        ]);
        const map = new Map<string, OneOnOne>();
        [...asLeader, ...asMember].forEach(r => map.set(r.id, r));
        const merged = Array.from(map.values())
          .filter(r => !(r.hiddenFor ?? []).includes(userProfile!.id));
        const sorted = merged.sort((a, b) => {
          const ta = a.lastMessageAt ?? a.createdAt;
          const tb = b.lastMessageAt ?? b.createdAt;
          return tb.getTime() - ta.getTime();
        });
        setRooms(sorted);
        setUsers(Object.fromEntries(allUsers.map(u => [u.id, u])));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userProfile]);

  return (
    <div className="flex flex-col h-full">
      <Header title="1on1" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">상위 결재권자 또는 본인 책임 조직 인원과 1on1 대화를 진행합니다.</p>
          <Link href="/oneon1/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> 대화 시작
            </Button>
          </Link>
        </div>

        {loading ? (
          <SkeletonList />
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-gray-50 py-16">
            <MessageCircle className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm text-gray-400">
              대화를 시작해보세요. 상위 결재권자 또는 본인 책임 조직 인원과 매칭할 수 있습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rooms.map(room => {
              // 본인이 leader 면 상대는 member, 그 반대도 마찬가지
              const counterpartId = room.leaderId === userProfile?.id ? room.memberId : room.leaderId;
              const counterpart = users[counterpartId];
              const lastAt = room.lastMessageAt ?? room.createdAt;
              return (
                <div key={room.id} className="group relative">
                  <Link href={`/oneon1/${room.id}`}>
                    <div className="flex items-center gap-4 rounded-xl border bg-white p-4 hover:shadow-sm transition-shadow cursor-pointer">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-semibold text-sm">
                        {counterpart?.name?.[0] ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0 pr-10">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-medium text-gray-900 truncate">
                            {counterpart?.name ?? '알 수 없음'}
                          </span>
                          {room.title && (
                            <span className="text-xs text-gray-400 font-normal truncate">· {room.title}</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 truncate mt-0.5">
                          <span className="text-xs text-gray-400 mr-1.5">
                            {formatDistanceToNow(lastAt, { addSuffix: true, locale: ko })}
                          </span>
                          {room.lastMessagePreview ?? '아직 메시지가 없습니다.'}
                        </p>
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!confirm('이 대화방을 본인 화면에서 삭제하시겠습니까?\n(상대방 화면에는 그대로 유지됩니다)')) return;
                      try {
                        await hideOneOnOneForUser(room.id, userProfile!.id);
                        setRooms(prev => prev.filter(x => x.id !== room.id));
                        toast.success('대화방을 삭제했습니다.');
                      } catch {
                        toast.error('삭제 중 오류가 발생했습니다.');
                      }
                    }}
                    className="absolute top-1/2 right-3 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    aria-label="대화방 삭제"
                    title="이 대화방 삭제"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
      ))}
    </div>
  );
}
