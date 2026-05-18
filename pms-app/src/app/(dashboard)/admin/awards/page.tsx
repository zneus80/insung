'use client';

import { useEffect, useState } from 'react';
import { getAllUsers, getAwardsByUser, createAward, deleteAward } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AuthGuard from '@/components/layout/AuthGuard';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { User, Award } from '@/types';

export default function AwardsPage() {
  return (
    <AuthGuard requireHrAdmin>
      <AwardsContent />
    </AuthGuard>
  );
}

function AwardsContent() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [awards, setAwards] = useState<Award[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingAwards, setLoadingAwards] = useState(false);

  // 추가 다이얼로그
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formUserId, setFormUserId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function loadUsers() {
    try {
      const all = await getAllUsers();
      setUsers(all.filter(u => u.isActive));
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadAwards(uid: string) {
    setLoadingAwards(true);
    try {
      const list = await getAwardsByUser(uid);
      setAwards(list);
    } finally {
      setLoadingAwards(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  useEffect(() => {
    if (selectedUserId) {
      loadAwards(selectedUserId);
    } else {
      setAwards([]);
    }
  }, [selectedUserId]);

  function openDialog() {
    setFormUserId(selectedUserId);
    setFormTitle('');
    setFormDate('');
    setFormDesc('');
    setDialogOpen(true);
  }

  async function handleAdd() {
    if (!userProfile) return;
    if (!formUserId) { toast.error('사용자를 선택하세요.'); return; }
    if (!formTitle.trim()) { toast.error('포상명을 입력하세요.'); return; }
    if (!formDate) { toast.error('수여일을 입력하세요.'); return; }
    setSaving(true);
    try {
      await createAward({
        userId: formUserId,
        title: formTitle.trim(),
        description: formDesc.trim() || undefined,
        awardDate: formDate,
        grantedBy: userProfile.id,
      });
      toast.success('포상 이력이 추가되었습니다.');
      setDialogOpen(false);
      if (selectedUserId === formUserId || !selectedUserId) {
        setSelectedUserId(formUserId);
        await loadAwards(formUserId);
      }
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(award: Award) {
    if (!confirm(`"${award.title}" 포상 이력을 삭제하시겠습니까?`)) return;
    setDeleting(award.id);
    try {
      await deleteAward(award.id);
      toast.success('삭제되었습니다.');
      setAwards(prev => prev.filter(a => a.id !== award.id));
    } catch (e: any) {
      toast.error(`삭제 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setDeleting(null);
    }
  }

  const selectedUser = users.find(u => u.id === selectedUserId);

  return (
    <div className="flex flex-col h-full">
      <Header title="포상 이력 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* 사용자 선택 + 추가 버튼 */}
        <div className="flex items-center gap-3">
          <div className="w-64">
            <Select value={selectedUserId} onValueChange={v => v && setSelectedUserId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="사용자 선택" />
              </SelectTrigger>
              <SelectContent>
                {loadingUsers ? (
                  <SelectItem value="_loading" disabled>불러오는 중...</SelectItem>
                ) : users.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} {u.position ? `(${u.position})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={openDialog} className="gap-1.5">
            <Plus className="h-4 w-4" />
            포상 이력 추가
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger className="hidden" />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>포상 이력 추가</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label>사용자 *</Label>
                  <Select value={formUserId} onValueChange={v => v && setFormUserId(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="사용자 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name} {u.position ? `(${u.position})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>포상명 *</Label>
                  <Input
                    value={formTitle}
                    onChange={e => setFormTitle(e.target.value)}
                    placeholder="예: 우수사원상"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>수여일 *</Label>
                  <Input
                    type="date"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>내용</Label>
                  <Textarea
                    rows={3}
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder="포상 내용 (선택)"
                  />
                </div>
                <Button onClick={handleAdd} disabled={saving} className="w-full">
                  {saving ? '저장 중...' : '저장'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 포상 이력 테이블 */}
        {selectedUserId ? (
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {selectedUser?.name ?? ''} 님의 포상 이력
              </h3>
              <span className="text-xs text-gray-400">{awards.length}건</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs border-b">
                <tr>
                  <th className="px-4 py-3 text-left">이름</th>
                  <th className="px-4 py-3 text-left">포상명</th>
                  <th className="px-4 py-3 text-left">수여일</th>
                  <th className="px-4 py-3 text-left">내용</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingAwards ? (
                  [1, 2, 3].map(i => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-100" />
                      </td>
                    </tr>
                  ))
                ) : awards.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                      포상 이력이 없습니다.
                    </td>
                  </tr>
                ) : awards.map(award => (
                  <tr key={award.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {users.find(u => u.id === award.userId)?.name ?? '-'}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{award.title}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {format(new Date(award.awardDate), 'yyyy.MM.dd', { locale: ko })}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[240px] truncate">
                      {award.description ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(award)}
                        disabled={deleting === award.id}
                        className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                        title="삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border bg-white p-12 text-center text-sm text-gray-400">
            위에서 사용자를 선택하면 포상 이력을 확인할 수 있습니다.
          </div>
        )}
      </div>
    </div>
  );
}
