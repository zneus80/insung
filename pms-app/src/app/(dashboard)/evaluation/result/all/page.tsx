'use client';

import { useEffect, useState } from 'react';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getAllUsers,
  getOrganizations,
  getOrgEvaluations,
  getAllIndividualEvaluations,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { SearchInput } from '@/components/ui/search-input';
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Building2, Users } from 'lucide-react';
import type { User, Organization, OrganizationEvaluation, IndividualEvaluation } from '@/types';

// 조직 평가등급 표시 대상:
// DIVISION(부문/공장) 타입이거나, 상위 조직에 DIVISION이 없는 단독 팀/본부
function isGradeTarget(org: Organization, allOrgs: Organization[]): boolean {
  if (org.type === 'COMPANY') return false;
  if (org.type === 'DIVISION') return true;
  // 상위 체인에 DIVISION이 있으면 표시 안 함
  let parentId = org.parentId;
  while (parentId) {
    const parent = allOrgs.find(o => o.id === parentId);
    if (!parent) break;
    if (parent.type === 'DIVISION') return false;
    parentId = parent.parentId;
  }
  return true; // 상위에 DIVISION 없음 → 단독 조직으로 등급 표시
}

const GRADE_STYLE: Record<string, string> = {
  S: 'bg-yellow-100 text-yellow-700',
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-green-100 text-green-700',
  C: 'bg-gray-100 text-gray-600',
  D: 'bg-red-100 text-red-600',
};

// 평가 진척 단계 (v0.75)
type Stage = 'NOT_STARTED' | 'SELF_SUBMITTED' | 'LEAD_REVIEWED' | 'HQ_REVIEWED' | 'EXEC_CONFIRMED' | 'PUBLISHED';

const STAGE_META: Record<Stage, { label: string; color: string }> = {
  NOT_STARTED:    { label: '시작 전',    color: 'bg-gray-100 text-gray-500' },
  SELF_SUBMITTED: { label: '자기평가',   color: 'bg-blue-100 text-blue-700' },
  LEAD_REVIEWED:  { label: '팀장 의견',  color: 'bg-indigo-100 text-indigo-700' },
  HQ_REVIEWED:    { label: '본부장 의견', color: 'bg-purple-100 text-purple-700' },
  EXEC_CONFIRMED: { label: '임원 확정',  color: 'bg-orange-100 text-orange-700' },
  PUBLISHED:      { label: '공개됨',    color: 'bg-green-100 text-green-700' },
};

const STAGE_ORDER: Stage[] = ['NOT_STARTED', 'SELF_SUBMITTED', 'LEAD_REVIEWED', 'HQ_REVIEWED', 'EXEC_CONFIRMED', 'PUBLISHED'];

function getStage(ie: IndividualEvaluation | undefined): Stage {
  if (!ie) return 'NOT_STARTED';
  const s = ie.status;
  if (s === 'PUBLISHED') return 'PUBLISHED';
  if (s === 'EXEC_CONFIRMED') return 'EXEC_CONFIRMED';
  if (s === 'HQ_REVIEWED') return 'HQ_REVIEWED';
  if (s === 'LEAD_REVIEWED') return 'LEAD_REVIEWED';
  if (s === 'SELF_SUBMITTED') return 'SELF_SUBMITTED';
  return 'NOT_STARTED';
}

export default function EvaluationResultAllPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrMaster>
      <EvaluationResultAllContent />
    </AuthGuard>
  );
}

