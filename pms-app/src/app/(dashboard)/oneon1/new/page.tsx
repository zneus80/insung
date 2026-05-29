'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { createOneOnOne, getAllUsers, getOrganizations } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { User, Organization } from '@/types';

// ── 1on1 매칭 후보 산출 ─────────────────────────────────────
// 정책: "상위 결재권자" 또는 "본인이 수행자인 조직 산하 인원" 과만 매칭 가능.
//  - 팀원 → 본인 팀의 팀장, 본부장, 부문/공장 임원
//  - 팀장 → 본인 팀의 팀원 (downward) + 본부장 / 임원 (upward)
//  - 본부장 → 본인 본부 산하 팀장·팀원 (downward) + 임원 (upward)
//  - 임원 → 본인 부문/공장 산하 본부장·팀장·팀원 (downward)

type CandidateDirection = 'UP' | 'DOWN';

interface Candidate {
  user: User;
  direction: CandidateDirection;
  roleLabel: string;     // "팀장" / "본부장" / "임원" / "팀원" / "최고관리자"
  orgName: string;
}

function getRoleLabel(orgType: Organization['type'], userRole: User['role']): string {
  if (orgType === 'TEAM') {
    return userRole === 'TEAM_LEAD' ? '팀장' : '팀원';
  }
  if (orgType === 'HEADQUARTERS') {
    if (userRole === 'EXECUTIVE') return '본부장';
    if (userRole === 'TEAM_LEAD') return '본부장';
    return '본부 직속';
  }
  if (orgType === 'DIVISION') return '임원';
  if (orgType === 'COMPANY') return userRole === 'CEO' ? '최고관리자' : '임원';
  return '';
}

function getOneOnOneCandidates(
  meId: string,
  allUsers: User[],
  allOrgs: Organization[],
): Candidate[] {
  const me = allUsers.find(u => u.id === meId);
  if (!me) return [];

  const candidates: Candidate[] = [];
  const seen = new Set<string>([meId]);

  // ── 1) Upward — 본인 소속 조직 체인을 위로 올라가며 leader 수집 ──
  let current = allOrgs.find(o => o.id === me.organizationId);
  while (current) {
    let leaderId: string | null | undefined = current.leaderId;
    // leaderId 미설정 fallback: 해당 조직 소속 팀장/임원
    if (!leaderId) {
      const fb = allUsers.find(u =>
        u.organizationId === current!.id &&
        (u.role === 'TEAM_LEAD' || u.role === 'EXECUTIVE') &&
        u.isActive !== false &&
        u.id !== meId,
      );
      leaderId = fb?.id;
    }
    if (leaderId && !seen.has(leaderId)) {
      const leaderUser = allUsers.find(u => u.id === leaderId);
      if (leaderUser && leaderUser.isActive !== false) {
        candidates.push({
          user: leaderUser,
          direction: 'UP',
          roleLabel: getRoleLabel(current.type, leaderUser.role),
          orgName: current.name,
        });
        seen.add(leaderId);
      }
    }
    current = current.parentId ? allOrgs.find(o => o.id === current!.parentId) : undefined;
  }

  // ── 2) Downward — 본인이 leader 인 조직 산하 모든 인원 ──
  const myLedOrgs = allOrgs.filter(o => o.leaderId === meId);
  // leaderId 미지정 fallback: 본인이 팀장/임원이고 소속 조직의 leaderId 가 비어 있으면 본인이 그 조직 리더로 간주
  if (myLedOrgs.length === 0 && (me.role === 'TEAM_LEAD' || me.role === 'EXECUTIVE')) {
    const myOrg = allOrgs.find(o => o.id === me.organizationId);
    if (myOrg && !myOrg.leaderId) myLedOrgs.push(myOrg);
  }
  const descendantOrgIds = new Set<string>();
  function collectDescendants(orgId: string) {
    descendantOrgIds.add(orgId);
    for (const child of allOrgs.filter(o => o.parentId === orgId)) {
      collectDescendants(child.id);
    }
  }
  myLedOrgs.forEach(o => collectDescendants(o.id));

  for (const u of allUsers) {
    if (seen.has(u.id)) continue;
    if (u.isActive === false) continue;
    if (!descendantOrgIds.has(u.organizationId)) continue;
    const userOrg = allOrgs.find(o => o.id === u.organizationId);
    if (!userOrg) continue;
    candidates.push({
      user: u,
      direction: 'DOWN',
      roleLabel: getRoleLabel(userOrg.type, u.role),
      orgName: userOrg.name,
    });
    seen.add(u.id);
  }

  return candidates;
}

