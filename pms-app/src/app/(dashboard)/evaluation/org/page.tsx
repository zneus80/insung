'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getOrganizations,
  getAllUsers,
  getOrgEvaluations,
  upsertOrgEvaluation,
  addOrgGradeHistory,
  getOrgGradeHistories,
  getDivisionGradeQuota,
  upsertDivisionGradeQuota,
  getAllDivisionGradeQuotas,
  getGradeQuotas,
  getAllIndividualEvaluations,
  getSelfEvaluationsByUsers,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AuthGuard from '@/components/layout/AuthGuard';
import { History, Check, AlertCircle, RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { findDescendantIds } from '@/components/goals/OrgGoalTree';
import type {
  Organization,
  OrganizationEvaluation,
  EvaluationGrade,
  OrgGradeHistory,
  DivisionGradeQuota,
  User,
} from '@/types';

const GRADES: EvaluationGrade[] = ['A', 'B', 'C', 'D', 'E'];

const GRADE_COLOR: Record<EvaluationGrade, string> = {
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-green-100 text-green-700',
  C: 'bg-gray-100 text-gray-700',
  D: 'bg-orange-100 text-orange-700',
  E: 'bg-red-100 text-red-600',
};

const ORG_TYPE_LABEL: Record<string, string> = {
  DIVISION: '부문/공장',
  TEAM:     '팀 (독립)',
};

/** orgId 기준 상위 조직 목록 반환 */
function getAncestorOrgs(orgId: string, allOrgs: Organization[]): Organization[] {
  const ancestors: Organization[] = [];
  let current = allOrgs.find(o => o.id === orgId);
  while (current?.parentId) {
    const parent = allOrgs.find(o => o.id === current!.parentId);
    if (parent) ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

// 소수점 0.8 이상 올림, 미만 버림
function roundQuota(n: number): number {
  return (n - Math.floor(n)) >= 0.8 ? Math.ceil(n) : Math.floor(n);
}

// 비율(%) 기반 자동 쿼터 계산
// · 초과 → 낮은 등급(E→D→C→B→A) 순으로 감소
// · 미달 → 높은 등급(A→B→C→D→E) 순으로 증가
function calcAutoQuotas(
  orgGrade: EvaluationGrade,
  totalMembers: number,
  globalQuotas: Record<string, number>
): Record<EvaluationGrade, number> {
  if (totalMembers === 0) return { A: 0, B: 0, C: 0, D: 0, E: 0 };

  const pcts = GRADES.map(g => globalQuotas[`${orgGrade}-${g}`] ?? 0);
  const pctSum = pcts.reduce((s, p) => s + p, 0);
  if (pctSum === 0) return { A: 0, B: 0, C: totalMembers, D: 0, E: 0 };

  const rounded = pcts.map(p => roundQuota((p / 100) * totalMembers));
  let diff = rounded.reduce((s, n) => s + n, 0) - totalMembers;

  if (diff > 0) {
    // 초과: 낮은 등급(E=4 → A=0) 순으로 감소
    for (let i = GRADES.length - 1; i >= 0 && diff > 0; i--) {
      const cut = Math.min(rounded[i], diff);
      rounded[i] -= cut;
      diff -= cut;
    }
  } else if (diff < 0) {
    // 미달: 높은 등급(A=0 → E=4) 순으로 증가
    for (let i = 0; i < GRADES.length && diff < 0; i++) {
      rounded[i]++;
      diff++;
    }
  }

  return { A: rounded[0], B: rounded[1], C: rounded[2], D: rounded[3], E: rounded[4] };
}

export default function OrgEvaluationPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <OrgEvaluationContent />
    </AuthGuard>
  );
}

function OrgEvaluationContent() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();
  const isCeo = userProfile?.role === 'CEO';
  const isHrAdmin = !!userProfile?.isHrAdmin;

  // 공통 데이터
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [targetOrgs, setTargetOrgs] = useState<Organization[]>([]); // DIVISION + HEADQUARTERS
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [evaluations, setEvaluations] = useState<OrganizationEvaluation[]>([]);
  const [divQuotas, setDivQuotas] = useState<DivisionGradeQuota[]>([]);
  const [globalQuotas, setGlobalQuotas] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // CEO 이력 다이얼로그
  const [historyOrg, setHistoryOrg] = useState<Organization | null>(null);
  const [histories, setHistories] = useState<OrgGradeHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savingGrade, setSavingGrade] = useState<string | null>(null);

  // HR_ADMIN 쿼터 편집 (orgId → { A, B, C, D, E })
  const [quotaEdits, setQuotaEdits] = useState<Record<string, Record<EvaluationGrade, number>>>({});
  const [savingQuota, setSavingQuota] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function load() {
    setLoading(true);
    const [orgs, users, evals, dQuotas, rawGlobal] = await Promise.all([
      getOrganizations(),
      getAllUsers(),
      getOrgEvaluations(year),
      getAllDivisionGradeQuotas(year),
      getGradeQuotas(),
    ]);

    // DIVISION + 상위에 DIVISION이 없는 독립 TEAM을 평가 단위로 포함
    const targets = orgs.filter(o => {
      if (o.type === 'DIVISION') return true;
      if (o.type === 'TEAM') {
        const ancestors = getAncestorOrgs(o.id, orgs);
        return !ancestors.some(a => a.type === 'DIVISION');
      }
      return false;
    });
    const activeUsers = users.filter(u => u.isActive);

    setAllOrgs(orgs);
    setTargetOrgs(targets);
    setAllUsers(activeUsers);
    setEvaluations(evals);
    setDivQuotas(dQuotas);

    const gMap: Record<string, number> = {};
    rawGlobal.forEach((q: any) => { gMap[`${q.orgGrade}-${q.memberGrade}`] = q.count; });
    setGlobalQuotas(gMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // 조직 산하 전체 인원 수 (재귀 하위 포함)
  function getMemberCount(orgId: string): number {
    const descIds = findDescendantIds(orgId, allOrgs);
    return allUsers.filter(u => descIds.includes(u.organizationId)).length;
  }

  // 현재 평가 데이터 가져오기
  function getEval(orgId: string) {
    return evaluations.find(e => e.organizationId === orgId);
  }

  // 쿼터 편집 초기화 (HR_ADMIN)
  function initQuotaEdit(orgId: string, orgGrade: EvaluationGrade) {
    const existing = divQuotas.find(q => q.organizationId === orgId);
    if (existing && existing.status === 'CONFIRMED') {
      setQuotaEdits(prev => ({
        ...prev,
        [orgId]: { A: existing.quotaA, B: existing.quotaB, C: existing.quotaC, D: existing.quotaD, E: existing.quotaE },
      }));
    } else {
      const totalMembers = getMemberCount(orgId);
      const auto = calcAutoQuotas(orgGrade, totalMembers, globalQuotas);
      setQuotaEdits(prev => ({ ...prev, [orgId]: auto }));
    }
  }

  useEffect(() => {
    if (!loading && isHrAdmin) {
      targetOrgs.forEach(org => {
        const ev = getEval(org.id);
        if (ev?.grade) initQuotaEdit(org.id, ev.grade);
      });
    }
  }, [loading]);

  // ── CEO: 등급 지정 ──────────────────────────
  async function handleGradeAssign(org: Organization, grade: EvaluationGrade) {
    if (!userProfile) return;
    const current = getEval(org.id);
    if (current?.grade === grade) return; // 동일 등급 재지정 스킵

    setSavingGrade(org.id);
    try {
      await upsertOrgEvaluation(org.id, year, {
        grade,
        uploadedBy: userProfile.id,
        status: 'APPROVED',
        approvedBy: userProfile.id,
        approvedAt: new Date(),
      });
      await addOrgGradeHistory(
        org.id, year, grade,
        current?.grade as EvaluationGrade | undefined,
        userProfile.id
      );

      // 이미 쿼터가 CONFIRMED 상태라면 DRAFT로 초기화 (등급 변경으로 재확정 필요)
      const quota = divQuotas.find(q => q.organizationId === org.id);
      if (quota?.status === 'CONFIRMED') {
        await upsertDivisionGradeQuota(org.id, year, {
          ...quota,
          orgGrade: grade,
          status: 'DRAFT',
          updatedBy: userProfile.id,
        });
        toast.warning(`${org.name} 등급이 변경되어 쿼터 재확정이 필요합니다.`);
      } else {
        toast.success(`${org.name} 등급이 ${grade}로 지정되었습니다.`);
      }
      await load();
    } finally { setSavingGrade(null); }
  }

  // ── CEO: 이력 조회 ──────────────────────────
  async function openHistory(org: Organization) {
    setHistoryOrg(org);
    setHistoryLoading(true);
    const hist = await getOrgGradeHistories(org.id, year);
    setHistories(hist);
    setHistoryLoading(false);
  }

  // ── HR_ADMIN: 쿼터 확정 ─────────────────────
  async function handleConfirmQuota(org: Organization) {
    if (!userProfile) return;
    const ev = getEval(org.id);
    if (!ev?.grade) return;

    const edit = quotaEdits[org.id];
    if (!edit) return;

    const totalMembers = getMemberCount(org.id);
    const editTotal = GRADES.reduce((s, g) => s + (edit[g] ?? 0), 0);
    if (editTotal !== totalMembers) {
      toast.error(`확정 인원 합계(${editTotal})가 총 인원(${totalMembers})과 다릅니다.`);
      return;
    }

    setSavingQuota(org.id);
    try {
      await upsertDivisionGradeQuota(org.id, year, {
        orgGrade: ev.grade,
        totalMembers,
        quotaA: edit.A,
        quotaB: edit.B,
        quotaC: edit.C,
        quotaD: edit.D,
        quotaE: edit.E,
        status: 'CONFIRMED',
        confirmedBy: userProfile.id,
        confirmedAt: new Date(),
        updatedBy: userProfile.id,
      });
      toast.success(`${org.name} 쿼터가 확정되었습니다.`);
      await load();
    } finally { setSavingQuota(null); }
  }

  // HR_ADMIN: 평가 결과 Excel 다운로드
  async function handleDownloadExcel() {
    setDownloading(true);
    try {
      const [indivEvals, users, orgs] = await Promise.all([
        getAllIndividualEvaluations(year),
        getAllUsers(),
        getOrganizations(),
      ]);
      const confirmedEvals = indivEvals.filter(ie =>
        ie.status === 'EXEC_CONFIRMED' || ie.status === 'PUBLISHED'
      );
      const userMap = Object.fromEntries(users.map(u => [u.id, u]));
      const orgMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));

      // 자기평가 로드
      const memberIds = confirmedEvals.map(ie => ie.userId);
      const selfEvals = await getSelfEvaluationsByUsers(memberIds, year);
      const selfEvalMap = Object.fromEntries(selfEvals.map(se => [se.userId, se]));

      const XLSX = await import('xlsx');
      const rows = confirmedEvals.map(ie => {
        const user = userMap[ie.userId];
        const se = selfEvalMap[ie.userId];
        const goodPoints = se?.goalEvals.map(g => `[${g.goalTitle}] ${g.good}`).join(' / ') ?? '';
        const regretPoints = se?.goalEvals.map(g => `[${g.goalTitle}] ${g.regret}`).join(' / ') ?? '';
        return {
          '소속': orgMap[user?.organizationId ?? ''] ?? '',
          '이름': user?.name ?? ie.userId,
          '직책': user?.position ?? '',
          '자기평가_잘된점': goodPoints,
          '자기평가_아쉬운점': regretPoints,
          '팀장의견_등급': ie.leadGrade ?? '',
          '팀장의견_내용': ie.leadComment ?? '',
          '임원확정_등급': ie.execGrade ?? '',
          '임원의견': ie.execComment ?? '',
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `${year}년 평가결과`);
      XLSX.writeFile(wb, `INSUNG_평가결과_${year}.xlsx`);
      toast.success('Excel 파일을 다운로드했습니다.');
    } catch (e) {
      console.error(e);
      toast.error('다운로드 중 오류가 발생했습니다.');
    } finally { setDownloading(false); }
  }

  // HR_ADMIN: 쿼터 DRAFT로 되돌리기 (재조정)
  async function handleResetQuota(org: Organization) {
    if (!userProfile) return;
    const ev = getEval(org.id);
    if (!ev?.grade) return;
    setSavingQuota(org.id);
    try {
      const quota = divQuotas.find(q => q.organizationId === org.id);
      if (quota) {
        await upsertDivisionGradeQuota(org.id, year, {
          ...quota,
          status: 'DRAFT',
          updatedBy: userProfile.id,
          confirmedBy: undefined,
          confirmedAt: undefined,
        });
        await load();
        // 재조정 시 편집창 다시 열기
        initQuotaEdit(org.id, ev.grade);
      }
    } finally { setSavingQuota(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="조직평가 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── CEO: 부문/공장 등급 지정 ── */}
        {isCeo && (
          <section className="space-y-3">
            <div>
              <h3 className="font-semibold text-gray-900">{year}년 조직 등급 지정</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                부문/공장 단위 조직의 등급을 지정합니다. 상위 부문 없이 단독으로 운영되는 팀도 여기서 등급을 지정합니다.
                등급 변경 시 이력이 자동으로 기록되며, 쿼터 확정 후 등급 변경 시 재확정이 필요합니다.
              </p>
            </div>

            {loading ? (
              [1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)
            ) : targetOrgs.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">
                평가 대상 조직(부문/공장 또는 독립 팀)이 없습니다.
              </div>
            ) : (
              <div className="rounded-xl border bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">조직명</th>
                      <th className="px-4 py-3 text-left">유형</th>
                      <th className="px-4 py-3 text-right">산하 인원</th>
                      <th className="px-4 py-3 text-center">현재 등급</th>
                      <th className="px-4 py-3 text-center">등급 변경</th>
                      <th className="px-4 py-3 text-center">쿼터 상태</th>
                      <th className="px-4 py-3 text-center">이력</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {targetOrgs.map(org => {
                      const ev = getEval(org.id);
                      const quota = divQuotas.find(q => q.organizationId === org.id);
                      const memberCount = getMemberCount(org.id);
                      return (
                        <tr key={org.id}>
                          <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                              {ORG_TYPE_LABEL[org.type] ?? org.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500">{memberCount}명</td>
                          <td className="px-4 py-3 text-center">
                            {ev?.grade ? (
                              <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-bold ${GRADE_COLOR[ev.grade]}`}>
                                {ev.grade}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">미지정</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Select
                              value={ev?.grade ?? ''}
                              onValueChange={g => handleGradeAssign(org, g as EvaluationGrade)}
                              disabled={savingGrade === org.id}
                            >
                              <SelectTrigger className="w-28 mx-auto">
                                <SelectValue placeholder="등급 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {GRADES.map(g => (
                                  <SelectItem key={g} value={g}>{g}등급</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {quota?.status === 'CONFIRMED' ? (
                              <span className="flex items-center justify-center gap-1 text-xs text-green-600">
                                <Check className="h-3.5 w-3.5" /> 쿼터 확정
                              </span>
                            ) : quota?.status === 'DRAFT' ? (
                              <span className="text-xs text-yellow-600">쿼터 미확정</span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => openHistory(org)}
                              className="inline-flex items-center gap-1 rounded p-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <History className="h-3.5 w-3.5" /> 이력
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── HR_ADMIN: 개인 등급 쿼터 확정 ── */}
        {isHrAdmin && (
          <section className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900">{year}년 개인 등급 쿼터 확정</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  최고관리자가 지정한 조직 등급 기반으로 개인 등급 쿼터를 확정합니다.
                  자동 계산 인원을 조정 후 <strong>확정 인원 합계 = 총 인원</strong>이 되면 확정할 수 있습니다.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={handleDownloadExcel}
                disabled={downloading}
              >
                <Download className="h-4 w-4" />
                {downloading ? '다운로드 중...' : '평가결과 Excel'}
              </Button>
            </div>

            {loading ? (
              [1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />)
            ) : targetOrgs.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">
                평가 대상 조직(부문/공장 또는 독립 팀)이 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {targetOrgs.map(org => {
                  const ev = getEval(org.id);
                  const quota = divQuotas.find(q => q.organizationId === org.id);
                  const totalMembers = getMemberCount(org.id);
                  const edit = quotaEdits[org.id];
                  const autoQuota = ev?.grade ? calcAutoQuotas(ev.grade, totalMembers, globalQuotas) : null;
                  const editTotal = edit ? GRADES.reduce((s, g) => s + (edit[g] ?? 0), 0) : 0;
                  const isConfirmed = quota?.status === 'CONFIRMED';
                  const totalMatch = editTotal === totalMembers;

                  return (
                    <div key={org.id} className="rounded-xl border bg-white overflow-hidden">
                      {/* 카드 헤더 */}
                      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-gray-900">{org.name}</span>
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                            {ORG_TYPE_LABEL[org.type] ?? org.type}
                          </span>
                          {ev?.grade ? (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${GRADE_COLOR[ev.grade]}`}>
                              조직 {ev.grade}등급
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-orange-500">
                              <AlertCircle className="h-3.5 w-3.5" /> 등급 미지정
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">총 {totalMembers}명</span>
                          {isConfirmed && (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                                <Check className="h-3.5 w-3.5" /> 확정됨
                              </span>
                              <button
                                onClick={() => handleResetQuota(org)}
                                disabled={savingQuota === org.id}
                                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                                title="재조정"
                              >
                                <RefreshCw className="h-3 w-3" /> 재조정
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 쿼터 입력 */}
                      {!ev?.grade ? (
                        <div className="px-5 py-4 text-sm text-gray-400 text-center">
                          최고관리자가 조직 등급을 지정한 후 쿼터를 설정할 수 있습니다.
                        </div>
                      ) : totalMembers === 0 ? (
                        <div className="px-5 py-4 text-sm text-gray-400 text-center">
                          산하 팀원이 없습니다.
                        </div>
                      ) : (
                        <div className="p-5 space-y-3">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm text-center">
                              <thead>
                                <tr className="text-xs text-gray-500 border-b">
                                  <th className="py-2 px-2 text-left w-28">구분</th>
                                  {GRADES.map(g => (
                                    <th key={g} className="py-2 px-2">
                                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${GRADE_COLOR[g]}`}>
                                        {g}등급
                                      </span>
                                    </th>
                                  ))}
                                  <th className="py-2 px-2 text-gray-500">합계</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* 권고 인원 (자동 계산) */}
                                <tr className="text-gray-400 text-xs border-b border-dashed">
                                  <td className="py-2 px-2 text-left">권고 인원</td>
                                  {GRADES.map(g => (
                                    <td key={g} className="py-2 px-2">
                                      {autoQuota?.[g] ?? '-'}
                                    </td>
                                  ))}
                                  <td className="py-2 px-2">{totalMembers}</td>
                                </tr>
                                {/* 확정 인원 (편집 가능) */}
                                <tr>
                                  <td className="py-2 px-2 text-left text-xs font-medium text-gray-700">확정 인원</td>
                                  {GRADES.map(g => (
                                    <td key={g} className="py-2 px-1">
                                      <Input
                                        type="number"
                                        min={0}
                                        disabled={isConfirmed}
                                        className="w-16 text-center mx-auto h-8 text-sm disabled:bg-gray-50"
                                        value={edit?.[g] ?? autoQuota?.[g] ?? 0}
                                        onChange={e => setQuotaEdits(prev => ({
                                          ...prev,
                                          [org.id]: {
                                            ...(prev[org.id] ?? autoQuota ?? { A: 0, B: 0, C: 0, D: 0, E: 0 }),
                                            [g]: Math.max(0, Number(e.target.value)),
                                          },
                                        }))}
                                      />
                                    </td>
                                  ))}
                                  <td className={`py-2 px-2 font-semibold text-sm ${
                                    isConfirmed
                                      ? 'text-green-600'
                                      : totalMatch
                                        ? 'text-green-600'
                                        : 'text-red-500'
                                  }`}>
                                    {editTotal} / {totalMembers}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          {!isConfirmed && !totalMatch && edit && (
                            <p className="text-xs text-red-500 text-right">
                              확정 인원 합계({editTotal})가 총 인원({totalMembers})과 일치해야 합니다.
                            </p>
                          )}

                          {!isConfirmed && (
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                disabled={savingQuota === org.id || !totalMatch || !edit}
                                onClick={() => handleConfirmQuota(org)}
                              >
                                {savingQuota === org.id ? '저장 중...' : '쿼터 확정'}
                              </Button>
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
        )}
      </div>

      {/* 등급 이력 다이얼로그 (CEO) */}
      <Dialog open={!!historyOrg} onOpenChange={open => !open && setHistoryOrg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-blue-500" />
              {historyOrg?.name} — {year}년 등급 변경 이력
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-2 max-h-80 overflow-y-auto">
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : histories.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">변경 이력이 없습니다.</p>
            ) : (
              histories.map(h => (
                <div key={h.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="flex items-center gap-3">
                    {h.previousGrade && (
                      <>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold opacity-50 ${GRADE_COLOR[h.previousGrade]}`}>
                          {h.previousGrade}
                        </span>
                        <span className="text-xs text-gray-400">→</span>
                      </>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${GRADE_COLOR[h.grade]}`}>
                      {h.grade}
                    </span>
                    {h.comment && <span className="text-xs text-gray-500">{h.comment}</span>}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 ml-4">
                    {h.createdAt.toLocaleDateString('ko-KR', {
                      month: 'long', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
