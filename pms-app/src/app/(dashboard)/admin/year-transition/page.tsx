'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getSystemSettings, updateSystemSettings, lockEvaluationYear, unlockEvaluationYear } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarClock, ArrowRight, RefreshCw, Lock, Unlock } from 'lucide-react';

const CALENDAR_YEAR = new Date().getFullYear();

export default function YearTransitionPage() {
  return (
    <AuthGuard requireHrAdmin>
      <YearTransitionContent />
    </AuthGuard>
  );
}

function YearTransitionContent() {
  const { userProfile } = useAuth();
  const { activeYear, isYearLocked } = useActiveYear();
  const isHrMaster = !!userProfile?.isHrMaster;

  const [currentSetting, setCurrentSetting] = useState<{ activeYear: number; updatedBy?: string; updatedAt?: Date } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function handleLock(year: number) {
    if (!userProfile) return;
    if (!confirm(`${year}년을 '확정'하시겠습니까?\n\n확정 후 ${year}년의 목표·주간보고·평가·육성면담서 등은 전 화면에서 조회만 가능(읽기 전용)해집니다.\n(해제는 HR 마스터만 가능)`)) return;
    setSaving(true);
    try {
      await lockEvaluationYear(year, { id: userProfile.id, name: userProfile.name });
      toast.success(`${year}년이 확정되었습니다. (읽기 전용)`);
    } catch (e: any) {
      toast.error(`확정 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally { setSaving(false); }
  }

  async function handleUnlock(year: number) {
    if (!userProfile) return;
    if (!isHrMaster) { toast.error('확정 해제는 HR 마스터만 가능합니다.'); return; }
    if (!confirm(`${year}년 확정을 해제하시겠습니까?\n\n해제 후 ${year}년 데이터의 편집이 다시 가능해집니다.`)) return;
    setSaving(true);
    try {
      await unlockEvaluationYear(year, { id: userProfile.id, name: userProfile.name });
      toast.success(`${year}년 확정이 해제되었습니다.`);
    } catch (e: any) {
      toast.error(`해제 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally { setSaving(false); }
  }

  async function load() {
    try {
      const s = await getSystemSettings();
      setCurrentSetting(s ?? { activeYear: CALENDAR_YEAR });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleTransition(targetYear: number) {
    if (!userProfile) return;
    if (!confirm(`연도를 ${currentSetting?.activeYear ?? activeYear}년에서 ${targetYear}년으로 전환하시겠습니까?\n\n전환 후 모든 사용자의 활성 연도가 ${targetYear}년으로 변경되며, 해당 연도의 평가기간이 없으면 기본값(1/1~12/31)으로 자동 생성됩니다.`)) return;

    setSaving(true);
    try {
      // 1) 활성 연도 변경
      await updateSystemSettings({ activeYear: targetYear, updatedBy: userProfile.id });

      // 2) 해당 연도의 평가기간 문서가 없으면 자동 생성 (구 평가기간 관리의 '익년도 평가 시작' 기능 통합)
      const periodRef = doc(db, 'evaluationPeriods', `${targetYear}`);
      const snap = await getDoc(periodRef);
      if (!snap.exists()) {
        await setDoc(periodRef, {
          year: targetYear,
          startDate: Timestamp.fromDate(new Date(`${targetYear}-01-01`)),
          endDate: Timestamp.fromDate(new Date(`${targetYear}-12-31`)),
          isPublished: false,
          publishedAt: null,
          updatedBy: userProfile.id,
          updatedAt: serverTimestamp(),
        });
        toast.success(`${targetYear}년으로 전환되었고, 평가기간이 새로 생성되었습니다.`);
      } else {
        toast.success(`${targetYear}년으로 연도가 전환되었습니다.`);
      }
      await load();
    } catch (e: any) {
      toast.error(`전환 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  }

  const settingYear = currentSetting?.activeYear ?? activeYear;
  const canGoNext = settingYear < CALENDAR_YEAR + 1;
  const canGoPrev = settingYear > CALENDAR_YEAR - 2;

  return (
    <div className="flex flex-col h-full">
      <Header title="연도 전환 관리" />
      <div className="flex-1 overflow-y-auto p-6 max-w-xl space-y-6">

        {/* 현재 활성 연도 */}
        <div className="rounded-xl border bg-blue-50 border-blue-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-semibold text-blue-700">현재 활성 연도</span>
          </div>
          {loading ? (
            <div className="h-10 animate-pulse rounded bg-blue-100 mt-2" />
          ) : (
            <>
              <p className="text-3xl font-bold text-blue-800 mt-1">{settingYear}년</p>
              {currentSetting?.updatedAt && (
                <p className="text-xs text-blue-500 mt-1">
                  마지막 전환: {format(currentSetting.updatedAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
                </p>
              )}
            </>
          )}
        </div>

        {/* 연도 전환 */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="h-5 w-5 text-gray-600" />
            <h2 className="font-semibold text-gray-900">연도 전환</h2>
          </div>
          <p className="text-sm text-gray-500">
            연도를 전환하면 모든 사용자의 기본 연도가 변경됩니다.<br />
            각 사용자는 연도 탭을 통해 이전 연도 이력도 열람할 수 있습니다.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* 이전 연도 */}
            <Button
              variant="outline"
              disabled={saving || loading || settingYear <= CALENDAR_YEAR - 2}
              onClick={() => handleTransition(settingYear - 1)}
              className="flex items-center justify-center gap-2 h-14 border-gray-200"
            >
              <ArrowRight className="h-4 w-4 rotate-180 text-gray-500" />
              <span className="text-sm">
                <span className="block text-gray-400 text-xs">이전 연도로</span>
                {settingYear - 1}년
              </span>
            </Button>

            {/* 다음 연도 */}
            <Button
              disabled={saving || loading || settingYear >= CALENDAR_YEAR + 1}
              onClick={() => handleTransition(settingYear + 1)}
              className="flex items-center justify-center gap-2 h-14"
            >
              <span className="text-sm text-right">
                <span className="block text-xs opacity-70">다음 연도로</span>
                {settingYear + 1}년
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          <p className="text-xs text-gray-400">
            전환 가능 범위: {CALENDAR_YEAR - 2}년 ~ {CALENDAR_YEAR + 1}년
          </p>
        </div>

        {/* 연도 확정(읽기 전용) 관리 */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="h-5 w-5 text-gray-600" />
            <h2 className="font-semibold text-gray-900">연도 확정 (읽기 전용)</h2>
          </div>
          <p className="text-sm text-gray-500">
            마감된 연도를 <strong>확정</strong>하면 해당 연도의 목표·주간보고·평가·육성면담서 등이
            전 화면에서 조회만 가능(읽기 전용)해집니다. 해제는 <strong>HR 마스터</strong>만 가능합니다.
          </p>
          <div className="divide-y border rounded-lg">
            {[CALENDAR_YEAR - 2, CALENDAR_YEAR - 1, CALENDAR_YEAR].map(y => {
              const locked = isYearLocked(y);
              return (
                <div key={y} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{y}년</span>
                    {locked
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"><Lock className="h-3 w-3" /> 확정됨 (읽기 전용)</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">편집 가능</span>}
                  </div>
                  {locked ? (
                    <Button size="sm" variant="outline" disabled={saving || !isHrMaster}
                      onClick={() => handleUnlock(y)}
                      className="gap-1.5 text-gray-600"
                      title={isHrMaster ? '' : '확정 해제는 HR 마스터만 가능'}>
                      <Unlock className="h-3.5 w-3.5" /> 확정 해제
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={saving}
                      onClick={() => handleLock(y)}
                      className="gap-1.5 text-gray-700">
                      <Lock className="h-3.5 w-3.5" /> 확정
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {!isHrMaster && (
            <p className="text-xs text-gray-400">※ 확정 해제(편집 재개방)는 HR 마스터 권한이 필요합니다.</p>
          )}
        </div>

        {/* 안내 */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1.5">
          <p className="font-semibold">연도 전환 안내</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>연도 전환은 <strong>기본 표시 연도만 변경</strong>하며, 모든 연도의 데이터는 그대로 유지됩니다.</li>
            <li>인사평가가 익년 초까지 이어지는 경우, 전환 전 미리 입력된 새 연도 데이터도 영향 없이 보존됩니다.</li>
            <li>이전·이후 연도 데이터는 각 메뉴의 연도 탭에서 언제든지 조회 가능합니다.</li>
            <li>새 연도 평가기간이 없는 경우 연도 전환 시 자동으로 1/1 ~ 12/31 기본값으로 생성됩니다. 필요 시 평가기간 관리에서 날짜를 조정하세요.</li>
          </ul>
        </div>

      </div>
    </div>
  );
}
