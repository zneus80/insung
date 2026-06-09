'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getAllUsers, getOrganizations, getAllMileages, getAllAwards,
  getAllIndividualEvaluations, getMentoringFormsByUsers, listAllInnovationActivities,
} from '@/lib/firestore';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
import { roleRank } from '@/lib/user-sort';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import MentoringFormModal from '@/components/evaluation/MentoringFormModal';
import { ChevronsUpDown, ChevronUp, ChevronDown, Search, Users as UsersIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  User, Organization, Mileage, Award, IndividualEvaluation, MentoringForm,
  EvaluationGrade, JobRequestType,
} from '@/types';

const GRADE_COLOR: Record<EvaluationGrade, string> = {
  A: 'bg-emerald-100 text-emerald-700',
  B: 'bg-blue-100   text-blue-700',
  C: 'bg-gray-100   text-gray-600',
  D: 'bg-orange-100 text-orange-700',
  E: 'bg-red-100    text-red-700',
};

const JOB_REQUEST_LABELS: Record<JobRequestType, string> = {
  EXPAND:    '직무 확대',
  REDUCE:    '직무 축소',
  CHANGE:    '직무 변경',
  RELOCATE:  '근무지 이동',
  SATISFIED: '만족함',
};
const JOB_REQUEST_COLOR: Record<JobRequestType, string> = {
  EXPAND:    'bg-blue-50    text-blue-700',
  REDUCE:    'bg-yellow-50  text-yellow-700',
  CHANGE:    'bg-orange-50  text-orange-700',
  RELOCATE:  'bg-purple-50  text-purple-700',
  SATISFIED: 'bg-green-50   text-green-700',
};

const ROLE_LABEL: Record<string, string> = {
  CEO: '최고관리자', EXECUTIVE: '임원', TEAM_LEAD: '팀장', MEMBER: '팀원',
};

type SortKey =
  | 'name' | 'org' | 'division' | 'position' | 'hireDate'
  | 'eval' | 'mileage' | 'mileageYear' | 'awards' | 'promotion' | 'jobRequest';
type SortDir = 'asc' | 'desc';

// ── 5년 이내 포상 판별 ────────────────────────────
function isWithin5Years(dateStr: string, now: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  return d >= fiveYearsAgo;
}

// ── 승진요건 계산 ────────────────────────────
interface PromotionInfo {
  target: '팀장 승진' | '임원 승진' | '해당 없음';
  pmCount: number;
  memberCount: number;
  totalPoints: number;
  meetsRequirement: boolean;
  /** UI 텍스트 — 미충족 사유 (충족 시 빈 문자열) */
  reasonText: string;
}

/** 사용자별 혁신활동(스마트프로젝트) 참여 카운트 */
interface SmartProjectCount {
  pmCount: number;       // SMART_PROJECT 에 PM 으로 참여
  memberCount: number;   // SMART_PROJECT 에 멤버로 참여
}

function computePromotion(user: User, mileage: Mileage | undefined, sp: SmartProjectCount): PromotionInfo {
  // 스마트프로젝트 카운트는 innovationActivities 직접 집계 (mileage entries 가 아님)
  const pmCount = sp.pmCount;
  const memberCount = sp.memberCount;
  const totalPoints = mileage?.points ?? 0;

  if (user.role === 'CEO' || user.role === 'EXECUTIVE') {
    return { target: '해당 없음', pmCount, memberCount, totalPoints, meetsRequirement: false, reasonText: '' };
  }

  // 정식 팀장 (대행이 아닌) → 임원 승진 요건
  // 팀장대행 (isActingLead === true) → 정식 직급은 팀원이므로 팀장 승진 요건 표기
  if (user.role === 'TEAM_LEAD' && !user.isActingLead) {
    // 임원 승진 — PM 1+
    const meets = pmCount >= 1;
    return {
      target: '임원 승진', pmCount, memberCount, totalPoints,
      meetsRequirement: meets,
      reasonText: meets ? '' : `스마트프로젝트 PM 0/1`,
    };
  }
  // MEMBER 또는 팀장대행 → 팀장 승진 — 스마트프로젝트 1+ (PM or MEMBER) + 마일리지 200+
  const projectCount = pmCount + memberCount;
  const meetsProject = projectCount >= 1;
  const meetsMileage = totalPoints >= 200;
  const meets = meetsProject && meetsMileage;
  const reasons: string[] = [];
  if (!meetsProject) reasons.push(`스마트프로젝트 ${projectCount}/1`);
  if (!meetsMileage) reasons.push(`마일리지 ${totalPoints}/200`);
  return {
    target: '팀장 승진', pmCount, memberCount, totalPoints,
    meetsRequirement: meets,
    reasonText: reasons.join(', '),
  };
}

