'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWeeklyTask,
  upsertWeeklyTask,
  addLeadComment,
  getWeeklyTasksByUsersAndWeek,
  getUsersByOrganization,
  getAllUsers,
  getOrganizations,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Pencil, ChevronDown, X, Save, CheckCircle2, Printer, Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import type {
  WeeklyTask, WeeklyTaskItem, WeeklyTaskStatus, WeeklyTaskCategory,
  LeadCommentEntry, User, Organization,
} from '@/types';

// ── 주차 유틸 ──────────────────────────────────────────────
function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7) };
}
function getWeekRange(year: number, week: number) {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Day + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function prevWeek(year: number, week: number) {
  if (week === 1) { const l = getISOWeek(new Date(year - 1, 11, 28)); return { year: year - 1, week: l.week }; }
  return { year, week: week - 1 };
}
function nextWeek(year: number, week: number) {
  const l = getISOWeek(new Date(year, 11, 28));
  if (week >= l.week) return { year: year + 1, week: 1 };
  return { year, week: week + 1 };
}

// ── 분류 설정 ──────────────────────────────────────────────
const CATEGORY_OPTIONS: { value: WeeklyTaskCategory; label: string; color: string }[] = [
  { value: 'CORE',     label: '핵심업무', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'GENERAL',  label: '일반업무', color: 'bg-gray-100 text-gray-600 border-gray-200' },
  { value: 'MEETING',  label: '회의/협업', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { value: 'TRAINING', label: '교육/개발', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'OTHER',    label: '기타',    color: 'bg-orange-100 text-orange-700 border-orange-200' },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORY_OPTIONS.map(c => [c.value, c])) as Record<WeeklyTaskCategory, typeof CATEGORY_OPTIONS[0]>;

// ── 상태 설정 ──────────────────────────────────────────────
const STATUS_OPTIONS: { value: WeeklyTaskStatus; label: string; color: string }[] = [
  { value: 'PLANNED',     label: '계획',   color: 'bg-gray-100 text-gray-500' },
  { value: 'IN_PROGRESS', label: '진행 중', color: 'bg-blue-100 text-blue-700' },
  { value: 'DONE',        label: '완료',   color: 'bg-green-100 text-green-700' },
];
const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s])) as Record<WeeklyTaskStatus, typeof STATUS_OPTIONS[0]>;

// ── 기본 빈 아이템 ─────────────────────────────────────────
const EMPTY_ITEM = (): Omit<WeeklyTaskItem, 'id'> => ({
  category: 'GENERAL',
  title: '',
  content: '',
  result: '',
  achievement: 0,
  status: 'PLANNED',
});

// ── 메인 라우터 ────────────────────────────────────────────
export default function TasksPage() {
  const { userProfile } = useAuth();
  if (!userProfile) return null;
  if (userProfile.role === 'EXECUTIVE') return <OrgTasksView allOrgs={false} />;
  if (userProfile.role === 'CEO') return <OrgTasksView allOrgs />;
  return <MemberTasksPage />;
}

// ── 팀원 / 팀장 페이지 ─────────────────────────────────────
function MemberTasksPage() {
  const [tab, setTab] = useState<'my' | 'team'>('my');
  const today = getISOWeek(new Date());
  const [year, setYear] = useState(today.year);
  const [week, setWeek] = useState(today.week);

  return (
    <div className="flex flex-col h-full">
      <Header title="주간 업무관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(['my', 'team'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-5 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}>
              {t === 'my' ? '내 주간 보고' : '팀 업무 현황'}
            </button>
          ))}
        </div>

        {tab === 'my'
          ? <WeeklyReport year={year} week={week} onWeekChange={(y, w) => { setYear(y); setWeek(w); }} />
          : <TeamWeeklyView year={year} week={week} onWeekChange={(y, w) => { setYear(y); setWeek(w); }} />
        }
      </div>
    </div>
  );
}

