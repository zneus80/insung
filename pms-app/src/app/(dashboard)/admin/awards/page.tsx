'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getAllUsers,
  getAwardsByUser,
  getAwardsByYearRange,
  getAwardsByYear,
  createAward,
  deleteAward,
} from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import Header from '@/components/layout/Header';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import AuthGuard from '@/components/layout/AuthGuard';
import { Plus, Trash2, X, ChevronDown, ChevronRight, Search, User as UserIcon, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { User, Award } from '@/types';

export default function AwardsPage() {
  return (
    <AuthGuard requireHrAdmin>
      <AwardsContent />
    </AuthGuard>
  );
}

const CATEGORY_SPAN = 10; // 최근 10년만 카테고리화

function AwardsContent() {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // 10년 카테고리 데이터
  const [recentAwards, setRecentAwards] = useState<Award[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  // 펼친 연도 — 기본 당해년도만 펼침
  const [openYears, setOpenYears] = useState<Set<number>>(new Set([activeYear]));

  // 인라인 입력 폼
  const [formUserId, setFormUserId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // 과거 이력 조회 (이름 / 연도)
  const [searchMode, setSearchMode] = useState<'NAME' | 'YEAR'>('NAME');
  const [searchUserId, setSearchUserId] = useState('');
  const [searchYear, setSearchYear] = useState<number | ''>('');
  const [searchResults, setSearchResults] = useState<Award[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // ── 데이터 로딩 ─────────────────────────────────────
  async function loadUsers() {
    try {
      const all = await getAllUsers();
      setUsers(all.filter(u => u.isActive !== false));
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadRecent() {
    setLoadingRecent(true);
    try {
      const startYear = activeYear - CATEGORY_SPAN + 1;
      const list = await getAwardsByYearRange(startYear, activeYear);
      setRecentAwards(list);
    } finally {
      setLoadingRecent(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);
  useEffect(() => { loadRecent(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeYear]);
  // activeYear 가 바뀌면 펼침 기본값도 그 해로 동기화
  useEffect(() => { setOpenYears(new Set([activeYear])); }, [activeYear]);

  // ── 추가 ──────────────────────────────────────────
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
      setFormTitle('');
      setFormDate('');
      setFormDesc('');
      await loadRecent();
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
      setRecentAwards(prev => prev.filter(a => a.id !== award.id));
      setSearchResults(prev => prev.filter(a => a.id !== award.id));
    } catch (e: any) {
      toast.error(`삭제 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setDeleting(null);
    }
  }

  // ── 카테고리(연도별) 그룹핑 ─────────────────────────
  const awardsByYear = useMemo(() => {
    const m = new Map<number, Award[]>();
    for (let y = activeYear; y > activeYear - CATEGORY_SPAN; y--) m.set(y, []);
    recentAwards.forEach(a => {
      const y = parseInt(a.awardDate.slice(0, 4), 10);
      if (m.has(y)) m.get(y)!.push(a);
    });
    return m;
  }, [recentAwards, activeYear]);

  // ── 과거 이력 조회 ─────────────────────────────────
  async function handleSearch() {
    setSearching(true);
    setSearchPerformed(true);
    try {
      if (searchMode === 'NAME') {
        if (!searchUserId) { toast.error('사용자를 선택하세요.'); return; }
        const list = await getAwardsByUser(searchUserId);
        setSearchResults(list);
      } else {
        if (!searchYear) { toast.error('연도를 입력하세요.'); return; }
        const list = await getAwardsByYear(Number(searchYear));
        setSearchResults(list);
      }
    } catch (e: any) {
      toast.error(`조회 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setSearching(false);
    }
  }

  function toggleYear(y: number) {
    setOpenYears(prev => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  }

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  return (
    <div className="flex flex-col h-full">
      <Header title="포상 이력 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl">

        {/* ── 인라인 포상 이력 추가 ─────────────────── */}
        <div className="rounded-xl border bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-blue-600" />
            <h3 className="text-base font-semibold text-gray-900">포상 이력 추가</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UserPicker label="사용자 *" users={users} value={formUserId} onChange={setFormUserId} loading={loadingUsers} />
            <div className="space-y-1.5">
              <Label>수여일 *</Label>
              <Input type="date" min="2000-01-01" max="2099-12-31" value={formDate} onChange={e => setFormDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>포상명 *</Label>
              <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="예: 우수사원상" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>내용</Label>
              <Textarea rows={3} value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="포상 내용 (선택)" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleAdd} disabled={saving}>{saving ? '저장 중...' : '저장'}</Button>
          </div>
        </div>

        {/* ── 연도별 포상 이력 조회 (최근 10년 카테고리) ─ */}
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">연도별 포상 이력 조회</h3>
            <span className="text-xs text-gray-400">
              {activeYear - CATEGORY_SPAN + 1} ~ {activeYear} ({CATEGORY_SPAN}년)
            </span>
          </div>
          {loadingRecent ? (
            <div className="p-6 space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>
          ) : (
            <div className="divide-y">
              {Array.from(awardsByYear.entries()).map(([year, list]) => {
                const isOpen = openYears.has(year);
                return (
                  <div key={year}>
                    <button
                      onClick={() => toggleYear(year)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      <span className={cn('font-semibold', year === activeYear ? 'text-blue-700' : 'text-gray-800')}>
                        {year}년
                      </span>
                      {year === activeYear && (
                        <span className="rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5">당해</span>
                      )}
                      <span className="ml-auto text-xs text-gray-400">{list.length}건</span>
                    </button>
                    {isOpen && (
                      list.length === 0 ? (
                        <p className="px-12 py-4 text-sm text-gray-400">해당 연도 포상 이력이 없습니다.</p>
                      ) : (
                        <ul className="divide-y divide-gray-100 bg-gray-50/30">
                          {list.map(a => (
                            <AwardRow key={a.id} award={a} usersById={usersById} onDelete={handleDelete} deleting={deleting} />
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 과거(10년 이전) · 이름·연도 조회 ──────────── */}
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50 flex items-center gap-2">
            <Search className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">이름·연도 조회</h3>
            <span className="text-xs text-gray-400 ml-1">(과거 자료 포함)</span>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex gap-2">
              {([['NAME', '이름으로', UserIcon], ['YEAR', '연도로', Calendar]] as const).map(([m, label, Icon]) => (
                <button
                  key={m}
                  onClick={() => { setSearchMode(m); setSearchResults([]); setSearchPerformed(false); }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    searchMode === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {searchMode === 'NAME' ? (
              <UserPicker label="" users={users} value={searchUserId} onChange={setSearchUserId} loading={loadingUsers} compact />
            ) : (
              <Input
                type="number"
                value={searchYear === '' ? '' : String(searchYear)}
                onChange={e => setSearchYear(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="예: 2015"
                min={1990}
                max={2100}
              />
            )}

            <Button onClick={handleSearch} disabled={searching}>
              {searching ? '조회 중...' : '조회'}
            </Button>
          </div>

          {searchPerformed && (
            searchResults.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-400 text-center border-t">조회 결과가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-gray-100 border-t">
                {searchResults.map(a => (
                  <AwardRow key={a.id} award={a} usersById={usersById} onDelete={handleDelete} deleting={deleting} />
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function AwardRow({ award, usersById, onDelete, deleting }: {
  award: Award;
  usersById: Map<string, User>;
  onDelete: (a: Award) => void;
  deleting: string | null;
}) {
  const u = usersById.get(award.userId);
  return (
    <li className="px-5 py-3 flex items-start gap-4 hover:bg-white transition-colors">
      <div className="w-24 shrink-0 text-xs text-gray-500">
        {format(new Date(award.awardDate), 'yyyy.MM.dd', { locale: ko })}
      </div>
      <div className="w-28 shrink-0 text-sm font-medium text-gray-900">
        {u ? <MemberInfoModal userId={u.id} userName={u.name} /> : '—'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{award.title}</p>
        {award.description && (
          <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap leading-relaxed">{award.description}</p>
        )}
      </div>
      <button
        onClick={() => onDelete(award)}
        disabled={deleting === award.id}
        className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
        title="삭제"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// ── 사용자 검색 픽커 (혁신활동·인라인 폼과 동일 패턴) ─────
function UserPicker({
  label, users, value, onChange, loading, compact,
}: {
  label: string;
  users: User[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return users.slice(0, 8);
    const k = search.toLowerCase();
    return users
      .filter(u => u.name?.toLowerCase().includes(k) || u.email?.toLowerCase().includes(k))
      .slice(0, 12);
  }, [users, search]);
  const selected = users.find(u => u.id === value);
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-1.5'}>
      {label && <Label>{label}</Label>}
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
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={loading ? '사용자 불러오는 중…' : '이름·이메일로 검색 (1명일 때 Enter 로 자동 선택)'}
            disabled={loading}
            onKeyDown={e => {
              if (e.key === 'Enter' && search.trim() && filtered.length === 1) {
                e.preventDefault();
                onChange(filtered[0].id);
                setSearch('');
              }
            }}
          />
          {search.trim() && (
            <div className="rounded-lg border max-h-44 overflow-y-auto divide-y bg-white">
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
