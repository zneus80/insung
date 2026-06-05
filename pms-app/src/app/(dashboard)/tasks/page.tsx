'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTeamWeeklyTask,
  getWeeklyTasksByMembersAndYear,
  upsertTeamWeeklyTask,
  subscribeTeamWeeklyTask,
  addLeadComment,
  updateLeadComment,
  deleteLeadComment,
  syncWeeklyGoalProgress,
  getGoalsByOrganization,
  getAllUsers,
  getOrganizations,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Star, Printer, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import { getMyScopeOrgIds } from '@/lib/approval-filters';
import type {
  WeeklyTask, SimpleTaskItem, LeadCommentEntry, User, Organization, Goal,
} from '@/types';

// 핵심업무목표 연계 대상 — 승인된 활성 목표
const WEEKLY_GOAL_STATUSES = new Set(['APPROVED', 'IN_PROGRESS']);

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
  const { userProfile } = useAuth();
  const [tab, setTab] = useState<'my' | 'team'>('my');
  const today = getISOWeek(new Date());
  const [year, setYear] = useState(today.year);
  const [week, setWeek] = useState(today.week);
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;
  // 산하 '다른 팀'(본인 팀 제외) — 있을 때만 '팀 업무 현황' 탭 노출
  const [orgsAll, setOrgsAll] = useState<Organization[]>([]);
  const [otherTeams, setOtherTeams] = useState<Organization[]>([]);

  useEffect(() => {
    if (!userProfile) return;
    (async () => {
      const allOrgs = await getOrganizations();
      const scopeIds = getMyScopeOrgIds(userProfile.id, userProfile.role, userProfile.organizationId, allOrgs);
      const scopeSet = new Set(scopeIds);
      const leaves = allOrgs
        .filter(o => scopeSet.has(o.id) && o.id !== userProfile.organizationId) // 본인 팀 제외
        .filter(o => !allOrgs.some(c => c.parentId === o.id && scopeSet.has(c.id)))
        .slice()
        .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || a.name.localeCompare(b.name, 'ko'));
      setOrgsAll(allOrgs);
      setOtherTeams(leaves);
    })().catch(console.error);
  }, [userProfile]);

  if (!userProfile) return null;
  const hasOtherTeams = otherTeams.length > 0;

  return (
    <div className="flex flex-col h-full">
      <Header title="주간업무보고" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {hasOtherTeams && (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {(['my', 'team'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={cn('px-5 py-1.5 rounded-md text-sm font-medium transition-colors',
                  tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}>
                {t === 'my' ? '우리 팀 주간보고' : '산하 팀 현황'}
              </button>
            ))}
          </div>
        )}

        <WeekNav year={year} week={week} start={start} end={end}
          isCurrentWeek={isCurrentWeek} saveStatus="idle"
          onPrev={() => { const p = prevWeek(year, week); setYear(p.year); setWeek(p.week); }}
          onNext={() => { const n = nextWeek(year, week); setYear(n.year); setWeek(n.week); }}
          onToday={() => { setYear(today.year); setWeek(today.week); }}
          onSelect={(y, w) => { setYear(y); setWeek(w); }}
        />

        {(tab === 'my' || !hasOtherTeams) ? (
          <div className="max-w-6xl">
            <TeamWeeklyForm
              orgId={userProfile.organizationId}
              year={year} week={week}
              editable
              currentUser={{ id: userProfile.id, name: userProfile.name }}
            />
          </div>
        ) : (
          <ScopeTeamsView year={year} week={week} teams={otherTeams} orgs={orgsAll}
            currentUser={{ id: userProfile.id, name: userProfile.name }} />
        )}
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
  value, onChange, onSave, onCancel, isNew, coreMode = false,
}: {
  value: Omit<SimpleTaskItem, 'id'>;
  onChange: (v: Omit<SimpleTaskItem, 'id'>) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
  coreMode?: boolean;   // 핵심업무 — 업무명 생략, 진행사항(content)만 입력
}) {
  const label = coreMode ? '진행사항' : '업무';
  const canSave = coreMode ? !!value.content.trim() : !!value.title.trim();
  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50/30 p-4 space-y-3">
      <p className="text-xs font-semibold text-blue-700">{isNew ? `${label} 추가` : `${label} 수정`}</p>
      {!coreMode && (
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
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">{coreMode ? '진행사항' : '업무 상세내용'}{coreMode && <span className="text-red-400"> *</span>}</label>
        <textarea
          rows={3}
          value={value.content}
          onChange={e => onChange({ ...value, content: e.target.value })}
          placeholder={coreMode ? '진행사항을 입력하세요' : '업무 상세내용을 입력하세요'}
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>취소</Button>
        <Button size="sm" onClick={onSave} disabled={!canSave}>
          {isNew ? '추가' : '저장'}
        </Button>
      </div>
    </div>
  );
}

// ── 입력자 배지 ────────────────────────────────────────────
function AuthorBadge({ name }: { name?: string }) {
  if (!name) return null;
  return (
    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{name}</span>
  );
}

// ── 팀 공유 주간보고 폼 (editable=우리 팀 / read-only=상위자 검토) ──
function TeamWeeklyForm({ orgId, year, week, editable, currentUser }: {
  orgId: string; year: number; week: number; editable: boolean;
  currentUser: { id: string; name: string };
}) {
  const [hasDoneItems, setHasDoneItems] = useState<SimpleTaskItem[]>([]);
  const [willDoItems, setWillDoItems] = useState<SimpleTaskItem[]>([]);
  const [goalProgress, setGoalProgress] = useState<Record<string, number>>({});
  const [leadComments, setLeadComments] = useState<LeadCommentEntry[]>([]);
  const [activeGoals, setActiveGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<SimpleTaskItem, 'id'>>(EMPTY_SIMPLE());
  const [commentDraft, setCommentDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const carriedRef = useRef(false);
  const gpRef = useRef(goalProgress);
  useEffect(() => { gpRef.current = goalProgress; }, [goalProgress]);

  const { start, end } = getWeekRange(year, week);
  const saturday = new Date(start); saturday.setDate(start.getDate() + 5); saturday.setHours(0, 0, 0, 0);
  // 검토자(read-only)는 항상 본문 잠금. 편집 가능자도 해당 주 토요일 이후 잠금.
  const isBodyLocked = !editable || new Date() >= saturday;

  // 팀 목표 로드 (핵심업무 그룹)
  useEffect(() => {
    let alive = true;
    setActiveGoals([]);
    getGoalsByOrganization(orgId, year)
      // 진행 목표 + 완료 목표(완료 주차까지만 표시하기 위해 포함) — 주차별 가시성은 renderSection 에서 필터
      // organizationId 일치만: 공동과제(relatedOrgIds)로 다른 팀 목표가 잡혀 부모/타 팀 폼에 중복되는 것 방지
      .then(list => { if (alive) setActiveGoals(list.filter(g => g.organizationId === orgId && (WEEKLY_GOAL_STATUSES.has(g.status) || g.status === 'COMPLETED'))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [orgId, year]);

  // 팀 문서 실시간 구독 (동시 편집 반영)
  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    carriedRef.current = false;
    setEditingKey(null);
    setCommentDraft('');
    const unsub = subscribeTeamWeeklyTask(orgId, year, week, async (wt) => {
      if (wt) {
        setHasDoneItems(wt.hasDoneItems ?? []);
        setWillDoItems(wt.willDoItems ?? []);
        setGoalProgress(wt.goalProgress ?? {});
        setLeadComments(wt.leadComments ?? []);
        setLoading(false);
      } else {
        setHasDoneItems([]); setWillDoItems([]); setGoalProgress({}); setLeadComments([]);
        setLoading(false);
        // 문서 없음 — 편집 가능 시 1회 자동 이월(지난 주 계획 → 이번 주 실적)
        if (editable && !carriedRef.current) {
          carriedRef.current = true;
          try {
            const prev = prevWeek(year, week);
            const prevWt = await getTeamWeeklyTask(orgId, prev.year, prev.week);
            const carried: SimpleTaskItem[] = (prevWt?.willDoItems ?? []).map(i => ({ ...i, id: crypto.randomUUID(), carriedFromId: i.id }));
            if (carried.length > 0) {
              await upsertTeamWeeklyTask(orgId, year, week, start, end, carried, [], {});
              toast.success(`지난 주 계획 ${carried.length}개를 이번 주 실적으로 불러왔습니다.`);
            }
          } catch (e) { console.error('[이월] 실패:', e); }
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, year, week, editable]);

  const saveBody = useCallback((hd: SimpleTaskItem[], wd: SimpleTaskItem[], gp?: Record<string, number>, syncGoals = false) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveStatus('saving');
    timerRef.current = setTimeout(async () => {
      try {
        const gpEff = gp ?? gpRef.current;
        await upsertTeamWeeklyTask(orgId, year, week, start, end, hd, wd, gpEff);
        // 진행률 역류 (핵심목표 연동) — '저장' 버튼으로 수동 실행 시에만
        if (syncGoals && gpEff && Object.keys(gpEff).length > 0) {
          const goalComments: Record<string, string> = {};
          for (const gid of Object.keys(gpEff)) {
            const titles = hd.filter(i => i.goalId === gid).map(i => (i.title || i.content).trim()).filter(Boolean);
            goalComments[gid] = titles.length ? `[${year}년 ${week}주차] ${titles.join(', ')}` : `${year}년 ${week}주차 주간보고`;
          }
          try { await syncWeeklyGoalProgress({ orgId, actorId: currentUser.id, year, week, goalProgress: gpEff, goalComments }); }
          catch (e) { console.error('[진행률 역류] 실패:', e); }
        }
        // 차주 hasDone 이월 동기화
        try {
          const nxt = nextWeek(year, week);
          const nextWt = await getTeamWeeklyTask(orgId, nxt.year, nxt.week);
          if (nextWt) {
            const nxtKept = (nextWt.hasDoneItems ?? []).filter(i => !i.carriedFromId);
            const nxtCarried: SimpleTaskItem[] = wd.map(i => ({ ...i, id: crypto.randomUUID(), carriedFromId: i.id }));
            const merged = [...nxtCarried, ...nxtKept];
            const prevHD = nextWt.hasDoneItems ?? [];
            const same = prevHD.length === merged.length && prevHD.every((p, idx) =>
              p.title === merged[idx].title && p.content === merged[idx].content &&
              (p.important ?? false) === (merged[idx].important ?? false) && p.carriedFromId === merged[idx].carriedFromId);
            if (!same) {
              const { start: nStart, end: nEnd } = getWeekRange(nxt.year, nxt.week);
              await upsertTeamWeeklyTask(orgId, nxt.year, nxt.week, nStart, nEnd, merged, nextWt.willDoItems ?? [], nextWt.goalProgress ?? {});
            }
          }
        } catch (e) { console.error('[차주 동기화] 실패:', e); }
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch { setSaveStatus('idle'); }
    }, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, year, week, currentUser.id]);

  function editing(section: 'hd' | 'wd', id: string) { return editingKey === `${section}-${id}`; }
  function openNew(section: 'hd' | 'wd', goalId?: string) {
    setEditDraft({ ...EMPTY_SIMPLE(), goalId });
    setEditingKey(`${section}-new`);
  }
  function openEdit(section: 'hd' | 'wd', item: SimpleTaskItem) {
    const { id, ...rest } = item;
    setEditDraft(rest);
    setEditingKey(`${section}-${id}`);
  }
  function saveItem() {
    if ((!editDraft.title.trim() && !editDraft.content.trim()) || !editingKey) return;
    const isHd = editingKey.startsWith('hd-');
    const idPart = editingKey.slice(3);
    const list = isHd ? hasDoneItems : willDoItems;
    const newItems = idPart === 'new'
      ? [...list, { ...editDraft, id: crypto.randomUUID(), authorId: currentUser.id, authorName: currentUser.name }]
      : list.map(i => i.id === idPart ? { ...editDraft, id: i.id } : i); // 수정 시 원 작성자 보존(editDraft 에 author 포함)
    if (isHd) { setHasDoneItems(newItems); saveBody(newItems, willDoItems); }
    else { setWillDoItems(newItems); saveBody(hasDoneItems, newItems); }
    setEditingKey(null);
  }
  function deleteItem(section: 'hd' | 'wd', id: string) {
    if (section === 'hd') { const n = hasDoneItems.filter(i => i.id !== id); setHasDoneItems(n); saveBody(n, willDoItems); }
    else { const n = willDoItems.filter(i => i.id !== id); setWillDoItems(n); saveBody(hasDoneItems, n); }
  }
  async function toggleImportant(section: 'hd' | 'wd', id: string) {
    const list = section === 'hd' ? hasDoneItems : willDoItems;
    const item = list.find(i => i.id === id);
    if (!item) return;
    const turningOn = !item.important;
    // 주요 일반업무(goalId 없는 항목) 별표를 켤 때만 — 작성자 1인당 연간 5개 제한
    if (turningOn && !item.goalId) {
      const authorId = item.authorId ?? currentUser.id;
      try {
        const yearDocs = await getWeeklyTasksByMembersAndYear([{ id: authorId, organizationId: orgId }], year);
        const starred = yearDocs
          .flatMap(t => (t.hasDoneItems ?? []).map(i => ({ i, owner: i.authorId ?? t.userId })))
          .filter(x => x.i.important && !x.i.goalId && x.owner === authorId);
        if (starred.length >= 5) {
          toast.error('주요 일반업무 별표는 1인당 연간 5개까지만 지정할 수 있습니다.');
          return;
        }
      } catch { /* 집계 실패 시 통과 */ }
    }
    const n = list.map(i => i.id === id ? { ...i, important: !i.important } : i);
    if (section === 'hd') { setHasDoneItems(n); saveBody(n, willDoItems); }
    else { setWillDoItems(n); saveBody(hasDoneItems, n); }
  }

  function renderItemRow(section: 'hd' | 'wd', item: SimpleTaskItem, isGreen: boolean) {
    if (editing(section, item.id)) {
      return (
        <div key={item.id} className="p-3">
          <SimpleItemForm value={editDraft} onChange={setEditDraft} onSave={saveItem} onCancel={() => setEditingKey(null)} isNew={false} coreMode={!!item.goalId} />
        </div>
      );
    }
    const hasTitle = !!item.title?.trim();
    return (
      <div key={item.id} className={cn('flex items-start gap-2.5 px-3 py-2.5 group hover:bg-gray-50 transition-colors', item.important && 'bg-amber-50/60')}>
        {/* 별표(주요 일반업무실적)는 일반업무 항목에만 — 핵심업무는 목표로 평가되므로 제외 */}
        {isGreen && !isBodyLocked && !item.goalId && (
          <button onClick={() => toggleImportant(section, item.id)} title={item.important ? '중요 해제' : '중요 표시 (육성면담서 주요 일반업무실적 연동, 연 5개)'}
            className={cn('shrink-0 mt-0.5 rounded p-0.5 transition-colors', item.important ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400')}>
            <Star className={cn('h-4 w-4', item.important && 'fill-amber-400')} />
          </button>
        )}
        {isGreen && isBodyLocked && item.important && !item.goalId && (
          <Star className="h-4 w-4 shrink-0 mt-0.5 text-amber-500 fill-amber-400" />
        )}
        <div className="flex-1 min-w-0">
          {hasTitle ? (
            <>
              <p className="text-sm font-medium text-gray-800 leading-snug">{item.title}</p>
              {item.content && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed whitespace-pre-wrap">{item.content}</p>}
            </>
          ) : (
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{item.content}</p>
          )}
        </div>
        <AuthorBadge name={item.authorName} />
        {!isBodyLocked && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button onClick={() => openEdit(section, item)} className="rounded p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={() => deleteItem(section, item.id)} className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
    );
  }

  function renderAdd(section: 'hd' | 'wd', goalId: string | undefined) {
    const isAddingHere = editingKey === `${section}-new` && (editDraft.goalId ?? undefined) === goalId;
    const isCore = !!goalId;
    if (isAddingHere) {
      return <div className="p-3"><SimpleItemForm value={editDraft} onChange={setEditDraft} onSave={saveItem} onCancel={() => setEditingKey(null)} isNew coreMode={isCore} /></div>;
    }
    if (isBodyLocked) return null;
    return (
      <div className="px-3 py-2">
        <button onClick={() => openNew(section, goalId)} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors">
          <Plus className="h-3.5 w-3.5" /> {isCore ? '진행사항 추가' : '업무 추가'}
        </button>
      </div>
    );
  }

  function renderSection(section: 'hd' | 'wd', items: SimpleTaskItem[], isGreen: boolean) {
    const general = items.filter(i => !i.goalId);
    // 핵심업무에 표시할 목표 — 완료 목표는 완료한 주차까지만(차주부터 미표시). 그 외 종료/이전 목표는 미표시.
    const viewedKey = year * 100 + week;
    const goalsToShow = activeGoals.filter(g => {
      if (g.status !== 'COMPLETED') return true;
      const at = g.completionExecApprovedAt ?? g.updatedAt;
      if (!at) return false;
      const w = getISOWeek(at instanceof Date ? at : new Date(at));
      return viewedKey <= (w.year * 100 + w.week);
    });
    return (
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className={cn('px-4 py-2.5 border-b flex items-center gap-2', isGreen ? 'bg-green-50' : 'bg-gray-50')}>
          <span className={cn('text-xs font-bold uppercase tracking-wide', isGreen ? 'text-green-700' : 'text-gray-700')}>
            {isGreen ? 'Has Done — 이번 주 실적' : 'Will Do — 다음 주 계획'}
          </span>
          <span className={cn('text-xs', isGreen ? 'text-green-500' : 'text-gray-400')}>{items.length}건</span>
        </div>

        {goalsToShow.length > 0 && (
          <div>
            <div className="px-4 py-1.5 bg-blue-50/70 border-b text-[11px] font-bold text-blue-700">핵심업무</div>
            {goalsToShow.map(g => {
              const gItems = items.filter(i => i.goalId === g.id);
              const pct = goalProgress[g.id] ?? g.progress ?? 0;
              return (
                <div key={g.id} className="border-b last:border-b-0">
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/60">
                    <span className="flex-1 text-sm font-semibold text-gray-800 truncate" title={g.title}>{g.title}</span>
                    {isGreen && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-gray-400">진행률</span>
                        {isBodyLocked ? (
                          <span className="text-sm font-medium text-blue-600">{pct}%</span>
                        ) : (
                          <>
                            <input type="number" min={0} max={100} value={pct}
                              onChange={e => {
                                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                const next = { ...goalProgress, [g.id]: v };
                                setGoalProgress(next);
                                saveBody(hasDoneItems, willDoItems, next);
                              }}
                              className="w-14 rounded border border-gray-200 px-1.5 py-0.5 text-sm text-right" />
                            <span className="text-[11px] text-gray-400">%</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="divide-y">{gItems.map(it => renderItemRow(section, it, isGreen))}</div>
                  {renderAdd(section, g.id)}
                </div>
              );
            })}
          </div>
        )}

        <div>
          <div className="px-4 py-1.5 bg-gray-100/70 border-b text-[11px] font-bold text-gray-600">일반업무</div>
          <div className="divide-y">{general.map(it => renderItemRow(section, it, isGreen))}</div>
          {renderAdd(section, undefined)}
        </div>
      </div>
    );
  }

  async function postComment() {
    if (!commentDraft.trim()) return;
    setPosting(true);
    try {
      const entry = await addLeadComment(orgId, year, week, currentUser.id, currentUser.name, commentDraft.trim());
      setLeadComments(prev => [...prev, entry]);
      setCommentDraft('');
    } catch { toast.error('코멘트 등록에 실패했습니다.'); }
    finally { setPosting(false); }
  }
  async function saveEditComment(commentId: string) {
    if (!editingText.trim()) return;
    try {
      await updateLeadComment(orgId, year, week, commentId, editingText.trim());
      setLeadComments(prev => prev.map(c => c.id === commentId ? { ...c, text: editingText.trim(), editedAt: new Date() } : c));
    } catch { toast.error('수정에 실패했습니다.'); }
    setEditingCommentId(null); setEditingText('');
  }
  async function removeComment(commentId: string) {
    if (!confirm('이 코멘트를 삭제하시겠습니까?')) return;
    try {
      await deleteLeadComment(orgId, year, week, commentId);
      setLeadComments(prev => prev.filter(c => c.id !== commentId));
    } catch { toast.error('삭제에 실패했습니다.'); }
  }

  // 인쇄 — A4 세로, 표 형식(가로: Has Done/Will Do, 세로: 핵심업무/일반업무). 코멘트 제외.
  function handlePrint() {
    const esc = (s?: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const titleById = new Map(activeGoals.map(g => [g.id, g.title]));
    const itemLi = (i: SimpleTaskItem) => {
      const main = esc(i.title || i.content);
      const sub = i.title && i.content ? `<div class="sub">${esc(i.content)}</div>` : '';
      const au = i.authorName ? ` <span class="au">작성자 ${esc(i.authorName)}</span>` : '';
      return `<li>${main}${au}${sub}</li>`;
    };
    // 핵심업무 셀 — 목표별 그룹(진행률은 Has Done 만)
    const goalOrder = new Map(activeGoals.map((g, idx) => [g.id, idx]));
    const coreCell = (items: SimpleTaskItem[], showPct: boolean) => {
      const goalIds = [...new Set(items.filter(i => i.goalId).map(i => i.goalId!))]
        // 화면(핵심목표)과 동일 순서로 정렬 — Has Done/Will Do 순서 어긋남 방지
        .sort((a, b) => (goalOrder.get(a) ?? 999) - (goalOrder.get(b) ?? 999));
      if (!goalIds.length) return '<span class="empty">—</span>';
      return goalIds.map(gid => {
        const gItems = items.filter(i => i.goalId === gid);
        const pct = showPct ? ` <span class="pct">진척률 (${goalProgress[gid] ?? 0}) %</span>` : '';
        return `<div class="g"><div class="gt">${esc(titleById.get(gid) ?? '핵심목표')}${pct}</div><ul>${gItems.map(itemLi).join('')}</ul></div>`;
      }).join('');
    };
    // 일반업무 셀
    const genCell = (items: SimpleTaskItem[]) => {
      const g = items.filter(i => !i.goalId);
      return g.length ? `<ul class="gen">${g.map(itemLi).join('')}</ul>` : '<span class="empty">—</span>';
    };
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>주간업무보고 ${year}년 ${week}주차</title>
<style>
  @page { size: A4 portrait; margin: 11mm; }
  *{ box-sizing:border-box; }
  html,body{ width:100%; }
  body{ font-family:'Malgun Gothic','맑은 고딕',sans-serif; color:#111; margin:0; font-size:12.7px; }
  h1{ font-size:20px; margin:0 0 2px; }
  .period{ color:#555; font-size:13px; margin-bottom:10px; }
  table{ width:100%; max-width:100%; border-collapse:collapse; table-layout:fixed; }
  th,td{ border:1px solid #333; padding:6px 6px; vertical-align:top; word-break:break-word; overflow-wrap:anywhere; }
  thead th{ background:#e5e7eb; text-align:center; font-size:14px; padding:6px; }
  .rowlabel{ width:56px; background:#f1f5f9; text-align:center; font-weight:700; font-size:13px; vertical-align:middle; }
  .colcell{ width:calc((100% - 56px)/2); }
  .g{ margin-bottom:6px; }
  .gt{ font-weight:700; background:#eef2ff; padding:2px 5px; border-radius:3px; word-break:break-word; overflow-wrap:anywhere; }
  .pct{ color:#2563eb; white-space:nowrap; }
  ul{ margin:3px 0 0; padding-left:15px; }
  li{ margin:1.5px 0; line-height:1.38; word-break:break-word; overflow-wrap:anywhere; }
  ul.gen li{ margin:6px 0; line-height:1.5; }
  ul.gen .sub{ margin-top:3px; }
  .au{ color:#6b7280; font-size:11px; }
  .sub{ color:#555; white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere; }
  .empty{ color:#bbb; }
</style></head><body>
  <h1>주간업무보고</h1>
  <div class="period">${year}년 ${week}주차 (${fmtDate(start)} ~ ${fmtDate(end)})</div>
  <table>
    <thead><tr><th class="rowlabel"></th><th>Has Done (이번 주 실적)</th><th>Will Do (다음 주 계획)</th></tr></thead>
    <tbody>
      <tr><td class="rowlabel">핵심<br>업무</td><td class="colcell">${coreCell(hasDoneItems, true)}</td><td class="colcell">${coreCell(willDoItems, false)}</td></tr>
      <tr><td class="rowlabel">일반<br>업무</td><td class="colcell">${genCell(hasDoneItems)}</td><td class="colcell">${genCell(willDoItems)}</td></tr>
    </tbody>
  </table>
</body></html>`;
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { toast.error('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 250);
  }

  if (loading) {
    return <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-36 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        {activeGoals.length > 0 && (
          <p className="text-xs text-gray-400 flex-1">
            핵심업무목표는 핵심업무 영역에 자동 표시됩니다. 진행사항·진행률을 입력하면 골카드 진행상황에 자동 반영되며, <span className="font-medium text-blue-600">입력자</span>가 표시됩니다.
          </p>
        )}
        <span className={cn('text-xs transition-opacity ml-auto', saveStatus === 'idle' ? 'opacity-0' : 'opacity-100', saveStatus === 'saving' ? 'text-gray-400' : 'text-green-600 font-medium')}>
          {saveStatus === 'saving' ? '저장 중...' : '✓ 저장됨'}
        </span>
        {editable && !isBodyLocked && (
          <Button size="sm" onClick={() => saveBody(hasDoneItems, willDoItems, goalProgress, true)} className="gap-1.5 shrink-0">
            <Save className="h-4 w-4" /> 저장 · 목표연동
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 shrink-0">
          <Printer className="h-4 w-4" /> 인쇄
        </Button>
      </div>

      {editable && new Date() >= saturday && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          해당 주 토요일이 지나 본문(실적/계획)은 읽기 전용입니다. 코멘트는 계속 가능합니다.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {renderSection('hd', hasDoneItems, true)}
        {renderSection('wd', willDoItems, false)}
      </div>

      {/* 코멘트 — 본인 + 조직 체인(팀장·본부장·임원) 스레드 */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-3">
        <p className="text-sm font-semibold text-blue-700">코멘트</p>
        {leadComments.length === 0 ? (
          <p className="text-xs text-blue-400 italic">아직 작성된 코멘트가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {leadComments.map(c => {
              const isOwn = c.authorId === currentUser.id;
              const isEditing = editingCommentId === c.id;
              return (
                <div key={c.id} className="rounded-lg bg-white border border-blue-100 px-4 py-3 space-y-1 group">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="font-medium text-blue-700">{c.authorName}</span>
                    <span>·</span>
                    <span>{c.createdAt.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    {c.editedAt && <span className="text-gray-300">(수정됨)</span>}
                    {isOwn && !isEditing && (
                      <span className="ml-auto opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                        <button onClick={() => { setEditingCommentId(c.id); setEditingText(c.text); }} className="text-blue-500 hover:text-blue-700">수정</button>
                        <span>·</span>
                        <button onClick={() => removeComment(c.id)} className="text-red-500 hover:text-red-700">삭제</button>
                      </span>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="space-y-1.5">
                      <textarea rows={2} value={editingText} onChange={e => setEditingText(e.target.value)} className="w-full resize-none rounded-md border border-blue-300 bg-white px-2 py-1.5 text-sm" />
                      <div className="flex justify-end gap-2 text-xs">
                        <button onClick={() => { setEditingCommentId(null); setEditingText(''); }} className="text-gray-500 hover:text-gray-700">취소</button>
                        <button onClick={() => saveEditComment(c.id)} className="text-blue-600 font-medium hover:text-blue-800">저장</button>
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
        <div className="flex items-end gap-2 pt-1">
          <textarea rows={2} value={commentDraft} onChange={e => setCommentDraft(e.target.value)} placeholder="코멘트를 입력하세요"
            className="flex-1 resize-none rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <Button size="sm" disabled={posting || !commentDraft.trim()} onClick={postComment}>{posting ? '등록 중…' : '등록'}</Button>
        </div>
      </div>
    </div>
  );
}

// ── 산하 팀 현황 (팀장·본부장 — 본인 팀 외 산하 팀 read-only) ───────────
function ScopeTeamsView({ year, week, teams, orgs, currentUser }: {
  year: number; week: number;
  teams: Organization[];          // 본인 팀 제외, 산하 leaf 팀들 (호출 측에서 계산)
  orgs: Organization[];
  currentUser: { id: string; name: string };
}) {
  const [activeId, setActiveId] = useState('');
  useEffect(() => {
    setActiveId(prev => teams.some(o => o.id === prev) ? prev : (teams[0]?.id ?? ''));
  }, [teams]);

  function teamPath(team: Organization): string {
    const labels: string[] = [team.name];
    let cur = team.parentId ? orgs.find(o => o.id === team.parentId!) : undefined;
    while (cur) { labels.unshift(cur.name); cur = cur.parentId ? orgs.find(o => o.id === cur!.parentId!) : undefined; }
    return labels.join(' · ');
  }

  if (teams.length === 0) return <p className="max-w-6xl rounded-xl border bg-white p-8 text-center text-sm text-gray-400">산하 다른 팀이 없습니다.</p>;

  const active = teams.find(o => o.id === activeId);
  return (
    <div className="space-y-3 max-w-6xl">
      <div className="flex gap-1 border-b bg-white px-1 pt-1 overflow-x-auto">
        {teams.map(o => (
          <button key={o.id} onClick={() => setActiveId(o.id)} title={teamPath(o)}
            className={cn('px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors whitespace-nowrap',
              activeId === o.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {o.name}
          </button>
        ))}
      </div>
      {active && (
        <>
          <p className="text-xs text-gray-400">{teamPath(active)}</p>
          {/* 해당 산하 팀의 리더(팀장)면 업무추가 등 편집 가능, 아니면 읽기전용(코멘트만) */}
          <TeamWeeklyForm orgId={active.id} year={year} week={week} editable={active.leaderId === currentUser.id} currentUser={currentUser} />
        </>
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
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const { start, end } = getWeekRange(year, week);
  const isCurrentWeek = year === today.year && week === today.week;

  useEffect(() => {
    if (!userProfile) return;
    setLoading(true);
    (async () => {
      const [allUsersList, allOrgsList] = await Promise.all([getAllUsers(), getOrganizations()]);
      const scopeOrgIds: string[] = isAllOrgs
        ? allOrgsList.map(o => o.id)
        : (() => {
            const byOrg = userProfile!.organizationId ? findDescendantIds(userProfile!.organizationId, allOrgsList) : [];
            const byLead = allOrgsList.filter(o => o.leaderId === userProfile!.id).flatMap(o => findDescendantIds(o.id, allOrgsList));
            return [...new Set([...byOrg, ...byLead])];
          })();
      setUsers(allUsersList.filter(u => u.id !== userProfile!.id && scopeOrgIds.includes(u.organizationId)));
      setOrgs(allOrgsList.filter(o => scopeOrgIds.includes(o.id)));
      setLoading(false);
    })().catch(console.error);
  }, [userProfile, isAllOrgs]);

  // 산하 팀 목록 — TEAM + 작성 대상자 있는 HEADQUARTERS, 트리 DFS 정렬
  const teams = (() => {
    const filtered = orgs.filter(o => {
      if (o.type === 'TEAM') return true;
      if (o.type === 'HEADQUARTERS') return users.some(u => u.organizationId === o.id && (u.role === 'MEMBER' || u.role === 'TEAM_LEAD'));
      return false;
    });
    const typeRank: Record<string, number> = { COMPANY: 0, DIVISION: 1, HEADQUARTERS: 2, TEAM: 3 };
    const orgIdSet = new Set(orgs.map(o => o.id));
    const orderMap = new Map<string, number>();
    let idx = 0;
    const sortSiblings = (list: Organization[]) => list.sort((a, b) => {
      const ra = typeRank[a.type] ?? 99, rb = typeRank[b.type] ?? 99;
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
    function visit(node: Organization) { orderMap.set(node.id, idx++); for (const c of sortSiblings(orgs.filter(o => o.parentId === node.id))) visit(c); }
    for (const r of sortSiblings(orgs.filter(o => !o.parentId || !orgIdSet.has(o.parentId)))) visit(r);
    return filtered.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  })();

  useEffect(() => {
    if (teams.length === 0) { setActiveTeamId(null); return; }
    if (!activeTeamId || !teams.find(t => t.id === activeTeamId)) setActiveTeamId(teams[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, activeTeamId]);

  function teamPath(team: Organization): string {
    const labels: string[] = [team.name];
    let cur = team.parentId ? orgs.find(o => o.id === team.parentId!) : undefined;
    while (cur) { labels.unshift(cur.name); cur = cur.parentId ? orgs.find(o => o.id === cur!.parentId!) : undefined; }
    return labels.join(' · ');
  }

  const activeTeam = teams.find(t => t.id === activeTeamId);

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
        <h4 className="text-sm font-semibold text-gray-700">{isAllOrgs ? '전체 조직' : '담당 조직'} 주간 업무 현황</h4>
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}</div>
        ) : teams.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8 rounded-xl border bg-white">표시할 팀이 없습니다.</p>
        ) : (
          <div className="space-y-3 max-w-6xl">
            <div className="flex gap-1 overflow-x-auto border-b border-gray-200 px-1 pb-px">
              {teams.map(t => (
                <button key={t.id} onClick={() => setActiveTeamId(t.id)} title={teamPath(t)}
                  className={cn('shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                    activeTeamId === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800')}>
                  {t.name}
                </button>
              ))}
            </div>
            {activeTeam && userProfile && (
              <>
                <p className="text-xs text-gray-400">{teamPath(activeTeam)}</p>
                <TeamWeeklyForm orgId={activeTeam.id} year={year} week={week} editable={false} currentUser={{ id: userProfile.id, name: userProfile.name }} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