// ── 주차 캘린더 팝업 ───────────────────────────────────────
function WeekCalendar({ year, week, onSelect, onClose }: {
  year: number; week: number;
  onSelect: (y: number, w: number) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const todayW = getISOWeek(today);
  const [calYear, setCalYear] = useState(year);
  const [calMonth, setCalMonth] = useState(() => {
    const { start } = getWeekRange(year, week);
    return start.getMonth(); // 현재 선택된 주의 월
  });
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 감지
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  // 해당 월의 캘린더 날짜 배열 생성 (월요일 시작)
  function buildCalDays(y: number, m: number): (Date | null)[] {
    const first = new Date(y, m, 1);
    const startDay = (first.getDay() + 6) % 7; // 0=월
    const days: (Date | null)[] = Array(startDay).fill(null);
    const last = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= last; d++) days.push(new Date(y, m, d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }

  const days = buildCalDays(calYear, calMonth);
  const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DAY_NAMES   = ['월','화','수','목','금','토','일'];

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  }

  // 날짜가 선택된 주에 속하는지 확인
  function isInSelectedWeek(d: Date | null) {
    if (!d) return false;
    const w = getISOWeek(d);
    return w.year === year && w.week === week;
  }
  // 날짜가 오늘 주에 속하는지 확인
  function isInTodayWeek(d: Date | null) {
    if (!d) return false;
    const w = getISOWeek(d);
    return w.year === todayW.year && w.week === todayW.week;
  }

  // 주 단위로 rows 분할
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));

  function handleDayClick(d: Date) {
    const w = getISOWeek(d);
    onSelect(w.year, w.week);
    onClose();
  }

  return (
    <div ref={ref} className="absolute top-full left-0 mt-2 z-50 rounded-xl border bg-white shadow-xl p-4 w-72 select-none">
      {/* 월 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-gray-800">{calYear}년 {MONTH_NAMES[calMonth]}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 transition-colors">
          <ChevronRight className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map(d => (
          <div key={d} className={cn('text-center text-xs font-medium py-1',
            d === '토' ? 'text-blue-400' : d === '일' ? 'text-red-400' : 'text-gray-400'
          )}>{d}</div>
        ))}
      </div>

      {/* 주 rows */}
      <div className="space-y-0.5">
        {rows.map((row, ri) => {
          const isSelected = row.some(isInSelectedWeek);
          const isToday    = row.some(isInTodayWeek);
          const firstDay   = row.find(Boolean);
          return (
            <button
              key={ri}
              onClick={() => firstDay && handleDayClick(firstDay)}
              className={cn(
                'grid grid-cols-7 w-full rounded-lg transition-colors',
                isSelected
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : isToday
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : 'hover:bg-gray-50'
              )}
            >
              {row.map((d, di) => {
                const isT = d ? (d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) : false;
                const isOtherMonth = d ? d.getMonth() !== calMonth : false;
                return (
                  <div key={di} className={cn('text-center text-xs py-1.5',
                    !d || isOtherMonth
                      ? 'text-gray-200'
                      : isSelected
                        ? 'text-white font-medium'
                        : isT
                          ? 'text-blue-600 font-bold'
                          : di === 5
                            ? 'text-blue-500'
                            : di === 6
                              ? 'text-red-500'
                              : 'text-gray-700'
                  )}>
                    {d?.getDate() ?? ''}
                  </div>
                );
              })}
            </button>
          );
        })}
      </div>

      {/* 오늘 주 이동 */}
      <div className="mt-3 border-t pt-2.5 text-center">
        <button onClick={() => { onSelect(todayW.year, todayW.week); onClose(); }}
          className="text-xs text-blue-600 hover:underline font-medium">
          이번 주로 이동
        </button>
      </div>
    </div>
  );
}

