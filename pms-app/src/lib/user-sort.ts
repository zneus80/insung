import type { User } from '@/types';

/**
 * 인원 표준 정렬 — 역할 우선순위: 임원(EXECUTIVE) → 팀장(TEAM_LEAD) → 팀원(MEMBER).
 * CEO 는 최상위(0). 동일 역할은 입사일(hireDate) → 이름 순.
 */
export function roleRank(role: User['role'] | string | undefined): number {
  switch (role) {
    case 'CEO': return 0;
    case 'EXECUTIVE': return 1;
    case 'TEAM_LEAD': return 2;
    case 'MEMBER': return 3;
    default: return 9;
  }
}

/** 입사일(YYYY-MM-DD) → 이름. hireDate 없는 사람은 뒤로. */
export function compareByHireThenName(a: User, b: User): number {
  const ha = a.hireDate ?? '';
  const hb = b.hireDate ?? '';
  if (ha && !hb) return -1;
  if (!ha && hb) return 1;
  if (ha !== hb) return ha.localeCompare(hb);
  return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
}

/**
 * 표준 인원 정렬: 역할(임원→팀장→팀원) → 입사일(이른 순) → 이름.
 * 같은 조직(팀) 내 목록, 또는 조직 그룹 내 2차 정렬에 사용.
 */
export function compareUserByRoleHire(a: User, b: User): number {
  const ra = roleRank(a.role);
  const rb = roleRank(b.role);
  if (ra !== rb) return ra - rb;
  return compareByHireThenName(a, b);
}
