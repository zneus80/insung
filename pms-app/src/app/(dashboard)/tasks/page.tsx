'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWeeklyTask,
  upsertWeeklyTaskSections,
  addLeadComment,
  getWeeklyTasksByUsersAndWeek,
  getUsersByOrganization,
  getAllUsers,
  getOrganizations,
  createNotification,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Pencil, ChevronDown, Check, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import type {
  WeeklyTask, SimpleTaskItem, LeadCommentEntry, User, Organization,
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

// ── 빈 간단 아이템 ─────────────────────────────────────────
const EMPTY_SIMPLE = (): Omit<SimpleTaskItem, 'id'> => ({ title: '', content: '' });

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
      <Header title="주간업무보고" />
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

// ── 간단 업무 폼 ──────────────────────────────────────────
function SimpleItemForm({
  value, onChange, onSave, onCancel, isNew,
}: {
  value: Omit<SimpleTaskItem, 'id'>;
  onChange: (v: Omit<SimpleTaskItem, 'id'>) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50/30 p-4 space-y-3">
      <p className="text-xs font-semibold text-blue-700">{isNew ? '업무 추가' : '업무 수정'}</p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">업무명 <span className="text-red-400">*</span></label>
        <input
          type="text"
          value={value.title}
          onChange={e => onChange({ ...value, title: e.target.value })}
          placeholder="업무명을 입력하세요"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">업무 상세내용</label>
        <textarea
          rows={3}
          value={value.content}
          onChange={e => onChange({ ...value, content: e.target.value })}
          placeholder="업무 상세내용을 입력하세요"
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>취소</Button>
        <Button size="sm" onClick={onSave} disabled={!value.title.trim()}>
          {isNew ? '추가' : '저장'}
        </Button>
      </div>
    </div>
  );
}

// ── 내 주간 실적 보고 ──────────────────────────────────────
function WeeklyReport({ year, week, onWeekChange }: {
  year: number; week: number; onWeekChange: (y: number, w: number) => void;
}) {
  const { userProfile } = useAuth();
  const [hasDoneItems, setHasDoneItems] = useState<SimpleTaskItem[]>([]);
  const [willDoItems, setWillDoItems] = useState<SimpleTaskItem[]>([]);
  const [summary, setSummary] = useState('');
  const [leadComments, setLeadComments] = useState<LeadCommentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [summaryLocked, setSummaryLocked] = useState(false); // 저장 직후 시각적 고정 효과
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<SimpleTaskItem, 'id'>>(EMPTY_SIMPLE());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement | null>(null);
  const today = getISOWeek(new Date());
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;

  useEffect(() => {
    if (!userProfile) return;
    setLoading(true);
    setEditingKey(null);
    setSummaryLocked(false);
    (async () => {
      const wt = await getWeeklyTask(userProfile.id, year, week);
      if (wt) {
        setHasDoneItems(wt.hasDoneItems ?? []);
        setWillDoItems(wt.willDoItems ?? []);
        setSummary(wt.summary ?? '');
        setLeadComments(wt.leadComments ?? []);
        // 저장된 종합 의견이 있으면 잠금 상태로 시작
        if (wt.summary && wt.summary.trim()) setSummaryLocked(true);
      } else {
        // Auto-carry: prev week's willDoItems → this week's hasDoneItems
        const prev = prevWeek(year, week);
        const prevWt = await getWeeklyTask(userProfile.id, prev.year, prev.week);
        const carried = (prevWt?.willDoItems ?? []).map(i => ({ ...i, id: crypto.randomUUID() }));
        if (carried.length > 0) {
          setHasDoneItems(carried);
          await upsertWeeklyTaskSections(
            userProfile.id, year, week,
            userProfile.organizationId, start, end,
            carried, [], '',
          );
          toast.success(`지난 주 계획 ${carried.length}개를 이번 주 실적으로 불러왔습니다.`);
        } else {
          setHasDoneItems([]);
        }
        setWillDoItems([]);
        setSummary('');
        setLeadComments([]);
      }
      setLoading(false);
    })();
  }, [userProfile, year, week]);

  const scheduleSave = useCallback((hd: SimpleTaskItem[], wd: SimpleTaskItem[], sum: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveStatus('saving');
    timerRef.current = setTimeout(async () => {
      if (!userProfile) return;
      try {
        await upsertWeeklyTaskSections(
          userProfile.id, year, week,
          userProfile.organizationId, start, end,
          hd, wd, sum,
        );
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } catch { setSaveStatus('idle'); }
    }, 700);
  }, [userProfile, year, week, start, end]);

  function openNew(section: 'hd' | 'wd') {
    setEditDraft(EMPTY_SIMPLE());
    setEditingKey(`${section}-new`);
  }

  function openEdit(section: 'hd' | 'wd', item: SimpleTaskItem) {
    const { id, ...rest } = item;
    setEditDraft(rest);
    setEditingKey(`${section}-${id}`);
  }

  function saveItem() {
    if (!editDraft.title.trim() || !editingKey) return;
    const isHd = editingKey.startsWith('hd-');
    const idPart = editingKey.slice(3);
    if (isHd) {
      const newItems = idPart === 'new'
        ? [...hasDoneItems, { ...editDraft, id: crypto.randomUUID() }]
        : hasDoneItems.map(i => i.id === idPart ? { ...editDraft, id: i.id } : i);
      setHasDoneItems(newItems);
      setEditingKey(null);
      scheduleSave(newItems, willDoItems, summary);
    } else {
      const newItems = idPart === 'new'
        ? [...willDoItems, { ...editDraft, id: crypto.randomUUID() }]
        : willDoItems.map(i => i.id === idPart ? { ...editDraft, id: i.id } : i);
      setWillDoItems(newItems);
      setEditingKey(null);
      scheduleSave(hasDoneItems, newItems, summary);
    }
  }

  function deleteItem(section: 'hd' | 'wd', id: string) {
    if (section === 'hd') {
      const newItems = hasDoneItems.filter(i => i.id !== id);
      setHasDoneItems(newItems);
      scheduleSave(newItems, willDoItems, summary);
    } else {
      const newItems = willDoItems.filter(i => i.id !== id);
      setWillDoItems(newItems);
      scheduleSave(hasDoneItems, newItems, summary);
    }
  }

  // 중요(별표) 토글 — Has Done(실적) 항목만 대상
  function toggleImportant(section: 'hd' | 'wd', id: string) {
    if (section === 'hd') {
      const newItems = hasDoneItems.map(i => i.id === id ? { ...i, important: !i.important } : i);
      setHasDoneItems(newItems);
      scheduleSave(newItems, willDoItems, summary);
    } else {
      const newItems = willDoItems.map(i => i.id === id ? { ...i, important: !i.important } : i);
      setWillDoItems(newItems);
      scheduleSave(hasDoneItems, newItems, summary);
    }
  }

  function renderSection(section: 'hd' | 'wd', items: SimpleTaskItem[], isGreen: boolean) {
    const newKey = `${section}-new`;
    const isAdding = editingKey === newKey;
    return (
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className={cn('px-4 py-2.5 border-b flex items-center gap-2', isGreen ? 'bg-green-50' : 'bg-gray-50')}>
          <span className={cn('text-xs font-bold uppercase tracking-wide', isGreen ? 'text-green-700' : 'text-gray-700')}>
            {isGreen ? 'Has Done — 이번 주 실적' : 'Will Do — 다음 주 계획'}
          </span>
          <span className={cn('text-xs', isGreen ? 'text-green-500' : 'text-gray-400')}>{items.length}건</span>
        </div>
        {items.length === 0 && !isAdding ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-400">{isGreen ? '이번 주 실적이 없습니다.' : '다음 주 계획이 없습니다.'}</p>
          </div>
        ) : (
          <div className="divide-y">
            {items.map(item => {
              const itemKey = `${section}-${item.id}`;
              const isEditing = editingKey === itemKey;
              return (
                <div key={item.id}>
                  {!isEditing ? (
                    <div className={cn('flex items-start gap-3 px-4 py-3 group hover:bg-gray-50 transition-colors',
                      isGreen && 'bg-green-50/20',
                      item.important && 'bg-amber-50/60')}>
                      {/* 중요(별표) 토글 — Has Done(실적)만 */}
                      {isGreen && (
                        <button
                          onClick={() => toggleImportant(section, item.id)}
                          title={item.important ? '중요 해제' : '중요 표시'}
                          className={cn('shrink-0 mt-0.5 rounded p-0.5 transition-colors',
                            item.important ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400')}
                        >
                          <Star className={cn('h-4 w-4', item.important && 'fill-amber-400')} />
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 leading-snug">{item.title}</p>
                        {item.content && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed whitespace-pre-wrap">{item.content}</p>}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={() => openEdit(section, item)}
                          className="rounded p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteItem(section, item.id)}
                          className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4">
                      <SimpleItemForm value={editDraft} onChange={setEditDraft} onSave={saveItem} onCancel={() => setEditingKey(null)} isNew={false} />
                    </div>
                  )}
                </div>
              );
            })}
            {isAdding && (
              <div className="p-4">
                <SimpleItemForm value={editDraft} onChange={setEditDraft} onSave={saveItem} onCancel={() => setEditingKey(null)} isNew />
              </div>
            )}
          </div>
        )}
        {!isAdding && (
          <div className="border-t px-4 py-2.5">
            <button onClick={() => openNew(section)}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors">
              <Plus className="h-4 w-4" /> 업무 추가
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <WeekNav year={year} week={week} start={start} end={end}
        isCurrentWeek={isCurrentWeek} saveStatus={saveStatus}
        onPrev={() => { const p = prevWeek(year, week); onWeekChange(p.year, p.week); }}
        onNext={() => { const n = nextWeek(year, week); onWeekChange(n.year, n.week); }}
        onToday={() => onWeekChange(today.year, today.week)}
        onSelect={(y, w) => onWeekChange(y, w)}
      />

      {loading ? (
        <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-36 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : (
        <>
          {/* Has Done · Will Do 가로 2열 배치 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {renderSection('hd', hasDoneItems, true)}
            {renderSection('wd', willDoItems, false)}
          </div>

          {/* 종합 의견 */}
          <div className={cn(
            'rounded-xl border p-5 space-y-3 transition-all',
            summaryLocked ? 'bg-green-50/40 border-green-200' : 'bg-white border-gray-200',
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-gray-800">이번 주 종합 의견</h4>
                {summaryLocked && (
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                    <Check className="h-3.5 w-3.5" /> 저장됨
                  </span>
                )}
              </div>
              {summaryLocked ? (
                <button
                  type="button"
                  onClick={() => {
                    setSummaryLocked(false);
                    setTimeout(() => summaryRef.current?.focus(), 50);
                  }}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  수정
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    if (!userProfile) return;
                    if (timerRef.current) clearTimeout(timerRef.current);
                    setSaveStatus('saving');
                    try {
                      await upsertWeeklyTaskSections(
                        userProfile.id, year, week,
                        userProfile.organizationId, start, end,
                        hasDoneItems, willDoItems, summary,
                      );
                      setSaveStatus('saved');
                      setSummaryLocked(true);
                      summaryRef.current?.blur();
                      toast.success('저장되었습니다.');
                      setTimeout(() => setSaveStatus('idle'), 2500);
                    } catch {
                      setSaveStatus('idle');
                      toast.error('저장에 실패했습니다.');
                    }
                  }}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                  disabled={saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? '저장 중…' : '저장'}
                </button>
              )}
            </div>
            <textarea
              ref={summaryRef}
              rows={4}
              value={summary}
              readOnly={summaryLocked}
              onChange={e => {
                setSummary(e.target.value);
                scheduleSave(hasDoneItems, willDoItems, e.target.value);
              }}
              placeholder="이번 주 업무 전반에 대한 종합 의견, 이슈 등을 자유롭게 작성하세요."
              className={cn(
                'w-full resize-none rounded-lg border px-4 py-3 text-sm text-gray-700 placeholder:text-gray-300 leading-relaxed transition-colors',
                summaryLocked
                  ? 'bg-white border-green-200 cursor-default focus:outline-none'
                  : 'bg-white border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500',
              )}
            />
          </div>

          {/* 팀 코멘트 — 종합 의견 아래에 항상 표시 (팀장·임원이 작성한 코멘트) */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-3">
            <p className="text-sm font-semibold text-blue-700">팀 코멘트</p>
            {leadComments.length === 0 ? (
              <p className="text-xs text-blue-400 italic">아직 작성된 코멘트가 없습니다.</p>
            ) : (
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
            )}
          </div>
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
  const [orgsById, setOrgsById] = useState<Map<string, Organization>>(new Map());
  const [tasksByUser, setTasksByUser] = useState<Record<string, WeeklyTask>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [savingComment, setSavingComment] = useState<string | null>(null);
  // v0.76 A2: 코멘트 수정 상태
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const today = getISOWeek(new Date());
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;

  // 코멘트 수정 저장
  async function handleEditComment(memberId: string, commentId: string) {
    if (!editingText.trim()) return;
    const { updateLeadComment } = await import('@/lib/firestore');
    await updateLeadComment(memberId, year, week, commentId, editingText.trim());
    setTasksByUser(p => ({
      ...p,
      [memberId]: {
        ...p[memberId],
        leadComments: (p[memberId].leadComments ?? []).map(c =>
          c.id === commentId ? { ...c, text: editingText.trim(), editedAt: new Date() } : c
        ),
      },
    }));
    setEditingCommentId(null);
    setEditingText('');
  }

  // 코멘트 삭제
  async function handleDeleteComment(memberId: string, commentId: string) {
    if (!confirm('이 코멘트를 삭제하시겠습니까?')) return;
    const { deleteLeadComment } = await import('@/lib/firestore');
    await deleteLeadComment(memberId, year, week, commentId);
    setTasksByUser(p => ({
      ...p,
      [memberId]: {
        ...p[memberId],
        leadComments: (p[memberId].leadComments ?? []).filter(c => c.id !== commentId),
      },
    }));
  }

  useEffect(() => {
    if (!userProfile) return;
    setLoading(true);
    (async () => {
      // 본부장(HEADQUARTERS 팀장) 등 산하 조직이 있는 경우까지 포괄
      const [allUsers, allOrgs] = await Promise.all([getAllUsers(), getOrganizations()]);
      const scopeOrgIds = userProfile!.organizationId
        ? findDescendantIds(userProfile!.organizationId, allOrgs)
        : [];
      const users = allUsers.filter(u =>
        u.id !== userProfile!.id && scopeOrgIds.includes(u.organizationId),
      );
      setMembers(users);
      setOrgsById(new Map(allOrgs.map(o => [o.id, o])));
      const tasks = await getWeeklyTasksByUsersAndWeek(users.map(u => u.id), year, week);
      const map: Record<string, WeeklyTask> = {};
      tasks.forEach(t => { map[t.userId] = t; });
      setTasksByUser(map);
      setCommentDraft({});  // 초기에는 모두 빈 입력란
      const init: Record<string, boolean> = {};
      users.forEach(u => { init[u.id] = true; });
      setExpanded(init);
      setLoading(false);
    })();
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
      // 알림 생성 (작성 대상자에게)
      try {
        await createNotification({
          userId,
          type: 'WEEKLY_TASK_COMMENT',
          category: 'WEEKLY_TASK',
          title: `${year}년 ${week}주차 주간업무`,
          message: `${me.name}님이 코멘트를 남겼습니다: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
          link: '/tasks',
          read: false,
        });
      } catch { /* 알림 실패는 무시 */ }
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
            const hdItems = wt?.hasDoneItems ?? [];
            const wdItems = wt?.willDoItems ?? [];
            const hasAny = hdItems.length > 0 || wdItems.length > 0;
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
                    <span className="ml-2 text-xs text-gray-400">
                      {[orgsById.get(member.organizationId)?.name, member.position].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {hasAny ? (
                    <div className="flex items-center gap-4 text-xs shrink-0">
                      <span className="text-green-600 font-medium">실적 {hdItems.length}건</span>
                      <span className="text-gray-500">계획 {wdItems.length}건</span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300 shrink-0">보고서 없음</span>
                  )}
                  <ChevronDown className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform', !isOpen && '-rotate-90')} />
                </button>

                {/* 상세 내용 */}
                {isOpen && (
                  <div className="border-t">
                    {!hasAny ? (
                      <p className="px-5 py-4 text-sm text-gray-400 text-center">이번 주 보고서가 없습니다.</p>
                    ) : (
                      <div className="grid grid-cols-2">
                        {/* Has Done */}
                        <div className="border-r">
                          <div className="px-4 py-2 bg-green-50 border-b flex items-center gap-2">
                            <span className="text-xs font-bold text-green-700">Has Done — 이번 주 실적</span>
                            <span className="text-xs text-green-500">{hdItems.length}건</span>
                          </div>
                          {hdItems.length === 0 ? (
                            <p className="px-5 py-3 text-xs text-gray-300 italic">기록 없음</p>
                          ) : (
                            <div className="divide-y">
                              {hdItems.map(item => (
                                <div key={item.id} className="px-5 py-3 bg-green-50/20">
                                  <p className="text-sm font-medium text-gray-800">{item.title}</p>
                                  {item.content && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{item.content}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Will Do */}
                        <div>
                          <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-700">Will Do — 다음 주 계획</span>
                            <span className="text-xs text-gray-400">{wdItems.length}건</span>
                          </div>
                          {wdItems.length === 0 ? (
                            <p className="px-5 py-3 text-xs text-gray-300 italic">기록 없음</p>
                          ) : (
                            <div className="divide-y">
                              {wdItems.map(item => (
                                <div key={item.id} className="px-5 py-3">
                                  <p className="text-sm font-medium text-gray-800">{item.title}</p>
                                  {item.content && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{item.content}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 종합 의견 — 업무 유무 관계없이 항상 Comment 위에 표시 */}
                    {wt?.summary && (
                      <div className="mx-4 my-3 rounded-lg bg-gray-50 px-4 py-3">
                        <p className="text-xs font-semibold text-gray-500 mb-1">종합 의견</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{wt.summary}</p>
                      </div>
                    )}

                    {/* 팀 코멘트 섹션 */}
                    <div className="border-t bg-blue-50/40 px-4 py-3 space-y-3">
                      <p className="text-xs font-semibold text-blue-700">팀 코멘트</p>

                      {/* 기존 Comment 스레드 — 본인 코멘트는 수정·삭제 가능 (v0.76 A2) */}
                      {(wt?.leadComments ?? []).length > 0 && (
                        <div className="space-y-2">
                          {(wt!.leadComments).map(c => {
                            const isOwn = me && c.authorId === me.id;
                            const isEditing = editingCommentId === c.id;
                            return (
                              <div key={c.id} className="rounded-lg bg-white border border-blue-100 px-3 py-2.5 space-y-1 group">
                                <div className="flex items-center gap-2 text-xs text-gray-400">
                                  <span className="font-medium text-blue-700">{c.authorName}</span>
                                  <span>·</span>
                                  <span>{c.createdAt.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                  {c.editedAt && <span className="text-gray-300">(수정됨)</span>}
                                  {isOwn && !isEditing && (
                                    <span className="ml-auto opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                                      <button
                                        onClick={() => { setEditingCommentId(c.id); setEditingText(c.text); }}
                                        className="text-blue-500 hover:text-blue-700"
                                      >
                                        수정
                                      </button>
                                      <span>·</span>
                                      <button
                                        onClick={() => handleDeleteComment(member.id, c.id)}
                                        className="text-red-500 hover:text-red-700"
                                      >
                                        삭제
                                      </button>
                                    </span>
                                  )}
                                </div>
                                {isEditing ? (
                                  <div className="space-y-1.5">
                                    <textarea
                                      rows={2}
                                      value={editingText}
                                      onChange={e => setEditingText(e.target.value)}
                                      className="w-full resize-none rounded-md border border-blue-300 bg-white px-2 py-1.5 text-sm"
                                    />
                                    <div className="flex justify-end gap-2 text-xs">
                                      <button onClick={() => { setEditingCommentId(null); setEditingText(''); }} className="text-gray-500 hover:text-gray-700">취소</button>
                                      <button onClick={() => handleEditComment(member.id, c.id)} className="text-blue-600 font-medium hover:text-blue-800">저장</button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.text}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* 새 Comment 입력 — 보고서 없으면 비활성화 */}
                      {!wt ? (
                        <p className="text-xs text-gray-300 italic">이번 주 보고서가 없어 팀 코멘트를 작성할 수 없습니다.</p>
                      ) : (
                        <div className="space-y-2">
                          <textarea
                            rows={2}
                            value={commentDraft[member.id] ?? ''}
                            onChange={e => setCommentDraft(p => ({ ...p, [member.id]: e.target.value }))}
                            placeholder="이번 주 업무에 대한 팀 코멘트를 남겨주세요."
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

// ── 임원 / CEO 조직 업무 현황 (v0.75 개편) ──────────────────────────────
// 산하 팀별 탭 + Has Done/Will Do 2-column + 행은 팀장→팀원 순
function OrgTasksView({ allOrgs: isAllOrgs }: { allOrgs: boolean }) {
  const { userProfile } = useAuth();
  const today = getISOWeek(new Date());
  const [year, setYear] = useState(today.year);
  const [week, setWeek] = useState(today.week);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasksByUser, setTasksByUser] = useState<Record<string, WeeklyTask>>({});
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [savingComment, setSavingComment] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // v0.76 A2: 본인 코멘트 수정 상태
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;

  async function handleEditComment(memberId: string, commentId: string) {
    if (!editingText.trim()) return;
    const { updateLeadComment } = await import('@/lib/firestore');
    await updateLeadComment(memberId, year, week, commentId, editingText.trim());
    setTasksByUser(p => ({
      ...p,
      [memberId]: {
        ...p[memberId],
        leadComments: (p[memberId].leadComments ?? []).map(c =>
          c.id === commentId ? { ...c, text: editingText.trim(), editedAt: new Date() } : c
        ),
      },
    }));
    setEditingCommentId(null);
    setEditingText('');
  }

  async function handleDeleteComment(memberId: string, commentId: string) {
    if (!confirm('이 코멘트를 삭제하시겠습니까?')) return;
    const { deleteLeadComment } = await import('@/lib/firestore');
    await deleteLeadComment(memberId, year, week, commentId);
    setTasksByUser(p => ({
      ...p,
      [memberId]: {
        ...p[memberId],
        leadComments: (p[memberId].leadComments ?? []).filter(c => c.id !== commentId),
      },
    }));
  }

  async function handleSaveComment(memberId: string) {
    const wt = tasksByUser[memberId];
    const text = (commentDraft[memberId] ?? '').trim();
    if (!wt || !text || !userProfile) return;
    setSavingComment(memberId);
    try {
      const newEntry = await addLeadComment(memberId, year, week, userProfile.id, userProfile.name, text);
      setTasksByUser(p => ({
        ...p,
        [memberId]: {
          ...p[memberId],
          leadComments: [...(p[memberId].leadComments ?? []), newEntry],
        },
      }));
      setCommentDraft(p => ({ ...p, [memberId]: '' }));
      try {
        await createNotification({
          userId: memberId,
          type: 'WEEKLY_TASK_COMMENT',
          category: 'WEEKLY_TASK',
          title: `${year}년 ${week}주차 주간업무`,
          message: `${userProfile.name}님이 코멘트를 남겼습니다: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
          link: '/tasks',
          read: false,
        });
      } catch { /* 알림 실패 무시 */ }
    } finally {
      setSavingComment(null);
    }
  }

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
      const scopeUsers = allUsersList.filter(u => u.id !== userProfile!.id && scopeOrgIds.includes(u.organizationId));
      const scopeOrgs  = allOrgsList.filter(o => scopeOrgIds.includes(o.id));
      setOrgs(scopeOrgs);
      setUsers(scopeUsers);
      const tasks = await getWeeklyTasksByUsersAndWeek(scopeUsers.map(u => u.id), year, week);
      const map: Record<string, WeeklyTask> = {};
      tasks.forEach(t => { map[t.userId] = t; });
      setTasksByUser(map);
      setLoading(false);
    }
    load().catch(console.error);
  }, [userProfile, year, week, isAllOrgs]);

  // 산하 팀 목록 — TEAM + 주간업무 작성 대상자가 있는 HEADQUARTERS
  // (본부장이 임원 role이면 주간업무 작성 안 함 → 그런 본부는 탭에 노출 안 함)
  // 정렬: 부문 → 본부 → 팀 순서 (조직 트리 DFS 순회)
  const teams = (() => {
    const filtered = orgs.filter(o => {
      if (o.type === 'TEAM') return true;
      if (o.type === 'HEADQUARTERS') {
        // HEADQUARTERS 본부장은 임원 role 또는 팀장 role 인데, 임원 role 본부장은
        // 본인 주간업무 작성 안 함 (CLAUDE.md 본부장 권한 케이스 정의). 따라서 본부 직속
        // 멤버 중 주간업무 작성 대상(MEMBER 또는 TEAM_LEAD)이 있을 때만 탭에 노출.
        return users.some(u =>
          u.organizationId === o.id && (u.role === 'MEMBER' || u.role === 'TEAM_LEAD'),
        );
      }
      return false;
    });
    // 조직 트리 DFS — 타입 우선순위: COMPANY → DIVISION → HEADQUARTERS → TEAM
    // 임원의 경우 scopeOrgs 가 부문부터 시작하므로 "scope 내 루트"는 parent 가 scope 에 없는 조직
    const typeRank: Record<string, number> = { COMPANY: 0, DIVISION: 1, HEADQUARTERS: 2, TEAM: 3 };
    const orgIdSet = new Set(orgs.map(o => o.id));
    const orderMap = new Map<string, number>();
    let idx = 0;
    function sortSiblings(list: Organization[]) {
      return list.sort((a, b) => {
        const ra = typeRank[a.type] ?? 99;
        const rb = typeRank[b.type] ?? 99;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
    }
    function visit(node: Organization) {
      orderMap.set(node.id, idx++);
      const children = sortSiblings(orgs.filter(o => o.parentId === node.id));
      for (const c of children) visit(c);
    }
    // scope 내 루트: parent 가 없거나 scope 밖
    const roots = sortSiblings(orgs.filter(o => !o.parentId || !orgIdSet.has(o.parentId)));
    for (const r of roots) visit(r);
    return filtered.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  })();
  // 활성 탭이 없거나 더 이상 유효하지 않으면 첫 팀으로
  useEffect(() => {
    if (teams.length === 0) { setActiveTeamId(null); return; }
    if (!activeTeamId || !teams.find(t => t.id === activeTeamId)) {
      setActiveTeamId(teams[0].id);
    }
  }, [teams, activeTeamId]);

  // 상위 조직 체인 라벨 (예: "재경부문 · 재경본부 · 재경팀")
  function teamPath(teamOrg: Organization): string {
    const labels: string[] = [teamOrg.name];
    let cur = teamOrg.parentId ? orgs.find(o => o.id === teamOrg.parentId!) : undefined;
    while (cur) {
      labels.unshift(cur.name);
      cur = cur.parentId ? orgs.find(o => o.id === cur!.parentId!) : undefined;
    }
    return labels.join(' · ');
  }

  const activeTeam = teams.find(t => t.id === activeTeamId);
  const teamMembers = activeTeam
    ? users
        .filter(u => u.organizationId === activeTeam.id)
        // 팀장 먼저, 팀원 다음 (그 외 역할은 뒤로)
        .sort((a, b) => {
          const rank = (r: string) => r === 'TEAM_LEAD' ? 0 : r === 'MEMBER' ? 1 : 2;
          return rank(a.role) - rank(b.role);
        })
    : [];

  return (
    <div className="flex flex-col h-full">
      <Header title="주간업무보고" />
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
          ) : teams.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8 rounded-xl border bg-white">표시할 팀이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {/* 팀 탭 */}
              <div className="flex gap-1 overflow-x-auto border-b border-gray-200 px-1 pb-px">
                {teams.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTeamId(t.id)}
                    className={cn(
                      'shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                      activeTeamId === t.id
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-gray-500 hover:text-gray-800',
                    )}
                    title={teamPath(t)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>

              {activeTeam && (
                <>
                  <p className="text-xs text-gray-400">{teamPath(activeTeam)}</p>
                  {teamMembers.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-8 rounded-xl border bg-white">이 팀에 소속된 인원이 없습니다.</p>
                  ) : (
                    <div className="space-y-3">
                      {teamMembers.map(member => {
                        const wt = tasksByUser[member.id];
                        const hdItems = wt?.hasDoneItems ?? [];
                        const wdItems = wt?.willDoItems ?? [];
                        const hasAny = hdItems.length > 0 || wdItems.length > 0;
                        const isOpen = expanded[member.id] ?? true;
                        const roleLabel = member.role === 'EXECUTIVE'
                          ? (activeTeam?.type === 'HEADQUARTERS' && activeTeam?.leaderId === member.id ? '본부장' : '임원')
                          : member.role === 'TEAM_LEAD'
                            ? (activeTeam?.type === 'HEADQUARTERS' ? '본부장' : '팀장')
                            : '팀원';
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
                                <span className="ml-2 text-xs text-gray-400">
                                  {[orgs.find(o => o.id === member.organizationId)?.name, roleLabel, member.position]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </div>
                              {hasAny ? (
                                <div className="flex items-center gap-4 text-xs shrink-0">
                                  <span className="text-green-600 font-medium">실적 {hdItems.length}건</span>
                                  <span className="text-gray-500">계획 {wdItems.length}건</span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-300 shrink-0">보고서 없음</span>
                              )}
                              <ChevronDown className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform', !isOpen && '-rotate-90')} />
                            </button>

                            {/* 상세 내용 */}
                            {isOpen && (
                              <div className="border-t">
                                {!hasAny ? (
                                  <p className="px-5 py-4 text-sm text-gray-400 text-center">이번 주 보고서가 없습니다.</p>
                                ) : (
                                  <div className="grid grid-cols-2">
                                    {/* Has Done */}
                                    <div className="border-r">
                                      <div className="px-4 py-2 bg-green-50 border-b flex items-center gap-2">
                                        <span className="text-xs font-bold text-green-700">Has Done — 이번 주 실적</span>
                                        <span className="text-xs text-green-500">{hdItems.length}건</span>
                                      </div>
                                      {hdItems.length === 0 ? (
                                        <p className="px-5 py-3 text-xs text-gray-300 italic">기록 없음</p>
                                      ) : (
                                        <div className="divide-y">
                                          {hdItems.map(item => (
                                            <div key={item.id} className="px-5 py-3 bg-green-50/20">
                                              <p className="text-sm font-medium text-gray-800">{item.title}</p>
                                              {item.content && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{item.content}</p>}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    {/* Will Do */}
                                    <div>
                                      <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-2">
                                        <span className="text-xs font-bold text-gray-700">Will Do — 다음 주 계획</span>
                                        <span className="text-xs text-gray-400">{wdItems.length}건</span>
                                      </div>
                                      {wdItems.length === 0 ? (
                                        <p className="px-5 py-3 text-xs text-gray-300 italic">기록 없음</p>
                                      ) : (
                                        <div className="divide-y">
                                          {wdItems.map(item => (
                                            <div key={item.id} className="px-5 py-3">
                                              <p className="text-sm font-medium text-gray-800">{item.title}</p>
                                              {item.content && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{item.content}</p>}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* 종합 의견 */}
                                {wt?.summary && (
                                  <div className="mx-4 my-3 rounded-lg bg-gray-50 px-4 py-3">
                                    <p className="text-xs font-semibold text-gray-500 mb-1">종합 의견</p>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{wt.summary}</p>
                                  </div>
                                )}

                                {/* 팀 코멘트 */}
                                <div className="border-t bg-blue-50/40 px-4 py-3 space-y-3">
                                  <p className="text-xs font-semibold text-blue-700">팀 코멘트</p>
                                  {(wt?.leadComments ?? []).length > 0 && (
                                    <div className="space-y-2">
                                      {(wt!.leadComments).map(c => {
                                        const isOwn = userProfile && c.authorId === userProfile.id;
                                        const isEditing = editingCommentId === c.id;
                                        return (
                                          <div key={c.id} className="rounded-lg bg-white border border-blue-100 px-3 py-2.5 space-y-1 group">
                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                              <span className="font-medium text-blue-700">{c.authorName}</span>
                                              <span>·</span>
                                              <span>{c.createdAt.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                              {c.editedAt && <span className="text-gray-300">(수정됨)</span>}
                                              {isOwn && !isEditing && (
                                                <span className="ml-auto opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                                                  <button onClick={() => { setEditingCommentId(c.id); setEditingText(c.text); }} className="text-blue-500 hover:text-blue-700">수정</button>
                                                  <span>·</span>
                                                  <button onClick={() => handleDeleteComment(member.id, c.id)} className="text-red-500 hover:text-red-700">삭제</button>
                                                </span>
                                              )}
                                            </div>
                                            {isEditing ? (
                                              <div className="space-y-1.5">
                                                <textarea
                                                  rows={2}
                                                  value={editingText}
                                                  onChange={e => setEditingText(e.target.value)}
                                                  className="w-full resize-none rounded-md border border-blue-300 bg-white px-2 py-1.5 text-sm"
                                                />
                                                <div className="flex justify-end gap-2 text-xs">
                                                  <button onClick={() => { setEditingCommentId(null); setEditingText(''); }} className="text-gray-500 hover:text-gray-700">취소</button>
                                                  <button onClick={() => handleEditComment(member.id, c.id)} className="text-blue-600 font-medium hover:text-blue-800">저장</button>
                                                </div>
                                              </div>
                                            ) : (
                                              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.text}</p>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {!wt ? (
                                    <p className="text-xs text-gray-300 italic">이번 주 보고서가 없어 팀 코멘트를 작성할 수 없습니다.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      <textarea
                                        rows={2}
                                        value={commentDraft[member.id] ?? ''}
                                        onChange={e => setCommentDraft(p => ({ ...p, [member.id]: e.target.value }))}
                                        placeholder="이번 주 업무에 대한 팀 코멘트를 남겨주세요."
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
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
