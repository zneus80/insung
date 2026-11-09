'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarDays, Eye, Building2 } from 'lucide-react';
import { seedIndividualEvaluations, getOrgEvalPublish, setOrgEvalPublish } from '@/lib/firestore';

interface EvalPeriod {
  year: number;
  startDate: Date;
  endDate: Date;
  publishedAt?: Date;
  isPublished: boolean;
  updatedBy: string;
}

export default function EvaluationPeriodPage() {
  return (
    <AuthGuard allowedRoles={[]} requireHrAdmin>
      <EvaluationPeriodContent />
    </AuthGuard>
  );
}

function EvaluationPeriodContent() {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  // 공개 작업은 활성연도에 묶지 않고 연도를 골라서 한다(활성연도 전환 없이 과거연도 공개 가능).
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const CURRENT_YEAR = selectedYear ?? activeYear;   // 선택연도(미선택 시 활성연도)
  // 공개 권한: 개인평가 공개 = HR마스터 전용(개인등급은 HR마스터/CEO만 열람), 조직평가 공개 = HR마스터 + HR관리자.
  const isHrMaster = !!userProfile?.isHrMaster;
  const isHrAdmin = !!userProfile?.isHrAdmin;
  const [period, setPeriod] = useState<EvalPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [orgPublished, setOrgPublished] = useState(false);
  const [orgPublishing, setOrgPublishing] = useState(false);

  async function handleSeedEvaluations() {
    if (!confirm(`${CURRENT_YEAR}년 평가 대상자를 등록합니다.\n\n평가 대상(팀원·팀장 — 최고관리자·임원 제외)에 미시작 평가 항목을 추가 생성합니다.\n· 이미 평가가 있는 사용자는 그대로 유지 (삭제·변경 없음)\n· 누락된 대상자만 새로 추가\n\n진행하시겠습니까?`)) return;
    setSeeding(true);
    try {
      const { created, skipped } = await seedIndividualEvaluations(CURRENT_YEAR);
      toast.success(`평가 대상자 초기화 완료 — 신규 ${created}명 / 기존 ${skipped}명 건너뜀`);
    } catch (e: any) {
      toast.error(`초기화 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setSeeding(false);
    }
  }

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const docId = `${CURRENT_YEAR}`;

  async function load() {
    const snap = await getDoc(doc(db, 'evaluationPeriods', docId));
    if (snap.exists()) {
      const d = snap.data();
      const p: EvalPeriod = {
        year: d.year,
        startDate: (d.startDate as Timestamp).toDate(),
        endDate: (d.endDate as Timestamp).toDate(),
        publishedAt: d.publishedAt ? (d.publishedAt as Timestamp).toDate() : undefined,
        isPublished: d.isPublished ?? false,
        updatedBy: d.updatedBy,
      };
      setPeriod(p);
      setStartDate(format(p.startDate, 'yyyy-MM-dd'));
      setEndDate(format(p.endDate, 'yyyy-MM-dd'));
    } else {
      // 선택연도에 평가기간 문서가 없으면 초기화(이전 연도 값이 남지 않게)
      setPeriod(null);
      setStartDate('');
      setEndDate('');
    }
    // 조직평가결과 공개 여부(선택연도)
    try { setOrgPublished(await getOrgEvalPublish(CURRENT_YEAR)); } catch { setOrgPublished(false); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [CURRENT_YEAR]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!startDate || !endDate) { toast.error('시작일과 종료일을 입력하세요.'); return; }
    if (startDate > endDate) { toast.error('종료일은 시작일보다 이후여야 합니다.'); return; }
    if (!userProfile) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'evaluationPeriods', docId), {
        year: CURRENT_YEAR,
        startDate: Timestamp.fromDate(new Date(startDate)),
        endDate: Timestamp.fromDate(new Date(endDate)),
        isPublished: period?.isPublished ?? false,
        publishedAt: period?.publishedAt ? Timestamp.fromDate(period.publishedAt) : null,
        updatedBy: userProfile.id,
        updatedAt: serverTimestamp(),
      });
      toast.success('평가 기간이 저장되었습니다.');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!period) { toast.error('먼저 평가 기간을 저장하세요.'); return; }
    if (!confirm('평가 결과를 전체 팀원에게 공개하시겠습니까?')) return;
    if (!userProfile) return;
    setPublishing(true);
    try {
      await setDoc(doc(db, 'evaluationPeriods', docId), {
        year: CURRENT_YEAR,
        startDate: Timestamp.fromDate(period.startDate),
        endDate: Timestamp.fromDate(period.endDate),
        isPublished: true,
        publishedAt: serverTimestamp(),
        updatedBy: userProfile.id,
        updatedAt: serverTimestamp(),
      });
      toast.success('평가 결과가 전체 공개되었습니다.');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? '공개 실패');
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish() {
    if (!period) return;
    if (!confirm(
      '평가 결과 공개를 취소하시겠습니까?\n\n' +
      '취소 후에는 팀원·팀장이 본인의 평가결과를 볼 수 없게 되며, 평가기간을 다시 수정할 수 있습니다.'
    )) return;
    if (!userProfile) return;
    setPublishing(true);
    try {
      await setDoc(doc(db, 'evaluationPeriods', docId), {
        year: CURRENT_YEAR,
        startDate: Timestamp.fromDate(period.startDate),
        endDate: Timestamp.fromDate(period.endDate),
        isPublished: false,
        publishedAt: null,
        updatedBy: userProfile.id,
        updatedAt: serverTimestamp(),
      });
      toast.success('평가 결과 공개를 취소했습니다.');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? '공개 취소 실패');
    } finally {
      setPublishing(false);
    }
  }

  async function handleOrgPublishToggle() {
    if (!userProfile) return;
    const next = !orgPublished;
    if (!confirm(next
      ? `${CURRENT_YEAR}년 조직평가결과를 공개하시겠습니까?\n공개 즉시 팀원·팀장 화면에 조직등급이 표시됩니다.`
      : `${CURRENT_YEAR}년 조직평가결과 공개를 취소하시겠습니까?\n팀원·팀장 화면에서 조직등급이 숨겨집니다.`)) return;
    setOrgPublishing(true);
    try {
      await setOrgEvalPublish(CURRENT_YEAR, next, userProfile.id);
      setOrgPublished(next);
      toast.success(next ? '조직평가결과가 공개되었습니다.' : '조직평가결과 공개가 취소되었습니다.');
    } catch {
      toast.error('처리에 실패했습니다.');
    } finally { setOrgPublishing(false); }
  }

  const YEAR_OPTIONS = [activeYear + 1, activeYear, activeYear - 1, activeYear - 2];

  return (
    <div className="flex flex-col h-full">
      <Header title="평가기간 관리" />
      <div className="flex-1 overflow-y-auto p-6 max-w-xl space-y-6">

        {/* 연도 선택 — 공개/설정 대상 연도. 활성연도 전환 없이 과거연도 결과도 공개 가능. */}
        <div className="rounded-xl border bg-white p-4">
          <Label className="mb-2 block">대상 연도</Label>
          <div className="flex flex-wrap gap-2">
            {YEAR_OPTIONS.map(y => (
              <button
                key={y}
                type="button"
                onClick={() => { setLoading(true); setSelectedYear(y); }}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  CURRENT_YEAR === y ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {y}년{y === activeYear && <span className="ml-1 text-[10px] font-normal opacity-80">(활성)</span>}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            선택한 연도의 평가기간·대상자·결과 공개를 관리합니다. 활성연도를 바꾸지 않아도 과거 연도 결과를 공개할 수 있습니다.
          </p>
        </div>

        {/* 현재 상태 */}
        {period && (
          <div className={`rounded-xl border p-4 ${period.isPublished ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Eye className={`h-4 w-4 ${period.isPublished ? 'text-green-600' : 'text-blue-600'}`} />
              <span className={`text-sm font-semibold ${period.isPublished ? 'text-green-700' : 'text-blue-700'}`}>
                {period.isPublished ? '평가 결과 공개 완료' : '평가 결과 비공개 중'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              평가 기간: {format(period.startDate, 'yyyy.MM.dd', { locale: ko })} ~ {format(period.endDate, 'yyyy.MM.dd', { locale: ko })}
            </p>
            {period.publishedAt && (
              <p className="text-xs text-gray-500">
                공개일시: {format(period.publishedAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
              </p>
            )}
          </div>
        )}

        {/* 평가 기간 설정 */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">{CURRENT_YEAR}년 평가 기간 설정</h2>
          </div>

          <div className="space-y-2">
            <Label>평가 시작일</Label>
            <Input type="date" min="2000-01-01" max="2099-12-31" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={period?.isPublished} />
          </div>
          <div className="space-y-2">
            <Label>평가 종료일</Label>
            <Input type="date" min="2000-01-01" max="2099-12-31" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={period?.isPublished} />
          </div>

          {!period?.isPublished && (
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? '저장 중...' : '저장'}
            </Button>
          )}
        </div>

        {/* 평가 대상자 등록 (IE 시드) */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">평가 대상자 등록</h2>
          </div>
          <p className="text-sm text-gray-500">
            평가 대상 사용자(팀원·팀장 — 최고관리자·임원 제외)에 대해 {CURRENT_YEAR}년 인사평가 항목을
            <strong> 미시작</strong> 상태로 <strong>추가 생성</strong>합니다.
            <br />
            <span className="text-xs text-gray-400">
              ※ 이미 평가가 진행 중이거나 완료된 사용자는 그대로 유지됩니다 (기존 데이터 삭제·변경 없음).
              누락된 대상자만 새로 추가되어 평가이력에 전원 표시됩니다.
            </span>
          </p>
          <Button
            onClick={handleSeedEvaluations}
            disabled={seeding}
            variant="outline"
            className="w-full"
          >
            {seeding ? '등록 중...' : `${CURRENT_YEAR}년 평가 대상자 등록 (누락분 추가)`}
          </Button>
        </div>

        {/* 개인평가결과 공개 — HR마스터 전용(개인평가등급은 HR마스터/CEO만 열람). */}
        {isHrMaster && (
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="h-5 w-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">개인평가결과 공개</h2>
          </div>
          <p className="text-sm text-gray-500">
            공개 후 팀원·팀장이 본인의 최종 <strong>개인평가등급</strong>을 확인할 수 있습니다.
            공개 취소 시 평가기간을 다시 수정할 수 있습니다.
          </p>
          {period?.isPublished ? (
            <Button
              onClick={handleUnpublish}
              disabled={publishing}
              variant="outline"
              className="w-full border-red-300 text-red-600 hover:bg-red-50"
            >
              {publishing ? '처리 중...' : '평가 결과 공개 취소'}
            </Button>
          ) : (
            <Button
              onClick={handlePublish}
              disabled={publishing || !period}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {publishing ? '공개 중...' : '전체 공개하기'}
            </Button>
          )}
        </div>
        )}

        {/* 조직평가결과 공개 — HR마스터 + HR관리자. 공개 전에는 팀원·팀장에게 조직등급 미노출. */}
        {(isHrMaster || isHrAdmin) && (
          <div className="rounded-xl border bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-5 w-5 text-green-600" />
              <h2 className="font-semibold text-gray-900">조직평가결과 공개</h2>
            </div>
            <p className="text-sm text-gray-500">
              공개 후 팀원·팀장 화면에 소속 부문/공장의 <strong>조직등급</strong>이 표시됩니다.
              공개 전에는 조직등급이 노출되지 않습니다.
            </p>
            <div className={`rounded-lg border px-4 py-2.5 text-sm ${orgPublished ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {orgPublished
                ? <>✅ <b>{CURRENT_YEAR}년 조직평가결과가 공개 중입니다.</b></>
                : <>🔒 <b>{CURRENT_YEAR}년 조직평가결과가 비공개입니다.</b></>}
            </div>
            <Button
              onClick={handleOrgPublishToggle}
              disabled={orgPublishing}
              className={`w-full ${orgPublished ? '' : 'bg-green-600 hover:bg-green-700'}`}
              variant={orgPublished ? 'outline' : 'default'}
            >
              {orgPublishing ? '처리 중...' : orgPublished ? '조직평가결과 공개 취소' : '조직평가결과 공개'}
            </Button>
          </div>
        )}

        {/* 익년도 평가 시작 안내 */}
        {period?.isPublished && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1">
            <p className="font-semibold">{CURRENT_YEAR}년 평가가 완료되었습니다.</p>
            <p className="text-xs">
              다음 연도 평가는 <strong>시스템 설정 → 연도 전환 관리</strong>에서 연도를 전환하면 자동으로 새 평가 기간이 시작됩니다.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
