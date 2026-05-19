'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { getSystemSettings, updateSystemSettings } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarClock, ArrowRight, RefreshCw } from 'lucide-react';

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
  const { activeYear } = useActiveYear();

  const [currentSetting, setCurrentSetting] = useState<{ activeYear: number; updatedBy?: string; updatedAt?: Date } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    if (!confirm(`연도를 ${currentSetting?.activeYear ?? activeYear}년에서 ${targetYear}년으로 전환하시겠습니까?\n\n전환 후 모든 사용자의 활성 연도가 ${targetYear}년으로 변경됩니다.`)) return;

    setSaving(true);
    try {
      await updateSystemSettings({ activeYear: targetYear, updatedBy: userProfile.id });
      toast.success(`${targetYear}년으로 연도가 전환되었습니다.`);
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

        {/* 안내 */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1.5">
          <p className="font-semibold">연도 전환 주의사항</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>연도 전환 시 기존 데이터는 삭제되지 않습니다.</li>
            <li>이전 연도 데이터는 각 메뉴의 연도 탭에서 조회 가능합니다.</li>
            <li>연도 전환 후 새 연도의 목표, 평가 등을 새로 등록해야 합니다.</li>
            <li>평가기간 관리에서 새 연도 평가 기간을 별도로 설정하세요.</li>
            <li>주간 업무관리 데이터는 연도전환 전에 입력된 익년도 기록도 그대로 유지됩니다.</li>
          </ul>
        </div>

        {/* 주간 업무관리 데이터 보존 안내 */}
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 space-y-1.5">
          <p className="font-semibold">주간 업무관리 연도 전환 동작</p>
          <p className="text-xs">
            주간 업무관리는 실제 달력 날짜 기준으로 데이터가 저장됩니다.
            예를 들어 2027년 4월에 연도전환을 실행하더라도, 2027년 1월부터 작성된 주간 업무 데이터는
            모두 그대로 유지됩니다. 연도전환 시 주간 업무관리 데이터는 절대 삭제되지 않습니다.
          </p>
        </div>

      </div>
    </div>
  );
}
