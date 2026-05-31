'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, updateUser, createAuditLog } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { SearchInput } from '@/components/ui/search-input';
import ReauthModal from '@/components/auth/ReauthModal';
import { toast } from 'sonner';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import type { User } from '@/types';

export default function HrMasterPage() {
  return (
    <AuthGuard allowedRoles={['CEO']}>
      <HrMasterContent />
    </AuthGuard>
  );
}

function HrMasterContent() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const all = await getAllUsers();
      setUsers(all.filter(u => u.isActive));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // 재인증 모달 상태 (D-2)
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthReason, setReauthReason] = useState('');
  const pendingAction = useRef<(() => Promise<void>) | undefined>(undefined);

  async function handleToggleMaster(user: User) {
    if (!userProfile) return;
    const nextMaster = !user.isHrMaster;
    const action = nextMaster ? '부여' : '제거';
    if (!confirm(`${user.name}님에게 HR 마스터 권한을 ${action}하시겠습니까?\n${nextMaster ? '마스터 권한이 부여되면 자동으로 HR 관리자 권한도 함께 부여됩니다.' : '마스터 권한만 제거됩니다. HR 관리자 권한은 유지됩니다.'}`)) return;

    // 본인 재인증 후 실행 — 민감 액션 (D-2)
    pendingAction.current = async () => {
      setSaving(user.id);
      try {
        await updateUser(user.id, nextMaster
          ? { isHrMaster: true, isHrAdmin: true }
          : { isHrMaster: false }
        );
        await createAuditLog({
          action: nextMaster ? 'HR_ROLE_GRANT' : 'HR_ROLE_REVOKE',
          actorId: userProfile.id,
          actorName: userProfile.name,
          targetId: user.id,
          targetName: user.name,
          details: `HR 마스터 ${action} (최고관리자 직접 처리, 재인증 완료)`,
        });
        toast.success(`${user.name}님의 HR 마스터 권한을 ${action}했습니다.`);
        await load();
      } catch (e: any) {
        toast.error(`처리 실패: ${e?.message ?? '알 수 없는 오류'}`);
      } finally {
        setSaving(null);
      }
    };
    setReauthReason(`${user.name}님 HR 마스터 권한 ${action}`);
    setReauthOpen(true);
  }

  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const masters = users.filter(u => u.isHrMaster);

  return (
    <div className="flex flex-col h-full">
      <Header title="HR 마스터 권한 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl">

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-800">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">최고관리자 전용 메뉴</p>
            <ul className="list-disc list-inside text-xs space-y-0.5">
              <li>HR 마스터는 인사평가 등급 설정, 평가이력 관리, 데이터 백업 등 민감 기능에 접근할 수 있습니다.</li>
              <li>마스터 권한 부여 시 HR 관리자 권한도 자동 부여됩니다.</li>
              <li>마스터 권한 제거 시 HR 관리자 권한은 유지되며, 별도로 제거하려면 사용자 관리에서 처리하세요.</li>
              <li>모든 권한 변경은 감사 로그에 기록됩니다.</li>
            </ul>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold text-gray-900">현재 HR 마스터</h3>
            <span className="text-xs text-gray-400">{masters.length}명</span>
          </div>
          {masters.length === 0 ? (
            <p className="text-sm text-gray-400">현재 HR 마스터가 지정되어 있지 않습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {masters.map(m => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 text-xs px-3 py-1 font-medium">
                  {m.name} <span className="text-blue-400">· {m.position ?? '-'}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <SearchInput
            placeholder="이름·이메일 검색"
            value={search}
            onChange={setSearch}
            className="max-w-xs"
          />
          <span className="text-xs text-gray-400 ml-auto">총 {filtered.length}명</span>
        </div>

        <div className="rounded-xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-3 text-left">이름</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-left">직책</th>
                <th className="px-4 py-3 text-center">HR 관리자</th>
                <th className="px-4 py-3 text-center">HR 마스터</th>
                <th className="px-4 py-3 text-right">액션</th>
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
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">검색 결과가 없습니다.</td>
                </tr>
              ) : filtered.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-gray-500">{u.position ?? '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {u.isHrAdmin ? <span className="text-blue-600">●</span> : <span className="text-gray-200">○</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.isHrMaster ? <span className="text-amber-600 font-bold">★</span> : <span className="text-gray-200">☆</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleToggleMaster(u)}
                      disabled={saving === u.id}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                        u.isHrMaster
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                      }`}
                    >
                      {saving === u.id ? '처리 중...' : u.isHrMaster ? '마스터 제거' : '마스터 부여'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      <ReauthModal
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        reason={reauthReason}
        onConfirmed={async () => {
          const fn = pendingAction.current;
          pendingAction.current = undefined;
          if (fn) await fn();
        }}
      />
    </div>
  );
}
