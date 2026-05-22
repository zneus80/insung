'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { COLLECTIONS, getGradeQuotas } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AuthGuard from '@/components/layout/AuthGuard';
import { toast } from 'sonner';
import type { EvaluationGrade } from '@/types';

const GRADES: EvaluationGrade[] = ['A', 'B', 'C', 'D', 'E'];

export default function SettingsPage() {
  return (
    <AuthGuard requireHrAdmin>
      <SettingsContent />
    </AuthGuard>
  );
}

function SettingsContent() {
  // 쿼터: orgGrade → { A, B, C, D, E } 비율 (%, 합계 100)
  const [quotas, setQuotas] = useState<Record<EvaluationGrade, Record<EvaluationGrade, number>>>({
    A: { A: 10, B: 30, C: 50, D: 10, E: 0 },
    B: { A: 0,  B: 20, C: 60, D: 10, E: 10 },
    C: { A: 0,  B: 10, C: 70, D: 10, E: 10 },
    D: { A: 0,  B: 0,  C: 60, D: 30, E: 10 },
    E: { A: 0,  B: 0,  C: 40, D: 30, E: 30 },
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const rawQuotas = await getGradeQuotas();
      if (rawQuotas.length > 0) {
        const qMap = { ...quotas };
        rawQuotas.forEach((q: any) => {
          if (qMap[q.orgGrade as EvaluationGrade]) {
            qMap[q.orgGrade as EvaluationGrade][q.memberGrade as EvaluationGrade] = q.count;
          }
        });
        setQuotas(qMap);
      }
    }
    load();
  }, []);

  async function saveQuotas() {
    setSaving(true);
    try {
      const writes = GRADES.flatMap(og =>
        GRADES.map(mg =>
          setDoc(doc(db, COLLECTIONS.GRADE_QUOTAS, `${og}-${mg}`), {
            orgGrade: og, memberGrade: mg, count: quotas[og][mg],
          })
        )
      );
      await Promise.all(writes);
      toast.success('쿼터 설정이 저장되었습니다.');
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="개인평가등급 설정" />
      <div className="flex-1 overflow-y-auto p-6 space-y-8">

        <p className="text-sm text-gray-500">
          조직평가 등급별 개인 평가등급 비율을 설정합니다.
          평가 기간은 <span className="font-medium text-gray-700">평가기간 관리</span> 페이지에서 설정하세요.
        </p>

        {/* 등급 쿼터 */}
        <section className="rounded-xl border bg-white p-6 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900">개인 평가등급 쿼터 설정</h3>
            <p className="text-xs text-gray-500 mt-1">
              조직평가 등급별 개인 평가등급 비율(%)을 입력하세요. 각 행의 합계가 100%가 되어야 합니다.
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              소수점 0.8 이상 올림 적용 · 초과 시 낮은 등급 감소, 미달 시 높은 등급 증가
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center">
              <thead>
                <tr className="text-gray-500 text-xs">
                  <th className="py-2 px-3 text-left">조직등급 \ 개인등급</th>
                  {GRADES.map(g => <th key={g} className="py-2 px-3">{g}등급</th>)}
                  <th className="py-2 px-3">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {GRADES.map(og => {
                  const rowSum = GRADES.reduce((s, mg) => s + (quotas[og][mg] ?? 0), 0);
                  const isValid = rowSum === 100;
                  return (
                    <tr key={og}>
                      <td className="py-2 px-3 text-left font-medium text-gray-700">{og}등급 조직</td>
                      {GRADES.map(mg => (
                        <td key={mg} className="py-2 px-2">
                          <div className="relative w-20 mx-auto">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              className="w-20 text-center pr-5"
                              value={quotas[og][mg]}
                              onChange={e => setQuotas(q => ({
                                ...q,
                                [og]: { ...q[og], [mg]: Math.max(0, Math.min(100, Number(e.target.value))) }
                              }))}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                          </div>
                        </td>
                      ))}
                      <td className={`py-2 px-3 font-semibold text-sm ${isValid ? 'text-green-600' : 'text-red-500'}`}>
                        {rowSum}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {GRADES.some(og => GRADES.reduce((s, mg) => s + (quotas[og][mg] ?? 0), 0) !== 100) && (
            <p className="text-xs text-red-500">각 행의 합계가 100%가 되어야 저장할 수 있습니다.</p>
          )}
          <Button
            onClick={saveQuotas}
            disabled={saving || GRADES.some(og => GRADES.reduce((s, mg) => s + (quotas[og][mg] ?? 0), 0) !== 100)}
            size="sm"
          >
            저장
          </Button>
        </section>
      </div>
    </div>
  );
}
