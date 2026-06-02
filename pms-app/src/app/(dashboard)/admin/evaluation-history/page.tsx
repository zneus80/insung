'use client';

import { useEffect, useState } from 'react';
import { getAllUsers, getOrganizations, getOrgEvaluations, getAllIndividualEvaluations } from '@/lib/firestore';
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
import { roleRank } from '@/lib/user-sort';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import AuthGuard from '@/components/layout/AuthGuard';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import type { User, Organization, IndividualEvaluation, OrganizationEvaluation, EvaluationGrade } from '@/types';

const GRADE_COLORS: Record<EvaluationGrade, string> = {
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-green-100 text-green-700',
  C: 'bg-yellow-100 text-yellow-700',
  D: 'bg-orange-100 text-orange-700',
  E: 'bg-red-100 text-red-700',
};

const YEARS = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

export default function EvaluationHistoryPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrMaster>
      <EvaluationHistoryContent />
    </AuthGuard>
  );
}

function EvaluationHistoryContent() {
  const { userProfile } = useAuth();
  const [selectedYear, setSelectedYear] = useState(YEARS[0]);
  const [evals, setEvals] = useState<IndividualEvaluation[]>([]);
  const [prevEvals, setPrevEvals] = useState<IndividualEvaluation[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [orgs, setOrgs] = useState<Record<string, Organization>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  // 비교 모드에서 표시할 당해년도 조직평가 등급
  const [orgEvalsForYear, setOrgEvalsForYear] = useState<OrganizationEvaluation[]>([]);
  // 기본은 부문/공장 우선순위 정렬(NONE = grade 정렬 미적용). 헤더 클릭 시 등급순으로 토글.
  const [sortByGrade, setSortByGrade] = useState<'NONE' | 'ASC' | 'DESC'>('NONE');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
      const [allUsers, allOrgs, realEvals] = await Promise.all([
        getAllUsers(),
        getOrganizations(),
        getAllIndividualEvaluations(selectedYear),
      ]);
      setUsers(Object.fromEntries(allUsers.map(u => [u.id, u])));
      setOrgs(Object.fromEntries(allOrgs.map(o => [o.id, o])));

      // 평가 대상 활성 사용자 — CEO·HR 전용 계정 제외하지 않고 전원 표시하되,
      // IE doc 가 없는 사용자는 'NOT_STARTED' 가상 row 로 합성 (평가이력 누락 방지)
      const haveIE = new Set(realEvals.map(e => e.userId));
      const virtualEvals: IndividualEvaluation[] = allUsers
        .filter(u => u.isActive !== false && !haveIE.has(u.id) && u.role !== 'CEO' && u.role !== 'EXECUTIVE')
        .map(u => ({
          id: `virtual_${u.id}_${selectedYear}`,
          userId: u.id,
          organizationId: u.organizationId,
          cycleYear: selectedYear,
          status: 'NOT_STARTED',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as IndividualEvaluation));

      setEvals([...realEvals, ...virtualEvals]);
      } catch (e: any) {
        console.error('평가이력 로드 실패:', e);
        toast.error('평가이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedYear]);

  // 비교 모드 — 전년도 개인평가 + 당해년도 조직평가 로딩
  useEffect(() => {
    if (!compareMode) {
      setPrevEvals([]);
      setOrgEvalsForYear([]);
      return;
    }
    let cancelled = false;
    async function loadCompareData() {
      setCompareLoading(true);
      try {
        const [prev, orgEvs] = await Promise.all([
          getAllIndividualEvaluations(selectedYear - 1),
          getOrgEvaluations(selectedYear),
        ]);
        if (cancelled) return;
        setPrevEvals(prev);
        setOrgEvalsForYear(orgEvs);
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    }
    loadCompareData();
    return () => { cancelled = true; };
  }, [compareMode, selectedYear]);

  // 조직 ID → 조직평가 등급(당해년도)
  const orgGradeById: Record<string, EvaluationGrade | undefined> = Object.fromEntries(
    orgEvalsForYear.map(e => [e.organizationId, e.grade])
  );

  // userId → 전년도 평가
  const prevByUser: Record<string, IndividualEvaluation> = Object.fromEntries(
    prevEvals.map(e => [e.userId, e])
  );

  // 사용자가 속한 TEAM(팀) 조직 객체 — 체인에서 가장 가까운 TEAM
  function getTeamOrg(orgId: string | undefined): Organization | null {
    if (!orgId) return null;
    let cur = orgs[orgId];
    while (cur) {
      if (cur.type === 'TEAM') return cur;
      cur = cur.parentId ? orgs[cur.parentId] : (undefined as any);
    }
    return null;
  }
  function getTeamName(orgId: string | undefined): string {
    return getTeamOrg(orgId)?.name ?? '-';
  }

  // 조직 체인 따라 올라가며 모든 상위 조직명 수집 (재경팀 → 재경본부 → 재경부문)
  function orgChainNames(orgId: string | undefined): string[] {
    if (!orgId) return [];
    const names: string[] = [];
    let cur = orgs[orgId];
    while (cur) {
      names.push(cur.name);
      cur = cur.parentId ? orgs[cur.parentId] : (undefined as any);
    }
    return names;
  }

  // 사용자가 속한 DIVISION(부문/공장) 을 조직 체인에서 찾음 — 없으면 최상위 비-COMPANY 조직
  function getDivisionOrg(orgId: string | undefined): Organization | null {
    if (!orgId) return null;
    let cur = orgs[orgId];
    let topmostNonCompany: Organization | null = null;
    while (cur) {
      if (cur.type === 'DIVISION') return cur;
      if (cur.type !== 'COMPANY') topmostNonCompany = cur;
      cur = cur.parentId ? orgs[cur.parentId] : (undefined as any);
    }
    return topmostNonCompany;
  }

  const filtered = evals
    .filter(e => {
      const user = users[e.userId];
      if (!user) return false;
      // 임원·CEO 는 평가 권한자이지 평가 대상자가 아님 — 이력에서 제외
      // (과거에 잘못 생성된 IE doc 가 있어도 화면에서 숨김)
      if (user.role === 'EXECUTIVE' || user.role === 'CEO') return false;
      // 텍스트 검색 — 이름, 이메일, 소속 체인 어느 하나라도 매칭
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const nameOk = user.name.toLowerCase().includes(q);
        const emailOk = user.email.toLowerCase().includes(q);
        const orgOk = orgChainNames(user.organizationId).some(n => n.toLowerCase().includes(q));
        if (!nameOk && !emailOk && !orgOk) return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (sortByGrade !== 'NONE') {
        const rank: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
        const av = a.execGrade ? rank[a.execGrade] : 99;
        const bv = b.execGrade ? rank[b.execGrade] : 99;
        if (av !== bv) return sortByGrade === 'ASC' ? av - bv : bv - av;
      }
      // 부문/공장 우선순위 → 팀 우선순위 → 직책 → 이름 가나다순
      const ua = users[a.userId];
      const ub = users[b.userId];
      const da = getDivisionOrg(ua?.organizationId);
      const db = getDivisionOrg(ub?.organizationId);
      if (da && db) {
        const cmp = compareOrgByDisplayOrder(da, db);
        if (cmp !== 0) return cmp;
      } else if (da) return -1;
      else if (db) return 1;
      // 팀 우선순위 (팀 없음을 먼저, 그 다음 displayOrder)
      const ta = getTeamOrg(ua?.organizationId);
      const tb = getTeamOrg(ub?.organizationId);
      if (!ta && tb) return -1;
      if (ta && !tb) return 1;
      if (ta && tb) {
        const cmp = compareOrgByDisplayOrder(ta, tb);
        if (cmp !== 0) return cmp;
      }
      // 역할 우선순위 (임원 → 팀장 → 팀원) → 입사일 → 이름
      const ra = roleRank(ua?.role);
      const rb = roleRank(ub?.role);
      if (ra !== rb) return ra - rb;
      const ha = ua?.hireDate ?? '';
      const hb = ub?.hireDate ?? '';
      if (ha && !hb) return -1;
      if (!ha && hb) return 1;
      if (ha !== hb) return ha.localeCompare(hb);
      return (ua?.name ?? '').localeCompare(ub?.name ?? '', 'ko');
    });

  // 사용자의 조직 체인에 본부(HEADQUARTERS)가 포함되는지 판별
  function hasHQInChain(userId: string): boolean {
    const user = users[userId];
    if (!user) return false;
    let cur = orgs[user.organizationId];
    while (cur) {
      if (cur.type === 'HEADQUARTERS') return true;
      cur = cur.parentId ? orgs[cur.parentId] : (undefined as any);
    }
    return false;
  }
  // 필터링된 결과 중 한 명이라도 HQ 체인이 있으면 본부장 컬럼 표시
  const showHqColumn = filtered.some(e => hasHQInChain(e.userId));

  return (
    <div className="flex flex-col h-full">
      <Header title="평가이력 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* 필터 */}
        <div className="flex gap-3 items-center flex-wrap">
          <div className="flex gap-1">
            {YEARS.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedYear === y ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {y}년
              </button>
            ))}
          </div>
          <SearchInput
            placeholder="이름·이메일·소속 검색"
            value={search}
            onChange={setSearch}
            className="max-w-xs"
          />
          <button
            type="button"
            onClick={() => setCompareMode(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              compareMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title={`${selectedYear}년 vs ${selectedYear - 1}년 비교`}
          >
            {compareMode ? `비교 해제` : `${selectedYear - 1}년과 비교`}
          </button>
          {compareMode && (
            <button
              type="button"
              onClick={() => {
                const rows = filtered.map(e => {
                  const user = users[e.userId];
                  const div = getDivisionOrg(user?.organizationId);
                  const prev = prevByUser[e.userId];
                  const orgGrade = div ? orgGradeById[div.id] : undefined;
                  return {
                    '부문/공장': div?.name ?? '-',
                    '조직평가등급': orgGrade ?? '-',
                    '이름': user?.name ?? '-',
                    '팀': getTeamName(user?.organizationId),
                    '직책': user?.position ?? '-',
                    [`${selectedYear}년 최종등급`]: e.execGrade ?? '-',
                    [`${selectedYear - 1}년 최종등급`]: prev?.execGrade ?? '-',
                    '임원 최종등급의견': e.execComment?.trim() ?? '',
                  };
                });
                const ws = XLSX.utils.json_to_sheet(rows);
                // 같은 부문/공장 셀 병합 (부문/공장: A열=0, 조직평가등급: B열=1). row 0 = 헤더
                const merges: XLSX.Range[] = [];
                let s = 1;
                while (s <= rows.length) {
                  let e = s;
                  while (e < rows.length && rows[e]['부문/공장'] === rows[s - 1]['부문/공장']) e++;
                  if (e > s) {
                    merges.push({ s: { r: s, c: 0 }, e: { r: e, c: 0 } });
                    merges.push({ s: { r: s, c: 1 }, e: { r: e, c: 1 } });
                  }
                  s = e + 1;
                }
                ws['!merges'] = merges;
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, '평가 비교');
                XLSX.writeFile(wb, `평가비교_${selectedYear}vs${selectedYear - 1}_${format(new Date(), 'yyyyMMdd')}.xlsx`);
              }}
              disabled={loading || compareLoading || filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Excel
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">총 {filtered.length}명</span>
        </div>

        {/* 테이블 */}
        {compareMode ? (() => {
          // 부문/공장 그룹별 첫 행과 span 계산 — filtered 는 이미 부문/공장 순으로 정렬됨
          const divIdByRow = filtered.map(e => getDivisionOrg(users[e.userId]?.organizationId)?.id ?? '');
          const groupSpan: Record<number, number> = {};
          const isFirstInGroup: Record<number, boolean> = {};
          let i = 0;
          while (i < filtered.length) {
            let j = i;
            while (j < filtered.length && divIdByRow[j] === divIdByRow[i]) j++;
            isFirstInGroup[i] = true;
            groupSpan[i] = j - i;
            i = j;
          }
          return (
          <div className="rounded-xl border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">부문/공장</th>
                  <th className="px-4 py-3 text-center">조직평가등급</th>
                  <th className="px-4 py-3 text-left">이름</th>
                  <th className="px-4 py-3 text-left">팀</th>
                  <th className="px-4 py-3 text-left">직책</th>
                  <th className="px-4 py-3 text-center">{selectedYear}년 최종등급</th>
                  <th className="px-4 py-3 text-center">{selectedYear - 1}년 최종등급</th>
                  <th className="px-4 py-3 text-left">임원 최종등급의견</th>
                </tr>
              </thead>
              <tbody>
                {(loading || compareLoading) ? (
                  [1, 2, 3].map(i => (
                    <tr key={i}>
                      <td colSpan={8} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-100" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">
                      {selectedYear}년 평가 데이터가 없습니다.
                    </td>
                  </tr>
                ) : filtered.map((e, idx) => {
                  const user = users[e.userId];
                  const div = getDivisionOrg(user?.organizationId);
                  const teamName = getTeamName(user?.organizationId);
                  const prev = prevByUser[e.userId];
                  const orgGrade = div ? orgGradeById[div.id] : undefined;
                  const firstInGroup = !!isFirstInGroup[idx];
                  const isGroupBoundary = firstInGroup && idx > 0;
                  const rowBorder = isGroupBoundary ? 'border-t-2 border-gray-300' : 'border-t border-gray-100';
                  return (
                    <tr key={e.id} className={`hover:bg-gray-50 ${rowBorder}`}>
                      {firstInGroup && (
                        <td
                          rowSpan={groupSpan[idx]}
                          className="px-4 py-3 text-gray-700 font-medium align-middle bg-gray-50/50 border-r border-gray-200"
                        >
                          {div?.name ?? '-'}
                        </td>
                      )}
                      {firstInGroup && (
                        <td
                          rowSpan={groupSpan[idx]}
                          className="px-4 py-3 text-center align-middle bg-gray-50/50 border-r border-gray-200"
                        >
                          {orgGrade ? (
                            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLORS[orgGrade]}`}>
                              {orgGrade}
                            </span>
                          ) : <span className="text-gray-300">-</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {user ? <MemberInfoModal userId={user.id} userName={user.name} /> : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{teamName}</td>
                      <td className="px-4 py-3 text-gray-500">{user?.position ?? '-'}</td>
                      <td className="px-4 py-3 text-center">
                        {e.execGrade ? (
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLORS[e.execGrade]}`}>
                            {e.execGrade}
                          </span>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {prev?.execGrade ? (
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLORS[prev.execGrade]}`}>
                            {prev.execGrade}
                          </span>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs whitespace-pre-wrap max-w-md">
                        {e.execComment?.trim() ? e.execComment : <span className="text-gray-300">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })() : (
        <div className="rounded-xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-3 text-left">이름</th>
                <th className="px-4 py-3 text-left">부서</th>
                <th className="px-4 py-3 text-left">직책</th>
                <th className="px-4 py-3 text-center">팀장 의견 등급</th>
                {showHqColumn && (
                  <th className="px-4 py-3 text-center">본부장 의견 등급</th>
                )}
                <th className="px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setSortByGrade(s => s === 'ASC' ? 'DESC' : s === 'DESC' ? 'NONE' : 'ASC')}
                    className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 font-semibold"
                    title="등급순 정렬"
                  >
                    최종 등급
                    <span className="text-[10px]">
                      {sortByGrade === 'ASC' ? '↑ A→E' : sortByGrade === 'DESC' ? '↓ E→A' : '↕'}
                    </span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left">확정일</th>
                <th className="px-4 py-3 text-left">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3].map(i => (
                  <tr key={i}>
                    <td colSpan={showHqColumn ? 8 : 7} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-gray-100" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={showHqColumn ? 8 : 7} className="px-4 py-8 text-center text-gray-400 text-sm">
                    {selectedYear}년 평가 데이터가 없습니다.
                  </td>
                </tr>
              ) : filtered.map(e => {
                const user = users[e.userId];
                const org = orgs[user?.organizationId ?? ''];
                const rowHasHQ = hasHQInChain(e.userId);
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {user ? <MemberInfoModal userId={user.id} userName={user.name} /> : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{org?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{user?.position ?? '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {e.leadGrade ? (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${GRADE_COLORS[e.leadGrade]}`}>
                          {e.leadGrade}
                        </span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    {showHqColumn && (
                      <td className="px-4 py-3 text-center">
                        {!rowHasHQ ? (
                          <span className="text-gray-300" title="본부 단계 없음">—</span>
                        ) : e.hqGrade ? (
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${GRADE_COLORS[e.hqGrade]}`}>
                            {e.hqGrade}
                          </span>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      {e.execGrade ? (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLORS[e.execGrade]}`}>
                          {e.execGrade}
                        </span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {e.execConfirmedAt ? format(e.execConfirmedAt, 'yy.MM.dd', { locale: ko }) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        e.status === 'PUBLISHED' ? 'bg-green-100 text-green-700' :
                        e.status === 'EXEC_CONFIRMED' ? 'bg-blue-100 text-blue-700' :
                        e.status === 'HQ_REVIEWED' ? 'bg-indigo-100 text-indigo-700' :
                        e.status === 'LEAD_REVIEWED' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {e.status === 'PUBLISHED' ? '공개완료' :
                         e.status === 'EXEC_CONFIRMED' ? '등급확정' :
                         e.status === 'HQ_REVIEWED' ? '본부장검토' :
                         e.status === 'LEAD_REVIEWED' ? '팀장검토' :
                         e.status === 'SELF_SUBMITTED' ? '자기평가완료' : '미시작'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}
