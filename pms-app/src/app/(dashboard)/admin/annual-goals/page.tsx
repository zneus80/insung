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
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import AuthGuard from '@/components/layout/AuthGuard';
import { Building2, Pencil, Check, X, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { AnnualGoal, AnnualGoalItem, Organization } from '@/types';

export default function AnnualGoalsPage() {
  return (
    <AuthGuard requireHrAdmin>
      <AnnualGoalsContent />
    </AuthGuard>
  );
}

// 기존 데이터(items 없음, content 만)를 표시용 items 배열로 변환
function toItems(goal: AnnualGoal | undefined | null): AnnualGoalItem[] {
  if (!goal) return [];
  if (goal.items && goal.items.length > 0) return goal.items;
  if (goal.content) return [{ id: crypto.randomUUID(), content: goal.content }];
  return [];
}

function AnnualGoalsContent() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [orgGoals, setOrgGoals] = useState<Record<string, AnnualGoal>>({});
  const [loading, setLoading] = useState(true);

  // 회사 목표 편집 상태
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraft, setCompanyDraft] = useState('');

  // 조직별 편집 상태 (orgId → 편집 중인 items 배열)
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [orgDraftItems, setOrgDraftItems] = useState<AnnualGoalItem[]>([]);

  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [orgList, cGoal, oGoals] = await Promise.all([
        getOrganizations(),
        getAnnualGoal('company', year),
        getAllOrgAnnualGoals(year),
      ]);
      // 부문/공장(DIVISION) 만 표시. 본부·팀은 별도 관리하지 않음.
      setOrgs(orgList.filter(o => o.type === 'DIVISION').sort(compareOrgByDisplayOrder));
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

  function startEditOrg(org: Organization) {
    const existing = toItems(orgGoals[org.id]);
    setOrgDraftItems(existing.length > 0 ? existing : [{ id: crypto.randomUUID(), content: '' }]);
    setEditingOrgId(org.id);
  }

  function addOrgItem() {
    setOrgDraftItems(prev => [...prev, { id: crypto.randomUUID(), content: '' }]);
  }

  function updateOrgItem(id: string, content: string) {
    setOrgDraftItems(prev => prev.map(i => (i.id === id ? { ...i, content } : i)));
  }

  function removeOrgItem(id: string) {
    setOrgDraftItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev);
  }

  async function saveOrgGoal(orgId: string) {
    if (!userProfile) return;
    // 부문/공장 목표는 비워둘 수 있음 (모두 빈 입력이면 빈 배열로 저장)
    const trimmed = orgDraftItems.map(i => ({ ...i, content: i.content.trim() })).filter(i => i.content);
    setSaving(true);
    try {
      await setAnnualGoal('org', year, {
        items: trimmed,
        updatedBy: userProfile.id,
        organizationId: orgId,
      });
      toast.success(trimmed.length === 0 ? '조직 목표를 비워두었습니다.' : '조직 목표가 저장되었습니다.');
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

        <p className="text-sm text-gray-500">{year}년 회사 및 부문/공장 목표를 입력합니다.</p>

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
                placeholder="회사의 당해년도 경영목표를 입력하세요"
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

        {/* 부문/공장 목표 — 조직별 복수 입력 */}
        <section className="space-y-3">
          <h3 className="font-semibold text-gray-900">{year}년 부문/공장 목표</h3>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-gray-400">등록된 부문/공장 조직이 없습니다.</p>
          ) : (
            orgs.map(org => {
              const items = toItems(orgGoals[org.id]);
              const isEditing = editingOrgId === org.id;
              return (
                <div key={org.id} className="rounded-xl border bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">{org.name}</h4>
                    {!isEditing && (
                      <button
                        onClick={() => startEditOrg(org)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                      >
                        <Pencil className="h-3.5 w-3.5" /> 편집
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      {orgDraftItems.map((it, idx) => (
                        <div key={it.id} className="flex items-start gap-2">
                          <span className="text-xs font-semibold text-gray-400 mt-2.5 shrink-0 w-6">#{idx + 1}</span>
                          <Input
                            value={it.content}
                            onChange={e => updateOrgItem(it.id, e.target.value)}
                            placeholder={`목표 ${idx + 1}`}
                            className="flex-1"
                            autoFocus={idx === orgDraftItems.length - 1}
                          />
                          <button
                            type="button"
                            onClick={() => removeOrgItem(it.id)}
                            disabled={orgDraftItems.length <= 1}
                            className="p-2 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="목표 제거"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addOrgItem}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-2"
                      >
                        <Plus className="h-3.5 w-3.5" /> 목표 추가
                      </button>
                      <div className="flex gap-2 justify-end pt-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingOrgId(null)} className="gap-1">
                          <X className="h-3.5 w-3.5" /> 취소
                        </Button>
                        <Button size="sm" disabled={saving} onClick={() => saveOrgGoal(org.id)} className="gap-1">
                          <Check className="h-3.5 w-3.5" /> 저장
                        </Button>
                      </div>
                    </div>
                  ) : items.length > 0 ? (
                    <div>
                      <ol className="space-y-1.5 list-none">
                        {items.map((it, idx) => (
                          <li key={it.id} className="flex items-start gap-2 text-sm text-gray-700">
                            <span className="text-xs font-semibold text-gray-400 mt-0.5 shrink-0 w-6">#{idx + 1}</span>
                            <span className="whitespace-pre-wrap leading-relaxed flex-1">{it.content}</span>
                          </li>
                        ))}
                      </ol>
                      {orgGoals[org.id] && (
                        <p className="mt-2 text-xs text-gray-400">
                          마지막 수정: {format(orgGoals[org.id].updatedAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">아직 입력된 목표가 없습니다.</p>
                  )}
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
