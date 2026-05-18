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
  getUsersByOrganization,
  getIndividualEvaluationsByOrg,
} from '@/lib/firestore';
import { cn } from '@/lib/utils';
import type { IndividualEvaluation, OrganizationEvaluation, User } from '@/types';
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
    <AuthGuard allowedRoles={['MEMBER', 'TEAM_LEAD']}>
      <EvaluationResultRouter />
    </AuthGuard>
  );
}

function EvaluationResultRouter() {
  const { userProfile } = useAuth();
  if (!userProfile) return null;
  if (userProfile.role === 'TEAM_LEAD') return <TeamLeadResultView />;
  return <MemberResultView />;
}

// ── 팀장: 내 결과 + 팀원 결과 탭 ──────────────────────────
function TeamLeadResultView() {
  const [tab, setTab] = useState<'mine' | 'team'>('mine');

  return (
    <div className="flex flex-col h-full">
      <Header title="평가결과 확인" />
      <div className="flex border-b bg-white px-6 shrink-0">
        {(['mine', 'team'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'mr-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {t === 'mine' ? '내 평가결과' : '팀원 평가결과'}
          </button>
        ))}
      </div>
      {tab === 'mine'
        ? <MemberResultView standalone={false} />
        : <TeamMembersResultView />
      }
    </div>
  );
}

// ── 팀원 결과 목록 (팀장 전용) ────────────────────────────
function TeamMembersResultView() {
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<User[]>([]);
  const [indivEvals, setIndivEvals] = useState<Record<string, IndividualEvaluation>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      if (!userProfile) return;
      const [memberList, evalList] = await Promise.all([
        getUsersByOrganization(userProfile.organizationId),
        getIndividualEvaluationsByOrg(userProfile.organizationId, CURRENT_YEAR),
      ]);
      setMembers(memberList.filter(u => u.role === 'MEMBER' && u.isActive));
      const ieMap: Record<string, IndividualEvaluation> = {};
      evalList.forEach(ie => { ieMap[ie.userId] = ie; });
      setIndivEvals(ieMap);
      setLoading(false);
    }
    load();
  }, [userProfile]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-3">
        <p className="text-sm text-gray-500">{CURRENT_YEAR}년 소속 팀원 평가결과</p>
        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : members.length === 0 ? (
          <div className="py-16 text-center text-gray-400">소속 팀원이 없습니다.</div>
        ) : (
          members.map(member => {
            const ie = indivEvals[member.id];
            const isOpen = expanded[member.id] ?? false;
            const isPublished = ie?.status === 'PUBLISHED';
            return (
              <div key={member.id} className="rounded-xl border bg-white overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(p => ({ ...p, [member.id]: !isOpen }))}
                >
                  <div>
                    <p className="font-medium text-gray-900">{member.name}</p>
                    <p className="text-xs text-gray-400">{member.position}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {isPublished && ie?.execGrade ? (
                      <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${GRADE_LABELS[ie.execGrade]?.color}`}>
                        {ie.execGrade}등급
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5">
                        {isPublished ? '미확정' : '비공개'}
                      </span>
                    )}
                    {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t px-5 py-4 space-y-3">
                    {!isPublished ? (
                      <p className="text-sm text-gray-400 flex items-center gap-2">
                        <Lock className="h-4 w-4" /> 아직 공개되지 않은 평가결과입니다.
                      </p>
                    ) : ie?.execGrade ? (
                      <>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">최종 등급</span>
                          <span className={`rounded-full px-3 py-1 text-sm font-bold ${GRADE_LABELS[ie.execGrade]?.color}`}>
                            {GRADE_LABELS[ie.execGrade]?.label}
                          </span>
                        </div>
                        {ie.execComment && (
                          <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                            <p className="text-xs font-medium text-gray-500">최종 평가 의견</p>
                            <p className="text-sm text-gray-700">{ie.execComment}</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">평가등급이 아직 확정되지 않았습니다.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── MEMBER / TEAM_LEAD 본인 결과 ──────────────────────────
function MemberResultView({ standalone = true }: { standalone?: boolean }) {
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
      <div className={standalone ? 'flex flex-col h-full' : 'flex-1 flex items-center justify-center'}>
        {standalone && <Header title="평가결과 확인" />}
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className={standalone ? 'flex flex-col h-full' : 'flex-1 overflow-y-auto'}>
      {standalone && <Header title="평가결과 확인" />}
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

            {/* 개인 평가결과 — 최종 평가권한자(임원) 등급·의견만 표시 */}
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
                  <p className="text-xs font-medium text-gray-500">최종 평가 의견</p>
                  <p className="text-sm text-gray-700">{eval_.execComment}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
