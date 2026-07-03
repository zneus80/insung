'use client';

/**
 * 전사 업무추진현황
 * 접근: MEMBER, TEAM_LEAD, EXECUTIVE, CEO 모두
 * 표시:
 *  - 부문/공장(DIVISION)별 연간목표 + 그 산하 팀장·팀원의 핵심목표(추진중·완료) 리스트
 *  - 혁신활동: 스마트 프로젝트 / TDS (HR 입력)
 *  - 세부내용은 노출하지 않음 (제목·소유자·진행률·상태)
 *  - 대내외비(혁신활동)는 제목을 CONFIDENTIAL 로 표기
 */

import { useEffect, useMemo, useState } from 'react';
import {
  getOrganizations,
  getAllUsers,
  getAllGoalsByYear,
  getAllOrgAnnualGoals,
  listInnovationActivities,
} from '@/lib/firestore';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { cn } from '@/lib/utils';
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import { ChevronDown, Lightbulb, FileText, Target, Lock } from 'lucide-react';
import type {
  Organization, User, Goal, AnnualGoal, InnovationActivity,
} from '@/types';

export default function CompanyProgressPage() {
  return (
    <AuthGuard allowedRoles={['MEMBER', 'TEAM_LEAD', 'EXECUTIVE', 'CEO']}>
      <div className="flex flex-col h-full">
        <Header title="전사 업무추진현황" />
        <CompanyProgressBody />
      </div>
    </AuthGuard>
  );
}

/**
 * 페이지 본문 — CEO 대시보드에서도 재사용
 * `withHeader` 옵션이 false 면 헤더 없이 본문만 렌더 (대시보드 임베드용)
 */
export function CompanyProgressBody({ embedded = false }: { embedded?: boolean } = {}) {
  return <Content embedded={embedded} />;
}

