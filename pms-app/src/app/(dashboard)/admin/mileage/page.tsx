'use client';

import { useEffect, useState } from 'react';
import { getAllUsers, getAllMileages, setMileage } from '@/lib/firestore';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import AuthGuard from '@/components/layout/AuthGuard';
import { Pencil, Lock, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { User, Mileage } from '@/types';
import { getTier } from '@/lib/mileage-tier';

const MILEAGE_ROLES = ['MEMBER', 'TEAM_LEAD'] as const;

export default function MileagePage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <MileageContent />
    </AuthGuard>
  );
}

function MileageContent() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [mileages, setMileages] = useState<Record<string, Mileage>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // ── 정렬·필터 ─────────────────────────────────
  type SortKey = 'name' | 'points';
  type SortDir = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterTier, setFilterTier] = useState<string>('ALL');

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-1 text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp className="inline h-3 w-3 ml-1 text-blue-500" />
      : <ChevronDown className="inline h-3 w-3 ml-1 text-blue-500" />;
  }

  const [editing, setEditing] = useState<User | null>(null);
  const [points, setPoints] = useState('');
  const [saving, setSaving] = useState(false);

  const previewPoints = parseInt(points, 10) || 0;
  const previewTier = getTier(previewPoints);

  async function load() {
    try {
      const [allUsers, allMileages] = await Promise.all([getAllUsers(), getAllMileages()]);
      const eligible = allUsers.filter(u => (MILEAGE_ROLES as readonly string[]).includes(u.role));
      setUsers(eligible);
      setMileages(Object.fromEntries(allMileages.map(m => [m.userId, m])));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openEdit(user: User) {
    const existing = mileages[user.id];
    setEditing(user);
    setPoints(String(existing?.points ?? 0));
  }

  async function handleSave() {
    if (!editing || !userProfile) return;
    const parsed = parseInt(points, 10);
    if (isNaN(parsed) || parsed < 0) { toast.error('올바른 마일리지 값을 입력하세요.'); return; }
    setSaving(true);
    try {
      await setMileage(editing.id, {
        userId: editing.id,
        organizationId: editing.organizationId,
        points: parsed,
        // 지급 내역(entries) 수동 입력 폐지 — 혁신활동 관리로 일원화. 기존 값은 보존.
        entries: mileages[editing.id]?.entries ?? [],
        updatedBy: userProfile.id,
      });
      toast.success(`${editing.name}님의 마일리지가 저장되었습니다.`);
      setEditing(null);
      await load();
    } catch (e: any) {
      console.error('마일리지 저장 오류:', e);
      toast.error(`저장 실패: ${e?.code ?? e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  }

  const isReadOnly = userProfile?.role === 'CEO';

  // 등급 범위 매핑 (filterTier 값 → 포인트 범위)
  const TIER_RANGES: Record<string, [number, number]> = {
    '새싹':    [0, 199],
    '주니어':  [200, 399],
    '시니어':  [400, 599],
    '전문가':  [600, 799],
    '마스터':  [800, 999],
    '지식스타': [1000, Infinity],
  };

  const filtered = users
    .filter(u => {
      const txt = search.toLowerCase();
      if (txt && !u.name.toLowerCase().includes(txt) && !u.email.toLowerCase().includes(txt)) return false;
      if (filterTier !== 'ALL') {
        const m = mileages[u.id];
        if (filterTier === '미입력') { if (m) return false; }
        else {
          const pts = m?.points ?? 0;
          const range = TIER_RANGES[filterTier];
          if (!m) return false;
          if (range && (pts < range[0] || pts > range[1])) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name, 'ko');
      } else if (sortKey === 'points') {
        const pa = mileages[a.id]?.points ?? -1;
        const pb = mileages[b.id]?.points ?? -1;
        cmp = pa - pb;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  return (
    <div className="flex flex-col h-full">
      <Header title="마일리지 관리" />
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-6 overflow-hidden">

        {isReadOnly && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700 shrink-0">
            <Lock className="h-4 w-4 shrink-0" />
            최고관리자는 마일리지를 조회만 할 수 있습니다. 수정은 HR관리자 계정으로 로그인하세요.
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center shrink-0">
          <SearchInput
            placeholder="이름 또는 이메일 검색"
            value={search}
            onChange={setSearch}
            className="max-w-xs"
          />
          {/* 등급 필터 */}
          <select
            value={filterTier}
            onChange={e => setFilterTier(e.target.value)}
            className="h-9 rounded-md border border-gray-200 bg-white px-3 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">전체 등급</option>
            <option value="새싹">🌱 새싹 (0–199)</option>
            <option value="주니어">📘 주니어 (200–399)</option>
            <option value="시니어">💡 시니어 (400–599)</option>
            <option value="전문가">🚀 전문가 (600–799)</option>
            <option value="마스터">🏆 마스터 (800–999)</option>
            <option value="지식스타">⭐ 지식스타 (1000+)</option>
            <option value="미입력">미입력</option>
          </select>
          {(filterTier !== 'ALL' || search) && (
            <button
              onClick={() => { setFilterTier('ALL'); setSearch(''); }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              초기화
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">총 {filtered.length}명</span>
        </div>

        {/* 등급 범례 */}
        <div className="flex flex-wrap gap-2 shrink-0">
          {[
            { label: '🌱 새싹', sub: '0–199', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            { label: '📘 주니어', sub: '200–399', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
            { label: '💡 시니어', sub: '400–599', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
            { label: '🚀 전문가', sub: '600–799', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
            { label: '🏆 마스터', sub: '800–999', cls: 'bg-red-50 text-red-700 border-red-200' },
            { label: '⭐ 지식스타', sub: '1000+', cls: 'bg-amber-50 text-amber-700 border-amber-300' },
          ].map(t => (
            <span key={t.label} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${t.cls}`}>
              {t.label} <span className="text-[10px] opacity-70">{t.sub}</span>
            </span>
          ))}
        </div>

        <div className="flex-1 min-h-0 rounded-xl border bg-white overflow-y-auto overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>
                  이름 <SortIcon col="name" />
                </th>
                <th className="px-4 py-3 text-left">직책</th>
                <th className="px-4 py-3 text-left">등급</th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('points')}>
                  마일리지 <SortIcon col="points" />
                </th>
                <th className="px-4 py-3 text-left">최종 수정</th>
                {!isReadOnly && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3].map(i => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-gray-100" />
                    </td>
                  </tr>
                ))
              ) : filtered.map(user => {
                const m = mileages[user.id];
                const pts = m?.points ?? 0;
                const tier = getTier(pts);
                return (
                  <tr key={user.id} className={m ? tier.bg : ''}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <MemberInfoModal userId={user.id} userName={user.name} targetRole={user.role} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">{user.position ?? '-'}</td>
                    <td className="px-4 py-3">
                      {m ? (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tier.badge} ${tier.border}`}>
                          {tier.icon} {tier.label}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">미입력</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m ? (
                        <span className={`font-bold text-sm ${tier.color}`}>
                          {pts.toLocaleString()}점
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {m ? format(m.updatedAt, 'yy.MM.dd', { locale: ko }) : '-'}
                    </td>
                    {!isReadOnly && (
                      <td className="px-4 py-3">
                        <button onClick={() => openEdit(user)} className="p-1.5 rounded hover:bg-gray-100">
                          <Pencil className="h-3.5 w-3.5 text-gray-400" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
          <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing?.name}님 마일리지 수정</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {/* 등급 미리보기 */}
              <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${previewTier.bg} ${previewTier.border}`}>
                <span className="text-3xl">{previewTier.icon}</span>
                <div>
                  <p className={`font-bold ${previewTier.color}`}>{previewTier.label}</p>
                  <p className="text-xs text-gray-500">{previewPoints.toLocaleString()}점</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>마일리지 (총점) *</Label>
                <Input
                  type="number"
                  min={0}
                  value={points}
                  onChange={e => setPoints(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-gray-400">스마트프로젝트·TDS 실적은 혁신활동 관리에서 자동 집계됩니다. 여기서는 마일리지 총점만 관리합니다.</p>
              </div>

              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