function EvaluationResultAllContent() {
  const { activeYear } = useActiveYear();
  const [selectedYear, setSelectedYear] = useState(activeYear);
  const YEAR_TABS = [activeYear, activeYear - 1, activeYear - 2];

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [orgEvals, setOrgEvals] = useState<Record<string, OrganizationEvaluation>>({});
  const [indivEvals, setIndivEvals] = useState<Record<string, IndividualEvaluation>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [allUsers, allOrgs, orgEvalList, indivEvalList] = await Promise.all([
          getAllUsers(),
          getOrganizations(),
          getOrgEvaluations(selectedYear),
          getAllIndividualEvaluations(selectedYear),
        ]);

        setUsers(allUsers.filter(u => u.isActive));
        setOrgs(allOrgs);

        const oeMap: Record<string, OrganizationEvaluation> = {};
        orgEvalList.forEach(oe => { oeMap[oe.organizationId] = oe; });
        setOrgEvals(oeMap);

        const ieMap: Record<string, IndividualEvaluation> = {};
        indivEvalList.forEach(ie => { ieMap[ie.userId] = ie; });
        setIndivEvals(ieMap);

        // 최상위 조직 기본 펼침
        const topOrgs = allOrgs.filter(o => !o.parentId);
        if (topOrgs.length > 0) setExpanded(new Set([topOrgs[0].id]));
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedYear]);

  // 조직 토글 — DIVISION/HEADQUARTERS 등 상위 노드 펼침 시 산하 모든 자식도 함께 펼침
  function toggleOrg(orgId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      // 산하(자기 자신 포함) descendant ids 수집
      function collectDescendantIds(id: string, acc: string[]) {
        acc.push(id);
        for (const c of orgs.filter(o => o.parentId === id)) collectDescendantIds(c.id, acc);
      }
      const ids: string[] = [];
      collectDescendantIds(orgId, ids);
      if (next.has(orgId)) {
        // 닫기 — 자신 + 산하 전체 닫기
        ids.forEach(i => next.delete(i));
      } else {
        // 펼치기 — 자신 + 산하 전체 펼치기
        ids.forEach(i => next.add(i));
      }
      return next;
    });
  }

  const topOrgs = orgs.filter(o => !o.parentId).slice().sort(compareOrgByDisplayOrder);

  return (
    <div className="flex flex-col h-full">
      <Header title="평가결과 확인" />

      {/* 연도 탭 */}
      <div className="flex items-center gap-2 px-6 py-3 bg-gray-50 border-b shrink-0">
        {YEAR_TABS.map(year => (
          <button
            key={year}
            onClick={() => setSelectedYear(year)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
              selectedYear === year
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-500 hover:text-gray-700',
            )}
          >
            {year}년
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : (
          <div className="max-w-3xl space-y-4">
            {/* 검색 (이름·소속) */}
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="이름·소속으로 검색"
              showSearchIcon
              className="max-w-md"
            />

            {/* 평가 진척도 요약 (v0.75) */}
            <ProgressSummary users={users} indivEvals={indivEvals} />

            {search.trim() ? (
              <SearchResultList
                search={search}
                users={users}
                orgs={orgs}
                indivEvals={indivEvals}
              />
            ) : (
              topOrgs.map(org => (
                <OrgEvalCard
                  key={org.id}
                  org={org}
                  allOrgs={orgs}
                  users={users}
                  orgEvals={orgEvals}
                  indivEvals={indivEvals}
                  expanded={expanded}
                  onToggle={toggleOrg}
                  depth={0}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OrgEvalCard({
  org, allOrgs, users, orgEvals, indivEvals, expanded, onToggle, depth,
}: {
  org: Organization;
  allOrgs: Organization[];
  users: User[];
  orgEvals: Record<string, OrganizationEvaluation>;
  indivEvals: Record<string, IndividualEvaluation>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  depth: number;
}) {
  const isOpen = expanded.has(org.id);
  const orgEval = orgEvals[org.id];
  const orgMembers = users.filter(u => u.organizationId === org.id);
  const leads = orgMembers.filter(u => u.role === 'TEAM_LEAD');
  const members = orgMembers.filter(u => u.role === 'MEMBER');
  const childOrgs = allOrgs.filter(o => o.parentId === org.id).slice().sort(compareOrgByDisplayOrder);
  const hasContent = orgMembers.length > 0 || childOrgs.length > 0;

  // 조직별 평가 완료 여부 (자신 + 산하 모든 인원 — 평가 대상은 MEMBER + TEAM_LEAD)
  function collectDescendantUserIds(orgId: string): string[] {
    const direct = users.filter(u => u.organizationId === orgId && (u.role === 'MEMBER' || u.role === 'TEAM_LEAD')).map(u => u.id);
    const childIds = allOrgs.filter(o => o.parentId === orgId).flatMap(c => collectDescendantUserIds(c.id));
    return [...direct, ...childIds];
  }
  const subjectIds = collectDescendantUserIds(org.id);
  const subjectTotal = subjectIds.length;
  const subjectConfirmed = subjectIds.filter(id => {
    const ie = indivEvals[id];
    return ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED';
  }).length;
  const allConfirmed = subjectTotal > 0 && subjectConfirmed === subjectTotal;

  return (
    <div className={cn('rounded-xl border bg-white overflow-hidden', depth > 0 && 'ml-6 rounded-lg')}>
      {/* 조직 헤더 행 */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => hasContent && onToggle(org.id)}
      >
        <span className="text-gray-400 shrink-0">
          {hasContent
            ? isOpen
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronRight className="h-4 w-4" />
            : <Building2 className="h-4 w-4" />}
        </span>
        <span className="font-semibold text-gray-900 flex-1">{org.name}</span>
        <span className="text-sm text-gray-400 shrink-0">
          <Users className="h-3.5 w-3.5 inline mr-1" />{orgMembers.length}명
        </span>
        {/* 조직별 평가 완료 여부 배지 (v0.75) — 자신 + 산하 인원 모두 임원 확정인지
            COMPANY 는 상단 진척도 요약과 중복이므로 표시 제외 */}
        {org.type !== 'COMPANY' && subjectTotal > 0 && (
          allConfirmed ? (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-700 shrink-0">
              평가 완료
            </span>
          ) : (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 shrink-0">
              진행 중 {subjectConfirmed}/{subjectTotal}
            </span>
          )
        )}
        {/* 조직 평가등급 — DIVISION 또는 상위 DIVISION 없는 단독 조직 표시 */}
        {isGradeTarget(org, allOrgs) && (
          orgEval?.grade ? (
            <span className={cn('rounded-full px-3 py-0.5 text-sm font-bold shrink-0', GRADE_STYLE[orgEval.grade])}>
              조직 {orgEval.grade}등급
            </span>
          ) : (
            <span className="rounded-full px-3 py-0.5 text-sm bg-gray-100 text-gray-400 shrink-0">조직등급 미확정</span>
          )
        )}
      </button>

      {/* 펼침: 팀장 + 팀원 개인평가 */}
      {isOpen && (
        <div className="border-t">
          {/* 팀장 */}
          {leads.length > 0 && (
            <MemberGroup label="팀장" members={leads} indivEvals={indivEvals} />
          )}
          {/* 팀원 */}
          {members.length > 0 && (
            <MemberGroup label="팀원" members={members} indivEvals={indivEvals} />
          )}
          {/* 하위 조직 */}
          {childOrgs.length > 0 && (
            <div className="p-3 space-y-2">
              {childOrgs.map(child => (
                <OrgEvalCard
                  key={child.id}
                  org={child}
                  allOrgs={allOrgs}
                  users={users}
                  orgEvals={orgEvals}
                  indivEvals={indivEvals}
                  expanded={expanded}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
          {orgMembers.length === 0 && childOrgs.length === 0 && (
            <p className="px-5 py-4 text-sm text-gray-400">소속 인원이 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

function MemberGroup({
  label, members, indivEvals,
}: {
  label: string;
  members: User[];
  indivEvals: Record<string, IndividualEvaluation>;
}) {
  return (
    <div className="px-5 py-3 space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <div className="space-y-1.5">
        {members.map(u => {
          const ie = indivEvals[u.id];
          const grade = ie?.execGrade;
          const isPublished = ie?.status === 'PUBLISHED';
          const stage = getStage(ie);
          const stageMeta = STAGE_META[stage];
          return (
            <div key={u.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <MemberInfoModal userId={u.id} userName={u.name} />
                {u.position && (
                  <span className="text-sm text-gray-400">{u.position}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* 진척 단계 배지 (v0.75) */}
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', stageMeta.color)}>
                  {stageMeta.label}
                </span>
                {/* 임원이 확정한 등급 — 임원 확정 또는 공개 이후 단계에서 표시 (CEO/HR 만 보는 페이지) */}
                {grade && (stage === 'EXEC_CONFIRMED' || stage === 'PUBLISHED') ? (
                  <span className={cn('rounded-full px-3 py-0.5 text-sm font-bold', GRADE_STYLE[grade])}>
                    {grade}등급
                  </span>
                ) : (
                  <span className="rounded-full px-2.5 py-0.5 text-sm bg-gray-200 text-gray-500">
                    {isPublished ? '미확정' : '비공개'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 검색 결과 — 이름·소속 매칭 (평가 대상자만) ────────
function SearchResultList({
  search, users, orgs, indivEvals,
}: {
  search: string;
  users: User[];
  orgs: Organization[];
  indivEvals: Record<string, IndividualEvaluation>;
}) {
  const q = search.trim().toLowerCase();
  const orgsById = new Map(orgs.map(o => [o.id, o]));
  // 조직 체인 따라 올라가며 모든 상위 조직명 수집 (재경팀 → 재경본부 → 재경부문 → 회사)
  function orgChainNames(orgId: string): string[] {
    const names: string[] = [];
    let cur = orgsById.get(orgId);
    while (cur) {
      names.push(cur.name);
      cur = cur.parentId ? orgsById.get(cur.parentId) : undefined;
    }
    return names;
  }
  // 매치된 평가 대상자 (MEMBER + TEAM_LEAD) — 이름 또는 조직 체인의 어떤 이름이라도 매칭
  const matched = users
    .filter(u => u.role === 'MEMBER' || u.role === 'TEAM_LEAD')
    .filter(u => {
      if (u.name.toLowerCase().includes(q)) return true;
      return orgChainNames(u.organizationId).some(n => n.toLowerCase().includes(q));
    });

  if (matched.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center text-sm text-gray-400">
        검색 결과가 없습니다.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white px-5 py-3 space-y-2">
      <p className="text-xs text-gray-400">총 {matched.length}명</p>
      <div className="space-y-1.5">
        {matched.map(u => {
          const ie = indivEvals[u.id];
          const grade = ie?.execGrade;
          const isPublished = ie?.status === 'PUBLISHED';
          const stage = getStage(ie);
          const stageMeta = STAGE_META[stage];
          const org = orgsById.get(u.organizationId);
          return (
            <div key={u.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <MemberInfoModal userId={u.id} userName={u.name} />
                <span className="text-sm text-gray-500 shrink-0">
                  {u.role === 'TEAM_LEAD' ? '팀장' : '팀원'}
                </span>
                {org && <span className="text-sm text-gray-400 truncate">· {org.name}</span>}
                {u.position && <span className="text-sm text-gray-400">· {u.position}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', stageMeta.color)}>
                  {stageMeta.label}
                </span>
                {grade && (stage === 'EXEC_CONFIRMED' || stage === 'PUBLISHED') ? (
                  <span className={cn('rounded-full px-3 py-0.5 text-sm font-bold', GRADE_STYLE[grade])}>
                    {grade}등급
                  </span>
                ) : (
                  <span className="rounded-full px-2.5 py-0.5 text-sm bg-gray-200 text-gray-500">
                    {isPublished ? '미확정' : '비공개'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 평가 진척도 요약 (v0.75) ─────────────────────────
function ProgressSummary({ users, indivEvals }: {
  users: User[];
  indivEvals: Record<string, IndividualEvaluation>;
}) {
  // 평가 대상자: MEMBER + TEAM_LEAD 모두
  const targets = users.filter(u => u.role === 'MEMBER' || u.role === 'TEAM_LEAD');
  const total = targets.length;
  if (total === 0) return null;

  // 각 단계별 누적 명수 — STAGE_ORDER 인덱스 이상이면 누적 카운트
  const stageIndex: Record<string, number> = {};
  targets.forEach(u => {
    const s = getStage(indivEvals[u.id]);
    stageIndex[u.id] = STAGE_ORDER.indexOf(s);
  });
  function countAtOrAfter(stage: Stage): number {
    const idx = STAGE_ORDER.indexOf(stage);
    return targets.filter(u => stageIndex[u.id] >= idx).length;
  }

  const selfDone = countAtOrAfter('SELF_SUBMITTED');
  const leadDone = countAtOrAfter('LEAD_REVIEWED');
  const hqDone = countAtOrAfter('HQ_REVIEWED');
  const execDone = countAtOrAfter('EXEC_CONFIRMED');

  const finalReadyRate = total > 0 ? Math.round((execDone / total) * 100) : 0;

  const Bar = ({ label, done, color }: { label: string; done: number; color: string }) => {
    const pct = total > 0 ? (done / total) * 100 : 0;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600 font-medium">{label}</span>
          <span className="text-gray-500">
            <span className="font-semibold text-gray-800">{done}</span>
            <span className="text-gray-400"> / {total}명</span>
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">평가 진척도</h3>
        <span className={cn(
          'rounded-full px-2.5 py-0.5 text-xs font-semibold',
          finalReadyRate === 100 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
        )}>
          공개 가능 {finalReadyRate}%
        </span>
      </div>
      <p className="text-xs text-gray-400">
        평가 대상 <strong className="text-gray-700">{total}명</strong>의 단계별 진척률입니다.
        {finalReadyRate === 100
          ? ' 모든 인원이 임원 확정 완료 → 평가결과 공개 가능합니다.'
          : ' 임원 확정이 완료된 인원이 100%가 되면 평가결과를 공개할 수 있습니다.'}
      </p>
      <div className="space-y-2.5">
        <Bar label="자기평가 제출"  done={selfDone}  color="bg-blue-500" />
        <Bar label="팀장 의견"      done={leadDone}  color="bg-indigo-500" />
        <Bar label="본부장 의견"    done={hqDone}    color="bg-purple-500" />
        <Bar label="임원 확정"      done={execDone}  color="bg-orange-500" />
      </div>
    </div>
  );
}
