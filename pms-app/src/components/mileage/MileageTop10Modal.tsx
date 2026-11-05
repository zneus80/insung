'use client';

/**
 * 마일리지 Top 10 — 전사 마일리지(마일리지관리 데이터) 상위 10명을 점수순으로 표시하는 팝업.
 * 마일리지는 전사 공유 정보(firestore 규칙상 인증 사용자 read 허용)라 §6-1 가시성 대상 아님.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Trophy } from 'lucide-react';
import { getAllMileages, getAllUsers, getOrganizations } from '@/lib/firestore';
import type { User, Organization } from '@/types';

interface Row { userId: string; name: string; org: string; points: number; }

// 순위별 메달 색(1·2·3) / 그 외 회색
const MEDAL = ['bg-amber-100 text-amber-700 ring-amber-300', 'bg-gray-100 text-gray-600 ring-gray-300', 'bg-orange-100 text-orange-700 ring-orange-300'];
const MEDAL_EMOJI = ['🥇', '🥈', '🥉'];

export default function MileageTop10Modal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [mileages, users, orgs] = await Promise.all([getAllMileages(), getAllUsers(), getOrganizations()]);
        const orgById = new Map<string, Organization>(orgs.map(o => [o.id, o]));
        const userById = new Map<string, User>(users.map(u => [u.id, u]));
        const ranked: Row[] = mileages
          .map(m => {
            const u = userById.get(m.userId);
            return u && u.isActive !== false
              ? { userId: m.userId, name: u.name, org: orgById.get(u.organizationId)?.name ?? '—', points: m.points ?? 0 }
              : null;
          })
          .filter((r): r is Row => r !== null && r.points > 0)
          .sort((a, b) => b.points - a.points)
          .slice(0, 10);
        setRows(ranked);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 동점 처리 — 같은 점수는 같은 순위(1,1,3 …)
  const withRank = useMemo(() => {
    let lastPts = -1, lastRank = 0;
    return rows.map((r, i) => {
      const rank = r.points === lastPts ? lastRank : i + 1;
      lastPts = r.points; lastRank = rank;
      return { ...r, rank };
    });
  }, [rows]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b flex items-center justify-between shrink-0 bg-gradient-to-r from-amber-50 to-white">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            마일리지 TOP 10
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 text-gray-500">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-11 animate-pulse rounded-lg bg-gray-100" />)}</div>
          ) : withRank.length === 0 ? (
            <p className="py-10 text-center text-xs text-gray-400">마일리지 데이터가 없습니다.</p>
          ) : (
            <ol className="space-y-1.5">
              {withRank.map(r => {
                const top3 = r.rank <= 3;
                return (
                  <li key={r.userId}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${top3 ? 'bg-amber-50/60 ring-1 ring-amber-100' : 'bg-gray-50'}`}>
                    <span className={`flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-sm font-bold ${top3 ? `ring-2 ${MEDAL[r.rank - 1]}` : 'bg-white text-gray-500 ring-1 ring-gray-200'}`}>
                      {top3 ? MEDAL_EMOJI[r.rank - 1] : r.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{r.name}</p>
                      <p className="text-[11px] text-gray-400 truncate">{r.org}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-base font-bold text-amber-600 tabular-nums">{r.points.toLocaleString()}</span>
                      <span className="text-[10px] text-gray-400 ml-0.5">점</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