function Content({ embedded = false }: { embedded?: boolean }) {
  const { activeYear } = useActiveYear();
  const { userProfile } = useAuth();
  // 최고관리자(CEO) 는 대내외비도 정상 노출
  const revealConfidential = userProfile?.role === 'CEO';
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [annualGoals, setAnnualGoals] = useState<AnnualGoal[]>([]);
  const [innovations, setInnovations] = useState<InnovationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 부문 카드에서 열린 카테고리 — 행(row) 단위로 관리해 같은 행 카드가 동시에 열림. key=행 인덱스.
  const [openCat, setOpenCat] = useState<Record<number, 'done' | 'ongoing' | undefined>>({});
  // 반응형 그리드 열 수 (기본 1 / md≥768 2 / lg≥1024 3) — 행 계산용
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const calc = () => setCols(window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1);
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  // 열 수가 바뀌면 행 구성이 달라지므로 열림 상태 초기화
  useEffect(() => { setOpenCat({}); }, [cols]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const [o, u, g, ag, inv] = await Promise.all([
        getOrganizations(),
        getAllUsers(),
        getAllGoalsByYear(activeYear),
        getAllOrgAnnualGoals(activeYear),
        listInnovationActivities(activeYear),
      ]);
      setOrgs(o);
      setUsers(u);
      setGoals(g);
      setAnnualGoals(ag);
      setInnovations(inv);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [activeYear]);

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const orgsById = useMemo(() => new Map(orgs.map(o => [o.id, o])), [orgs]);

  // 부문/공장 목록 — DIVISION 우선, 없으면 최상위 (COMPANY 의 자식) 비-COMPANY 조직
  const divisions = useMemo(() => {
    const divList = orgs.filter(o => o.type === 'DIVISION');
    if (divList.length > 0) {
      return divList.sort(compareOrgByDisplayOrder);
    }
    // fallback: 부문 등록이 없는 환경에서는 최상위(부모가 COMPANY 이거나 없는) 비-COMPANY 조직을 사용
    const companyIds = new Set(orgs.filter(o => o.type === 'COMPANY').map(o => o.id));
    return orgs
      .filter(o => o.type !== 'COMPANY' && (!o.parentId || companyIds.has(o.parentId)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orgs]);

  // 부문/공장별 descendant orgIds
  function descendantOrgIds(rootId: string): string[] {
    const ids: string[] = [rootId];
    for (const c of orgs.filter(o => o.parentId === rootId)) {
      ids.push(...descendantOrgIds(c.id));
    }
    return ids;
  }

  // 부문별 핵심목표 — 임원 승인 이후(APPROVED/IN_PROGRESS/COMPLETED) 모두 표시. 세부 내용은 제외.
  // 공동 수행자가 다른 부문 소속이면 그 부문에서도 동일 목표가 노출됨 (relatedOrgIds 활용).
  function goalsForDivision(divId: string): Goal[] {
    const scopeIds = new Set(descendantOrgIds(divId));
    const VISIBLE = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETED']);
    return goals
      .filter(g => {
        if (!VISIBLE.has(g.status) || g.trashedAt || g.softDeletedAt) return false;
        if (scopeIds.has(g.organizationId)) return true;
        // relatedOrgIds 매칭 — 공동 수행자 소속 조직 포함
        if ((g.relatedOrgIds ?? []).some(orgId => scopeIds.has(orgId))) return true;
        return false;
      })
      // 완료된 업무를 상단으로 → 그 외(추진중)는 그 아래, 동일 그룹 내 제목순
      .sort((a, b) => {
        const ac = a.status === 'COMPLETED' ? 0 : 1;
        const bc = b.status === 'COMPLETED' ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return a.title.localeCompare(b.title);
      });
  }

  function annualGoalForOrg(orgId: string): AnnualGoal | undefined {
    return annualGoals.find(g => g.organizationId === orgId);
  }
  // 조직목표(연간목표) 주제 목록 — 신규 스키마(subject/detail) 우선, 구버전 content 호환.
  function subjectsForOrg(orgId: string): string[] {
    const ag = annualGoalForOrg(orgId);
    if (!ag) return [];
    if (ag.items && ag.items.length > 0) return ag.items.map(it => it.subject ?? it.content ?? '').filter(Boolean);
    return ag.content ? [ag.content] : [];
  }
  // 조직목표가 등록된 부문/공장만 노출 (#1: 조직목표 비어있으면 조직 자체를 표시하지 않음)
  const shownDivisions = useMemo(
    () => divisions.filter(d => subjectsForOrg(d.id).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [divisions, annualGoals],
  );

  return (
    <div className={embedded ? '' : 'flex-1 overflow-y-auto'}>
      <div className={cn('space-y-6', embedded ? '' : 'p-6 max-w-6xl')}>
        <p className="text-xs text-gray-400">{activeYear}년 · 세부 내용은 공유되지 않습니다. (목표명·팀·상태만 표시)</p>

        {/* ── 1. 혁신활동 (최상단) ────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-orange-500" />
            <h3 className="font-semibold text-gray-900">혁신활동</h3>
          </div>

          <div className="space-y-3">
            {/* 스마트 프로젝트 — 전체 폭, 접기 가능 */}
            {(() => {
              const spOpen = expanded['__sp'] ?? false;
              const list = innovations.filter(i => i.type === 'SMART_PROJECT');
              return (
                <div className="rounded-xl border bg-white overflow-hidden">
                  <button
                    onClick={() => setExpanded(p => ({ ...p, __sp: !spOpen }))}
                    className="w-full px-4 py-2.5 bg-orange-50 border-b flex items-center gap-2 hover:bg-orange-100/70 transition-colors"
                  >
                    <span className="text-sm font-semibold text-orange-700">스마트 프로젝트</span>
                    <span className="text-xs text-orange-500">{list.length}건</span>
                    <ChevronDown className={cn('h-4 w-4 text-orange-400 ml-auto shrink-0 transition-transform', !spOpen && '-rotate-90')} />
                  </button>
                  {spOpen && (loading
                    ? <div className="p-4 space-y-2">{[1,2].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}</div>
                    : list.length === 0
                      ? <p className="px-4 py-6 text-center text-sm text-gray-400">등록된 항목이 없습니다.</p>
                      : <div className="divide-y">{list.map(it => (
                          <InnovationRow key={it.id} item={it} usersById={usersById} revealConfidential={revealConfidential} />
                        ))}</div>
                  )}
                </div>
              );
            })()}

            {/* TDS — 스마트 프로젝트 아래, 2열 배치, 접기 가능 */}
            {(() => {
              const tdsOpen = expanded['__tds'] ?? false;
              const list = innovations.filter(i => i.type === 'TDS');
              return (
                <div className="rounded-xl border bg-white overflow-hidden">
                  <button
                    onClick={() => setExpanded(p => ({ ...p, __tds: !tdsOpen }))}
                    className="w-full px-4 py-2.5 bg-purple-50 border-b flex items-center gap-2 hover:bg-purple-100/70 transition-colors"
                  >
                    <FileText className="h-4 w-4 text-purple-600 shrink-0" />
                    <span className="text-sm font-semibold text-purple-700">TDS</span>
                    <span className="text-xs text-purple-500">{list.length}건</span>
                    <ChevronDown className={cn('h-4 w-4 text-purple-400 ml-auto shrink-0 transition-transform', !tdsOpen && '-rotate-90')} />
                  </button>
                  {tdsOpen && (loading
                    ? <div className="p-4 space-y-2">{[1,2].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}</div>
                    : list.length === 0
                      ? <p className="px-4 py-6 text-center text-sm text-gray-400">등록된 항목이 없습니다.</p>
                      : <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">{list.map(it => (
                          <div key={it.id} className="rounded-lg border bg-gray-50/50">
                            <InnovationRow item={it} usersById={usersById} revealConfidential={revealConfidential} compact />
                          </div>
                        ))}</div>
                  )}
                </div>
              );
            })()}
          </div>
        </section>

        {/* ── 2. 부문/공장별 업무목표추진현황 ─────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold text-gray-900">부문/공장별 업무목표추진현황</h3>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{[1,2,3].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-100" />)}</div>
          ) : shownDivisions.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8 rounded-xl border bg-white">조직목표가 등록된 부문/공장이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
              {shownDivisions.map((div, idx) => {
                const rowIndex = Math.floor(idx / cols);   // 같은 행 카드는 동일 rowIndex → 동시 열림
                const subjects = subjectsForOrg(div.id);
                const divGoals = goalsForDivision(div.id);
                const doneGoals = divGoals.filter(g => g.status === 'COMPLETED');
                const ongoingGoals = divGoals.filter(g => g.status !== 'COMPLETED');
                const cat = openCat[rowIndex];
                const shownGoals = cat === 'done' ? doneGoals : cat === 'ongoing' ? ongoingGoals : [];
                const toggle = (c: 'done' | 'ongoing') => setOpenCat(p => ({ ...p, [rowIndex]: p[rowIndex] === c ? undefined : c }));
                const goalRow = (g: Goal) => {
                  const ownerOrg = orgsById.get(g.organizationId);
                  const masked = g.isConfidential && !revealConfidential;
                  const titleText = masked ? 'CONFIDENTIAL (대내외비)' : g.title;
                  return (
                    <div key={g.id} className="px-3 py-2 flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-xs font-medium leading-snug break-words flex items-center gap-1.5', masked ? 'text-red-600' : 'text-gray-900')}>
                          {g.isConfidential && <Lock className="h-3 w-3 shrink-0" />}
                          {titleText}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5 truncate">{ownerOrg?.name ?? '—'}</p>
                      </div>
                      <span className="text-[10px] text-gray-500 shrink-0">{g.progress ?? 0}%</span>
                    </div>
                  );
                };
                return (
                  <div key={div.id} className="rounded-xl border bg-white overflow-hidden h-full flex flex-col">
                    {/* 상단: 부문명 + 조직목표 주제 */}
                    <div className="px-4 py-3 space-y-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{div.name}</p>
                      {subjects.map((s, idx) => (
                        <p key={idx} className="text-xs font-medium text-blue-800 leading-snug break-words">· {s}</p>
                      ))}
                    </div>

                    {/* 하단 고정 블록: 완료/추진중 2구역 버튼 + (그 아래로 열리는 선택 목표 목록) */}
                    <div className="mt-auto">
                    {/* 완료 / 추진중 2구역 (클릭 시 아래로 해당 목표 노출) */}
                    <div className="grid grid-cols-2 border-t divide-x">
                      <button
                        onClick={() => toggle('done')}
                        className={cn('flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors',
                          cat === 'done' ? 'bg-green-100 text-green-800' : 'text-green-700 hover:bg-green-50')}
                      >
                        완료 <span className="tabular-nums">{doneGoals.length}</span>
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', cat !== 'done' && '-rotate-90')} />
                      </button>
                      <button
                        onClick={() => toggle('ongoing')}
                        className={cn('flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors',
                          cat === 'ongoing' ? 'bg-blue-100 text-blue-800' : 'text-blue-700 hover:bg-blue-50')}
                      >
                        추진중 <span className="tabular-nums">{ongoingGoals.length}</span>
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', cat !== 'ongoing' && '-rotate-90')} />
                      </button>
                    </div>
                    {/* 선택된 카테고리 목표 목록 — 버튼 아래로 열림 */}
                    {cat && (
                      <div className="border-t">
                        {shownGoals.length === 0
                          ? <p className="px-3 py-3 text-xs text-gray-400">{cat === 'done' ? '완료된 목표가 없습니다.' : '추진 중인 목표가 없습니다.'}</p>
                          : <div className="divide-y">{shownGoals.map(goalRow)}</div>}
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function InnovationRow({ item, usersById, revealConfidential = false, compact = false }: { item: InnovationActivity; usersById: Map<string, User>; revealConfidential?: boolean; compact?: boolean }) {
  const masked = item.isConfidential && !revealConfidential;
  const displayName = masked ? 'CONFIDENTIAL' : item.name;
  return (
    <div className={cn('flex items-start gap-3', compact ? 'px-3 py-2 gap-2' : 'px-4 py-2.5')}>
      <span className={cn(
        'font-bold rounded-full shrink-0',
        compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5',
        item.status === 'COMPLETED' ? 'bg-green-100 text-green-700'
          : item.status === 'DROPPED' ? 'bg-gray-200 text-gray-600'
          : 'bg-blue-100 text-blue-700',
      )}>
        {item.status === 'COMPLETED' ? '완료' : item.status === 'DROPPED' ? 'Drop' : '추진중'}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'font-medium flex items-center gap-1.5',
          compact ? 'text-xs leading-snug break-words' : 'text-sm',
          masked ? 'text-red-600' : 'text-gray-900',
        )}>
          {item.isConfidential && <Lock className={compact ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5'} />}
          {displayName}
        </p>
        <p className={cn('text-gray-400 mt-0.5', compact ? 'text-[10px]' : 'text-xs')}>
          {item.type === 'SMART_PROJECT' ? (
            <>
              PM: {getPmIds(item).map(id => usersById.get(id)?.name).filter(Boolean).join(', ') || '—'}
              {(item.memberIds?.length ?? 0) > 0 && ` · 팀원 ${(item.memberIds ?? []).length}명`}
            </>
          ) : (
            <>
              수행자: {getPerformerIds(item).map(id => usersById.get(id)?.name).filter(Boolean).join(', ') || '—'}
              {' · '}지시자: {usersById.get(item.instructorId ?? '')?.name ?? '—'}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
