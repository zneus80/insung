'use client';

import { useEffect, useState } from 'react';
import { getAllUsers, getAllMileages, setMileage } from '@/lib/firestore';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import AuthGuard from '@/components/layout/AuthGuard';
import { Pencil, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { User, Mileage, MileageEntry, MileageEntryType, MileageEntrySubtype } from '@/types';
import { getTier } from '@/lib/mileage-tier';

const MILEAGE_ROLES = ['MEMBER', 'TEAM_LEAD'] as const;

const SUBTYPE_OPTIONS: Record<MileageEntryType, { value: MileageEntrySubtype; label: string }[]> = {
  TDS:           [{ value: 'SUBMIT', label: '제출' }, { value: 'INSTRUCT', label: '지시' }],
  SMART_PROJECT: [{ value: 'PM', label: 'PM' }, { value: 'MEMBER', label: '팀원' }],
};

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
  const [entries, setEntries] = useState<MileageEntry[]>([]);
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
    setEntries(existing?.entries ?? []);
  }

  function addEntry(type: MileageEntryType) {
    const def = SUBTYPE_OPTIONS[type][0].value;
    setEntries(prev => [...prev, {
      id: crypto.randomUUID(),
      type, subtype: def, subject: '', points: 0,
      createdAt: new Date(),
    }]);
  }
  function updateEntry(id: string, patch: Partial<MileageEntry>) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }
  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  async function handleSave() {
    if (!editing || !userProfile) return;
    const parsed = parseInt(points, 10);
    if (isNaN(parsed) || parsed < 0) { toast.error('올바른 마일리지 값을 입력하세요.'); return; }
    // entries 정제: subject 비어있으면 제외
    const cleanEntries = entries
      .map(e => ({ ...e, subject: e.subject.trim(), points: Number(e.points) || 0 }))
      .filter(e => e.subject);
    setSaving(true);
    try {
      await setMileage(editing.id, {
        userId: editing.id,
        organizationId: editing.organizationId,
        points: parsed,
        entries: cleanEntries,
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

  function entrySummary(m?: Mileage): string {
    if (!m?.entries || m.entries.length === 0) return '-';
    const tdsCount = m.entries.filter(e => e.type === 'TDS').length;
    const spCount = m.entries.filter(e => e.type === 'SMART_PROJECT').length;
    const parts: string[] = [];
    if (tdsCount > 0) parts.push(`TDS ${tdsCount}`);
    if (spCount > 0) parts.push(`SP ${spCount}`);
    return parts.join(' · ');
  }

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
                <th className="px-4 py-3 text-left">지급 내역</th>
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
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <MemberInfoModal userId={user.id} userName={user.name} />
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
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {entrySummary(m)}
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
                <p className="text-xs text-gray-400">총 마일리지 점수는 직접 입력하며 지급 내역과 별개로 관리됩니다.</p>
              </div>

              {/* 마일리지 지급 내역 */}
              <div className="space-y-3 rounded-xl border bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">마일리지 지급 내역</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => addEntry('TDS')} className="gap-1 h-7 text-xs">
                      <Plus className="h-3 w-3" /> TDS 추가
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addEntry('SMART_PROJECT')} className="gap-1 h-7 text-xs">
                      <Plus className="h-3 w-3" /> 스마트 프로젝트 추가
                    </Button>
                  </div>
                </div>
                {entries.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">아직 지급 내역이 없습니다. 위 버튼으로 추가하세요.</p>
                ) : (
                  <div className="space-y-2">
                    {entries.map(entry => (
                      <div key={entry.id} className="rounded-lg border bg-white p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 text-xs font-bold rounded-full px-2 py-0.5 ${
                            entry.type === 'TDS' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {entry.type === 'TDS' ? 'TDS' : '스마트 프로젝트'}
                          </span>
                          <select
                            value={entry.subtype}
                            onChange={e => updateEntry(entry.id, { subtype: e.target.value as MileageEntrySubtype })}
                            className="rounded border border-gray-200 px-2 py-1 text-xs"
                          >
                            {SUBTYPE_OPTIONS[entry.type].map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeEntry(entry.id)}
                            className="ml-auto p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                            title="삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-[1fr_120px] gap-2">
                          <Input
                            placeholder="주제명"
                            value={entry.subject}
                            onChange={e => updateEntry(entry.id, { subject: e.target.value })}
                            className="h-8 text-sm"
                          />
                          <Input
                            type="number"
                            min={0}
                            placeholder="지급 마일리지"
                            value={String(entry.points)}
                            onChange={e => updateEntry(entry.id, { points: Number(e.target.value) || 0 })}
                            className="h-8 text-sm text-right"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
