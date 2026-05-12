'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { createGoal, addGoalHistory, getAnnualGoal, getOrganizations } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import GoalForm, { type GoalFormValues } from '@/components/goals/GoalForm';
import { toast } from 'sonner';
import { Building2, LayoutList, ChevronDown, ChevronUp } from 'lucide-react';
import type { AnnualGoal, Organization } from '@/types';

function findAncestorOfType(
  orgId: string,
  type: Organization['type'],
  allOrgs: Organization[]
): Organization | null {
  let current = allOrgs.find(o => o.id === orgId) ?? null;
  while (current) {
    if (current.type === type) return current;
    if (!current.parentId) return null;
    current = allOrgs.find(o => o.id === current!.parentId) ?? null;
  }
  return null;
}

export default function NewGoalPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const year = new Date().getFullYear();
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [divisionGoal, setDivisionGoal] = useState<AnnualGoal | null>(null);
  const [divisionName, setDivisionName] = useState('');
  const [guideOpen, setGuideOpen] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    async function loadGuide() {
      const [cGoal, orgs] = await Promise.all([
        getAnnualGoal('company', year),
        getOrganizations(),
      ]);
      setCompanyGoal(cGoal);
      const division = findAncestorOfType(userProfile!.organizationId, 'DIVISION', orgs);
      if (division) {
        setDivisionName(division.name);
        const dGoal = await getAnnualGoal('org', year, division.id);
        setDivisionGoal(dGoal);
      }
    }
    loadGuide();
  }, [userProfile]);

  async function handleSubmit(values: GoalFormValues) {
    if (!userProfile) return;
    setLoading(true);
    try {
      const goalId = await createGoal({
        userId: userProfile.id,
        organizationId: userProfile.organizationId,
        cycleYear: year,
        goalType: 'TASK',
        title: values.title,
        description: values.description,
        dueDate: new Date(values.dueDate),
        weight: values.weight,
        status: 'DRAFT',
        progress: 0,
      });
      await addGoalHistory({
        goalId, changedBy: userProfile.id,
        changeType: 'CREATED', newStatus: 'DRAFT', comment: '목표 등록',
      });
      toast.success('목표가 등록되었습니다.');
      router.push(`/goals/${goalId}`);
    } catch (e) {
      console.error(e);
      toast.error('목표 등록에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="목표 등록" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">

          {/* 연간 목표 가이드 */}
          {(companyGoal || divisionGoal) && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
              <button
                className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-blue-800"
                onClick={() => setGuideOpen(v => !v)}
              >
                <span>📋 {year}년 목표 가이드 — 아래 목표를 참고하여 개인 목표를 설정하세요</span>
                {guideOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {guideOpen && (
                <div className="grid grid-cols-1 gap-px bg-blue-200 border-t border-blue-200 lg:grid-cols-2">
                  <div className="bg-white px-5 py-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600 uppercase tracking-wide">
                      <Building2 className="h-3.5 w-3.5" /> {year}년 회사 경영목표
                    </div>
                    {companyGoal
                      ? <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{companyGoal.content}</p>
                      : <p className="text-sm text-gray-400">미입력</p>}
                  </div>
                  <div className="bg-white px-5 py-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 uppercase tracking-wide">
                      <LayoutList className="h-3.5 w-3.5" /> {divisionName || '소속 부문'} 목표
                    </div>
                    {divisionGoal
                      ? <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{divisionGoal.content}</p>
                      : <p className="text-sm text-gray-400">미입력</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 목표 작성 폼 */}
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">새 목표 작성</h3>
              <p className="text-sm text-gray-500 mt-1">
                작성 후 팀장에게 승인 요청을 해야 목표가 확정됩니다.
              </p>
            </div>
            <div className="rounded-xl border bg-white p-6">
              <GoalForm onSubmit={handleSubmit} submitLabel="초안 저장" isLoading={loading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
