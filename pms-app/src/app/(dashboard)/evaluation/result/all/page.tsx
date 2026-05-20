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
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Building2, Users } from 'lucide-react';
import type { User, Organization, OrganizationEvaluation, IndividualEvaluation } from '@/types';

const GRADE_STYLE: Record<string, string> = {
  S: 'bg-yellow-100 text-yellow-700',
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-green-100 text-green-700',
  C: 'bg-gray-100 text-gray-600',
  D: 'bg-red-100 text-red-600',
};

export default function EvaluationResultAllPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
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

  function toggleOrg(orgId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(orgId) ? next.delete(orgId) : next.add(orgId);
      return next;
    });
  }

  const topOrgs = orgs.filter(o => !o.parentId);

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
          <div className="max-w-3xl space-y-3">
            {topOrgs.map(org => (
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
            ))}
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
  const childOrgs = allOrgs.filter(o => o.parentId === org.id);
  const hasContent = orgMembers.length > 0 || childOrgs.length > 0;

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
        {/* 조직 평가등급 */}
        {orgEval?.grade ? (
          <span className={cn('rounded-full px-3 py-0.5 text-sm font-bold shrink-0', GRADE_STYLE[orgEval.grade])}>
            조직 {orgEval.grade}등급
          </span>
        ) : (
          <span className="rounded-full px-3 py-0.5 text-sm bg-gray-100 text-gray-400 shrink-0">조직등급 미확정</span>
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
          return (
            <div key={u.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5">
              <div>
                <span className="text-sm font-medium text-gray-900">{u.name}</span>
                {u.position && (
                  <span className="ml-2 text-sm text-gray-400">{u.position}</span>
                )}
              </div>
              {grade && isPublished ? (
                <span className={cn('rounded-full px-3 py-0.5 text-sm font-bold', GRADE_STYLE[grade])}>
                  {grade}등급
                </span>
              ) : (
                <span className="rounded-full px-2.5 py-0.5 text-sm bg-gray-200 text-gray-500">
                  {isPublished ? '미확정' : '비공개'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
