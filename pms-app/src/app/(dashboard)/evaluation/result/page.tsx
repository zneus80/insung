'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import {
  getIndividualEvaluation,
  getOrgEvaluations,
  getAllUsers,
  getOrganizations,
  getIndividualEvaluationsByOrg,
} from '@/lib/firestore';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import type { IndividualEvaluation, OrganizationEvaluation, User, Organization } from '@/types';
import { Lock, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();

const GRADE_LABELS: Record<string, { label: string; color: string }> = {
  A: { label: 'A등급', color: 'bg-blue-100 text-blue-700' },
  B: { label: 'B등급', color: 'bg-green-100 text-green-700' },
  C: { label: 'C등급', color: 'bg-yellow-100 text-yellow-700' },
  D: { label: 'D등급', color: 'bg-orange-100 text-orange-700' },
  E: { label: 'E등급', color: 'bg-red-100 text-red-700' },
};

export default function EvaluationResultPage() {
  return (
    <AuthGuard allowedRoles={['MEMBER', 'TEAM_LEAD', 'EXECUTIVE']}>
      <EvaluationResultRouter />
    </AuthGuard>
  );
}

function EvaluationResultRouter() {
  const { userProfile } = useAuth();
  if (!userProfile) return null;
  if (userProfile.role === 'EXECUTIVE') return <ExecutiveResultView />;
  return <MemberResultView />;
}

// ── MEMBER / TEAM_LEAD 본인 결과 ──────────────────────────
function MemberResultView() {
  const { userProfile } = useAuth();
  const [isPublished, setIsPublished] = useState(false);
  const [eval_, setEval] = useState<IndividualEvaluation | null>(null);
  const [orgEval, setOrgEval] = useState<OrganizationEvaluation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!userProfile) return;
      const periodSnap = await getDoc(doc(db, 'evaluationPeriods', `${CURRENT_YEAR}`));
      const published = periodSnap.exists() ? periodSnap.data().isPublished : false;
      setIsPublished(published);

      if (published) {
        const [result, orgEvals] = await Promise.all([
          getIndividualEvaluation(userProfile.id, CURRENT_YEAR),
          getOrgEvaluations(CURRENT_YEAR),
        ]);
        setEval(result);
        const myOrg = orgEvals.find(e => e.organizationId === userProfile.organizationId);
        setOrgEval(myOrg ?? null);
      }
      setLoading(false);
    }
    load();
  }, [userProfile]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="평가결과 확인" />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="평가결과 확인" />
      <div className="flex-1 overflow-y-auto p-6 max-w-xl space-y-6">
        {!isPublished ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <Lock className="h-12 w-12 text-gray-300" />
            <p className="font-semibold text-gray-500">아직 평가 결과가 공개되지 않았습니다.</p>
            <p className="text-sm text-gray-400">HR관리자가 공개하면 이곳에서 확인할 수 있습니다.</p>
          </div>
        ) : !eval_ ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-gray-300" />
            <p className="font-semibold text-gray-500">평가 결과가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 조직 평가등급 */}
            {orgEval && (
              <div className="rounded-xl border bg-white p-5 space-y-3">
                <h2 className="font-semibold text-gray-900">조직 평가등급</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">소속 조직 등급</span>
                  <span className={`rounded-full px-4 py-1 text-sm font-bold ${GRADE_LABELS[orgEval.grade]?.color}`}>
                    {GRADE_LABELS[orgEval.grade]?.label}
                  </span>
                </div>
              </div>
            )}

            {/* 개인 평가결과 */}
            <div className="rounded-xl border bg-white p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">{CURRENT_YEAR}년 개인 평가결과</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">최종 평가등급</span>
                {eval_.execGrade ? (
                  <span className={`rounded-full px-4 py-1 text-sm font-bold ${GRADE_LABELS[eval_.execGrade]?.color}`}>
                    {GRADE_LABELS[eval_.execGrade]?.label}
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">미확정</span>
                )}
              </div>
              {eval_.execComment && (
                <div className="rounded-lg bg-gray-50 p-4 space-y-1">
                  <p className="text-xs font-medium text-gray-500">임원 의견</p>
                  <p className="text-sm text-gray-700">{eval_.execComment}</p>
                </div>
              )}
              {eval_.leadComment && (
                <div className="rounded-lg bg-blue-50 p-4 space-y-1">
                  <p className="text-xs font-medium text-blue-500">팀장 의견</p>
                  <p className="text-sm text-gray-700">{eval_.leadComment}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── EXECUTIVE 산하 평가결과 조회 ──────────────────────────
function ExecutiveResultView() {
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<User[]>([]);
  const [indivEvals, setIndivEvals] = useState<Record<string, IndividualEvaluation>>({});
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      if (!userProfile) return;
      const [allUsers, allOrgs] = await Promise.all([
        getAllUsers(), getOrganizations(),
      ]);
      const descIds = findDescendantIds(userProfile.organizationId, allOrgs);
      const subordinates = allUsers.filter(u =>
        (u.role === 'MEMBER' || u.role === 'TEAM_LEAD') &&
        u.isActive && descIds.includes(u.organizationId)
      );
      setMembers(subordinates);
      setOrgs(allOrgs);

      const evalResults = await Promise.all(
        descIds.map(oid => getIndividualEvaluationsByOrg(oid, CURRENT_YEAR))
      );
      const ieMap: Record<string, IndividualEvaluation> = {};
      evalResults.flat().forEach(ie => { ieMap[ie.userId] = ie; });
      setIndivEvals(ieMap);
      setLoading(false);
    }
    load();
  }, [userProfile]);

  const orgNameMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));
  const membersByOrg = members.reduce<Record<string, User[]>>((acc, m) => {
    if (!acc[m.organizationId]) acc[m.organizationId] = [];
    acc[m.organizationId].push(m);
    return acc;
  }, {});

  const ROLE_LABEL: Record<string, string> = { MEMBER: '팀원', TEAM_LEAD: '팀장' };

  return (
    <div className="flex flex-col h-full">
      <Header title="평가결과 확인" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <p className="text-sm text-gray-500">{CURRENT_YEAR}년 소관 조직 평가결과</p>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <CheckCircle2 className="h-12 w-12 text-gray-300" />
              <p className="text-gray-500">소관 조직에 구성원이 없습니다.</p>
            </div>
          ) : (
            Object.entries(membersByOrg).map(([orgId, orgMembers]) => (
              <div key={orgId} className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 px-1">{orgNameMap[orgId] ?? orgId}</p>
                {orgMembers.map(member => {
                  const ie = indivEvals[member.id];
                  const isOpen = expanded[member.id] ?? false;
                  return (
                    <div key={member.id} className="rounded-xl border bg-white overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                        onClick={() => setExpanded(p => ({ ...p, [member.id]: !isOpen }))}
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="font-semibold text-gray-900">{member.name}</p>
                            <p className="text-xs text-gray-400">
                              {ROLE_LABEL[member.role]} {member.position && `· ${member.position}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {ie?.execGrade ? (
                            <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${GRADE_LABELS[ie.execGrade]?.color}`}>
                              {ie.execGrade}등급
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5">미확정</span>
                          )}
                          {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                        </div>
                      </button>
                      {isOpen && ie && (
                        <div className="border-t px-5 py-4 space-y-3">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500">최종 등급</span>
                            {ie.execGrade ? (
                              <span className={`rounded-full px-3 py-1 text-sm font-bold ${GRADE_LABELS[ie.execGrade]?.color}`}>
                                {GRADE_LABELS[ie.execGrade]?.label}
                              </span>
                            ) : <span className="text-sm text-gray-400">미확정</span>}
                          </div>
                          {ie.execComment && (
                            <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                              <p className="text-xs font-medium text-gray-500">임원 의견</p>
                              <p className="text-sm text-gray-700">{ie.execComment}</p>
                            </div>
                          )}
                          {ie.leadComment && (
                            <div className="rounded-lg bg-blue-50 p-3 space-y-1">
                              <p className="text-xs font-medium text-blue-500">팀장 의견</p>
                              <p className="text-sm text-gray-700">{ie.leadComment}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
