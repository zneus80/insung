'use client';

import { useEffect, useState } from 'react';
import { getAllUsers, getAllMileages, setMileage } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import AuthGuard from '@/components/layout/AuthGuard';
import { Pencil, Lock } from 'lucide-react';
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

  const [editing, setEditing] = useState<User | null>(null);
  const [points, setPoints] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  // 다이얼로그에서 미리보기용
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
    setMemo(existing?.memo ?? '');
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
        memo: memo.trim() || '',
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
  const filtered = users.filter(u => u.name.includes(search) || u.email.includes(search));

  return (
    <div className="flex flex-col h-full">
      <Header title="마일리지 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {isReadOnly && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
            <Lock className="h-4 w-4 shrink-0" />
            최고관리자는 마일리지를 조회만 할 수 있습니다. 수정은 HR관리자 계정으로 로그인하세요.
          </div>
        )}

        <div className="flex gap-3 items-center">
          <Input
            placeholder="이름 또는 이메일 검색"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <span className="text-xs text-gray-400 ml-auto">총 {filtered.length}명</span>
        </div>

        {/* 등급 범례 */}
        <div className="flex flex-wrap gap-2">
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

        <div className="rounded-xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-3 text-left">이름</th>
                <th className="px-4 py-3 text-left">직책</th>
                <th className="px-4 py-3 text-left">등급</th>
                <th className="px-4 py-3 text-right">마일리지</th>
                <th className="px-4 py-3 text-left">메모</th>
                <th className="px-4 py-3 text-left">최종 수정</th>
                {!isReadOnly && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3].map(i => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-3">
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
                    <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
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
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[160px] truncate">
                      {m?.memo ?? '-'}
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
          <DialogContent>
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
                <Label>마일리지 *</Label>
                <Input
                  type="number"
                  min={0}
                  value={points}
                  onChange={e => setPoints(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>메모</Label>
                <Input
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  placeholder="지급 사유 등 (선택)"
                />
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
