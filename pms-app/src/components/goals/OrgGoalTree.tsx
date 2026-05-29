'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { ChevronDown, ChevronRight, Users, Target, LayoutList, Lock } from 'lucide-react';
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
import type { Goal, Organization, User, AnnualGoal } from '@/types';

// ── 유틸 ─────────────────────────────────────────
export function findDescendantIds(orgId: string, allOrgs: Organization[]): string[] {
  const ids: string[] = [orgId];
  for (const child of allOrgs.filter(o => o.parentId === orgId)) {
    ids.push(...findDescendantIds(child.id, allOrgs));
  }
  return ids;
}

// ── 트리 펼침 상태 영속화 (sessionStorage) ─────────
// persistKey 가 주어지면 조직/인원 펼침 상태를 보존 → 상세 페이지 다녀온 뒤에도 동일하게 복원.
function readOpen(persistKey: string | undefined, kind: 'org' | 'member', id: string, fallback: boolean): boolean {
  if (!persistKey || typeof window === 'undefined') return fallback;
  try {
    const v = sessionStorage.getItem(`treeopen:${persistKey}:${kind}:${id}`);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* 무시 */ }
  return fallback;
}
function writeOpen(persistKey: string | undefined, kind: 'org' | 'member', id: string, val: boolean) {
  if (!persistKey || typeof window === 'undefined') return;
  try { sessionStorage.setItem(`treeopen:${persistKey}:${kind}:${id}`, val ? '1' : '0'); } catch { /* 무시 */ }
}

export function avgProgress(goals: Goal[]): number {
  const active = goals.filter(g => !['ABANDONED', 'REJECTED'].includes(g.status));
  if (!active.length) return 0;
  return Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length);
}

// ── 트리 타입 ─────────────────────────────────────
export interface OrgNode {
  org: Organization;
  members: User[];
  goals: Goal[];
  children: OrgNode[];
}

export function buildTree(
  parentId: string | null,
  allOrgs: Organization[],
  usersByOrg: Record<string, User[]>,
  goalsByUser: Record<string, Goal[]>
): OrgNode[] {
  return allOrgs
    .filter(o => {
      if (parentId === null) {
        // 최상위 호출: 진짜 root(parentId 없음) + scope 밖에 부모가 있는 조직(orphan) 도 root 로
        if (!o.parentId) return true;
        return !allOrgs.some(p => p.id === o.parentId);
      }
      return o.parentId === parentId;
    })
    .slice()
    .sort(compareOrgByDisplayOrder)
    .map(org => {
      const members = usersByOrg[org.id] ?? [];
      const goals = members.flatMap(u => goalsByUser[u.id] ?? []);
      return { org, members, goals, children: buildTree(org.id, allOrgs, usersByOrg, goalsByUser) };
    });
}

// ── 타입별 스타일 ─────────────────────────────────
const TYPE_COLOR: Record<string, string> = {
  COMPANY:      'bg-blue-100 text-blue-700',
  DIVISION:     'bg-purple-100 text-purple-700',
  HEADQUARTERS: 'bg-indigo-100 text-indigo-700',
  TEAM:         'bg-green-100 text-green-700',
};
const TYPE_LABEL: Record<string, string> = {
  COMPANY: '회사', DIVISION: '부문/공장', HEADQUARTERS: '본부', TEAM: '팀',
};