// ── 주차 네비게이터 ────────────────────────────────────────
function WeekNav({ year, week, start, end, isCurrentWeek, saveStatus, onPrev, onNext, onToday, onSelect }: {
  year: number; week: number; start: Date; end: Date;
  isCurrentWeek: boolean; saveStatus: 'idle' | 'saving' | 'saved';
  onPrev: () => void; onNext: () => void; onToday: () => void;
  onSelect: (y: number, w: number) => void;
}) {
  const [calOpen, setCalOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex items-center rounded-xl border bg-white shadow-sm overflow-visible">
        <button onClick={onPrev} className="px-3 py-2 hover:bg-gray-50 border-r rounded-l-xl transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
        <button
          onClick={() => setCalOpen(o => !o)}
          className="px-5 py-2 text-sm font-semibold text-gray-800 min-w-[240px] text-center hover:bg-gray-50 transition-colors"
        >
          {year}년 {week}주차&nbsp;
          <span className="font-normal text-gray-500">({fmtDate(start)} ~ {fmtDate(end)})</span>
        </button>
        <button onClick={onNext} className="px-3 py-2 hover:bg-gray-50 border-l rounded-r-xl transition-colors">
          <ChevronRight className="h-4 w-4 text-gray-500" />
        </button>

        {calOpen && (
          <WeekCalendar
            year={year} week={week}
            onSelect={onSelect}
            onClose={() => setCalOpen(false)}
          />
        )}
      </div>

      {!isCurrentWeek && (
        <button onClick={onToday} className="text-xs font-medium text-blue-600 hover:underline">이번 주</button>
      )}
      <span className={cn('text-xs transition-opacity',
        saveStatus === 'idle' ? 'opacity-0' : 'opacity-100',
        saveStatus === 'saving' ? 'text-gray-400' : 'text-green-600 font-medium'
      )}>
        {saveStatus === 'saving' ? '저장 중...' : '✓ 저장됨'}
      </span>
    </div>
  );
}


