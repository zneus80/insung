'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getAnnualGoal,
  setAnnualGoal,
  getAllOrgAnnualGoals,
  getOrganizations,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import AuthGuard from '@/components/layout/AuthGuard';
import { Building2, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { AnnualGoal, Organization } from '@/types';

export default function AnnualGoalsPage() {
  return (
    <AuthGuard requireHrAdmin>
      <AnnualGoalsContent />
    </AuthGuard>
  );
}

function AnnualGoalsContent() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [orgGoals, setOrgGoals] = useState<Record<string, AnnualGoal>>({});
  const [loading, setLoading] = useState(true);

  // 편집 상태
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraft, setCompanyDraft] = useState('');
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [orgDraft, setOrgDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [orgList, cGoal, oGoals] = await Promise.all([
        getOrganizations(),
        getAnnualGoal('company', year),
        getAllOrgAnnualGoals(year),
      ]);
      setOrgs(orgList.filter(o => o.type === 'DIVISION' || o.type === 'HEADQUARTERS'));
      setCompanyGoal(cGoal);
      setOrgGoals(Object.fromEntries(oGoals.map(g => [g.organizationId!, g])));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function saveCompanyGoal() {
    if (!userProfile || !companyDraft.trim()) return;
    setSaving(true);
    try {
      await setAnnualGoal('company', year, { content: companyDraft.trim(), updatedBy: userProfile.id });
      toast.success('회사 목표가 저장되었습니다.');
      setEditingCompany(false);
      await load();
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function saveOrgGoal(orgId: string) {
    if (!userProfile || !orgDraft.trim()) return;
    setSaving(true);
    try {
      await setAnnualGoal('org', year, { content: orgDraft.trim(), updatedBy: userProfile.id, organizationId: orgId });
      toast.success('조직 목표가 저장되었습니다.');
      setEditingOrgId(null);
      await load();
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="연간 목표 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">

        <p className="text-sm text-gray-500">{year}년 회사 및 조직별 목표를 입력합니다.</p>

        {/* 회사 목표 */}
        <section className="rounded-xl border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              {year}년 회사 목표
            </h3>
            {!editingCompany && (
              <button
                onClick={() => { setCompanyDraft(companyGoal?.content ?? ''); setEditingCompany(true); }}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              >
                <Pencil className="h-3.5 w-3.5" /> 편집
              </button>
            )}
          </div>

          {editingCompany ? (
            <div className="space-y-2">
              <Textarea
                rows={4}
                value={companyDraft}
                onChange={e => setCompanyDraft(e.target.value)}
                placeholder="회사의 당해년도 목표를 입력하세요"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditingCompany(false)} className="gap-1">
                  <X className="h-3.5 w-3.5" /> 취소
                </Button>
                <Button size="sm" disabled={saving || !companyDraft.trim()} onClick={saveCompanyGoal} className="gap-1">
                  <Check className="h-3.5 w-3.5" /> 저장
                </Button>
              </div>
            </div>
          ) : companyGoal ? (
            <div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{companyGoal.content}</p>
              <p className="mt-2 text-xs text-gray-400">
                마지막 수정: {format(companyGoal.updatedAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">아직 입력된 목표가 없습니다. 편집을 눌러 입력하세요.</p>
          )}
        </section>

        {/* 조직별 목표 */}
        <section className="space-y-3">
          <h3 className="font-semibold text-gray-900">{year}년 부문/공장 목표</h3>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : orgs.map(org => {
            const goal = orgGoals[org.id];
            const isEditing = editingOrgId === org.id;
            return (
              <div key={org.id} className="rounded-xl border bg-white p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900 text-sm">{org.name}</h4>
                  {!isEditing && (
                    <button
                      onClick={() => { setOrgDraft(goal?.content ?? ''); setEditingOrgId(org.id); }}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                    >
                      <Pencil className="h-3.5 w-3.5" /> 편집
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      rows={3}
                      value={orgDraft}
                      onChange={e => setOrgDraft(e.target.value)}
                      placeholder={`${org.name}의 ${year}년 목표를 입력하세요`}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setEditingOrgId(null)} className="gap-1">
                        <X className="h-3.5 w-3.5" /> 취소
                      </Button>
                      <Button size="sm" disabled={saving || !orgDraft.trim()} onClick={() => saveOrgGoal(org.id)} className="gap-1">
                        <Check className="h-3.5 w-3.5" /> 저장
                      </Button>
                    </div>
                  </div>
                ) : goal ? (
                  <div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{goal.content}</p>
                    <p className="mt-2 text-xs text-gray-400">
                      마지막 수정: {format(goal.updatedAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">아직 입력된 목표가 없습니다.</p>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
