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
import { CalendarDays, Eye, RefreshCw } from 'lucide-react';

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
  const { activeYear: CURRENT_YEAR } = useActiveYear();
  const [period, setPeriod] = useState<EvalPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [nextYearExists, setNextYearExists] = useState(false);

  const docId = `${CURRENT_YEAR}`;

  async function load() {
    const [snap, nextSnap] = await Promise.all([
      getDoc(doc(db, 'evaluationPeriods', docId)),
      getDoc(doc(db, 'evaluationPeriods', `${CURRENT_YEAR + 1}`)),
    ]);
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
    }
    setNextYearExists(nextSnap.exists());
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

  async function handleRestart() {
    if (!period?.isPublished) { toast.error('현재 연도 평가가 공개 완료된 후에 다음 연도 평가를 시작할 수 있습니다.'); return; }
    if (nextYearExists) { toast.error(`${CURRENT_YEAR + 1}년 평가 기간이 이미 존재합니다.`); return; }
    if (!confirm(`${CURRENT_YEAR + 1}년 평가를 새로 시작하시겠습니까?\n다음 연도 평가 기간 문서가 생성됩니다.`)) return;
    if (!userProfile) return;
    setRestarting(true);
    try {
      const nextYear = CURRENT_YEAR + 1;
      await setDoc(doc(db, 'evaluationPeriods', `${nextYear}`), {
        year: nextYear,
        startDate: Timestamp.fromDate(new Date(`${nextYear}-01-01`)),
        endDate: Timestamp.fromDate(new Date(`${nextYear}-12-31`)),
        isPublished: false,
        publishedAt: null,
        updatedBy: userProfile.id,
        updatedAt: serverTimestamp(),
      });
      toast.success(`${nextYear}년 평가가 시작되었습니다. 평가 기간을 설정해주세요.`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? '재시작 실패');
    } finally {
      setRestarting(false);
    }
  }

  async function handlePublish() {
    if (!period) { toast.error('먼저 평가 기간을 저장하세요.'); return; }
    if (!confirm('평가 결과를 전체 팀원에게 공개하시겠습니까?\n공개 후에는 취소할 수 없습니다.')) return;
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

  return (
    <div className="flex flex-col h-full">
      <Header title="평가기간 관리" />
      <div className="flex-1 overflow-y-auto p-6 max-w-xl space-y-6">

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
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={period?.isPublished} />
          </div>
          <div className="space-y-2">
            <Label>평가 종료일</Label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={period?.isPublished} />
          </div>

          {!period?.isPublished && (
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? '저장 중...' : '저장'}
            </Button>
          )}
        </div>

        {/* 평가결과 공개 */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="h-5 w-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">평가결과 공개</h2>
          </div>
          <p className="text-sm text-gray-500">
            공개 후 팀원·팀장이 본인의 최종 평가등급을 확인할 수 있습니다.
            공개 후에는 취소할 수 없습니다.
          </p>
          <Button
            onClick={handlePublish}
            disabled={publishing || period?.isPublished || !period}
            variant={period?.isPublished ? 'outline' : 'default'}
            className={`w-full ${period?.isPublished ? '' : 'bg-purple-600 hover:bg-purple-700'}`}
          >
            {period?.isPublished ? '이미 공개됨' : publishing ? '공개 중...' : '전체 공개하기'}
          </Button>
        </div>

        {/* 다음 연도 평가 재시작 */}
        {period?.isPublished && (
          <div className="rounded-xl border bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="h-5 w-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">{CURRENT_YEAR + 1}년 평가 시작</h2>
            </div>
            <p className="text-sm text-gray-500">
              {CURRENT_YEAR}년 평가가 완료되었습니다. 다음 연도 평가 사이클을 시작할 수 있습니다.
            </p>
            {nextYearExists ? (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-700">
                ✅ {CURRENT_YEAR + 1}년 평가 기간이 이미 생성되어 있습니다.
              </div>
            ) : (
              <Button
                onClick={handleRestart}
                disabled={restarting}
                variant="outline"
                className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {restarting ? '생성 중...' : `${CURRENT_YEAR + 1}년 평가 시작하기`}
              </Button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
