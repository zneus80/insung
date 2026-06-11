'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  getAllUsers,
  listInnovationActivities,
  listInnovationActivitiesByYearRange,
  listInnovationActivitiesByUser,
  createInnovationActivity,
  updateInnovationActivity,
  deleteInnovationActivity,
} from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AuthGuard from '@/components/layout/AuthGuard';
import { Plus, Trash2, Pencil, X, ChevronDown, ChevronRight, Search, User as UserIcon, Calendar, Download, Upload, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import { resolveUserNames, resolveUserByName, parseBoolCell } from '@/lib/excel-helpers';
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

const CATEGORY_SPAN = 10;

function InnovationContent() {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const [tab, setTab] = useState<InnovationActivityType>('SMART_PROJECT');
  const [users, setUsers] = useState<User[]>([]);
  const [items, setItems] = useState<InnovationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<InnovationActivity | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openYears, setOpenYears] = useState<Set<number>>(new Set([activeYear]));

  // ── 인라인 추가 폼 상태 ──
  const [formYear, setFormYear] = useState(activeYear);
  const [formName, setFormName] = useState('');
  const [formStatus, setFormStatus] = useState<InnovationActivityStatus>('IN_PROGRESS');
  const [formConfidential, setFormConfidential] = useState(false);
  const [formPmIds, setFormPmIds] = useState<string[]>([]);
  const [formMemberIds, setFormMemberIds] = useState<string[]>([]);
  const [formPerformerIds, setFormPerformerIds] = useState<string[]>([]);
  const [formInstructorId, setFormInstructorId] = useState('');
  const [saving, setSaving] = useState(false);

  // ── 검색 ──
  const [searchMode, setSearchMode] = useState<'NAME' | 'YEAR'>('NAME');
  const [searchUserId, setSearchUserId] = useState('');
  const [searchYear, setSearchYear] = useState<number | ''>('');
  const [searchResults, setSearchResults] = useState<InnovationActivity[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // ── 엑셀 업로드 ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: number; failed: { row: number; reason: string }[] } | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const startYear = activeYear - CATEGORY_SPAN + 1;
      const [u, list] = await Promise.all([
        getAllUsers(),
        listInnovationActivitiesByYearRange(startYear, activeYear),
      ]);
      setUsers(u.filter(x => x.isActive !== false));
      setItems(list);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeYear]);
  useEffect(() => { setOpenYears(new Set([activeYear])); setFormYear(activeYear); }, [activeYear]);

  const filteredByTab = useMemo(() => items.filter(i => i.type === tab), [items, tab]);
  const itemsByYear = useMemo(() => {
    const m = new Map<number, InnovationActivity[]>();
    for (let y = activeYear; y > activeYear - CATEGORY_SPAN; y--) m.set(y, []);
    filteredByTab.forEach(a => { if (m.has(a.year)) m.get(a.year)!.push(a); });
    return m;
  }, [filteredByTab, activeYear]);
  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  function resetForm() {
    setFormYear(activeYear);
    setFormName('');
    setFormStatus('IN_PROGRESS');
    setFormConfidential(false);
    setFormPmIds([]);
    setFormMemberIds([]);
    setFormPerformerIds([]);
    setFormInstructorId('');
  }

  async function handleAdd() {
    if (!userProfile) return;
    if (!formName.trim()) { toast.error('이름을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = {
        type: tab,
        name: formName.trim(),
        isConfidential: formConfidential,
        status: formStatus,
        year: formYear,
        pmIds: tab === 'SMART_PROJECT' ? formPmIds : undefined,
        memberIds: tab === 'SMART_PROJECT' ? formMemberIds : undefined,
        performerIds: tab === 'TDS' ? formPerformerIds : undefined,
        instructorId: tab === 'TDS' ? (formInstructorId || undefined) : undefined,
        createdBy: userProfile.id,
      };
      const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)) as typeof payload;
      await createInnovationActivity(clean as Parameters<typeof createInnovationActivity>[0]);
      toast.success('추가되었습니다.');
      resetForm();
      await reload();
    } catch (e: any) {
      console.error(e);
      toast.error(`저장 실패: ${e?.message ?? '오류'}`);
    } finally {
      setSaving(false);
    }
  }

  function openEdit(item: InnovationActivity) { setEditTarget(item); setEditDialogOpen(true); }
  function toggleYear(y: number) {
    setOpenYears(prev => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  }

  async function handleDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    setDeleting(id);
    try {
      await deleteInnovationActivity(id);
      toast.success('삭제되었습니다.');
      setSearchResults(prev => prev.filter(a => a.id !== id));
      await reload();
    } catch {
      toast.error('삭제 실패');
    } finally {
      setDeleting(null);
    }
  }

  // ── 검색 핸들러 ──
  async function handleSearch() {
    setSearching(true);
    setSearchPerformed(true);
    try {
      if (searchMode === 'NAME') {
        if (!searchUserId) { toast.error('사용자를 선택하세요.'); return; }
        const list = await listInnovationActivitiesByUser(searchUserId);
        setSearchResults(list.filter(a => a.type === tab));
      } else {
        if (!searchYear) { toast.error('연도를 입력하세요.'); return; }
        const list = await listInnovationActivities(Number(searchYear));
        setSearchResults(list.filter(a => a.type === tab));
      }
    } catch (e: any) {
      toast.error(`조회 실패: ${e?.message ?? '오류'}`);
    } finally {
      setSearching(false);
    }
  }

  // ── 엑셀: 양식 다운로드 / 업로드 / 데이터 다운로드 (현재 탭 기준) ──
  const typeLabel = tab === 'SMART_PROJECT' ? '스마트프로젝트' : 'TDS';
  const nameCol = tab === 'SMART_PROJECT' ? '프로젝트명*' : 'TDS명*';
  const peopleCol1 = tab === 'SMART_PROJECT' ? 'PM(이름;세미콜론구분)' : '수행자(이름;세미콜론구분)';
  const peopleCol2 = tab === 'SMART_PROJECT' ? '팀원(이름;세미콜론구분)' : '지시자(이름)';

  function parseStatus(raw: string): InnovationActivityStatus | null {
    const s = String(raw ?? '').trim();
    if (['추진중', '진행중', 'IN_PROGRESS'].includes(s)) return 'IN_PROGRESS';
    if (['완료', 'COMPLETED'].includes(s)) return 'COMPLETED';
    return null;
  }

  function downloadTemplate() {
    const headers = ['수행년도*', '진행상태*(추진중/완료)', nameCol, '대내외비(Y/N)', peopleCol1, peopleCol2];
    const example = tab === 'SMART_PROJECT'
      ? [String(activeYear), '추진중', '예시 프로젝트', 'N', users[0]?.name ?? '홍길동', `${users[1]?.name ?? '김팀원'};${users[2]?.name ?? '이팀원'}`]
      : [String(activeYear), '완료', '예시 TDS', 'N', `${users[0]?.name ?? '홍길동'};${users[1]?.name ?? '김수행'}`, users[2]?.name ?? '박지시'];
    const ws = XLSX.utils.aoa_to_sheet([
      headers,
      ['-- 아래에 데이터를 입력하세요 (이름은 정확히, 여러 명은 ; 로 구분) --', '', '', '', '', ''],
      example,
    ]);
    ws['!cols'] = [{ wch: 10 }, { wch: 18 }, { wch: 26 }, { wch: 10 }, { wch: 26 }, { wch: 26 }];
    const ws2 = XLSX.utils.aoa_to_sheet([['등록 가능 사용자 이름'], ...users.map(u => [`${u.name}${u.position ? ` (${u.position})` : ''}`])]);
    ws2['!cols'] = [{ wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, typeLabel);
    XLSX.utils.book_append_sheet(wb, ws2, '사용자목록');
    XLSX.writeFile(wb, `INSUNG_${typeLabel}_등록양식.xlsx`);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userProfile) return;
    e.target.value = '';
    setUploading(true);
    setUploadResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][];
      const dataRows = rows.slice(2).filter(r => r[0]?.toString().trim() && !r[0].toString().startsWith('--'));
      let success = 0;
      const failed: { row: number; reason: string }[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNum = i + 3;
        const year = Number(row[0]?.toString().trim());
        const status = parseStatus(row[1]?.toString() ?? '');
        const name = row[2]?.toString().trim();
        const confidential = parseBoolCell(row[3]);

        if (!Number.isFinite(year) || year < 2000 || year > 2100) { failed.push({ row: rowNum, reason: '수행년도가 올바르지 않습니다.' }); continue; }
        if (!status) { failed.push({ row: rowNum, reason: `진행상태값 "${row[1]}"이 올바르지 않습니다. (추진중/완료)` }); continue; }
        if (!name) { failed.push({ row: rowNum, reason: '이름이 비어있습니다.' }); continue; }

        let pmIds: string[] | undefined, memberIds: string[] | undefined, performerIds: string[] | undefined, instructorId: string | undefined;
        if (tab === 'SMART_PROJECT') {
          const pm = resolveUserNames(row[4]?.toString() ?? '', users);
          const mem = resolveUserNames(row[5]?.toString() ?? '', users);
          const errs = [...pm.errors, ...mem.errors];
          if (errs.length) { failed.push({ row: rowNum, reason: errs.join(' / ') }); continue; }
          pmIds = pm.ids; memberIds = mem.ids;
        } else {
          const perf = resolveUserNames(row[4]?.toString() ?? '', users);
          const errs = [...perf.errors];
          const instRaw = row[5]?.toString().trim();
          if (instRaw) {
            const inst = resolveUserByName(instRaw, users);
            if ('error' in inst) errs.push(inst.error); else instructorId = inst.id;
          }
          if (errs.length) { failed.push({ row: rowNum, reason: errs.join(' / ') }); continue; }
          performerIds = perf.ids;
        }

        try {
          const payload = {
            type: tab, name, isConfidential: confidential, status, year,
            pmIds, memberIds, performerIds, instructorId,
            createdBy: userProfile.id,
          };
          const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)) as typeof payload;
          await createInnovationActivity(clean as Parameters<typeof createInnovationActivity>[0]);
          success++;
        } catch (err: any) {
          failed.push({ row: rowNum, reason: err?.message ?? '처리 실패' });
        }
      }
      setUploadResult({ success, failed });
      if (success > 0) { toast.success(`${success}건 등록 완료`); await reload(); }
      if (failed.length > 0) toast.error(`${failed.length}건 실패`);
    } catch {
      toast.error('파일을 읽는 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  function downloadData() {
    const rows = filteredByTab.map(it => {
      const base: Record<string, string> = {
        '수행년도': String(it.year),
        '진행상태': STATUS_LABEL[it.status],
        [tab === 'SMART_PROJECT' ? '프로젝트명' : 'TDS명']: it.name,
        '대내외비': it.isConfidential ? 'Y' : 'N',
      };
      if (tab === 'SMART_PROJECT') {
        base['PM'] = getPmIds(it).map(id => usersById.get(id)?.name).filter(Boolean).join('; ');
        base['팀원'] = (it.memberIds ?? []).map(id => usersById.get(id)?.name).filter(Boolean).join('; ');
      } else {
        base['수행자'] = getPerformerIds(it).map(id => usersById.get(id)?.name).filter(Boolean).join('; ');
        base['지시자'] = usersById.get(it.instructorId ?? '')?.name ?? '';
      }
      return base;
    });
    if (rows.length === 0) { toast.info('내보낼 데이터가 없습니다.'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), typeLabel);
    XLSX.writeFile(wb, `INSUNG_${typeLabel}_데이터_${activeYear}.xlsx`);
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="혁신활동 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl">
        {/* 타입 탭 */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(['SMART_PROJECT', 'TDS'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearchResults([]); setSearchPerformed(false); }}
              className={cn(
                'px-5 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {t === 'SMART_PROJECT' ? '스마트 프로젝트' : 'TDS'}
            </button>
          ))}
        </div>

        {/* ── 엑셀 일괄 등록 ──── */}
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">엑셀로 일괄 등록 — {typeLabel}</span>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
                <Download className="h-4 w-4" /> 양식 다운로드
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> {uploading ? '업로드 중...' : '엑셀 업로드'}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadData}>
                <Download className="h-4 w-4" /> 데이터 다운로드
              </Button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            양식의 헤더·예시는 그대로 두고 3행부터 입력하세요. 사람은 <b>이름</b>으로 입력하며 여러 명은 <b>;</b>(세미콜론)으로 구분합니다. 동명이인은 화면에서 직접 등록하세요.
          </p>
          {uploadResult && (
            <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
              <p className="text-sm font-medium text-gray-900">
                업로드 결과 — 성공 <span className="text-green-600">{uploadResult.success}건</span>
                {uploadResult.failed.length > 0 && <>, 실패 <span className="text-red-500">{uploadResult.failed.length}건</span></>}
                <button onClick={() => setUploadResult(null)} className="ml-2 text-xs text-gray-400 hover:text-gray-600">닫기</button>
              </p>
              {uploadResult.failed.length > 0 && (
                <ul className="space-y-1">
                  {uploadResult.failed.map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{f.row}행: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── 인라인 추가 폼 ─── */}
        <div className="rounded-xl border bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-blue-600" />
            <h3 className="text-base font-semibold text-gray-900">
              {tab === 'SMART_PROJECT' ? '스마트 프로젝트 추가' : 'TDS 추가'}
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>수행년도 *</Label>
              <Input
                type="number"
                min={2000} max={2100}
                value={String(formYear)}
                onChange={e => setFormYear(Number(e.target.value) || activeYear)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>진행상태 *</Label>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                {(['IN_PROGRESS', 'COMPLETED'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFormStatus(s)}
                    className={cn(
                      'px-4 py-1 rounded-md text-sm font-medium transition-colors',
                      formStatus === s ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500',
                    )}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{tab === 'SMART_PROJECT' ? '프로젝트명 *' : 'TDS명 *'}</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="이름 입력" />
            </div>
            {tab === 'SMART_PROJECT' ? (
              <>
                <MultiUserPicker label="PM (복수 선택 가능)" users={users} values={formPmIds} onChange={setFormPmIds} />
                <MultiUserPicker label="팀원" users={users} values={formMemberIds} onChange={setFormMemberIds} />
              </>
            ) : (
              <>
                <MultiUserPicker label="수행자 (복수 선택 가능)" users={users} values={formPerformerIds} onChange={setFormPerformerIds} />
                <UserPicker label="지시자" users={users} value={formInstructorId} onChange={setFormInstructorId} />
              </>
            )}
            <label className="flex items-center gap-2 cursor-pointer md:col-span-2">
              <input
                type="checkbox"
                checked={formConfidential}
                onChange={e => setFormConfidential(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">대내외비 (전사 업무추진현황에서 CONFIDENTIAL 로 마스킹)</span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetForm} disabled={saving}>초기화</Button>
            <Button onClick={handleAdd} disabled={saving}>{saving ? '저장 중...' : '저장'}</Button>
          </div>
        </div>

        {/* ── 연도별 이력 조회 ── */}
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              연도별 {tab === 'SMART_PROJECT' ? '스마트 프로젝트' : 'TDS'} 이력 조회
            </h3>
            <span className="text-xs text-gray-400">
              {activeYear - CATEGORY_SPAN + 1} ~ {activeYear} ({CATEGORY_SPAN}년)
            </span>
          </div>
          {loading ? (
            <div className="p-6 space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>
          ) : (
            <div className="divide-y">
              {Array.from(itemsByYear.entries()).map(([year, list]) => {
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
                        <p className="px-12 py-4 text-sm text-gray-400">해당 연도 등록 항목이 없습니다.</p>
                      ) : (
                        <ul className="divide-y divide-gray-100 bg-gray-50/30">
                          {list.map(it => (
                            <InnovationItemRow key={it.id} it={it} usersById={usersById} onEdit={openEdit} onDelete={handleDelete} deleting={deleting} />
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

        {/* ── 검색 (이름·연도) ── */}
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
                    searchMode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {searchMode === 'NAME' ? (
              <UserPicker label="" users={users} value={searchUserId} onChange={setSearchUserId} />
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
                {searchResults.map(it => (
                  <InnovationItemRow key={it.id} it={it} usersById={usersById} onEdit={openEdit} onDelete={handleDelete} deleting={deleting} showYear />
                ))}
              </ul>
            )
          )}
        </div>
      </div>

      <InnovationDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        type={tab}
        users={users}
        editTarget={editTarget}
        year={editTarget?.year ?? activeYear}
        onSaved={() => { setEditDialogOpen(false); reload(); }}
      />
    </div>
  );
}

// ── 행 컴포넌트 ──
function InnovationItemRow({ it, usersById, onEdit, onDelete, deleting, showYear }: {
  it: InnovationActivity;
  usersById: Map<string, User>;
  onEdit: (it: InnovationActivity) => void;
  onDelete: (id: string) => void;
  deleting: string | null;
  showYear?: boolean;
}) {
  return (
    <li className="px-5 py-3 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {showYear && (
            <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-700">{it.year}년</span>
          )}
          <span className={cn(
            'text-xs font-bold rounded-full px-2 py-0.5',
            it.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700',
          )}>
            {STATUS_LABEL[it.status]}
          </span>
          {it.isConfidential && (
            <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-700">대내외비</span>
          )}
          <span className="font-medium text-gray-900">{it.name}</span>
        </div>
        <p className="text-xs text-gray-500">
          {it.type === 'SMART_PROJECT' ? (
            <>
              PM: {getPmIds(it).map(id => usersById.get(id)?.name).filter(Boolean).join(', ') || '—'}
              {' · '}팀원: {(it.memberIds ?? []).map(id => usersById.get(id)?.name).filter(Boolean).join(', ') || '—'}
            </>
          ) : (
            <>
              수행자: {getPerformerIds(it).map(id => usersById.get(id)?.name).filter(Boolean).join(', ') || '—'}
              {' · '}지시자: {usersById.get(it.instructorId ?? '')?.name ?? '—'}
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onEdit(it)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="수정">
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(it.id)}
          disabled={deleting === it.id}
          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 disabled:opacity-50"
          title="삭제"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
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
  const [pmIds, setPmIds] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [performerIds, setPerformerIds] = useState<string[]>([]);
  const [instructorId, setInstructorId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      setName(editTarget.name);
      setIsConfidential(editTarget.isConfidential);
      setStatus(editTarget.status);
      setPmIds(getPmIds(editTarget));
      setMemberIds(editTarget.memberIds ?? []);
      setPerformerIds(getPerformerIds(editTarget));
      setInstructorId(editTarget.instructorId ?? '');
    } else {
      setName('');
      setIsConfidential(false);
      setStatus('IN_PROGRESS');
      setPmIds([]);
      setMemberIds([]);
      setPerformerIds([]);
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
        pmIds: type === 'SMART_PROJECT' ? pmIds : undefined,
        // 구버전 단일 필드 정리 (수정 시 잔여 데이터 제거)
        pmId: undefined,
        memberIds: type === 'SMART_PROJECT' ? memberIds : undefined,
        performerIds: type === 'TDS' ? performerIds : undefined,
        performerId: undefined,
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
            <span className="text-sm font-medium text-gray-700">대내외비 (제목을 CONFIDENTIAL 로 노출)</span>
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
              <MultiUserPicker label="PM (복수 선택 가능)" users={users} values={pmIds} onChange={setPmIds} />
              <MultiUserPicker label="팀원" users={users} values={memberIds} onChange={setMemberIds} />
            </>
          ) : (
            <>
              <MultiUserPicker label="수행자 (복수 선택 가능)" users={users} values={performerIds} onChange={setPerformerIds} />
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
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="이름·이메일로 검색 (검색 결과 1명일 때 Enter 로 자동 선택)"
            onKeyDown={e => {
              if (e.key === 'Enter' && search.trim() && filtered.length === 1) {
                e.preventDefault();
                onChange(filtered[0].id);
                setSearch('');
              }
            }}
          />
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
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="이름·이메일로 검색해서 추가 (검색 결과 1명일 때 Enter 로 자동 추가)"
        onKeyDown={e => {
          if (e.key === 'Enter' && search.trim() && filtered.length === 1) {
            e.preventDefault();
            onChange([...values, filtered[0].id]);
            setSearch('');
          }
        }}
      />
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
