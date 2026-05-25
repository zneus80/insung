'use client';

/**
 * 전사 업무추진현황
 * 접근: MEMBER, TEAM_LEAD, EXECUTIVE, CEO 모두
 * 표시:
 *  - 부문/공장(DIVISION)별 연간목표 + 그 산하 팀장·팀원의 핵심목표(추진중·완료) 리스트
 *  - 혁신활동: 스마트 프로젝트 / TDS (HR 입력)
 *  - 세부내용은 노출하지 않음 (제목·소유자·진행률·상태)
 *  - 대내비(혁신활동)는 제목을 CONFIDENTIAL 로 표기
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
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { cn } from '@/lib/utils';
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
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
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [annualGoals, setAnnualGoals] = useState<AnnualGoal[]>([]);
  const [innovations, setInnovations] = useState<InnovationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
  // 공동 추진자가 다른 부문 소속이면 그 부문에서도 동일 목표가 노출됨 (relatedOrgIds 활용).
  function goalsForDivision(divId: string): Goal[] {
    const scopeIds = new Set(descendantOrgIds(divId));
    const VISIBLE = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETED']);
    return goals
      .filter(g => {
        if (!VISIBLE.has(g.status) || g.trashedAt || g.softDeletedAt) return false;
        if (scopeIds.has(g.organizationId)) return true;
        // relatedOrgIds 매칭 — 공동 추진자 소속 조직 포함
        if ((g.relatedOrgIds ?? []).some(orgId => scopeIds.has(orgId))) return true;
        return false;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  function annualGoalForOrg(orgId: string): AnnualGoal | undefined {
    return annualGoals.find(g => g.organizationId === orgId);
  }

  return (
    <div className={embedded ? '' : 'flex-1 overflow-y-auto'}>
      <div className={cn('space-y-6', embedded ? '' : 'p-6 max-w-6xl')}>
        <p className="text-xs text-gray-400">{activeYear}년 · 세부 내용은 공유되지 않습니다. (목표명·소유자·상태만 표시)</p>

        {/* ── 1. 혁신활동 (최상단) ────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-orange-500" />
            <h3 className="font-semibold text-gray-900">혁신활동</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 스마트 프로젝트 */}
            <div className="rounded-xl border bg-white overflow-hidden">
              <div className="px-4 py-2.5 bg-orange-50 border-b flex items-center gap-2">
                <span className="text-sm font-semibold text-orange-700">스마트 프로젝트</span>
                <span className="text-xs text-orange-500">
                  {innovations.filter(i => i.type === 'SMART_PROJECT').length}건
                </span>
              </div>
              {(() => {
                const list = innovations.filter(i => i.type === 'SMART_PROJECT');
                if (loading) return <div className="p-4 space-y-2">{[1,2].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}</div>;
                if (list.length === 0) return <p className="px-4 py-6 text-center text-sm text-gray-400">등록된 항목이 없습니다.</p>;
                return (
                  <div className="divide-y">
                    {list.map(it => (
                      <InnovationRow key={it.id} item={it} usersById={usersById} />
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* TDS */}
            <div className="rounded-xl border bg-white overflow-hidden">
              <div className="px-4 py-2.5 bg-purple-50 border-b flex items-center gap-2">
                <FileText className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-semibold text-purple-700">TDS</span>
                <span className="text-xs text-purple-500">
                  {innovations.filter(i => i.type === 'TDS').length}건
                </span>
              </div>
              {(() => {
                const list = innovations.filter(i => i.type === 'TDS');
                if (loading) return <div className="p-4 space-y-2">{[1,2].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}</div>;
                if (list.length === 0) return <p className="px-4 py-6 text-center text-sm text-gray-400">등록된 항목이 없습니다.</p>;
                return (
                  <div className="divide-y">
                    {list.map(it => (
                      <InnovationRow key={it.id} item={it} usersById={usersById} />
                    ))}
                  </div>
                );
              })()}
            </div>
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
          ) : divisions.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8 rounded-xl border bg-white">등록된 부문/공장이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
              {divisions.map(div => {
                const ag = annualGoalForOrg(div.id);
                const items = ag?.items ?? (ag?.content ? [{ id: 'legacy', content: ag.content }] : []);
                const divGoals = goalsForDivision(div.id);
                const isOpen = expanded[div.id] ?? true;
                return (
                  <div key={div.id} className="rounded-xl border bg-white overflow-hidden">
                    <button
                      onClick={() => setExpanded(p => ({ ...p, [div.id]: !isOpen }))}
                      className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{div.name}</p>
                      </div>
                      <ChevronDown className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform', !isOpen && '-rotate-90')} />
                    </button>
                    {isOpen && (
                      <div className="border-t">
                        {/* 연간 목표 */}
                        {items.length > 0 && (
                          <div className="px-3 py-2 bg-blue-50/30 border-b space-y-0.5">
                            <p className="text-[11px] font-semibold text-blue-700">연간 목표</p>
                            <ul className="space-y-0.5">
                              {items.map(item => (
                                <li key={item.id} className="text-xs text-gray-700 leading-snug">· {item.content}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* 핵심목표 리스트 */}
                        {divGoals.length === 0 ? (
                          <p className="px-3 py-3 text-xs text-gray-400">추진 중/완료 목표 없음</p>
                        ) : (
                          <div className="divide-y">
                            {divGoals.map(g => {
                              const owner = usersById.get(g.userId);
                              const ownerOrg = orgsById.get(g.organizationId);
                              return (
                                <div key={g.id} className="px-3 py-2 flex items-start gap-2">
                                  <span className={cn(
                                    'text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0',
                                    g.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700',
                                  )}>
                                    {g.status === 'COMPLETED' ? '완료' : '추진중'}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-gray-900 leading-snug break-words">{g.title}</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                                      {owner?.name ?? '—'}
                                      {ownerOrg ? ` · ${ownerOrg.name}` : ''}
                                    </p>
                                  </div>
                                  <span className="text-[10px] text-gray-500 shrink-0">{g.progress ?? 0}%</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
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

function InnovationRow({ item, usersById }: { item: InnovationActivity; usersById: Map<string, User> }) {
  const displayName = item.isConfidential ? 'CONFIDENTIAL' : item.name;
  return (
    <div className="px-4 py-2.5 flex items-start gap-3">
      <span className={cn(
        'text-xs font-bold rounded-full px-2 py-0.5 shrink-0',
        item.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700',
      )}>
        {item.status === 'COMPLETED' ? '완료' : '추진중'}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium flex items-center gap-1.5',
          item.isConfidential ? 'text-red-600' : 'text-gray-900',
        )}>
          {item.isConfidential && <Lock className="h-3.5 w-3.5" />}
          {displayName}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {item.type === 'SMART_PROJECT' ? (
            <>
              PM: {usersById.get(item.pmId ?? '')?.name ?? '—'}
              {(item.memberIds?.length ?? 0) > 0 && ` · 팀원 ${(item.memberIds ?? []).length}명`}
            </>
          ) : (
            <>
              수행자: {usersById.get(item.performerId ?? '')?.name ?? '—'}
              {' · '}지시자: {usersById.get(item.instructorId ?? '')?.name ?? '—'}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
