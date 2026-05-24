'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getAllUsers,
  listInnovationActivities,
  createInnovationActivity,
  updateInnovationActivity,
  deleteInnovationActivity,
} from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AuthGuard from '@/components/layout/AuthGuard';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type {
  User,
  InnovationActivity,
  InnovationActivityType,
  InnovationActivityStatus,
} from '@/types';

export default function InnovationPage() {
  return (
    <AuthGuard requireHrAdmin>
      <InnovationContent />
    </AuthGuard>
  );
}

const STATUS_LABEL: Record<InnovationActivityStatus, string> = {
  IN_PROGRESS: '추진중',
  COMPLETED: '완료',
};

function InnovationContent() {
  const { activeYear } = useActiveYear();
  const [tab, setTab] = useState<InnovationActivityType>('SMART_PROJECT');
  const [users, setUsers] = useState<User[]>([]);
  const [items, setItems] = useState<InnovationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<InnovationActivity | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [u, list] = await Promise.all([getAllUsers(), listInnovationActivities(activeYear)]);
      // isActive 가 명시적으로 false 인 경우만 제외 (필드 없는 구버전 사용자는 포함)
      setUsers(u.filter(x => x.isActive !== false));
      setItems(list);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeYear]);

  const filtered = useMemo(() => items.filter(i => i.type === tab), [items, tab]);
  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  function openCreate() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(item: InnovationActivity) { setEditTarget(item); setDialogOpen(true); }

  async function handleDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    setDeleting(id);
    try {
      await deleteInnovationActivity(id);
      toast.success('삭제되었습니다.');
      await reload();
    } catch {
      toast.error('삭제 실패');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="혁신활동 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5 max-w-5xl">
        {/* 탭 */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(['SMART_PROJECT', 'TDS'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-5 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {t === 'SMART_PROJECT' ? '스마트 프로젝트' : 'TDS'}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-500">{activeYear}년 · {filtered.length}건</p>
          <Button onClick={openCreate} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> {tab === 'SMART_PROJECT' ? '프로젝트 추가' : 'TDS 추가'}
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10 rounded-xl border bg-white">등록된 항목이 없습니다.</p>
        ) : (
          <div className="rounded-xl border bg-white overflow-hidden">
            {filtered.map((it, idx) => (
              <div key={it.id} className={cn('px-5 py-3 flex items-start gap-4', idx > 0 && 'border-t')}>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      'text-xs font-bold rounded-full px-2 py-0.5',
                      it.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700',
                    )}>
                      {STATUS_LABEL[it.status]}
                    </span>
                    {it.isConfidential && (
                      <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-700">대내비</span>
                    )}
                    <span className="font-medium text-gray-900">{it.name}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {it.type === 'SMART_PROJECT' ? (
                      <>
                        PM: {usersById.get(it.pmId ?? '')?.name ?? '—'}
                        {' · '}팀원: {(it.memberIds ?? []).map(id => usersById.get(id)?.name).filter(Boolean).join(', ') || '—'}
                      </>
                    ) : (
                      <>
                        수행자: {usersById.get(it.performerId ?? '')?.name ?? '—'}
                        {' · '}지시자: {usersById.get(it.instructorId ?? '')?.name ?? '—'}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(it)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="수정">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(it.id)}
                    disabled={deleting === it.id}
                    className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 disabled:opacity-50"
                    title="삭제"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <InnovationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={tab}
        users={users}
        editTarget={editTarget}
        year={activeYear}
        onSaved={() => { setDialogOpen(false); reload(); }}
      />
    </div>
  );
}

// ── 추가/수정 다이얼로그 ─────────────────────────────────
function InnovationDialog({
  open, onOpenChange, type, users, editTarget, year, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: InnovationActivityType;
  users: User[];
  editTarget: InnovationActivity | null;
  year: number;
  onSaved: () => void;
}) {
  const { userProfile } = useAuth();
  const [name, setName] = useState('');
  const [isConfidential, setIsConfidential] = useState(false);
  const [status, setStatus] = useState<InnovationActivityStatus>('IN_PROGRESS');
  const [pmId, setPmId] = useState<string>('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [performerId, setPerformerId] = useState<string>('');
  const [instructorId, setInstructorId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      setName(editTarget.name);
      setIsConfidential(editTarget.isConfidential);
      setStatus(editTarget.status);
      setPmId(editTarget.pmId ?? '');
      setMemberIds(editTarget.memberIds ?? []);
      setPerformerId(editTarget.performerId ?? '');
      setInstructorId(editTarget.instructorId ?? '');
    } else {
      setName('');
      setIsConfidential(false);
      setStatus('IN_PROGRESS');
      setPmId('');
      setMemberIds([]);
      setPerformerId('');
      setInstructorId('');
    }
  }, [open, editTarget]);

  async function handleSave() {
    if (!name.trim()) { toast.error('이름을 입력해주세요'); return; }
    if (!userProfile) return;
    setSaving(true);
    try {
      const payload = {
        type,
        name: name.trim(),
        isConfidential,
        status,
        year,
        pmId: type === 'SMART_PROJECT' ? (pmId || undefined) : undefined,
        memberIds: type === 'SMART_PROJECT' ? memberIds : undefined,
        performerId: type === 'TDS' ? (performerId || undefined) : undefined,
        instructorId: type === 'TDS' ? (instructorId || undefined) : undefined,
        createdBy: editTarget?.createdBy ?? userProfile.id,
      };
      // undefined 필드는 Firestore 가 거부 → 제거
      const clean = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      ) as typeof payload;
      if (editTarget) {
        await updateInnovationActivity(editTarget.id, clean);
        toast.success('수정되었습니다.');
      } else {
        await createInnovationActivity(clean as Parameters<typeof createInnovationActivity>[0]);
        toast.success('추가되었습니다.');
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toast.error('저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editTarget ? '수정' : '추가'} — {type === 'SMART_PROJECT' ? '스마트 프로젝트' : 'TDS'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>{type === 'SMART_PROJECT' ? '프로젝트명' : 'TDS명'}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="이름 입력" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isConfidential}
              onChange={e => setIsConfidential(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">대내비 (제목을 CONFIDENTIAL 로 노출)</span>
          </label>

          <div className="space-y-1.5">
            <Label>진행상태</Label>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              {(['IN_PROGRESS', 'COMPLETED'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    'px-4 py-1 rounded-md text-sm font-medium transition-colors',
                    status === s ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500',
                  )}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {type === 'SMART_PROJECT' ? (
            <>
              <UserPicker label="PM (프로젝트 매니저)" users={users} value={pmId} onChange={setPmId} />
              <MultiUserPicker label="팀원" users={users} values={memberIds} onChange={setMemberIds} />
            </>
          ) : (
            <>
              <UserPicker label="수행자" users={users} value={performerId} onChange={setPerformerId} />
              <UserPicker label="지시자" users={users} value={instructorId} onChange={setInstructorId} />
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '저장 중...' : (editTarget ? '저장' : '추가')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 단일 사용자 선택 ─────────────────────────────────────
function UserPicker({ label, users, value, onChange }: {
  label: string;
  users: User[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return users.slice(0, 8);
    const k = search.toLowerCase();
    return users.filter(u => u.name?.toLowerCase().includes(k) || u.email?.toLowerCase().includes(k)).slice(0, 12);
  }, [users, search]);
  const selected = users.find(u => u.id === value);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {selected ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-gray-50">
          <span className="text-sm font-medium">{selected.name}</span>
          {selected.position && <span className="text-xs text-gray-400">{selected.position}</span>}
          <button type="button" onClick={() => onChange('')} className="ml-auto text-gray-400 hover:text-red-500">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름·이메일로 검색" />
          {search.trim() && (
            <div className="rounded-lg border max-h-44 overflow-y-auto divide-y">
              {filtered.length === 0 ? (
                <p className="text-xs text-gray-400 px-3 py-2">검색 결과 없음</p>
              ) : filtered.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { onChange(u.id); setSearch(''); }}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                >
                  <span className="font-medium">{u.name}</span>
                  {u.position && <span className="text-xs text-gray-400 ml-2">{u.position}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 복수 사용자 선택 ─────────────────────────────────────
function MultiUserPicker({ label, users, values, onChange }: {
  label: string;
  users: User[];
  values: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const k = search.toLowerCase();
    return users
      .filter(u => !values.includes(u.id))
      .filter(u => u.name?.toLowerCase().includes(k) || u.email?.toLowerCase().includes(k))
      .slice(0, 12);
  }, [users, values, search]);
  const selected = values.map(id => users.find(u => u.id === id)).filter(Boolean) as User[];
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(u => (
            <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">
              {u.name}
              <button type="button" onClick={() => onChange(values.filter(v => v !== u.id))} className="text-blue-400 hover:text-red-500">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름·이메일로 검색해서 추가" />
      {search.trim() && (
        <div className="rounded-lg border max-h-44 overflow-y-auto divide-y">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2">검색 결과 없음</p>
          ) : filtered.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onChange([...values, u.id]); setSearch(''); }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
            >
              <span className="font-medium">{u.name}</span>
              {u.position && <span className="text-xs text-gray-400 ml-2">{u.position}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