// ── 내 주간 실적 보고 ──────────────────────────────────────
function WeeklyReport({ year, week, onWeekChange }: {
  year: number; week: number; onWeekChange: (y: number, w: number) => void;
}) {
  const { userProfile } = useAuth();
  const [items, setItems] = useState<WeeklyTaskItem[]>([]);
  const [summary, setSummary] = useState('');
  const [leadComments, setLeadComments] = useState<LeadCommentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [summarySaving, setSummarySaving] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const [addingStatus, setAddingStatus] = useState<'IN_PROGRESS' | 'DONE' | null>(null);
  const [addDraft, setAddDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; content: string }>({ title: '', content: '' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = getISOWeek(new Date());
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;

  useEffect(() => {
    if (!userProfile) return;
    setLoading(true);
    setAddingStatus(null);
    setEditingId(null);
    (async () => {
      const wt = await getWeeklyTask(userProfile.id, year, week);
      if (wt?.items?.length) {
        setItems(wt.items);
        setSummary(wt.summary ?? '');
        setLeadComments(wt.leadComments ?? []);
      } else {
        // Auto-carry-forward: load previous week's IN_PROGRESS items
        const prev = prevWeek(year, week);
        const prevWt = await getWeeklyTask(userProfile.id, prev.year, prev.week);
        const carried = (prevWt?.items ?? []).filter(i => i.status === 'IN_PROGRESS');
        if (carried.length > 0) {
          const { start: s, end: e } = getWeekRange(year, week);
          await upsertWeeklyTask(userProfile.id, year, week, userProfile.organizationId, s, e, carried, wt?.summary ?? '').catch(() => {});
        }
        setItems(carried);
        setSummary(wt?.summary ?? '');
        setLeadComments(wt?.leadComments ?? []);
      }
      setLoading(false);
    })();
  }, [userProfile, year, week]);

  const scheduleSave = useCallback((newItems: WeeklyTaskItem[], newSummary: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveStatus('saving');
    timerRef.current = setTimeout(async () => {
      if (!userProfile) return;
      try {
        await upsertWeeklyTask(userProfile.id, year, week, userProfile.organizationId, start, end, newItems, newSummary);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } catch { setSaveStatus('idle'); }
    }, 700);
  }, [userProfile, year, week, start, end]);

  function addItem() {
    if (!addDraft.trim() || !addingStatus) return;
    const newItem: WeeklyTaskItem = {
      id: crypto.randomUUID(),
      category: 'GENERAL',
      title: addDraft.trim(),
      content: '',
      result: '',
      achievement: addingStatus === 'DONE' ? 100 : 0,
      status: addingStatus,
    };
    const newItems = [...items, newItem];
    setItems(newItems);
    setAddDraft('');
    setAddingStatus(null);
    scheduleSave(newItems, summary);
  }

  function startEdit(item: WeeklyTaskItem) {
    setEditingId(item.id);
    setEditDraft({ title: item.title, content: item.content });
    setAddingStatus(null);
  }

  function saveEdit() {
    if (!editDraft.title.trim() || !editingId) return;
    const newItems = items.map(i =>
      i.id === editingId ? { ...i, title: editDraft.title.trim(), content: editDraft.content } : i
    );
    setItems(newItems);
    setEditingId(null);
    scheduleSave(newItems, summary);
  }

  function moveItem(id: string, toStatus: 'IN_PROGRESS' | 'DONE') {
    const newItems = items.map(i =>
      i.id === id ? { ...i, status: toStatus, achievement: toStatus === 'DONE' ? 100 : 0 } : i
    );
    setItems(newItems);
    scheduleSave(newItems, summary);
  }

  function deleteItem(id: string) {
    const newItems = items.filter(i => i.id !== id);
    setItems(newItems);
    scheduleSave(newItems, summary);
  }

  function handleSummaryChange(v: string) {
    setSummary(v);
    setSummarySaved(false);
  }

  async function handleSummarySave() {
    if (!userProfile) return;
    setSummarySaving(true);
    try {
      await upsertWeeklyTask(userProfile.id, year, week, userProfile.organizationId, start, end, items, summary);
      setSummarySaved(true);
      setTimeout(() => setSummarySaved(false), 2500);
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setSummarySaving(false);
    }
  }

  const inProgressItems = items.filter(i => i.status !== 'DONE');
  const doneItems = items.filter(i => i.status === 'DONE');

  function handlePrint() {
    window.print();
  }

  async function handleExcelDownload() {
    const { utils, writeFile } = await import('xlsx');
    const rows: (string | number)[][] = [
      [`${year}년 ${week}주차 주간 업무 보고`],
      [`작성자: ${userProfile?.name ?? ''} ${userProfile?.position ? `(${userProfile.position})` : ''}`],
      [`기간: ${fmtDate(start)} ~ ${fmtDate(end)}`],
      [],
      ['구분', '업무 내용', '상세 내용'],
    ];
    inProgressItems.forEach(item => {
      rows.push(['진행 업무', item.title, item.content ?? '']);
    });
    doneItems.forEach(item => {
      rows.push(['완료 업무', item.title, item.content ?? '']);
    });
    if (summary) {
      rows.push([]);
      rows.push(['종합 의견', summary, '']);
    }
    const ws = utils.aoa_to_sheet(rows);
    // 열 너비 설정
    ws['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 40 }];
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, '주간업무보고');
    writeFile(wb, `주간업무보고_${year}년_${week}주차_${userProfile?.name ?? ''}.xlsx`);
  }

  function renderSection(
    sectionItems: WeeklyTaskItem[],
    sectionStatus: 'IN_PROGRESS' | 'DONE',
    label: string,
    badgeColor: string,
  ) {
    const isAddingThisSection = addingStatus === sectionStatus;
    return (
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b bg-gray-50">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          {sectionItems.length > 0 && (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', badgeColor)}>
              {sectionItems.length}
            </span>
          )}
        </div>

        {sectionItems.length === 0 && !isAddingThisSection && (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-300">
              {sectionStatus === 'IN_PROGRESS' ? '진행 중인 업무가 없습니다.' : '완료된 업무가 없습니다.'}
            </p>
          </div>
        )}

        {sectionItems.length > 0 && (
          <div className="divide-y">
            {sectionItems.map(item => {
              const isEditing = editingId === item.id;
              return (
                <div key={item.id} className="px-5 py-3 group hover:bg-gray-50 transition-colors">
                  {!isEditing ? (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium text-gray-800', sectionStatus === 'DONE' && 'line-through text-gray-400')}>
                          {item.title}
                        </p>
                        {item.content && (
                          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed whitespace-pre-wrap">{item.content}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {sectionStatus === 'IN_PROGRESS' ? (
                          <button
                            onClick={() => moveItem(item.id, 'DONE')}
                            className="rounded px-2 py-0.5 text-xs text-green-600 hover:bg-green-50 border border-green-200 font-medium transition-colors"
                          >
                            완료
                          </button>
                        ) : (
                          <button
                            onClick={() => moveItem(item.id, 'IN_PROGRESS')}
                            className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 border border-blue-200 font-medium transition-colors"
                          >
                            진행
                          </button>
                        )}
                        <button onClick={() => startEdit(item)}
                          className="rounded p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteItem(item.id)}
                          className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        autoFocus
                        value={editDraft.title}
                        onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                        placeholder="업무 내용"
                        className="w-full rounded-lg border border-blue-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <textarea
                        rows={2}
                        value={editDraft.content}
                        onChange={e => setEditDraft(d => ({ ...d, content: e.target.value }))}
                        placeholder="상세 내용 (선택)"
                        className="w-full resize-none rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-300"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>취소</Button>
                        <Button size="sm" onClick={saveEdit} disabled={!editDraft.title.trim()}>저장</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {isAddingThisSection && (
          <div className={cn('px-5 py-3 space-y-2 bg-blue-50/30', sectionItems.length > 0 && 'border-t')}>
            <input
              type="text"
              autoFocus
              value={addDraft}
              onChange={e => setAddDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) addItem(); if (e.key === 'Escape') setAddingStatus(null); }}
              placeholder={`${label} 내용을 입력하세요`}
              className="w-full rounded-lg border border-blue-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAddingStatus(null)}>취소</Button>
              <Button size="sm" onClick={addItem} disabled={!addDraft.trim()}>추가</Button>
            </div>
          </div>
        )}

        {!isAddingThisSection && (
          <div className={cn('px-5 py-2.5', sectionItems.length > 0 && 'border-t')}>
            <button
              onClick={() => { setAddingStatus(sectionStatus); setAddDraft(''); setEditingId(null); }}
              className={cn('flex items-center gap-1.5 text-sm font-medium transition-colors',
                sectionStatus === 'IN_PROGRESS' ? 'text-blue-600 hover:text-blue-700' : 'text-green-600 hover:text-green-700'
              )}
            >
              <Plus className="h-4 w-4" />
              {label} 추가
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <WeekNav year={year} week={week} start={start} end={end}
        isCurrentWeek={isCurrentWeek} saveStatus={saveStatus}
        onPrev={() => { const p = prevWeek(year, week); onWeekChange(p.year, p.week); }}
        onNext={() => { const n = nextWeek(year, week); onWeekChange(n.year, n.week); }}
        onToday={() => onWeekChange(today.year, today.week)}
        onSelect={(y, w) => onWeekChange(y, w)}
      />

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : (
        <>
          {/* 보고서 헤더 카드 */}
          <div className="rounded-xl border bg-white px-6 py-4 print-report">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {year}년 {week}주차 주간 업무 보고
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {userProfile?.name} · {userProfile?.position ?? ''} · {fmtDate(start)} ~ {fmtDate(end)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {items.length > 0 && (
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <p className="text-xs text-gray-400">진행 중</p>
                      <p className="font-bold text-blue-600">{inProgressItems.length}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-400">완료</p>
                      <p className="font-bold text-green-600">{doneItems.length}</p>
                    </div>
                  </div>
                )}
                <div className="flex gap-1.5 no-print">
                  <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 text-gray-600">
                    <Printer className="h-3.5 w-3.5" /> 인쇄
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExcelDownload} className="gap-1.5 text-green-700 border-green-300 hover:bg-green-50">
                    <Download className="h-3.5 w-3.5" /> Excel
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {renderSection(inProgressItems, 'IN_PROGRESS', '진행 업무', 'bg-blue-100 text-blue-700')}
          {renderSection(doneItems, 'DONE', '완료 업무', 'bg-green-100 text-green-700')}

          {/* 종합 의견 */}
          <div className="rounded-xl border bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-800">이번 주 종합 의견</h4>
              {summarySaved && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 저장됨
                </span>
              )}
            </div>
            <textarea
              rows={4}
              value={summary}
              onChange={e => handleSummaryChange(e.target.value)}
              placeholder="이번 주 업무 전반에 대한 종합 의견, 이슈, 다음 주 계획 등을 자유롭게 작성하세요."
              className="w-full resize-none rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300 leading-relaxed"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSummarySave} disabled={summarySaving} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                {summarySaving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>

          {leadComments.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Comment</p>
              <div className="space-y-3">
                {leadComments.map(c => (
                  <div key={c.id} className="rounded-lg bg-white border border-blue-100 px-4 py-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="font-medium text-blue-700">{c.authorName}</span>
                      <span>·</span>
                      <span>{c.createdAt.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 팀 업무 현황 (팀장 검토 뷰) ───────────────────────────
function TeamWeeklyView({ year, week, onWeekChange }: {
  year: number; week: number; onWeekChange: (y: number, w: number) => void;
}) {
  const { userProfile } = useAuth();
  const me = userProfile;  // Comment 작성자 정보
  const [members, setMembers] = useState<User[]>([]);
  const [tasksByUser, setTasksByUser] = useState<Record<string, WeeklyTask>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [savingComment, setSavingComment] = useState<string | null>(null);
  const today = getISOWeek(new Date());
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;

  useEffect(() => {
    if (!userProfile) return;
    setLoading(true);
    getUsersByOrganization(userProfile.organizationId).then(async users => {
      setMembers(users);
      const tasks = await getWeeklyTasksByUsersAndWeek(users.map(u => u.id), year, week);
      const map: Record<string, WeeklyTask> = {};
      tasks.forEach(t => { map[t.userId] = t; });
      setTasksByUser(map);
      setCommentDraft({});  // 초기에는 모두 빈 입력란
      const init: Record<string, boolean> = {};
      users.forEach(u => { init[u.id] = true; });
      setExpanded(init);
      setLoading(false);
    });
  }, [userProfile, year, week]);

  async function handleSaveComment(userId: string) {
    const wt = tasksByUser[userId];
    const text = (commentDraft[userId] ?? '').trim();
    if (!wt || !text || !me) return;
    setSavingComment(userId);
    try {
      const newEntry = await addLeadComment(userId, year, week, me.id, me.name, text);
      // 로컬 스레드에 즉시 추가 + 입력란 초기화
      setTasksByUser(p => ({
        ...p,
        [userId]: {
          ...p[userId],
          leadComments: [...(p[userId].leadComments ?? []), newEntry],
        },
      }));
      setCommentDraft(p => ({ ...p, [userId]: '' }));
    } finally {
      setSavingComment(null);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <WeekNav year={year} week={week} start={start} end={end}
        isCurrentWeek={isCurrentWeek} saveStatus="idle"
        onPrev={() => { const p = prevWeek(year, week); onWeekChange(p.year, p.week); }}
        onNext={() => { const n = nextWeek(year, week); onWeekChange(n.year, n.week); }}
        onToday={() => onWeekChange(today.year, today.week)}
        onSelect={(y, w) => onWeekChange(y, w)}
      />

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-gray-400">같은 조직의 팀원이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {members.map(member => {
            const wt = tasksByUser[member.id];
            const items = wt?.items ?? [];
            const doneCount = items.filter(i => i.status === 'DONE').length;
            const isOpen = expanded[member.id] ?? true;

            return (
              <div key={member.id} className="rounded-xl border bg-white overflow-hidden shadow-sm">
                {/* 멤버 헤더 */}
                <button
                  onClick={() => setExpanded(p => ({ ...p, [member.id]: !isOpen }))}
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600">
                    {member.name[0]}
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm font-semibold text-gray-900">{member.name}</span>
                    {member.position && <span className="ml-2 text-xs text-gray-400">{member.position}</span>}
                  </div>
                  {items.length > 0 ? (
                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-gray-500">업무 {items.length}건</span>
                      <span className="text-green-600 font-medium">완료 {doneCount}/{items.length}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300 shrink-0">보고서 없음</span>
                  )}
                  <ChevronDown className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform', !isOpen && '-rotate-90')} />
                </button>

                {/* 상세 내용 */}
                {isOpen && (
                  <div className="border-t">
                    {items.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-gray-400 text-center">이번 주 보고서가 없습니다.</p>
                    ) : (
                      <div className="divide-y">
                        {items.filter(i => i.status !== 'DONE').length > 0 && (
                          <div className="px-4 py-3">
                            <p className="text-xs font-semibold text-blue-600 mb-2">진행 업무</p>
                            <div className="space-y-1.5">
                              {items.filter(i => i.status !== 'DONE').map(item => (
                                <div key={item.id}>
                                  <p className="text-sm text-gray-800">{item.title}</p>
                                  {item.content && <p className="text-xs text-gray-400 mt-0.5">{item.content}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {items.filter(i => i.status === 'DONE').length > 0 && (
                          <div className="px-4 py-3">
                            <p className="text-xs font-semibold text-green-600 mb-2">완료 업무</p>
                            <div className="space-y-1.5">
                              {items.filter(i => i.status === 'DONE').map(item => (
                                <div key={item.id}>
                                  <p className="text-sm text-gray-500 line-through">{item.title}</p>
                                  {item.content && <p className="text-xs text-gray-400 mt-0.5">{item.content}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 종합 의견 — 업무 유무 관계없이 항상 Comment 위에 표시 */}
                    {wt?.summary && (
                      <div className="mx-4 my-3 rounded-lg bg-gray-50 px-4 py-3">
                        <p className="text-xs font-semibold text-gray-500 mb-1">종합 의견</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{wt.summary}</p>
                      </div>
                    )}

                    {/* Comment 섹션 */}
                    <div className="border-t bg-blue-50/40 px-4 py-3 space-y-3">
                      <p className="text-xs font-semibold text-blue-700">Comment</p>

                      {/* 기존 Comment 스레드 */}
                      {(wt?.leadComments ?? []).length > 0 && (
                        <div className="space-y-2">
                          {(wt!.leadComments).map(c => (
                            <div key={c.id} className="rounded-lg bg-white border border-blue-100 px-3 py-2.5 space-y-1">
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <span className="font-medium text-blue-700">{c.authorName}</span>
                                <span>·</span>
                                <span>{c.createdAt.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.text}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 새 Comment 입력 — 보고서 없으면 비활성화 */}
                      {!wt ? (
                        <p className="text-xs text-gray-300 italic">이번 주 보고서가 없어 Comment를 작성할 수 없습니다.</p>
                      ) : (
                        <div className="space-y-2">
                          <textarea
                            rows={2}
                            value={commentDraft[member.id] ?? ''}
                            onChange={e => setCommentDraft(p => ({ ...p, [member.id]: e.target.value }))}
                            placeholder="이번 주 업무에 대한 Comment를 남겨주세요."
                            className="w-full resize-none rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-300"
                          />
                          <div className="flex justify-end">
                            <Button size="sm" variant="outline"
                              onClick={() => handleSaveComment(member.id)}
                              disabled={savingComment === member.id || !(commentDraft[member.id] ?? '').trim()}
                              className="h-7 text-xs">
                              {savingComment === member.id ? '저장 중...' : '저장'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 임원 / CEO 조직 업무 현황 ──────────────────────────────
function OrgTasksView({ allOrgs: isAllOrgs }: { allOrgs: boolean }) {
  const { userProfile } = useAuth();
  const today = getISOWeek(new Date());
  const [year, setYear] = useState(today.year);
  const [week, setWeek] = useState(today.week);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasksByUser, setTasksByUser] = useState<Record<string, WeeklyTask>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;

  useEffect(() => {
    if (!userProfile) return;
    setLoading(true);
    async function load() {
      const [allUsersList, allOrgsList] = await Promise.all([getAllUsers(), getOrganizations()]);
      const scopeOrgIds: string[] = isAllOrgs
        ? allOrgsList.map(o => o.id)
        : (() => {
            const byOrg = userProfile!.organizationId ? findDescendantIds(userProfile!.organizationId, allOrgsList) : [];
            const byLead = allOrgsList.filter(o => o.leaderId === userProfile!.id).flatMap(o => findDescendantIds(o.id, allOrgsList));
            return [...new Set([...byOrg, ...byLead])];
          })();
      const scopeUsers = allUsersList.filter(u => scopeOrgIds.includes(u.organizationId));
      const scopeOrgs  = allOrgsList.filter(o => scopeOrgIds.includes(o.id));
      setOrgs(scopeOrgs);
      setUsers(scopeUsers);
      const tasks = await getWeeklyTasksByUsersAndWeek(scopeUsers.map(u => u.id), year, week);
      const map: Record<string, WeeklyTask> = {};
      tasks.forEach(t => { map[t.userId] = t; });
      setTasksByUser(map);
      const init: Record<string, boolean> = {};
      scopeOrgs.forEach(o => { init[o.id] = true; });
      scopeUsers.forEach(u => { init[`u_${u.id}`] = false; }); // 멤버 기본 닫힘
      setExpanded(init);
      setLoading(false);
    }
    load().catch(console.error);
  }, [userProfile, year, week, isAllOrgs]);

  const scopeOrgIdSet = new Set(orgs.map(o => o.id));
  const rootOrgs = orgs.filter(o => o.parentId === null || !scopeOrgIdSet.has(o.parentId!));

  function renderOrg(org: Organization, depth = 0): React.ReactNode {
    const orgUsers = users.filter(u => u.organizationId === org.id);
    const childOrgs = orgs.filter(o => o.parentId === org.id);
    const allItems = orgUsers.flatMap(u => tasksByUser[u.id]?.items ?? []);
    const doneCount = allItems.filter(i => i.status === 'DONE').length;
    const isOpen = expanded[org.id] ?? true;

    return (
      <div key={org.id} className={cn(depth > 0 && 'ml-5 border-l border-gray-100 pl-3 mt-1')}>
        <button
          onClick={() => setExpanded(p => ({ ...p, [org.id]: !isOpen }))}
          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors text-left"
        >
          <ChevronDown className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform', !isOpen && '-rotate-90')} />
          <span className="font-semibold text-gray-800 flex-1 text-sm">{org.name}</span>
          <span className="text-xs text-gray-400 shrink-0">{orgUsers.length}명</span>
          {allItems.length > 0 && (
            <span className="text-xs text-gray-500 shrink-0">{doneCount}/{allItems.length} 완료</span>
          )}
        </button>

        {isOpen && (
          <div className="ml-2 mt-0.5 mb-1 space-y-0.5">
            {orgUsers.map(member => {
              const items = tasksByUser[member.id]?.items ?? [];
              const isUserOpen = expanded[`u_${member.id}`] ?? false;

              return (
                <div key={member.id} className="rounded-lg border bg-white overflow-hidden ml-1 mb-1">
                  <button
                    onClick={() => setExpanded(p => ({ ...p, [`u_${member.id}`]: !isUserOpen }))}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-gray-50"
                  >
                    <div className="h-6 w-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0">
                      {member.name[0]}
                    </div>
                    <span className="flex-1 text-left text-sm text-gray-800">
                      {member.name}
                      {member.position && <span className="ml-1 text-xs text-gray-400">{member.position}</span>}
                    </span>
                    {items.length === 0 ? (
                      <span className="text-xs text-gray-300">보고서 없음</span>
                    ) : (
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        <span className="text-gray-500">{items.length}건</span>
                        <span className="text-green-600 font-medium">{items.filter(i => i.status === 'DONE').length}/{items.length} 완료</span>
                      </div>
                    )}
                    <ChevronDown className={cn('h-3.5 w-3.5 text-gray-300 shrink-0 transition-transform', !isUserOpen && '-rotate-90')} />
                  </button>

                  {isUserOpen && items.length > 0 && (
                    <div className="border-t divide-y">
                      {items.filter(i => i.status !== 'DONE').length > 0 && (
                        <div className="px-3 py-2.5">
                          <p className="text-xs font-semibold text-blue-600 mb-1.5">진행 업무</p>
                          <div className="space-y-1">
                            {items.filter(i => i.status !== 'DONE').map(item => (
                              <div key={item.id}>
                                <p className="text-xs text-gray-800">{item.title}</p>
                                {item.content && <p className="text-xs text-gray-400">{item.content}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {items.filter(i => i.status === 'DONE').length > 0 && (
                        <div className="px-3 py-2.5">
                          <p className="text-xs font-semibold text-green-600 mb-1.5">완료 업무</p>
                          <div className="space-y-1">
                            {items.filter(i => i.status === 'DONE').map(item => (
                              <div key={item.id}>
                                <p className="text-xs text-gray-500 line-through">{item.title}</p>
                                {item.content && <p className="text-xs text-gray-400">{item.content}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {childOrgs.map(child => renderOrg(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="주간 업무관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <WeekNav year={year} week={week} start={start} end={end}
          isCurrentWeek={isCurrentWeek} saveStatus="idle"
          onPrev={() => { const p = prevWeek(year, week); setYear(p.year); setWeek(p.week); }}
          onNext={() => { const n = nextWeek(year, week); setYear(n.year); setWeek(n.week); }}
          onToday={() => { setYear(today.year); setWeek(today.week); }}
          onSelect={(y, w) => { setYear(y); setWeek(w); }}
        />

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">
            {isAllOrgs ? '전체 조직' : '담당 조직'} 주간 업무 현황
          </h4>
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}</div>
          ) : (
            <div className="rounded-xl border bg-white p-3 space-y-1">
              {rootOrgs.length === 0
                ? <p className="text-center text-sm text-gray-400 py-8">표시할 조직이 없습니다.</p>
                : rootOrgs.map(org => renderOrg(org))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
