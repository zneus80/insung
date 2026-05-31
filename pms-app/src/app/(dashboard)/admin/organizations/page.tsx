'use client';

import React, { useEffect, useState } from 'react';
import { getOrganizations, createOrganization, updateOrganization, deleteOrganization, getAllUsers, countOrgReferences, abandonGoalsForOrg } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AuthGuard from '@/components/layout/AuthGuard';
import { Plus, Pencil, Trash2, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import type { Organization, User } from '@/types';

type OrgType = Organization['type'];

const TYPE_LABEL: Record<OrgType, string> = {
  COMPANY:      '회사',
  DIVISION:     '부문/공장',
  HEADQUARTERS: '본부',
  TEAM:         '팀',
};
const TYPE_COLOR: Record<OrgType, string> = {
  COMPANY:      'bg-blue-100 text-blue-700',
  DIVISION:     'bg-purple-100 text-purple-700',
  HEADQUARTERS: 'bg-indigo-100 text-indigo-700',
  TEAM:         'bg-green-100 text-green-700',
};

const EMPTY_FORM = {
  name: '',
  type: 'TEAM' as OrgType,
  parentId: null as string | null,
  leaderId: null as string | null,
  displayOrder: '' as string, // 입력 편의를 위해 string 으로 다루다 저장 시 number 변환
};

// ── 트리 빌더 ────────────────────────────────────
interface OrgTreeNode {
  org: Organization;
  depth: number;
  prefix: string;   // 시각적 들여쓰기 접두사 (e.g. "│  ├─ ")
}

function buildOrgTree(orgs: Organization[]): OrgTreeNode[] {
  const childrenMap = new Map<string | null, Organization[]>();
  for (const org of orgs) {
    const pid = org.parentId ?? null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(org);
  }
  // 각 부모 단위의 자식들을 정렬:
  //  displayOrder 가 있는 항목 우선 (오름차순), 없는 항목은 그 뒤에 이름순
  childrenMap.forEach(arr => {
    arr.sort((a, b) => {
      const ao = a.displayOrder;
      const bo = b.displayOrder;
      const aHas = typeof ao === 'number' && !Number.isNaN(ao);
      const bHas = typeof bo === 'number' && !Number.isNaN(bo);
      if (aHas && bHas) {
        if (ao !== bo) return (ao as number) - (bo as number);
        return a.name.localeCompare(b.name, 'ko');
      }
      if (aHas) return -1;
      if (bHas) return 1;
      return a.name.localeCompare(b.name, 'ko');
    });
  });

  const result: OrgTreeNode[] = [];

  function traverse(parentId: string | null, depth: number, parentPrefix: string) {
    const children = childrenMap.get(parentId) ?? [];
    children.forEach((org, idx) => {
      const isLast = idx === children.length - 1;
      const connector = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');
      result.push({ org, depth, prefix: parentPrefix + connector });
      const nextPrefix = depth === 0 ? '' : parentPrefix + (isLast ? '   ' : '│  ');
      traverse(org.id, depth + 1, nextPrefix);
    });
  }

  traverse(null, 0, '');
  return result;
}

export default function OrganizationsPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <OrganizationsContent />
    </AuthGuard>
  );
}

