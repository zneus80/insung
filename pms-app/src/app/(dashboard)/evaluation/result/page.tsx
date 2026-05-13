'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { getIndividualEvaluation } from '@/lib/firestore';
import type { IndividualEvaluation } from '@/types';
import { Lock, CheckCircle2 } from 'lucide-react';

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
      <EvaluationResultContent />
    </AuthGuard>
  );
}

function EvaluationResultContent() {
  const { userProfile } = useAuth();
  const [isPublished, setIsPublished] = useState(false);
  const [eval_, setEval] = useState<IndividualEvaluation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!userProfile) return;
      // 공개 여부 확인
      const periodSnap = await getDoc(doc(db, 'evaluationPeriods', `${CURRENT_YEAR}`));
      const published = periodSnap.exists() ? periodSnap.data().isPublished : false;
      setIsPublished(published);

      if (published) {
        const result = await getIndividualEvaluation(userProfile.id, CURRENT_YEAR);
        setEval(result);
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
            <div className="rounded-xl border bg-white p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">{CURRENT_YEAR}년 평가결과</h2>

              {/* 최종 등급 */}
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

              {/* 임원 의견 */}
              {eval_.execComment && (
                <div className="rounded-lg bg-gray-50 p-4 space-y-1">
                  <p className="text-xs font-medium text-gray-500">임원 의견</p>
                  <p className="text-sm text-gray-700">{eval_.execComment}</p>
                </div>
              )}

              {/* 팀장 의견 */}
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