// ── 연간 마일리지 합계 (entries 의 createdAt 기준) ────────
function getYearMileage(mileage: Mileage | undefined, year: number): number {
  if (!mileage?.entries) return 0;
  return mileage.entries
    .filter(e => new Date(e.createdAt).getFullYear() === year)
    .reduce((sum, e) => sum + (e.points ?? 0), 0);
}

// ── 행 통합 객체 ────────────────────────────
interface MemberRow {
  user: User;
  orgName: string;
  orgChain: string[];          // 부모-자식 체인 (필터링용)
  hireDate: string;
  evals: Record<number, EvaluationGrade | null>;
  mileage: Mileage | undefined;
  mileagePoints: number;
  mileageYearPoints: number;
  recentAwards: Award[];
  promotion: PromotionInfo;
  latestMentoring?: MentoringForm;     // 가장 최신 육성면담서 (없으면 undefined)
  jobRequest?: JobRequestType;
  jobRequestLabel: string;
  jobRequestYear?: number;             // 최신 육성면담서의 작성 연도
}

export default function AllMembersPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrMaster>
      <AllMembersContent />
    </AuthGuard>
  );
}

function AllMembersContent() {
  const { activeYear } = useActiveYear();
  const yearsToShow = [activeYear, activeYear - 1, activeYear - 2]; // 최신 → 과거

  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [mileages, setMileages] = useState<Mileage[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [evalsByYear, setEvalsByYear] = useState<Record<number, Record<string, IndividualEvaluation>>>({});
  const [spCountByUser, setSpCountByUser] = useState<Map<string, SmartProjectCount>>(new Map());
  // 사용자별 가장 최신 작성 육성면담서 (최근 3개 연도 중)
  const [latestMentoringByUser, setLatestMentoringByUser] = useState<Record<string, MentoringForm>>({});
  const [loading, setLoading] = useState(true);

  // 검색/정렬/필터
  const [search, setSearch] = useState('');
  // 기본 정렬: 부문/공장 우선순위(displayOrder) → 본부 → 팀 → 이름
  const [sortKey, setSortKey] = useState<SortKey>('division');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterOrg, setFilterOrg] = useState<string>('ALL');     // 부모 조직 ID (산하 전체 포함)
  const [filterRole, setFilterRole] = useState<string>('ALL');
  const [filterPromotion, setFilterPromotion] = useState<string>('ALL');  // 'MEETS' | 'NOT_MEETS' | 'NA' | 'ALL'

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [allUsers, allOrgs, allMileages, allAwards, allInnovations, ...evalLists] = await Promise.all([
          getAllUsers(),
          getOrganizations(),
          getAllMileages(),
          getAllAwards(),
          listAllInnovationActivities(), // 승진 요건(누적 PM)은 연도 무관 — 전체 연도 집계
          ...yearsToShow.map(y => getAllIndividualEvaluations(y)),
        ]);
        // 사용자별 스마트프로젝트 PM/멤버 카운트 (innovationActivities 직접 집계)
        const spCountByUser = new Map<string, SmartProjectCount>();
        for (const a of allInnovations) {
          if (a.type !== 'SMART_PROJECT') continue;
          for (const uid of getPmIds(a)) {
            const c = spCountByUser.get(uid) ?? { pmCount: 0, memberCount: 0 };
            c.pmCount++; spCountByUser.set(uid, c);
          }
          for (const uid of (a.memberIds ?? [])) {
            const c = spCountByUser.get(uid) ?? { pmCount: 0, memberCount: 0 };
            c.memberCount++; spCountByUser.set(uid, c);
          }
        }
        setSpCountByUser(spCountByUser);
        // 임원·CEO 는 평가·승진 대상이 아니므로 전사 인원현황에서 제외
        const activeUsers = allUsers.filter(u =>
          u.isActive !== false &&
          u.role !== 'EXECUTIVE' &&
          u.role !== 'CEO'
        );
        setUsers(activeUsers);
        setOrgs(allOrgs);
        setMileages(allMileages);
        setAwards(allAwards);

        const evalsByYearMap: Record<number, Record<string, IndividualEvaluation>> = {};
        yearsToShow.forEach((y, i) => {
          const map: Record<string, IndividualEvaluation> = {};
          evalLists[i].forEach(ie => { map[ie.userId] = ie; });
          evalsByYearMap[y] = map;
        });
        setEvalsByYear(evalsByYearMap);

        // 최근 3개 연도 육성면담서 — 가장 최신(연도 큰 것) 우선
        const uids = activeUsers.map(u => u.id);
        const mfYearLists = await Promise.all(
          yearsToShow.map(y => getMentoringFormsByUsers(uids, y)),
        );
        const latestMap: Record<string, MentoringForm> = {};
        // yearsToShow 는 [올해, -1, -2] 순 (내림차순) — 먼저 본 것이 최신
        mfYearLists.forEach(list => {
          list.forEach(mf => {
            if (!latestMap[mf.userId]) latestMap[mf.userId] = mf;
          });
        });
        setLatestMentoringByUser(latestMap);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeYear]);

  // ── 조직 헬퍼 ────────────────────────────
  const orgsById = useMemo(() => Object.fromEntries(orgs.map(o => [o.id, o])), [orgs]);
  function getOrgChain(orgId: string): string[] {
    const chain: string[] = [];
    let cur = orgsById[orgId];
    while (cur) {
      chain.push(cur.id);
      cur = cur.parentId ? orgsById[cur.parentId] : (undefined as any);
    }
    return chain;
  }
  function getOrgName(orgId: string): string {
    return orgsById[orgId]?.name ?? '—';
  }

  // 부모 후보 (필터용) — 최상위 + 1단계 하위 (DIVISION 까지). DIVISION 은 displayOrder 정렬.
  const filterOrgOptions = useMemo(() => {
    const topLevel = orgs.filter(o => !o.parentId).slice().sort(compareOrgByDisplayOrder);
    const divs = orgs
      .filter(o => topLevel.some(t => t.id === o.parentId))
      .slice()
      .sort(compareOrgByDisplayOrder);
    return [...topLevel, ...divs];
  }, [orgs]);

  // ── 행 빌드 ────────────────────────────
  const mileagesByUser = useMemo(
    () => Object.fromEntries(mileages.map(m => [m.userId, m])),
    [mileages],
  );
  const awardsByUser = useMemo(() => {
    const m: Record<string, Award[]> = {};
    awards.forEach(a => { (m[a.userId] ??= []).push(a); });
    return m;
  }, [awards]);

  const now = new Date();

  const rows: MemberRow[] = useMemo(() => {
    return users.map(u => {
      const userMileage = mileagesByUser[u.id];
      const userAwards = awardsByUser[u.id] ?? [];
      const recentAwards = userAwards.filter(a => isWithin5Years(a.awardDate, now));
      const evals: Record<number, EvaluationGrade | null> = {};
      yearsToShow.forEach(y => {
        evals[y] = (evalsByYear[y]?.[u.id]?.execGrade as EvaluationGrade | undefined) ?? null;
      });
      const mentoring = latestMentoringByUser[u.id];
      const jobReq = mentoring?.jobRequest as JobRequestType | undefined;
      return {
        user: u,
        orgName: getOrgName(u.organizationId),
        orgChain: getOrgChain(u.organizationId),
        hireDate: u.hireDate ?? '',
        evals,
        mileage: userMileage,
        mileagePoints: userMileage?.points ?? 0,
        mileageYearPoints: getYearMileage(userMileage, activeYear),
        recentAwards,
        promotion: computePromotion(u, userMileage, spCountByUser.get(u.id) ?? { pmCount: 0, memberCount: 0 }),
        latestMentoring: mentoring,
        jobRequest: jobReq,
        jobRequestLabel: jobReq ? JOB_REQUEST_LABELS[jobReq] : '',
        jobRequestYear: mentoring?.cycleYear,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, mileagesByUser, awardsByUser, evalsByYear, latestMentoringByUser, orgsById, activeYear, spCountByUser]);

  // ── 필터 + 검색 + 정렬 ────────────────────────────
  const visibleRows = useMemo(() => {
    let arr = rows;
    if (filterOrg !== 'ALL') {
      arr = arr.filter(r => r.orgChain.includes(filterOrg));
    }
    if (filterRole !== 'ALL') {
      arr = arr.filter(r => r.user.role === filterRole);
    }
    if (filterPromotion !== 'ALL') {
      arr = arr.filter(r => {
        if (filterPromotion === 'MEETS') return r.promotion.meetsRequirement;
        if (filterPromotion === 'NOT_MEETS') return r.promotion.target !== '해당 없음' && !r.promotion.meetsRequirement;
        if (filterPromotion === 'NA') return r.promotion.target === '해당 없음';
        return true;
      });
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      arr = arr.filter(r => {
        if (r.user.name?.toLowerCase().includes(s)) return true;
        if ((r.user.position ?? '').toLowerCase().includes(s)) return true;
        // 조직 체인 (소속 팀 → 본부 → 부문 등) 의 어떤 이름이라도 매칭
        return r.orgChain.some(oid => (orgsById[oid]?.name ?? '').toLowerCase().includes(s));
      });
    }
    // 사용자가 속한 DIVISION(부문/공장) 찾기 — 없으면 최상위 비-COMPANY 조직
    function getDivisionOrg(orgId: string | undefined) {
      if (!orgId) return null;
      let cur = orgsById[orgId];
      let topNonCompany: Organization | null = null;
      while (cur) {
        if (cur.type === 'DIVISION') return cur;
        if (cur.type !== 'COMPANY') topNonCompany = cur;
        cur = cur.parentId ? orgsById[cur.parentId] : (undefined as any);
      }
      return topNonCompany;
    }
    arr = [...arr].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':       cmp = a.user.name.localeCompare(b.user.name, 'ko'); break;
        case 'org':        cmp = a.orgName.localeCompare(b.orgName, 'ko'); break;
        case 'division': {
          const da = getDivisionOrg(a.user.organizationId);
          const db = getDivisionOrg(b.user.organizationId);
          if (da && db) cmp = compareOrgByDisplayOrder(da, db);
          else if (da) cmp = -1;
          else if (db) cmp = 1;
          // 같은 부문 내 — 직속 조직명 → 역할(팀장→팀원) → 입사일 → 이름
          if (cmp === 0) cmp = a.orgName.localeCompare(b.orgName, 'ko');
          if (cmp === 0) cmp = roleRank(a.user.role) - roleRank(b.user.role);
          if (cmp === 0) cmp = (a.hireDate || '9999').localeCompare(b.hireDate || '9999');
          break;
        }
        case 'position':   cmp = (a.user.position ?? '').localeCompare(b.user.position ?? '', 'ko'); break;
        case 'hireDate':   cmp = a.hireDate.localeCompare(b.hireDate); break;
        case 'eval':       {
          const gradeRank: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
          const ag = a.evals[activeYear]; const bg = b.evals[activeYear];
          cmp = (ag ? gradeRank[ag] : 99) - (bg ? gradeRank[bg] : 99);
          break;
        }
        case 'mileage':     cmp = a.mileagePoints - b.mileagePoints; break;
        case 'mileageYear': cmp = a.mileageYearPoints - b.mileageYearPoints; break;
        case 'awards':      cmp = a.recentAwards.length - b.recentAwards.length; break;
        case 'promotion':   {
          const aRank = a.promotion.target === '해당 없음' ? 2 : a.promotion.meetsRequirement ? 0 : 1;
          const bRank = b.promotion.target === '해당 없음' ? 2 : b.promotion.meetsRequirement ? 0 : 1;
          cmp = aRank - bRank;
          break;
        }
        case 'jobRequest':  cmp = a.jobRequestLabel.localeCompare(b.jobRequestLabel, 'ko'); break;
      }
      if (cmp === 0) cmp = a.user.name.localeCompare(b.user.name, 'ko');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, filterOrg, filterRole, filterPromotion, search, sortKey, sortDir, activeYear]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }
  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-1 text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp className="inline h-3 w-3 ml-1 text-blue-600" />
      : <ChevronDown className="inline h-3 w-3 ml-1 text-blue-600" />;
  }

  function clearFilters() {
    setSearch(''); setFilterOrg('ALL'); setFilterRole('ALL'); setFilterPromotion('ALL');
    setSortKey('division'); setSortDir('asc');
  }
  const hasActiveFilter = !!search || filterOrg !== 'ALL' || filterRole !== 'ALL' || filterPromotion !== 'ALL';

  return (
    <div className="flex flex-col h-full">
      <Header title="전사 인원현황" />
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-6 overflow-hidden">

        {/* 헤더 — 검색·필터 */}
        <div className="shrink-0 flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="이름·직책·소속 검색"
            showSearchIcon
            className="flex-1 min-w-[240px] max-w-md"
          />
          <select
            value={filterOrg}
            onChange={e => setFilterOrg(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="ALL">전체 소속</option>
            {filterOrgOptions.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <select
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="ALL">전체 역할</option>
            <option value="MEMBER">팀원</option>
            <option value="TEAM_LEAD">팀장</option>
          </select>
          <select
            value={filterPromotion}
            onChange={e => setFilterPromotion(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="ALL">전체 승진요건</option>
            <option value="MEETS">충족</option>
            <option value="NOT_MEETS">미충족</option>
            <option value="NA">해당 없음</option>
          </select>
          {hasActiveFilter && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
              <X className="h-3 w-3" /> 필터 초기화
            </button>
          )}
          <div className="ml-auto text-sm text-gray-500">
            <UsersIcon className="inline h-4 w-4 mr-1 text-gray-400" />
            {visibleRows.length} / {rows.length}명
          </div>
        </div>

        {/* 테이블 */}
        <div className="flex-1 min-h-0 rounded-xl border bg-white overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('org')}>
                  소속 <SortIcon col="org" />
                </th>
                <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('name')}>
                  이름 <SortIcon col="name" />
                </th>
                <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('position')}>
                  직책 <SortIcon col="position" />
                </th>
                <th className="px-3 py-3 text-left whitespace-nowrap">역할</th>
                <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('hireDate')}>
                  입사일 <SortIcon col="hireDate" />
                </th>
                <th className="px-3 py-3 text-center cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('eval')}>
                  3년간 인사평가 <SortIcon col="eval" />
                  <div className="text-[10px] text-gray-400 font-normal normal-case mt-0.5">
                    {yearsToShow[0]} / {yearsToShow[1]} / {yearsToShow[2]}
                  </div>
                </th>
                <th className="px-3 py-3 text-right cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('mileage')}>
                  마일리지 <SortIcon col="mileage" />
                </th>
                <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('awards')}>
                  포상이력 (5년) <SortIcon col="awards" />
                </th>
                <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('promotion')}>
                  승진요건 <SortIcon col="promotion" />
                </th>
                <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('jobRequest')}>
                  직무 요청 <SortIcon col="jobRequest" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={10} className="px-3 py-3"><div className="h-6 animate-pulse rounded bg-gray-100" /></td></tr>
                ))
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-sm text-gray-400">
                    조건에 맞는 인원이 없습니다.
                  </td>
                </tr>
              ) : (
                visibleRows.map(r => (
                  <tr key={r.user.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{r.orgName}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                      <MemberInfoModal userId={r.user.id} userName={r.user.name} targetRole={r.user.role} />
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.user.position ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{ROLE_LABEL[r.user.role] ?? r.user.role}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.hireDate || '—'}</td>
                    {/* 3년간 평가 */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 justify-center">
                        {yearsToShow.map(y => {
                          const g = r.evals[y];
                          return g ? (
                            <span key={y} className={cn('rounded-full px-2 py-0.5 text-xs font-bold', GRADE_COLOR[g])}>{g}</span>
                          ) : (
                            <span key={y} className="text-xs text-gray-300">·</span>
                          );
                        })}
                      </div>
                    </td>
                    {/* 마일리지 */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <span className="font-medium text-gray-900">{r.mileagePoints}</span>
                    </td>
                    {/* 포상 */}
                    <td className="px-3 py-2.5">
                      {r.recentAwards.length === 0 ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="inline-block text-xs font-medium text-amber-700">
                            {r.recentAwards.length}건
                          </span>
                          <div className="text-[11px] text-gray-500 truncate max-w-[200px]" title={r.recentAwards.map(a => `${a.awardDate} ${a.title}`).join('\n')}>
                            최근: {r.recentAwards[0].title} ({r.recentAwards[0].awardDate})
                          </div>
                        </div>
                      )}
                    </td>
                    {/* 승진요건 */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.promotion.target === '해당 없음' ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-gray-500">{r.promotion.target}</span>
                            {r.promotion.meetsRequirement ? (
                              <span className="rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-bold">충족</span>
                            ) : (
                              <span className="rounded-full bg-gray-100 text-gray-500 px-1.5 py-0.5 text-[10px] font-medium">미충족</span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            PM {r.promotion.pmCount} · 멤버 {r.promotion.memberCount} · {r.promotion.totalPoints}점
                          </div>
                          {!r.promotion.meetsRequirement && r.promotion.reasonText && (
                            <div className="text-[10px] text-orange-500">{r.promotion.reasonText}</div>
                          )}
                        </div>
                      )}
                    </td>
                    {/* 직무 요청 — 클릭 시 육성면담서 상세 모달 */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.latestMentoring && r.jobRequest ? (
                        <MentoringFormModal
                          form={r.latestMentoring}
                          memberName={r.user.name}
                          trigger={
                            <span className="inline-flex items-center gap-1.5">
                              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', JOB_REQUEST_COLOR[r.jobRequest])}>
                                {r.jobRequestLabel}
                              </span>
                              {r.jobRequestYear && (
                                <span className="text-[11px] text-gray-400">{r.jobRequestYear}년</span>
                              )}
                            </span>
                          }
                        />
                      ) : (
                        <span className="text-xs text-gray-300">미작성</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
