'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarDays, Eye } from 'lucide-react';

interface EvalPeriod {
  year: number;
  startDate: Date;
  endDate: Date;
  publishedAt?: Date;
  isPublished: boolean;
  updatedBy: string;
}

const CURRENT_YEAR = new Date().getFullYear();

export default function EvaluationPeriodPage() {
  return (
    <AuthGuard allowedRoles={[]} requireHrAdmin>
      <EvaluationPeriodContent />
    </AuthGuard>
  );
}

function EvaluationPeriodContent() {
  const { userProfile } = useAuth();
  const [period, setPeriod] = useState<EvalPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

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
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

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

      </div>
    </div>
  );
}