// ── 구성원 + 목표 행 ──────────────────────────────
function MemberGoalRow({ user, goals, persistKey, defaultMemberOpen = false }: { user: User; goals: Goal[]; persistKey?: string; defaultMemberOpen?: boolean }) {
  const [open, setOpen] = useState(() => readOpen(persistKey, 'member', user.id, defaultMemberOpen));
  const avg = avgProgress(goals);
  const hasGoals = goals.length > 0;
  // 임원/최고관리자는 개인 목표가 없으므로 목표 없으면 행 미표시 ('목표 없음' 표기 대상 아님)
  if (!hasGoals && (user.role === 'EXECUTIVE' || user.role === 'CEO')) return null;

  function toggle() {
    if (!hasGoals) return;  // 목표 없으면 펼침 비활성
    setOpen(v => { const n = !v; writeOpen(persistKey, 'member', user.id, n); return n; });
  }

  return (
    <div className="ml-2">
      <div
        className={`flex items-center gap-3 rounded-lg px-3 py-2 ${hasGoals ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
        onClick={toggle}
      >
        <span className="text-gray-300 w-4 shrink-0">
          {hasGoals
            ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)
            : null}
        </span>
        {/* 아이콘 클릭 시 개인 프로필 모달 (10-2-3-8) */}
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600 hover:bg-blue-100 hover:text-blue-600 transition-colors"
          onClick={e => e.stopPropagation()}
          title="프로필 보기"
        >
          <MemberInfoModal userId={user.id} userName={user.name[0]} />
        </div>
        <span className={`text-sm flex-1 ${hasGoals ? 'text-gray-800' : 'text-gray-400'}`}>
          {user.name}
          {user.position && <span className="ml-1 text-sm text-gray-400">· {user.position}</span>}
        </span>
        {hasGoals ? (
          <>
            <span className="flex items-center gap-1 text-sm text-gray-400 shrink-0">
              <Target className="h-3.5 w-3.5" />{goals.length}개
            </span>
            <div className="flex items-center gap-2 shrink-0 w-36">
              <Progress value={avg} className="h-1.5 flex-1" />
              <span className="text-sm font-medium text-gray-600 w-8 text-right">{avg}%</span>
            </div>
          </>
        ) : (
          <span className="text-xs text-gray-400 shrink-0">목표 없음</span>
        )}
      </div>
      {open && hasGoals && (
        <div className="ml-9 space-y-1 mt-1 mb-2">
          {goals.map(goal => {
            // 단순화된 배지 (F3): 최종승인/진행중 · 완료 · 포기 만 노출
            const badge = goal.status === 'COMPLETED'
              ? { label: '완료', cls: 'bg-green-100 text-green-700' }
              : goal.status === 'ABANDONED'
                ? { label: '포기', cls: 'bg-gray-100 text-gray-500' }
                : { label: '최종승인/진행중', cls: 'bg-blue-100 text-blue-700' };
            return (
            <Link key={goal.id} href={`/goals/${goal.id}`}>
              <div className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2 hover:shadow-sm transition-shadow">
                <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0', badge.cls)}>
                  {badge.label}
                </span>
                <span className="flex-1 text-sm text-gray-800 truncate flex items-center gap-1.5">
                  {goal.isConfidential && <span title="대내비"><Lock className="h-3 w-3 shrink-0 text-red-500" /></span>}
                  {goal.title}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Progress value={goal.progress} className="h-1.5 w-16" />
                  <span className="text-sm text-gray-500 w-8 text-right">{goal.progress}%</span>
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 조직 트리 노드 ────────────────────────────────
export function OrgTreeNode({
  node,
  depth = 0,
  orgGoalMap = {},
  persistKey,
  defaultOpenDepth = 2,
  defaultMemberOpen = false,
}: {
  node: OrgNode;
  depth?: number;
  orgGoalMap?: Record<string, AnnualGoal>;
  persistKey?: string;
  /** 기본 펼침 깊이 — depth < defaultOpenDepth 인 조직 노드는 처음에 열린 상태 (기본 2). 팀까지 펼치려면 3+ */
  defaultOpenDepth?: number;
  /** 개인 목표 행을 기본 펼침 상태로 표시 (기본 false) */
  defaultMemberOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => readOpen(persistKey, 'org', node.org.id, depth < defaultOpenDepth));
  const avg = avgProgress(node.goals);
  const orgAnnualGoal = orgGoalMap[node.org.id];

  function toggle() {
    setOpen(v => { const n = !v; writeOpen(persistKey, 'org', node.org.id, n); return n; });
  }

  return (
    <div className={depth > 0 ? 'ml-5 border-l border-gray-200 pl-4' : ''}>
      <div
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
        onClick={toggle}
      >
        <span className="text-gray-400 w-4 shrink-0">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-sm font-semibold shrink-0 ${TYPE_COLOR[node.org.type] ?? 'bg-gray-100 text-gray-600'}`}>
          {TYPE_LABEL[node.org.type] ?? node.org.type}
        </span>
        <span className="font-medium text-gray-900 flex-1">{node.org.name}</span>
        <span className="flex items-center gap-1 text-sm text-gray-400 shrink-0">
          <Users className="h-3.5 w-3.5" />{node.members.length}명
        </span>
        {node.goals.length > 0 && (
          <div className="flex items-center gap-2 shrink-0 w-36">
            <Progress value={avg} className="h-1.5 flex-1" />
            <span className="text-sm font-medium text-gray-600 w-8 text-right">{avg}%</span>
          </div>
        )}
      </div>

      {/* 핵심목표업무 */}
      {orgAnnualGoal?.content && (
        <div className="mx-3 mb-1 flex items-start gap-1.5 rounded-lg bg-green-50 border border-green-100 px-3 py-2">
          <LayoutList className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
          <p className="text-xs text-green-800 leading-relaxed whitespace-pre-wrap">{orgAnnualGoal.content}</p>
        </div>
      )}

      {open && (
        <div className="ml-4 space-y-1 mt-1">
          {node.members.map(member => (
            <MemberGoalRow key={member.id} user={member} goals={node.goals.filter(g => g.userId === member.id)} persistKey={persistKey} defaultMemberOpen={defaultMemberOpen} />
          ))}
          {node.children.map(child => (
            <OrgTreeNode key={child.org.id} node={child} depth={depth + 1} orgGoalMap={orgGoalMap} persistKey={persistKey} defaultOpenDepth={defaultOpenDepth} defaultMemberOpen={defaultMemberOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