// 후보 정렬 우선순위: 위 → 아래, 같은 방향이면 역할 비중 (임원 > 본부장 > 팀장 > 팀원)
const ROLE_ORDER: Record<string, number> = { '임원': 1, '본부장': 2, '팀장': 3, '본부 직속': 4, '팀원': 5, '최고관리자': 0 };
function sortCandidates(a: Candidate, b: Candidate) {
  if (a.direction !== b.direction) return a.direction === 'UP' ? -1 : 1;
  const ra = ROLE_ORDER[a.roleLabel] ?? 99;
  const rb = ROLE_ORDER[b.roleLabel] ?? 99;
  if (ra !== rb) return ra - rb;
  return a.user.name.localeCompare(b.user.name, 'ko');
}

export default function NewOneOnOnePage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [counterpartId, setCounterpartId] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userProfile) return;
    Promise.all([getAllUsers(), getOrganizations()]).then(([users, orgs]) => {
      setAllUsers(users);
      setAllOrgs(orgs);
    });
  }, [userProfile]);

  const candidates = useMemo(() => {
    if (!userProfile) return [];
    return getOneOnOneCandidates(userProfile.id, allUsers, allOrgs).sort(sortCandidates);
  }, [userProfile, allUsers, allOrgs]);

  const upwardCandidates = candidates.filter(c => c.direction === 'UP');
  const downwardCandidates = candidates.filter(c => c.direction === 'DOWN');

  const selectedCandidate = candidates.find(c => c.user.id === counterpartId);
  const counterpartIsSenior = selectedCandidate?.direction === 'UP';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userProfile || !counterpartId || !selectedCandidate) return;
    setLoading(true);
    try {
      // leaderId = 상대적으로 senior 한 쪽, memberId = junior 한 쪽
      const id = await createOneOnOne({
        leaderId: counterpartIsSenior ? counterpartId : userProfile.id,
        memberId: counterpartIsSenior ? userProfile.id : counterpartId,
        organizationId: userProfile.organizationId,
        title: title.trim() || '',
      });
      toast.success('1on1 대화가 시작되었습니다.');
      router.push(`/oneon1/${id}`);
    } catch {
      toast.error('생성에 실패했습니다.');
      setLoading(false);
    }
  }

  function formatLabel(c: Candidate) {
    const pos = c.user.position ? ` (${c.user.position})` : '';
    return `${c.orgName} ${c.roleLabel} — ${c.user.name}${pos}`;
  }

  const hasAny = candidates.length > 0;

  return (
    <div className="flex flex-col h-full">
      <Header title="1on1 대화 시작" showBack />
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl border bg-white p-6 space-y-5">
            <h3 className="font-semibold text-gray-900">새 1on1 대화</h3>
            <p className="text-xs text-gray-500 -mt-2">
              본인 소속의 결재권자(팀장·본부장·임원) 또는 본인이 수행자인 조직 산하 인원과 대화할 수 있습니다.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="whitespace-nowrap">대화 상대 <span className="text-red-500">*</span></Label>
                {!hasAny ? (
                  <div className="rounded-lg border bg-gray-50 px-3 py-3 text-sm text-gray-500">
                    매칭 가능한 대화 상대가 없습니다.
                  </div>
                ) : (
                  <Select value={counterpartId} onValueChange={(v: string | null) => setCounterpartId(v ?? '')}>
                    <SelectTrigger>
                      {selectedCandidate
                        ? <span className="flex flex-1 text-left truncate">{formatLabel(selectedCandidate)}</span>
                        : <SelectValue placeholder="대화 상대를 선택하세요" />
                      }
                    </SelectTrigger>
                    <SelectContent>
                      {upwardCandidates.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-xs text-blue-600">↑ 상위 결재권자</SelectLabel>
                          {upwardCandidates.map(c => (
                            <SelectItem key={c.user.id} value={c.user.id}>
                              {formatLabel(c)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {downwardCandidates.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-xs text-emerald-600">↓ 소속 인원</SelectLabel>
                          {downwardCandidates.map(c => (
                            <SelectItem key={c.user.id} value={c.user.id}>
                              {formatLabel(c)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="whitespace-nowrap">주제 <span className="text-gray-400 text-xs">(선택)</span></Label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="예) 2분기 목표 점검, 커리어 상담"
                />
              </div>
              <Button type="submit" disabled={loading || !counterpartId} className="w-full">
                {loading ? '생성 중...' : '대화 시작'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
