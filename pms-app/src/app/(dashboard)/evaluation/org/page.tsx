'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getOrganizations,
  getOrgSnapshot,
  getAllUsers,
  getOrgEvaluations,
  upsertOrgEvaluation,
  addOrgGradeHistory,
  getOrgGradeHistories,
  getDivisionGradeQuota,
  upsertDivisionGradeQuota,
  getAllDivisionGradeQuotas,
  getOrgEvalPublish,
  setOrgEvalPublish,
  getGradeQuotas,
  getAllIndividualEvaluations,
  getSelfEvaluationsByUsers,
  clearExecConfirmation,
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
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
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

  const raws = pcts.map(p => (p / 100) * totalMembers);
  const rounded = raws.map(r => roundQuota(r));
  // 반올림 후 "남은 소수점" = raw - 반올림 결과
  //  · 0.9 → 1로 올렸으므로 남은 = -0.1 (보충 대상 아님)
  //  · 1.35 → 1로 내렸으므로 남은 = 0.35 (보충 대상 후보, 단 0.7 미만이라 제외)
  //  · 1.7 → 1로 내렸으므로 남은 = 0.7 (보충 대상)
  const fracs = raws.map((r, i) => r - rounded[i]);
  let diff = rounded.reduce((s, n) => s + n, 0) - totalMembers;

  if (diff > 0) {
    // 초과: 낮은 등급(E=4 → A=0) 순으로 -1
    //  · 비율 0% 등급은 이미 0이라 자동 제외
    //  · 소수점 0.3 초과 등급 제외 (미달 보충 0.7 이상의 대칭 — 반올림에서 살짝 밀린 정도라 깎으면 의도 어긋남)
    //  · 모두 제외되어 diff 가 남으면 → C 등급에서 일괄 감소 (최하 fallback)
    for (let i = GRADES.length - 1; i >= 0 && diff > 0; i--) {
      if (pcts[i] === 0) continue;
      if (fracs[i] > 0.3) continue;
      const cut = Math.min(rounded[i], diff);
      rounded[i] -= cut;
      diff -= cut;
    }
    // 그래도 초과면 C 등급에서 감소
    if (diff > 0) {
      const cIdx = GRADES.indexOf('C');
      const cut = Math.min(rounded[cIdx], diff);
      rounded[cIdx] -= cut;
      diff -= cut;
    }
  } else if (diff < 0) {
    // 미달: 높은 등급(A=0 → E=4) 순으로 +1
    //  · 비율 0% 등급 제외 (정책상 보장된 0% 깨지지 않음)
    //  · 소수점 0.7 미만 등급도 제외 (0.7 자체는 포함 — 반올림 임계 0.8 보다 살짝 완화)
    //  · 모두 제외되어 diff 가 남으면 → C 등급에 일괄 보충 (최하 fallback)
    for (let i = 0; i < GRADES.length && diff < 0; i++) {
      if (pcts[i] === 0) continue;
      if (fracs[i] < 0.7) continue;
      rounded[i]++;
      diff++;
    }
    // 그래도 미달이면 C 등급에 잔여 추가
    if (diff < 0) {
      const cIdx = GRADES.indexOf('C');
      rounded[cIdx] += -diff;
      diff = 0;
    }
  }

  return { A: rounded[0], B: rounded[1], C: rounded[2], D: rounded[3], E: rounded[4] };
}

export default function OrgEvaluationPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrMaster>
      <OrgEvaluationContent />
    </AuthGuard>
  );
}