function OrganizationsContent() {
  const { userProfile } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [leaderSearch, setLeaderSearch] = useState('');
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});

  async function load() {
    try {
      const [o, u] = await Promise.all([getOrganizations(), getAllUsers()]);
      setOrgs(o);
      setUsers(u);
    } catch (e: any) {
      console.error('조직/사용자 로드 실패:', e);
      toast.error(`데이터 로드 실패: ${e?.code ?? e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setLeaderSearch('');
    setShowDialog(true);
  }

  function openEdit(org: Organization) {
    setEditing(org);
    setForm({
      name: org.name, type: org.type, parentId: org.parentId, leaderId: org.leaderId,
      displayOrder: org.displayOrder != null ? String(org.displayOrder) : '',
    });
    setLeaderSearch('');
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.name) { toast.error('조직명을 입력하세요.'); return; }
    // 조직 부모/타입 변경 시 — 기존 목표 처리 옵션 제공 (v0.75 B14)
    let shouldAbandonGoals = false;
    if (editing) {
      const parentChanged = (editing.parentId ?? null) !== (form.parentId || null);
      const typeChanged   = editing.type !== form.type;
      if (parentChanged || typeChanged) {
        const refs = await countOrgReferences(editing.id);
        if (refs.goals > 0) {
          const labels: string[] = [];
          if (parentChanged) labels.push('상위 조직');
          if (typeChanged)   labels.push('조직 타입');
          // 1차 — 기존 목표 처리 의사 묻기
          shouldAbandonGoals = confirm(
            `${labels.join(' / ')} 변경 시 기존 목표 처리 방식\n\n` +
            `이 조직과 연결된 핵심목표 ${refs.goals}건이 있습니다.\n\n` +
            `[확인] 모든 목표를 자동 포기 확정 + 휴지통 이동 처리\n` +
            `[취소] 데이터는 유지하고 새 조직 구조에 맞춰 결재 라인이 자동 재구성됨`
          );
          // 2차 — 최종 진행 confirm (사용자에게 선택 결과 안내)
          const summary = shouldAbandonGoals
            ? `핵심목표 ${refs.goals}건을 모두 포기 처리하고 휴지통으로 이동합니다.`
            : `핵심목표는 그대로 유지되며, 새 조직 구조에 맞게 결재 라인이 재구성됩니다.`;
          if (!confirm(`${summary}\n\n진행하시겠습니까?`)) return;
        }
      }
    }
    setSaving(true);
    try {
      if (editing) {
        // "예" 선택 시 — 조직 변경 전에 기존 목표 포기·휴지통 처리
        if (shouldAbandonGoals && userProfile) {
          const processed = await abandonGoalsForOrg(editing.id, userProfile.id);
          if (processed > 0) toast.success(`기존 목표 ${processed}건이 포기 처리되었습니다.`);
        }
        const orderNum = form.displayOrder.trim() === '' ? undefined : Number(form.displayOrder);
        await updateOrganization(editing.id, {
          name: form.name, type: form.type,
          parentId: form.parentId || null,
          leaderId: form.leaderId || null,
          ...(orderNum !== undefined && !Number.isNaN(orderNum) ? { displayOrder: orderNum } : {}),
        });
        toast.success('조직 정보가 수정되었습니다.');
      } else {
        const orderNum = form.displayOrder.trim() === '' ? undefined : Number(form.displayOrder);
        await createOrganization({
          name: form.name, type: form.type,
          parentId: form.parentId || null,
          leaderId: form.leaderId || null,
          ...(orderNum !== undefined && !Number.isNaN(orderNum) ? { displayOrder: orderNum } : {}),
        });
        toast.success('조직이 추가되었습니다.');
      }
      setShowDialog(false);
      await load();
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const assigned = users.filter(u => u.organizationId === deleteTarget.id);
    if (assigned.length > 0) {
      toast.error(`소속 사용자 ${assigned.length}명이 있어 삭제할 수 없습니다.`);
      setDeleteTarget(null);
      return;
    }
    const hasChildren = orgs.some(o => o.parentId === deleteTarget.id);
    if (hasChildren) {
      toast.error('하위 조직이 있어 삭제할 수 없습니다.');
      setDeleteTarget(null);
      return;
    }

    // 연중 조직 변경 시 historical 데이터 영향 확인 (v0.75 B14)
    setDeleting(true);
    try {
      const refs = await countOrgReferences(deleteTarget.id);
      const total = refs.goals + refs.weeklyTasks + refs.annualGoals + refs.orgEvaluations;
      if (total > 0) {
        const details = [
          refs.goals > 0 ? `핵심목표 ${refs.goals}건` : '',
          refs.weeklyTasks > 0 ? `주간업무 ${refs.weeklyTasks}건` : '',
          refs.annualGoals > 0 ? `연간목표 ${refs.annualGoals}건` : '',
          refs.orgEvaluations > 0 ? `조직평가 ${refs.orgEvaluations}건` : '',
        ].filter(Boolean).join(', ');
        if (!confirm(
          `이 조직에 연결된 이력 데이터가 있습니다.\n  ${details}\n\n` +
          `삭제 시 해당 데이터는 보존되지만 조직 정보를 잃습니다.\n` +
          `(인사평가·이력 관리에 영향이 있을 수 있습니다)\n\n그래도 삭제하시겠습니까?`
        )) {
          setDeleting(false);
          return;
        }
      }
      await deleteOrganization(deleteTarget.id);
      toast.success(`${deleteTarget.name} 조직이 삭제되었습니다.`);
      setDeleteTarget(null);
      await load();
    } catch {
      toast.error('삭제에 실패했습니다.');
    } finally { setDeleting(false); }
  }

  // 순환 참조 방지: 편집 중인 조직과 그 하위 조직은 상위 조직 후보에서 제외
  function getDescendantIds(orgId: string): string[] {
    const ids: string[] = [orgId];
    for (const child of orgs.filter(o => o.parentId === orgId)) {
      ids.push(...getDescendantIds(child.id));
    }
    return ids;
  }
  const excludedFromParent = editing ? getDescendantIds(editing.id) : [];

  const treeNodes = buildOrgTree(orgs);
  const memberCountMap = users.reduce<Record<string, number>>((acc, u) => {
    if (u.organizationId) acc[u.organizationId] = (acc[u.organizationId] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      <Header title="조직 관리" />
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-6 overflow-hidden">

        {/* 안내 */}
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shrink-0">
          <strong>권장 등록 순서:</strong> 조직 등록 (책임자 없이) → 사용자 등록 (소속 지정) → 조직 수정으로 책임자 지정
        </div>

        <div className="flex justify-end shrink-0">
          <Button onClick={openNew} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> 조직 추가
          </Button>
        </div>

        {/* 조직도 테이블 */}
        <div className="flex-1 min-h-0 rounded-xl border bg-white overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left">조직명</th>
                <th className="px-4 py-3 text-left">구분</th>
                <th className="px-4 py-3 text-left">책임자</th>
                <th className="px-4 py-3 text-center">인원</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3].map(i => (
                  <tr key={i}><td colSpan={5} className="px-4 py-3">
                    <div className="h-4 animate-pulse rounded bg-gray-100" />
                  </td></tr>
                ))
              ) : treeNodes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                    등록된 조직이 없습니다.
                  </td>
                </tr>
              ) : treeNodes.map(({ org, depth, prefix }) => {
                const leader = users.find(u => u.id === org.leaderId);
                const memberCount = memberCountMap[org.id] ?? 0;
                const orgMembers = users.filter(u => u.organizationId === org.id);
                const isExpanded = expandedOrgs[org.id] ?? false;

                const ROLE_LABEL: Record<string, string> = {
                  EXECUTIVE: '임원', TEAM_LEAD: '팀장', MEMBER: '팀원', CEO: '대표', HR_ADMIN: 'HR',
                };

                return (
                  <React.Fragment key={org.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {prefix && (
                            <span className="font-mono text-xs text-gray-300 select-none whitespace-pre">
                              {prefix}
                            </span>
                          )}
                          <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold
                            ${org.type === 'COMPANY' ? 'bg-blue-100 text-blue-600' :
                              org.type === 'DIVISION' ? 'bg-purple-100 text-purple-600' :
                              org.type === 'HEADQUARTERS' ? 'bg-indigo-100 text-indigo-600' :
                              'bg-green-100 text-green-600'}`}>
                            {org.type === 'COMPANY' ? '사' : org.type === 'DIVISION' ? '부' : org.type === 'HEADQUARTERS' ? '본' : '팀'}
                          </span>
                          <span className={`font-medium text-gray-900 ${depth === 0 ? 'text-base' : ''}`}>
                            {org.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[org.type]}`}>
                          {TYPE_LABEL[org.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {leader ? (
                          <span>
                            {leader.name}
                            {leader.position && <span className="text-gray-400"> · {leader.position}</span>}
                          </span>
                        ) : (
                          <span className="text-gray-300">미지정</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {memberCount > 0 ? (
                          <button
                            onClick={() => setExpandedOrgs(p => ({ ...p, [org.id]: !isExpanded }))}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                          >
                            <Users className="h-3 w-3" />
                            {memberCount}
                            {isExpanded
                              ? <ChevronUp className="h-3 w-3" />
                              : <ChevronDown className="h-3 w-3" />}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(org)} className="p-1.5 rounded hover:bg-gray-100" title="수정">
                            <Pencil className="h-3.5 w-3.5 text-gray-400" />
                          </button>
                          <button onClick={() => setDeleteTarget(org)} className="p-1.5 rounded hover:bg-gray-100" title="삭제">
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${org.id}_members`} className="bg-blue-50/40">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {orgMembers.map(u => (
                              <div key={u.id} className="flex items-center gap-1.5 rounded-lg bg-white border border-blue-100 px-2.5 py-1.5">
                                <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 shrink-0">
                                  {u.name[0]}
                                </div>
                                <div className="text-xs">
                                  <MemberInfoModal userId={u.id} userName={u.name} />
                                  {u.position && <span className="ml-1 text-gray-400">{u.position}</span>}
                                  {u.role && (
                                    <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                                      {ROLE_LABEL[u.role] ?? u.role}
                                    </span>
                                  )}
                                  {!u.isActive && (
                                    <span className="ml-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-600">초대대기</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 삭제 확인 다이얼로그 */}
        <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>조직 삭제</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{deleteTarget?.name}</span> 조직을 삭제하시겠습니까?
              </p>
              <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
                소속 사용자가 있거나 하위 조직이 있는 경우 삭제할 수 없습니다.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)}>취소</Button>
                <Button variant="destructive" className="flex-1" disabled={deleting} onClick={handleDelete}>
                  {deleting ? '삭제 중...' : '삭제'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* 추가/수정 다이얼로그 */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? '조직 수정' : '조직 추가'}</DialogTitle>
            </DialogHeader>
            <div key={editing?.id ?? 'new'} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>조직명 *</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예) 생산2팀"
                />
              </div>
              <div className="space-y-1.5">
                <Label>구분 *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as OrgType }))}>
                  {/* SelectValue 에 명시적 children 전달 — Radix 의 자동 textContent 추출 실패(편집 폼처럼 값 먼저 set 되는 케이스) 회피 */}
                  <SelectTrigger><SelectValue>{TYPE_LABEL[form.type]}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as OrgType[]).map(t => (
                      <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>상위 조직</Label>
                <Select
                  value={form.parentId ?? ''}
                  onValueChange={v => setForm(f => ({ ...f, parentId: v || null }))}
                >
                  {/* 명시적 children — 편집 시 form.parentId 가 먼저 set 되어도 정상 표시 */}
                  <SelectTrigger>
                    <SelectValue placeholder="없음 (최상위)">
                      {form.parentId
                        ? (orgs.find(o => o.id === form.parentId)?.name ?? '없음 (최상위)')
                        : '없음 (최상위)'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">없음 (최상위)</SelectItem>
                    {treeNodes
                      .filter(n => !excludedFromParent.includes(n.org.id))
                      .map(({ org, prefix }) => (
                        <SelectItem key={org.id} value={org.id}>
                          {prefix}{org.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <LeaderPicker
                  users={users}
                  value={form.leaderId ?? ''}
                  search={leaderSearch}
                  onSearchChange={setLeaderSearch}
                  onChange={(id) => setForm(f => ({ ...f, leaderId: id || null }))}
                />
                {/* 겸직 정보 — 선택된 leader 가 이미 다른 조직 책임자인 경우 안내 */}
                {(() => {
                  if (!form.leaderId) return null;
                  const concurrent = orgs.filter(o =>
                    o.leaderId === form.leaderId && o.id !== editing?.id,
                  );
                  if (concurrent.length === 0) return null;
                  return (
                    <p className="text-xs text-amber-600">
                      ℹ️ 이 사용자는 이미 {concurrent.length}개 조직({concurrent.map(c => c.name).join(', ')}) 의 책임자입니다. 겸직으로 처리됩니다.
                    </p>
                  );
                })()}
              </div>
              {/* 부문/공장 표시 순서 — DIVISION 타입에만 노출 */}
              {form.type === 'DIVISION' && (
                <div className="space-y-1.5">
                  <Label>
                    표시 순서 <span className="text-gray-400 text-xs font-normal">(작은 값이 먼저 표시)</span>
                  </Label>
                  <Input
                    type="number"
                    value={form.displayOrder}
                    onChange={e => setForm(f => ({ ...f, displayOrder: e.target.value }))}
                    placeholder="예) 1, 2, 3"
                  />
                </div>
              )}
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? '저장 중...' : editing ? '수정' : '추가'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// ─── 책임자 검색 픽커 (조직 등록·수정 폼) ──────────────────
function LeaderPicker({
  users, value, search, onSearchChange, onChange,
}: {
  users: User[];
  value: string;
  search: string;
  onSearchChange: (s: string) => void;
  onChange: (id: string) => void;
}) {
  const selected = users.find(u => u.id === value);
  const filtered = (() => {
    if (!search.trim()) return users.slice(0, 10);
    const k = search.toLowerCase();
    return users.filter(u =>
      u.name.toLowerCase().includes(k)
      || (u.email ?? '').toLowerCase().includes(k)
      || (u.position ?? '').toLowerCase().includes(k)
    ).slice(0, 15);
  })();
  function label(u: User): string {
    const parts: string[] = [u.name];
    if (u.position) parts.push(`(${u.position})`);
    if (!u.isActive) parts.push('·초대대기');
    return parts.join(' ');
  }
  return (
    <>
      <Label>책임자 <span className="text-gray-400 text-xs font-normal">(나중에 지정 가능 · 검색 가능)</span></Label>
      {selected ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-gray-50">
          <span className="text-sm font-medium">{label(selected)}</span>
          {selected.email && <span className="text-xs text-gray-400 truncate">{selected.email}</span>}
          <button type="button" onClick={() => { onChange(''); onSearchChange(''); }} className="ml-auto text-gray-400 hover:text-red-500 text-xs">
            해제 ✕
          </button>
        </div>
      ) : (
        <>
          <Input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="이름·이메일·직책으로 검색"
          />
          {(search.trim() || filtered.length > 0) && (
            <div className="rounded-lg border max-h-56 overflow-y-auto divide-y bg-white mt-1.5">
              {filtered.length === 0 ? (
                <p className="text-xs text-gray-400 px-3 py-2">검색 결과 없음</p>
              ) : filtered.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { onChange(u.id); onSearchChange(''); }}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center gap-2"
                >
                  <span className="font-medium">{u.name}</span>
                  {u.position && <span className="text-xs text-gray-500">({u.position})</span>}
                  {!u.isActive && <span className="text-xs text-amber-600">·초대대기</span>}
                  {u.email && <span className="text-xs text-gray-400 ml-auto truncate">{u.email}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
