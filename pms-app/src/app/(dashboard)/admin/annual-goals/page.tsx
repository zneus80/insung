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
import { shiftEnterSubmit } from '@/lib/utils';
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

// 기존 데이터(items 없음, content 만 또는 구버전 items.content)를 표시용 items 배열로 변환
// — 신규 스키마: { subject, detail }
function toItems(goal: AnnualGoal | undefined | null): AnnualGoalItem[] {
  if (!goal) return [];
  if (goal.items && goal.items.length > 0) {
    return goal.items.map(it => {
      // 구버전 호환: content 만 있으면 subject 로 마이그레이션
      if (it.subject === undefined && it.detail === undefined && it.content !== undefined) {
        return { id: it.id, subject: it.content, detail: '' };
      }
      return { id: it.id, subject: it.subject ?? '', detail: it.detail ?? '' };
    });
  }
  if (goal.content) return [{ id: crypto.randomUUID(), subject: goal.content, detail: '' }];
  return [];
}

function AnnualGoalsContent() {
  const { userProfile } = useAuth();
  const { activeYear: year } = useActiveYear();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [companyGoal, setCompanyGoal] = useState<AnnualGoal | null>(null);
  const [orgGoals, setOrgGoals] = useState<Record<string, AnnualGoal>>({});
  const [loading, setLoading] = useState(true);

  // 회사 목표 편집 상태 — 조직 목표와 동일하게 items(주제+세부전략) 구조
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraftItems, setCompanyDraftItems] = useState<AnnualGoalItem[]>([]);

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

  function startEditCompany() {
    const existing = toItems(companyGoal);
    setCompanyDraftItems(existing.length > 0 ? existing : [{ id: crypto.randomUUID(), subject: '', detail: '' }]);
    setEditingCompany(true);
  }
  function addCompanyItem() {
    setCompanyDraftItems(prev => [...prev, { id: crypto.randomUUID(), subject: '', detail: '' }]);
  }
  function updateCompanyItem(id: string, patch: Partial<AnnualGoalItem>) {
    setCompanyDraftItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
  }
  function removeCompanyItem(id: string) {
    setCompanyDraftItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev);
  }
  async function saveCompanyGoal() {
    if (!userProfile) return;
    const trimmed = companyDraftItems
      .map(i => ({ id: i.id, subject: (i.subject ?? '').trim(), detail: (i.detail ?? '').trim() }))
      .filter(i => i.subject || i.detail);
    setSaving(true);
    try {
      await setAnnualGoal('company', year, { items: trimmed, updatedBy: userProfile.id });
      toast.success(trimmed.length === 0 ? '회사 목표를 비워두었습니다.' : '회사 목표가 저장되었습니다.');
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
    setOrgDraftItems(existing.length > 0 ? existing : [{ id: crypto.randomUUID(), subject: '', detail: '' }]);
    setEditingOrgId(org.id);
  }

  function addOrgItem() {
    setOrgDraftItems(prev => [...prev, { id: crypto.randomUUID(), subject: '', detail: '' }]);
  }

  function updateOrgItem(id: string, patch: Partial<AnnualGoalItem>) {
    setOrgDraftItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
  }

  function removeOrgItem(id: string) {
    setOrgDraftItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev);
  }

  async function saveOrgGoal(orgId: string) {
    if (!userProfile) return;
    // 주제 또는 세부전략 중 하나라도 입력된 항목만 저장. 둘 다 비우면 삭제.
    const trimmed = orgDraftItems
      .map(i => ({ id: i.id, subject: (i.subject ?? '').trim(), detail: (i.detail ?? '').trim() }))
      .filter(i => i.subject || i.detail);
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

        {/* 회사 목표 — 조직 목표와 동일한 주제·세부전략 구조 */}
        <section className="rounded-xl border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              {year}년 회사 경영목표
            </h3>
            {!editingCompany && (
              <button
                onClick={startEditCompany}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              >
                <Pencil className="h-3.5 w-3.5" /> 편집
              </button>
            )}
          </div>

          {editingCompany ? (
            <div className="space-y-4">
              {companyDraftItems.map((it, idx) => (
                <div key={it.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500">목표 #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeCompanyItem(it.id)}
                      disabled={companyDraftItems.length <= 1}
                      className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="목표 제거"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">주제</label>
                    <Input
                      value={it.subject ?? ''}
                      onChange={e => updateCompanyItem(it.id, { subject: e.target.value })}
                      placeholder="목표 주제 (예: 글로벌 시장 점유율 확대)"
                      className="font-bold text-base bg-white"
                      autoFocus={idx === companyDraftItems.length - 1}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">세부전략 (줄바꿈 가능)</label>
                    <Textarea
                      rows={4}
                      value={it.detail ?? ''}
                      onChange={e => updateCompanyItem(it.id, { detail: e.target.value })}
                      onKeyDown={shiftEnterSubmit(saveCompanyGoal, !saving)}
                      placeholder={`세부 추진 전략·계획·KPI 등을 입력하세요.\n· 줄바꿈으로 항목 구분 가능 (Shift+Enter 저장)`}
                      className="text-sm bg-white"
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addCompanyItem}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-3.5 w-3.5" /> 목표 추가
              </button>
              <div className="flex gap-2 justify-end pt-2">
                <Button size="sm" variant="outline" onClick={() => setEditingCompany(false)} className="gap-1">
                  <X className="h-3.5 w-3.5" /> 취소
                </Button>
                <Button size="sm" disabled={saving} onClick={saveCompanyGoal} className="gap-1">
                  <Check className="h-3.5 w-3.5" /> 저장
                </Button>
              </div>
            </div>
          ) : toItems(companyGoal).length > 0 ? (
            <div>
              <ol className="space-y-3 list-none">
                {toItems(companyGoal).map((it, idx) => (
                  <li key={it.id} className="flex items-start gap-3">
                    <span className="text-xs font-semibold text-gray-400 mt-1 shrink-0 w-6">#{idx + 1}</span>
                    <div className="flex-1 space-y-1">
                      {(it.subject ?? it.content) && (
                        <p className="text-base font-bold text-gray-900 leading-snug">{it.subject ?? it.content}</p>
                      )}
                      {it.detail && (
                        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{it.detail}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {companyGoal && (
                <p className="mt-3 text-xs text-gray-400">
                  마지막 수정: {format(companyGoal.updatedAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
                </p>
              )}
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
                    <div className="space-y-4">
                      {orgDraftItems.map((it, idx) => (
                        <div key={it.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500">목표 #{idx + 1}</span>
                            <button
                              type="button"
                              onClick={() => removeOrgItem(it.id)}
                              disabled={orgDraftItems.length <= 1}
                              className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="목표 제거"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-600">주제</label>
                            <Input
                              value={it.subject ?? ''}
                              onChange={e => updateOrgItem(it.id, { subject: e.target.value })}
                              placeholder="목표 주제 (예: 글로벌 영업망 확장)"
                              className="font-bold text-base bg-white"
                              autoFocus={idx === orgDraftItems.length - 1}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-600">세부전략 (줄바꿈 가능)</label>
                            <Textarea
                              rows={4}
                              value={it.detail ?? ''}
                              onChange={e => updateOrgItem(it.id, { detail: e.target.value })}
                              onKeyDown={shiftEnterSubmit(() => saveOrgGoal(org.id), !saving)}
                              placeholder={`세부 추진 전략·계획·KPI 등을 입력하세요.\n· 줄바꿈으로 항목 구분 가능 (Shift+Enter 저장)`}
                              className="text-sm bg-white"
                            />
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addOrgItem}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
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
                      <ol className="space-y-3 list-none">
                        {items.map((it, idx) => (
                          <li key={it.id} className="flex items-start gap-3">
                            <span className="text-xs font-semibold text-gray-400 mt-1 shrink-0 w-6">#{idx + 1}</span>
                            <div className="flex-1 space-y-1">
                              {(it.subject ?? it.content) && (
                                <p className="text-base font-bold text-gray-900 leading-snug">{it.subject ?? it.content}</p>
                              )}
                              {it.detail && (
                                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{it.detail}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                      {orgGoals[org.id] && (
                        <p className="mt-3 text-xs text-gray-400">
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