function OrgEvaluationContent() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode'); // 'grade' | 'quota' | null
  const isCeo = userProfile?.role === 'CEO';
  const isHrMaster = !!userProfile?.isHrMaster;
  const isHrAdmin = !!userProfile?.isHrAdmin;
  const isCeoViewer = !!userProfile?.isCeoViewer;
  // 조직평가관리(등급 지정) — CEO / HR 마스터 / CEO Viewer (모두 조회 가능)
  const canSeeGradeSection = isCeo || isHrMaster || isCeoViewer;
  // 실제 등급 변경 권한 — CEO 본인 (isCeoViewer 가 부여되면 같은 CEO 라도 권한 박탈 = 각자대표 중 viewer 케이스)
  // 등급 결정: CEO + HR마스터 (CEO Viewer 는 조회 전용)
  const canModifyGrade = (isCeo || isHrMaster) && !isCeoViewer;
  // mode 쿼리에 따라 표시할 섹션 결정. mode 없으면 권한대로 모두 표시
  const showGradeSection = canSeeGradeSection && mode !== 'quota';
  const showQuotaSection = isHrAdmin && mode !== 'grade';
  // 페이지 헤더 — mode 별 라벨
  const headerTitle = mode === 'grade' ? '조직평가관리'
                    : mode === 'quota' ? '조직평가인원관리'
                    : '조직평가 관리';

  // 공통 데이터
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [targetOrgs, setTargetOrgs] = useState<Organization[]>([]); // DIVISION + HEADQUARTERS
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [evaluations, setEvaluations] = useState<OrganizationEvaluation[]>([]);
  const [divQuotas, setDivQuotas] = useState<DivisionGradeQuota[]>([]);
  const [orgPublished, setOrgPublished] = useState(false);   // 조직평가결과 공개 여부
  const [publishing, setPublishing] = useState(false);
  const [globalQuotas, setGlobalQuotas] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // 조직평가관리 — 3개년 선택 + 비교 모드
  const GRADE_YEARS = Array.from({ length: 3 }, (_, i) => year - i);
  const [gradeSelectedYear, setGradeSelectedYear] = useState(year);
  const [gradeYearEvals, setGradeYearEvals] = useState<OrganizationEvaluation[]>([]);
  const [gradePrevEvals, setGradePrevEvals] = useState<OrganizationEvaluation[]>([]);
  const [gradeCompareMode, setGradeCompareMode] = useState(false);
  const [gradeYearLoading, setGradeYearLoading] = useState(false);

  // CEO 이력 다이얼로그
  const [historyOrg, setHistoryOrg] = useState<Organization | null>(null);
  const [histories, setHistories] = useState<OrgGradeHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savingGrade, setSavingGrade] = useState<string | null>(null);
  // 경량 B — 선택 연도가 확정(스냅샷 보유)이면 그 해 조직명으로 표시
  const [gradeYearOrgNames, setGradeYearOrgNames] = useState<Record<string, string>>({});

  // HR_ADMIN 쿼터 편집 (orgId → { A, B, C, D, E })
  const [quotaEdits, setQuotaEdits] = useState<Record<string, Record<EvaluationGrade, number>>>({});
  const [savingQuota, setSavingQuota] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function load() {
    setLoading(true);
    try {
    const [orgs, users, evals, dQuotas, rawGlobal] = await Promise.all([
      getOrganizations(),
      getAllUsers(),
      getOrgEvaluations(year),
      getAllDivisionGradeQuotas(year),
      getGradeQuotas(),
    ]);

    // DIVISION + 조직평가 단위로 지정된 본부(isEvalUnit) + 상위에 DIVISION이 없는 독립 TEAM
    const targets = orgs.filter(o => {
      if (o.type === 'DIVISION') return true;
      if (o.isEvalUnit) return true;
      if (o.type === 'TEAM') {
        const ancestors = getAncestorOrgs(o.id, orgs);
        return !ancestors.some(a => a.type === 'DIVISION');
      }
      return false;
    }).sort(compareOrgByDisplayOrder);
    const activeUsers = users.filter(u => u.isActive);

    setAllOrgs(orgs);
    setTargetOrgs(targets);
    getOrgEvalPublish(year).then(setOrgPublished).catch(() => {});
    setAllUsers(activeUsers);
    setEvaluations(evals);
    setDivQuotas(dQuotas);

    const gMap: Record<string, number> = {};
    rawGlobal.forEach((q: any) => { gMap[`${q.orgGrade}-${q.memberGrade}`] = q.count; });
    setGlobalQuotas(gMap);
    } catch (e: any) {
      console.error('조직평가 로드 실패:', e);
      toast.error('데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // 조직평가관리 — 선택 연도(및 비교 모드 시 전년도) 평가 로드
  useEffect(() => {
    if (!showGradeSection) return;
    let cancelled = false;
    async function loadGradeYear() {
      setGradeYearLoading(true);
      try {
        // 활성 연도면 이미 로드된 evaluations 재사용
        if (gradeSelectedYear === year) {
          if (!cancelled) setGradeYearEvals(evaluations);
        } else {
          const evs = await getOrgEvaluations(gradeSelectedYear);
          if (!cancelled) setGradeYearEvals(evs);
        }
        if (gradeCompareMode) {
          const prev = await getOrgEvaluations(gradeSelectedYear - 1);
          if (!cancelled) setGradePrevEvals(prev);
        } else {
          if (!cancelled) setGradePrevEvals([]);
        }
        // 경량 B — 그 해 조직 스냅샷 이름맵(없으면 라이브 이름 사용)
        const snapOrgs = await getOrgSnapshot(gradeSelectedYear);
        if (!cancelled) setGradeYearOrgNames(snapOrgs ? Object.fromEntries(snapOrgs.map(o => [o.id, o.name])) : {});
      } finally {
        if (!cancelled) setGradeYearLoading(false);
      }
    }
    loadGradeYear();
    return () => { cancelled = true; };
  }, [gradeSelectedYear, gradeCompareMode, showGradeSection, year, evaluations]);

  // 선택 연도 조직명 (확정 연도면 그 해 스냅샷 이름, 아니면 라이브)
  function orgNameY(org: { id: string; name: string }) {
    return gradeYearOrgNames[org.id] ?? org.name;
  }
  // 선택 연도 평가에서 조회
  function getGradeYearEval(orgId: string) {
    return gradeYearEvals.find(e => e.organizationId === orgId);
  }
  function getGradePrevEval(orgId: string) {
    return gradePrevEvals.find(e => e.organizationId === orgId);
  }
  const isActiveGradeYear = gradeSelectedYear === year;

  // 조직 산하 전체 평가 대상 인원 수 (재귀 하위 포함) — 임원·CEO 는 쿼터 기준에서 제외
  function getMemberCount(orgId: string): number {
    const descIds = findDescendantIds(orgId, allOrgs);
    return allUsers.filter(u =>
      descIds.includes(u.organizationId) &&
      u.role !== 'EXECUTIVE' &&
      u.role !== 'CEO' &&
      u.isActive !== false,
    ).length;
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
    if (!canModifyGrade) {
      toast.error('등급 확정 권한이 없습니다 (최고관리자 전용).');
      return;
    }
    const current = getEval(org.id);
    if (current?.grade === grade) return; // 동일 등급 재지정 스킵

    // 쿼터 CONFIRMED 상태이거나 산하에 임원 확정/공개된 IE 가 있으면 사전 확인
    const quota = divQuotas.find(q => q.organizationId === org.id);
    const wasQuotaConfirmed = quota?.status === 'CONFIRMED';
    const descIds = [org.id, ...findDescendantIds(org.id, allOrgs)];
    const allIEs = wasQuotaConfirmed ? await getAllIndividualEvaluations(year) : [];
    const affectedIEs = allIEs.filter(ie =>
      descIds.includes(ie.organizationId) &&
      (ie.status === 'EXEC_CONFIRMED' || ie.status === 'PUBLISHED')
    );
    if (wasQuotaConfirmed) {
      const msgParts: string[] = [
        `${org.name} 등급을 ${current?.grade ?? '미지정'} → ${grade} 로 변경합니다.`,
        '',
        `· 쿼터가 자동으로 DRAFT 로 초기화되어 HR 가 재확정해야 합니다.`,
      ];
      if (affectedIEs.length > 0) {
        msgParts.push(
          `· 산하 조직에서 이미 임원이 확정한 ${affectedIEs.length}건의 개인 평가 등급이 ` +
          `자동 무효화되며, 임원이 다시 등급을 부여해야 합니다.`,
        );
      }
      msgParts.push('', '계속하시겠습니까?');
      if (!confirm(msgParts.join('\n'))) return;
    }

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

      // 이미 쿼터가 CONFIRMED 상태라면 DRAFT로 초기화 + 산하 임원 확정 무효화
      if (wasQuotaConfirmed) {
        await upsertDivisionGradeQuota(org.id, year, {
          ...quota!,
          orgGrade: grade,
          status: 'DRAFT',
          updatedBy: userProfile.id,
        });
        // 산하 EXEC_CONFIRMED/PUBLISHED IE 무효화
        if (affectedIEs.length > 0) {
          await Promise.all(affectedIEs.map(ie => clearExecConfirmation(ie)));
          toast.warning(
            `${org.name} 등급 변경 — 쿼터 초기화 + 산하 임원 확정 ${affectedIEs.length}건 무효화됨. 재확정 필요.`,
          );
        } else {
          toast.warning(`${org.name} 등급이 변경되어 쿼터 재확정이 필요합니다.`);
        }
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

    // 이 부문/공장 산하에 이미 임원 확정/공개된 개인평가가 있는지 미리 조회.
    // 있다면 — 쿼터 (재)확정으로 그 등급들을 무효화해야 함.
    // (참고: 재조정 버튼이 quota status 를 DRAFT 로 먼저 바꾸기 때문에,
    //        "이전 quota 가 CONFIRMED 였나" 로 판단하면 항상 false 가 되어 무효화 안 됨.
    //        그래서 실제 임원 확정 IE 의 존재 여부로 판단한다.)
    const descIds = [org.id, ...findDescendantIds(org.id, allOrgs)];
    const allIEs = await getAllIndividualEvaluations(year);
    const affected = allIEs.filter(ie =>
      descIds.includes(ie.organizationId) &&
      (ie.status === 'EXEC_CONFIRMED' || ie.status === 'PUBLISHED')
    );

    if (affected.length > 0) {
      const msg =
        `${org.name} 쿼터를 (재)확정하면 이 조직에서 이미 임원이 확정한 ${affected.length}건의 개인 등급이 모두 무효화되고, ` +
        `임원이 다시 등급을 부여해야 합니다.\n\n계속하시겠습니까?`;
      if (!confirm(msg)) return;
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

      // 임원 확정 등급 무효화 (산하 EXEC_CONFIRMED/PUBLISHED 모두)
      if (affected.length > 0) {
        await Promise.all(affected.map(ie => clearExecConfirmation(ie)));
        toast.success(
          `${org.name} 쿼터가 확정되고, 임원 확정 등급 ${affected.length}건이 무효화되었습니다.`,
        );
      } else {
        toast.success(`${org.name} 쿼터가 확정되었습니다.`);
      }
      await load();
    } catch (err) {
      console.error('[쿼터 확정] 실패:', err);
      toast.error('쿼터 확정에 실패했습니다.');
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
        // 종합 의견 (구버전 good/regret 데이터도 호환)
        const comments = se?.goalEvals.map(g => {
          const legacy = [
            g.good ? `잘된 점: ${g.good}` : '',
            g.regret ? `아쉬운 점: ${g.regret}` : '',
          ].filter(Boolean).join(' / ');
          const text = g.comment || legacy || '';
          return `[${g.goalTitle}] ${text}`;
        }).join(' // ') ?? '';
        return {
          '소속': orgMap[user?.organizationId ?? ''] ?? '',
          '이름': user?.name ?? ie.userId,
          '직책': user?.position ?? '',
          '자기평가_종합의견': comments,
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
      <Header title={headerTitle} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── 등급 지정 (CEO·HR 마스터) ── */}
        {showGradeSection && (
          <section className="space-y-3">
            <div>
              <h3 className="font-semibold text-gray-900">{gradeSelectedYear}년 조직 등급 지정</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                부문/공장 단위 조직의 등급을 지정합니다. 상위 부문 없이 단독으로 운영되는 팀도 여기서 등급을 지정합니다.
                등급 변경 시 이력이 자동으로 기록되며, 쿼터 확정 후 등급 변경 시 재확정이 필요합니다.
                {!canModifyGrade && (
                  <span className="ml-1 text-blue-600">· 조회 전용입니다 (등급 확정은 최고관리자 권한).</span>
                )}
                {canModifyGrade && !isActiveGradeYear && (
                  <span className="ml-1 text-orange-600">· 활성 연도가 아니므로 등급 변경이 불가합니다 (조회 전용).</span>
                )}
              </p>
            </div>

            {/* 연도 탭 + 비교 토글 */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-1">
                {GRADE_YEARS.map(y => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setGradeSelectedYear(y)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      gradeSelectedYear === y ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {y}년
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setGradeCompareMode(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  gradeCompareMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title={`${gradeSelectedYear}년 vs ${gradeSelectedYear - 1}년 비교`}
              >
                {gradeCompareMode ? '비교 해제' : `${gradeSelectedYear - 1}년과 비교`}
              </button>
              {gradeCompareMode && (
                <button
                  type="button"
                  onClick={async () => {
                    const XLSX = await import('xlsx');
                    const rows = targetOrgs.map(org => {
                      const cur = getGradeYearEval(org.id);
                      const prev = getGradePrevEval(org.id);
                      return {
                        '조직명': orgNameY(org),
                        '유형': ORG_TYPE_LABEL[org.type] ?? org.type,
                        [`${gradeSelectedYear}년 등급`]: cur?.grade ?? '-',
                        [`${gradeSelectedYear - 1}년 등급`]: prev?.grade ?? '-',
                      };
                    });
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '조직 등급 비교');
                    XLSX.writeFile(wb, `조직평가비교_${gradeSelectedYear}vs${gradeSelectedYear - 1}.xlsx`);
                  }}
                  disabled={loading || gradeYearLoading || targetOrgs.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  Excel
                </button>
              )}
            </div>

            {gradeCompareMode ? (
              <div className="rounded-xl border bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">조직명</th>
                      <th className="px-4 py-3 text-left">유형</th>
                      <th className="px-4 py-3 text-center">{gradeSelectedYear}년 등급</th>
                      <th className="px-4 py-3 text-center">{gradeSelectedYear - 1}년 등급</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(loading || gradeYearLoading) ? (
                      [1, 2, 3].map(i => (
                        <tr key={i}>
                          <td colSpan={4} className="px-4 py-3">
                            <div className="h-4 animate-pulse rounded bg-gray-100" />
                          </td>
                        </tr>
                      ))
                    ) : targetOrgs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">평가 대상 조직이 없습니다.</td>
                      </tr>
                    ) : targetOrgs.map(org => {
                      const cur = getGradeYearEval(org.id);
                      const prev = getGradePrevEval(org.id);
                      return (
                        <tr key={org.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{orgNameY(org)}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                              {ORG_TYPE_LABEL[org.type] ?? org.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {cur?.grade ? (
                              <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-bold ${GRADE_COLOR[cur.grade]}`}>
                                {cur.grade}
                              </span>
                            ) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {prev?.grade ? (
                              <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-bold ${GRADE_COLOR[prev.grade]}`}>
                                {prev.grade}
                              </span>
                            ) : <span className="text-gray-300">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (loading || gradeYearLoading) ? (
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
                      <th className="px-4 py-3 text-center">권고 인원 (A/B/C/D/E)</th>
                      <th className="px-4 py-3 text-center">등급 변경</th>
                      <th className="px-4 py-3 text-center">쿼터 상태</th>
                      <th className="px-4 py-3 text-center">이력</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {targetOrgs.map(org => {
                      const ev = getGradeYearEval(org.id);
                      const quota = divQuotas.find(q => q.organizationId === org.id);
                      const memberCount = getMemberCount(org.id);
                      // 등급 확정 후 권고 인원 자동 계산 (조직평가인원관리의 권고 인원과 동일)
                      const autoQuota = ev?.grade && ev.status === 'APPROVED' && memberCount > 0
                        ? calcAutoQuotas(ev.grade, memberCount, globalQuotas)
                        : null;
                      return (
                        <tr key={org.id}>
                          <td className="px-4 py-3 font-medium text-gray-900">{orgNameY(org)}</td>
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
                            {(() => {
                              // HR마스터가 조직평가인원관리에서 확정한 쿼터 — 확정 시 권고 아래 행으로 표시
                              const confirmedQuota = quota?.status === 'CONFIRMED' ? quota : null;
                              if (!autoQuota && !confirmedQuota) {
                                return <span className="text-xs text-gray-300">등급 확정 후 자동 계산</span>;
                              }
                              return (
                                <div className="inline-flex flex-col items-center gap-1">
                                  <div className="inline-flex rounded-lg border overflow-hidden divide-x">
                                    {GRADES.map(g => {
                                      const confirmedVal = confirmedQuota
                                        ? (confirmedQuota[`quota${g}` as 'quotaA' | 'quotaB' | 'quotaC' | 'quotaD' | 'quotaE'] ?? 0)
                                        : null;
                                      return (
                                        <div key={g} className="flex flex-col items-center min-w-[44px]">
                                          <div className={`w-full px-2 py-0.5 text-[10px] font-bold text-center ${GRADE_COLOR[g]}`}>{g}</div>
                                          <div className={`w-full px-2 py-1 text-sm font-bold text-gray-800 ${autoQuota && autoQuota[g] === 0 ? 'text-gray-300' : ''}`}>
                                            {autoQuota ? autoQuota[g] : '-'}
                                          </div>
                                          <div className={`w-full px-2 py-1 text-sm font-bold border-t ${
                                            confirmedVal == null ? 'text-gray-300' : confirmedVal === 0 ? 'text-green-300 bg-green-50/50' : 'text-green-700 bg-green-50'
                                          }`}>
                                            {confirmedVal == null ? '-' : confirmedVal}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <p className="text-[10px] text-gray-400">
                                    상단 권고 · 하단 확정{confirmedQuota ? ' (HR 쿼터 확정)' : ' (쿼터 미확정)'}
                                  </p>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Select
                              value={ev?.grade ?? ''}
                              onValueChange={g => handleGradeAssign(org, g as EvaluationGrade)}
                              disabled={savingGrade === org.id || !isActiveGradeYear || !canModifyGrade}
                            >
                              <SelectTrigger className="w-28 mx-auto">
                                <SelectValue placeholder={
                                  !canModifyGrade ? '조회 전용'
                                    : isActiveGradeYear ? '등급 선택' : '조회 전용'
                                } />
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
        {showQuotaSection && (
          <section className="space-y-4">
            {/* 조직평가결과 공개 — HR마스터/CEO 전용. 공개 전에는 일반 사용자에게 조직등급 미노출 (§6-1) */}
            {(isHrMaster || isCeo) && (
              <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${orgPublished ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                <p className={`text-sm ${orgPublished ? 'text-green-700' : 'text-amber-700'}`}>
                  {orgPublished
                    ? <>✅ <b>{year}년 조직평가결과가 공개되었습니다.</b> 팀원·팀장 화면에 조직등급이 표시됩니다.</>
                    : <>🔒 <b>{year}년 조직평가결과가 아직 비공개입니다.</b> 공개 전에는 팀원·팀장에게 조직등급이 표시되지 않습니다.</>}
                </p>
                <Button
                  size="sm"
                  variant={orgPublished ? 'outline' : 'default'}
                  disabled={publishing || isCeoViewer}
                  className={orgPublished ? 'shrink-0' : 'shrink-0 bg-green-600 hover:bg-green-700'}
                  onClick={async () => {
                    if (!userProfile) return;
                    const next = !orgPublished;
                    if (!confirm(next
                      ? `${year}년 조직평가결과를 공개하시겠습니까?\n공개 즉시 팀원·팀장 화면에 조직등급이 표시됩니다.`
                      : `${year}년 조직평가결과 공개를 취소하시겠습니까?\n팀원·팀장 화면에서 조직등급이 숨겨집니다.`)) return;
                    setPublishing(true);
                    try {
                      await setOrgEvalPublish(year, next, userProfile.id);
                      setOrgPublished(next);
                      toast.success(next ? '조직평가결과가 공개되었습니다.' : '조직평가결과 공개가 취소되었습니다.');
                    } catch {
                      toast.error('처리에 실패했습니다.');
                    } finally { setPublishing(false); }
                  }}
                >
                  {publishing ? '처리 중…' : orgPublished ? '공개 취소' : '조직평가결과 공개'}
                </Button>
              </div>
            )}
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
                          <span className="font-semibold text-gray-900">{orgNameY(org)}</span>
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
