'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { getAllUsers, getOrganizations } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Input } from '@/components/ui/input';
import { fromTimestamp } from '@/lib/firestore';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { User, Organization, IndividualEvaluation, EvaluationGrade } from '@/types';

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
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <EvaluationHistoryContent />
    </AuthGuard>
  );
}

function EvaluationHistoryContent() {
  const { userProfile } = useAuth();
  const [selectedYear, setSelectedYear] = useState(YEARS[0]);
  const [evals, setEvals] = useState<IndividualEvaluation[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [orgs, setOrgs] = useState<Record<string, Organization>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [allUsers, allOrgs, snap] = await Promise.all([
        getAllUsers(),
        getOrganizations(),
        getDocs(query(
          collection(db, 'individualEvaluations'),
          where('cycleYear', '==', selectedYear),
        )),
      ]);
      setUsers(Object.fromEntries(allUsers.map(u => [u.id, u])));
      setOrgs(Object.fromEntries(allOrgs.map(o => [o.id, o])));
      setEvals(snap.docs.map(d => ({
        ...d.data(),
        id: d.id,
        leadSubmittedAt: fromTimestamp(d.data().leadSubmittedAt),
        hqReviewedAt: fromTimestamp(d.data().hqReviewedAt),
        execConfirmedAt: fromTimestamp(d.data().execConfirmedAt),
        createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
        updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
      } as IndividualEvaluation)));
      setLoading(false);
    }
    load();
  }, [selectedYear]);

  const filtered = evals.filter(e => {
    const user = users[e.userId];
    if (!user) return false;
    return user.name.includes(search) || user.email.includes(search);
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
          <Input
            placeholder="이름 또는 이메일 검색"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <span className="text-xs text-gray-400 ml-auto">총 {filtered.length}명</span>
        </div>

        {/* 테이블 */}
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
                <th className="px-4 py-3 text-center">최종 등급</th>
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
                    <td className="px-4 py-3 font-medium text-gray-900">{user?.name ?? '-'}</td>
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
      </div>
    </div>
  );
}
